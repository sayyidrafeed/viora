import type { SQL } from 'bun'
import { Admin, MessagesStreamFallbackModes, MessagesStreamModes, type Consumer, type MessagesStream } from '@platformatic/kafka'
import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { dlqTopic, envelopeSchema, headers, retryTopic, type DataSchemas, type EventEnvelope } from '@viora/contracts'
import { createConsumer, type KafkaMessage, type KafkaProducer } from './kafka.ts'
import { identifier } from './outbox.ts'

export class PermanentError extends Error {}

export type Handler = (event: EventEnvelope, message: KafkaMessage) => Promise<void>

export type Outcome = {
  stage: 'main' | 'retry'
  result: 'ok' | 'retry' | 'dlq'
  eventId: string | undefined
  attempt: number
  error?: string
}

export type ConsumerOptions = {
  group: string
  topic: string
  brokers: string[]
  producer: KafkaProducer
  handle: Handler
  dataSchemas?: DataSchemas
  // Jeda antar-percobaan di tahap 1; jumlah percobaan = panjang array + 1.
  backoffMs?: number[]
  retryDelayMs?: number
  onOutcome?: (outcome: Outcome) => void
  onFatal?: (error: unknown) => void
}

const DEFAULT_BACKOFF_MS = [200, 1_000]
const DEFAULT_RETRY_DELAY_MS = 60_000

const jitter = (ms: number) => ms / 2 + Math.random() * ms

function parseEvent(value: string, dataSchemas: DataSchemas | undefined): EventEnvelope {
  const envelope = envelopeSchema.safeParse(JSON.parse(value))
  if (!envelope.success) throw new PermanentError(`envelope tidak valid: ${envelope.error.message}`)
  const schema = dataSchemas?.[envelope.data.type]
  if (!schema) return envelope.data
  const data = schema.safeParse(envelope.data.data)
  if (!data.success) throw new PermanentError(`data ${envelope.data.type} tidak valid: ${data.error.message}`)
  return { ...envelope.data, data: data.data }
}

// Tahap 1 (di dalam proses), tahap 2 (topic retry tertunda), tahap 3 (DLQ). Lihat grand plan §6.
export class EventConsumer {
  private readonly main: Consumer<string, string, string, string>
  private readonly retry: Consumer<string, string, string, string>
  private readonly streams: MessagesStream<string, string, string, string>[] = []
  private loops: Promise<void>[] = []
  private fatal: unknown

  constructor(private readonly opts: ConsumerOptions) {
    this.main = createConsumer(opts.group, `${opts.group}-main`, opts.brokers)
    this.retry = createConsumer(`retry.${opts.group}`, `${opts.group}-retry`, opts.brokers)
  }

  // Dipakai sebagai readiness/liveness probe: loop yang mati membuat pod di-restart dan pesan dikirim ulang dari offset terakhir.
  get ready() {
    return this.fatal === undefined && this.main.isActive() && this.retry.isActive()
  }

  // Topic retry dan DLQ milik consumer group ini (§6), jadi group yang membuatnya. Retensi 14 hari (§10).
  private async ensureGroupTopics(): Promise<void> {
    const admin = new Admin({ clientId: `${this.opts.group}-admin`, bootstrapBrokers: this.opts.brokers })
    try {
      const existing = new Set(await admin.listTopics())
      const missing = [retryTopic(this.opts.group, this.opts.topic), dlqTopic(this.opts.group, this.opts.topic)].filter(
        (t) => !existing.has(t),
      )
      if (missing.length === 0) return
      await admin.createTopics({
        topics: missing,
        partitions: 1,
        replicas: -1,
        configs: [{ name: 'retention.ms', value: String(14 * 24 * 60 * 60 * 1000) }],
      })
    } finally {
      await admin.close()
    }
  }

  async start(): Promise<void> {
    await this.ensureGroupTopics()
    const mode = { mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST }
    const main = await this.main.consume({ topics: [this.opts.topic], ...mode })
    const retry = await this.retry.consume({ topics: [retryTopic(this.opts.group, this.opts.topic)], ...mode })
    this.streams.push(main, retry)
    this.loops = [this.loop(main, 'main'), this.loop(retry, 'retry')]
  }

  async stop(): Promise<void> {
    await Promise.all(this.streams.map((s) => s.close()))
    await Promise.allSettled(this.loops)
    await Promise.all([this.main.close(true), this.retry.close(true)])
  }

  // Gagal memindahkan pesan ke retry/DLQ atau gagal commit tidak boleh melewati pesan: loop berhenti tanpa commit.
  private async loop(stream: AsyncIterable<KafkaMessage>, stage: Outcome['stage']) {
    try {
      for await (const message of stream) {
        if (stage === 'retry') {
          const notBefore = Number(message.headers.get(headers.retryNotBefore) ?? 0)
          const wait = notBefore - Date.now()
          if (wait > 0) await Bun.sleep(wait)
        }
        await this.traced(message, stage)
        await message.commit()
      }
    } catch (err) {
      this.fatal = err
      this.opts.onFatal?.(err)
    }
  }

  // Span consumer memakai link ke konteks producer di header record, sesuai spesifikasi messaging OpenTelemetry (§6 Tracing).
  private async traced(message: KafkaMessage, stage: Outcome['stage']) {
    const producerContext = trace.getSpanContext(propagation.extract(context.active(), Object.fromEntries(message.headers)))
    const tracer = trace.getTracer('@viora/service-kit')
    await tracer.startActiveSpan(
      `process ${message.topic}`,
      {
        kind: SpanKind.CONSUMER,
        links: producerContext ? [{ context: producerContext }] : [],
        attributes: {
          'messaging.system': 'kafka',
          'messaging.destination.name': message.topic,
          'messaging.consumer.group.name': this.opts.group,
          'messaging.kafka.offset': Number(message.offset),
        },
      },
      async (span) => {
        try {
          await this.process(message, stage)
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw err
        } finally {
          span.end()
        }
      },
    )
  }

  // x-attempt = total percobaan handler sejauh ini, lintas tahap (§6: DLQ membawa jumlah percobaan).
  private async process(message: KafkaMessage, stage: Outcome['stage']) {
    const priorAttempts = Number(message.headers.get(headers.attempt) ?? 0)
    let event: EventEnvelope
    try {
      event = parseEvent(message.value, this.opts.dataSchemas)
    } catch (err) {
      return this.park(message, stage, undefined, priorAttempts, err)
    }

    const run = await this.runWithBackoff(event, message)
    const attempts = priorAttempts + run.tries
    if (run.ok) return this.report({ stage, result: 'ok', eventId: event.id, attempt: attempts })
    if (stage === 'main' && !(run.error instanceof PermanentError)) return this.deferRetry(message, event, attempts, run.error)
    return this.park(message, stage, event.id, attempts, run.error)
  }

  private async runWithBackoff(
    event: EventEnvelope,
    message: KafkaMessage,
  ): Promise<{ ok: true; tries: number } | { ok: false; tries: number; error: unknown }> {
    const delays = this.opts.backoffMs ?? DEFAULT_BACKOFF_MS
    for (let i = 0; ; i++) {
      try {
        await this.opts.handle(event, message)
        return { ok: true, tries: i + 1 }
      } catch (error) {
        const delay = delays[i]
        if (error instanceof PermanentError || delay === undefined) return { ok: false, tries: i + 1, error }
        await Bun.sleep(jitter(delay))
      }
    }
  }

  private async deferRetry(message: KafkaMessage, event: EventEnvelope, attempts: number, error: unknown) {
    await this.opts.producer.send({
      messages: [
        {
          topic: retryTopic(this.opts.group, this.opts.topic),
          key: message.key,
          value: message.value,
          headers: {
            ...this.forwardHeaders(message),
            [headers.attempt]: String(attempts),
            [headers.retryNotBefore]: String(Date.now() + (this.opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)),
            [headers.error]: errorText(error),
          },
        },
      ],
    })
    this.report({ stage: 'main', result: 'retry', eventId: event.id, attempt: attempts, error: errorText(error) })
  }

  private async park(message: KafkaMessage, stage: Outcome['stage'], eventId: string | undefined, attempts: number, error: unknown) {
    await this.opts.producer.send({
      messages: [
        {
          topic: dlqTopic(this.opts.group, this.opts.topic),
          key: message.key,
          value: message.value,
          headers: { ...this.forwardHeaders(message), [headers.attempt]: String(attempts), [headers.error]: errorText(error) },
        },
      ],
    })
    this.report({ stage, result: 'dlq', eventId, attempt: attempts, error: errorText(error) })
  }

  // Header trace ikut diteruskan; asal pesan dicatat sekali dari topic utama dan dipertahankan di tahap berikutnya.
  private forwardHeaders(message: KafkaMessage): Record<string, string> {
    const out: Record<string, string> = {}
    for (const key of [headers.traceparent, headers.tracestate, headers.originTopic, headers.originPartition, headers.originOffset]) {
      const v = message.headers.get(key)
      if (v !== undefined) out[key] = v
    }
    out[headers.originTopic] ??= message.topic
    out[headers.originPartition] ??= String(message.partition)
    out[headers.originOffset] ??= String(message.offset)
    return out
  }

  private report(outcome: Outcome) {
    this.opts.onOutcome?.(outcome)
  }
}

const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 1000)

export const processedEventsDdl = (schema: string) => `
  create table if not exists ${identifier(schema)}.processed_events (
    consumer_group text not null,
    event_id uuid not null,
    processed_at timestamptz not null default now(),
    primary key (consumer_group, event_id)
  );`

// Klaim event_id di awal transaksi: pengiriman kedua yang bersamaan menunggu di unique index sampai yang pertama commit,
// lalu mendapat konflik dan dilewati. Efek eksternal dijalankan di dalam fn sebelum commit (efek dulu, lalu commit).
export async function processOnce(
  sql: SQL,
  schema: string,
  group: string,
  eventId: string,
  fn: (tx: SQL) => Promise<void>,
): Promise<'applied' | 'duplicate'> {
  return sql.begin(async (tx) => {
    const claimed = await tx.unsafe(
      `insert into ${identifier(schema)}.processed_events (consumer_group, event_id) values ($1, $2) on conflict do nothing returning 1`,
      [group, eventId],
    )
    if (claimed.length === 0) return 'duplicate'
    await fn(tx)
    return 'applied'
  })
}
