// Walking skeleton M0: outbox → relay → Redpanda → consumer (retry bertahap, DLQ), terhadap Postgres dan Redpanda asli.
// Butuh `bun run dev:infra`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { sql as q } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import { Admin, MessagesStreamModes } from '@platformatic/kafka'
import { dlqTopic, headers, retryTopic, type EventEnvelope } from '@viora/contracts'
import {
  createConsumer,
  createProducer,
  EventConsumer,
  OutboxRelay,
  outboxDdl,
  processedEventsDdl,
  processOnce,
  writeOutbox,
  type KafkaMessage,
  type Outcome,
} from '../src/index.ts'

const brokers = [process.env.KAFKA_BROKERS ?? '127.0.0.1:19092']
const sql = new SQL(process.env.DATABASE_URL ?? 'postgres://viora:viora-dev@127.0.0.1:15432/viora', { max: 10 })
const db = drizzle({ client: sql })
const run = Date.now().toString(36)
const owner = `skel_owner_${run}`
const feed = `skel_feed_${run}`
const topic = `video.v1.${run}`
const group = `feed-svc-${run}`
const admin = new Admin({ clientId: 'skel-admin', bootstrapBrokers: brokers })
const producer = createProducer('skel', brokers)

type VideoData = { videoId: string; title: string; stateVersion: number }

// Pengganti Meilisearch/KV/Redis: menerima versi yang sama atau lebih baru (aturan efek eksternal §6).
const external = {
  store: new Map<string, { title: string; version: number }>(),
  calls: [] as { eventId: string; version: number; accepted: boolean }[],
  put(eventId: string, d: VideoData) {
    const cur = this.store.get(d.videoId)
    const accepted = !cur || d.stateVersion >= cur.version
    if (accepted) this.store.set(d.videoId, { title: d.title, version: d.stateVersion })
    this.calls.push({ eventId, version: d.stateVersion, accepted })
  },
}

// Skenario dipicu lewat judul: berapa kali handler dipaksa gagal, dan kapan.
const failPlan = new Map<string, { remaining: number; when: 'before-effect' | 'after-effect' }>()
const slowTitles = new Set<string>()
const processLog: { eventId: string; topic: string; result: 'applied' | 'duplicate'; start: number; end: number }[] = []
const outcomes: Outcome[] = []

async function handle(event: EventEnvelope, message: KafkaMessage) {
  const d = event.data as VideoData
  const start = performance.now()
  const result = await processOnce(sql, feed, group, event.id, async (tx) => {
    const plan = failPlan.get(d.title)
    const fail = plan && plan.remaining > 0 ? (plan.remaining--, plan.when) : undefined
    if (fail === 'before-effect') throw new Error('gagal sementara')
    if (slowTitles.has(d.title)) await Bun.sleep(500)
    external.put(event.id, d)
    if (fail === 'after-effect') throw new Error('proses mati setelah efek, sebelum commit')
    await tx.unsafe(
      `insert into ${feed}.video_card (id, title, state_version) values ($1, $2, $3)
       on conflict (id) do update set title = excluded.title, state_version = excluded.state_version
       where video_card.state_version < excluded.state_version`,
      [d.videoId, d.title, d.stateVersion],
    )
  })
  processLog.push({ eventId: event.id, topic: message.topic, result, start, end: performance.now() })
}

const consumer = new EventConsumer({
  group,
  topic,
  brokers,
  producer,
  handle,
  backoffMs: [10, 20],
  retryDelayMs: 1_500,
  onOutcome: (o) => outcomes.push(o),
})
const relay = new OutboxRelay({ sql, schema: owner, producer, lockKey: 4242n, pollMs: 50 })

async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error('timeout menunggu kondisi')
    await Bun.sleep(25)
  }
}

async function updateVideo(id: string, title: string) {
  return db.transaction(async (tx) => {
    const [row] = (await tx.execute(
      q`insert into ${q.raw(owner)}.video (id, title, state_version) values (${id}, ${title}, 1)
       on conflict (id) do update set title = excluded.title, state_version = video.state_version + 1
       returning state_version`,
    )) as unknown as { state_version: number }[]
    return writeOutbox<VideoData>(tx, owner, {
      topic,
      type: 'video.metadata_updated',
      key: id,
      data: { videoId: id, title, stateVersion: row!.state_version },
    })
  })
}

const card = async (id: string) =>
  (await sql.unsafe(`select title, state_version from ${feed}.video_card where id = $1`, [id]))[0] as
    | { title: string; state_version: number }
    | undefined

beforeAll(async () => {
  await sql.unsafe(`
    create schema ${owner};
    create table ${owner}.video (id text primary key, title text not null, state_version int not null);
    ${outboxDdl(owner, 'video-svc')}
    create schema ${feed};
    create table ${feed}.video_card (id text primary key, title text not null, state_version int not null);
    ${processedEventsDdl(feed)}`)
  await admin.createTopics({ topics: [topic], partitions: 3, replicas: 1 })
})

afterAll(async () => {
  await consumer.stop()
  await relay.stop()
  await producer.close()
  await admin.deleteTopics({ topics: [topic, retryTopic(group, topic), dlqTopic(group, topic)] })
  await admin.close()
  await sql.unsafe(`drop schema ${owner} cascade; drop schema ${feed} cascade`)
  await sql.close()
})

describe('relay outbox', () => {
  test('transaksi yang commit belakangan tidak tersusul transaksi yang mulai belakangan (filter xmin)', async () => {
    const xmin = `${owner}_xmin`
    const xminTopic = `${topic}.xmin`
    await sql.unsafe(`create schema ${xmin}; ${outboxDdl(xmin, 'skel')}`)
    await admin.createTopics({ topics: [xminTopic], partitions: 1, replicas: 1 })
    const manual = new OutboxRelay({ sql, schema: xmin, producer, lockKey: 4343n })
    expect(await manual.tryBecomeLeader()).toBe(true)

    const connA = await sql.reserve()
    await connA.unsafe('begin')
    const emit = `select ${xmin}.outbox_emit($1, 'video.metadata_updated', $2, '{}'::jsonb) as e`
    const [a] = await connA.unsafe(emit, [xminTopic, 'x1'])
    const [b] = await sql.begin((tx) => tx.unsafe(emit, [xminTopic, 'x2']))

    expect(await manual.tick()).toEqual([])
    await connA.unsafe('commit')
    connA.release()

    let published: string[] = []
    await until(async () => (published = await manual.tick()).length > 0)
    expect(published).toEqual([a.e.id, b.e.id])

    await manual.stop()
    await sql.unsafe(`drop schema ${xmin} cascade`)
    await admin.deleteTopics({ topics: [xminTopic] })
  })

  test('hanya satu relay yang menjadi leader; yang lain mengambil alih setelah leader berhenti', async () => {
    const r1 = new OutboxRelay({ sql, schema: owner, producer, lockKey: 4444n })
    const r2 = new OutboxRelay({ sql, schema: owner, producer, lockKey: 4444n })
    expect(await r1.tryBecomeLeader()).toBe(true)
    expect(await r2.tryBecomeLeader()).toBe(false)
    await r1.stop()
    expect(await r2.tryBecomeLeader()).toBe(true)
    await r2.stop()
  })
})

describe('consumer', () => {
  beforeAll(async () => {
    relay.start()
    await consumer.start()
    await until(() => consumer.ready, 30_000)
  }, 40_000)

  test('jalur normal: perubahan di tabel pemilik sampai ke proyeksi dan efek eksternal', async () => {
    const t0 = performance.now()
    const e = await updateVideo('v-happy', 'Judul awal')
    await until(async () => (await card('v-happy'))?.state_version === 1)
    console.log(`  latensi outbox → proyeksi: ${Math.round(performance.now() - t0)} ms`)
    expect(external.store.get('v-happy')).toEqual({ title: 'Judul awal', version: 1 })
    expect(outcomes.find((o) => o.eventId === e.id)).toMatchObject({ stage: 'main', result: 'ok' })
  })

  test('balapan: event lama yang selesai di retry tidak menimpa versi baru yang lewat consumer utama', async () => {
    failPlan.set('judul-v1-gagal', { remaining: 3, when: 'before-effect' })
    const v1 = await updateVideo('v-race', 'judul-v1-gagal')
    await until(() => outcomes.some((o) => o.eventId === v1.id && o.result === 'retry'))
    const v2 = await updateVideo('v-race', 'judul-v2')
    await until(() => outcomes.some((o) => o.eventId === v1.id && o.stage === 'retry' && o.result === 'ok'), 20_000)

    const v2ok = outcomes.findIndex((o) => o.eventId === v2.id && o.result === 'ok')
    const v1RetryOk = outcomes.findIndex((o) => o.eventId === v1.id && o.stage === 'retry')
    expect(v2ok).toBeGreaterThanOrEqual(0)
    expect(v2ok).toBeLessThan(v1RetryOk)

    expect(await card('v-race')).toEqual({ title: 'judul-v2', state_version: 2 })
    expect(external.store.get('v-race')).toEqual({ title: 'judul-v2', version: 2 })
    expect(external.calls.filter((c) => c.eventId === v1.id)).toEqual([{ eventId: v1.id, version: 1, accepted: false }])
  }, 30_000)

  test('balapan: event yang sama di consumer utama dan retry bersamaan hanya diterapkan sekali', async () => {
    slowTitles.add('judul-dobel')
    const [row] = await sql.unsafe(
      `insert into ${owner}.video (id, title, state_version) values ('v-dup', 'judul-dobel', 1) returning state_version`,
    )
    const event: EventEnvelope = {
      id: Bun.randomUUIDv7(),
      type: 'video.metadata_updated',
      version: 1,
      occurredAt: new Date().toISOString(),
      producer: 'video-svc',
      key: 'v-dup',
      data: { videoId: 'v-dup', title: 'judul-dobel', stateVersion: row.state_version },
    }
    const value = JSON.stringify(event)
    await producer.send({
      messages: [
        { topic, key: 'v-dup', value },
        { topic: retryTopic(group, topic), key: 'v-dup', value, headers: { [headers.attempt]: '1', [headers.retryNotBefore]: '0' } },
      ],
    })
    await until(() => processLog.filter((p) => p.eventId === event.id).length === 2)

    const runs = processLog.filter((p) => p.eventId === event.id).toSorted((x, y) => x.start - y.start)
    expect(runs.map((r) => r.result).toSorted()).toEqual(['applied', 'duplicate'])
    expect(new Set(runs.map((r) => r.topic)).size).toBe(2)
    expect(runs[1]!.start).toBeLessThan(runs[0]!.end)
    expect(external.calls.filter((c) => c.eventId === event.id)).toHaveLength(1)
  })

  test('proses mati setelah efek sebelum commit: pengiriman ulang menerapkan efek yang sama, hasil tetap benar', async () => {
    failPlan.set('judul-crash', { remaining: 1, when: 'after-effect' })
    const e = await updateVideo('v-crash', 'judul-crash')
    await until(async () => (await card('v-crash'))?.state_version === 1)

    expect(external.calls.filter((c) => c.eventId === e.id)).toEqual([
      { eventId: e.id, version: 1, accepted: true },
      { eventId: e.id, version: 1, accepted: true },
    ])
    expect(external.store.get('v-crash')).toEqual({ title: 'judul-crash', version: 1 })
    const [n] = await sql.unsafe(`select count(*)::int as n from ${feed}.processed_events where event_id = $1`, [e.id])
    expect(n.n).toBe(1)
  })

  test('DLQ: envelope rusak langsung diparkir, kegagalan menetap lewat retry dulu lalu diparkir', async () => {
    await producer.send({ messages: [{ topic, key: 'v-bad', value: JSON.stringify({ hello: 'bukan envelope' }) }] })
    failPlan.set('judul-selalu-gagal', { remaining: Number.POSITIVE_INFINITY, when: 'before-effect' })
    const e = await updateVideo('v-dlq', 'judul-selalu-gagal')

    await until(() => outcomes.some((o) => o.eventId === e.id && o.result === 'dlq'), 20_000)
    await until(() => outcomes.some((o) => o.eventId === undefined && o.result === 'dlq'))
    expect(outcomes.filter((o) => o.eventId === e.id).map((o) => `${o.stage}:${o.result}`)).toEqual([
      'main:retry',
      'retry:dlq',
    ])

    const reader = createConsumer(`dlq-reader-${run}`, 'dlq-reader', brokers)
    const stream = await reader.consume({ topics: [dlqTopic(group, topic)], mode: MessagesStreamModes.EARLIEST })
    const parked: KafkaMessage[] = []
    for await (const m of stream) {
      parked.push(m)
      if (parked.length === 2) break
    }
    await stream.close()
    await reader.close()

    const byKey = new Map(parked.map((m) => [m.key, m]))
    expect(byKey.get('v-bad')?.headers.get(headers.error)).toContain('envelope tidak valid')
    expect(byKey.get('v-bad')?.headers.get(headers.attempt)).toBe('0')
    expect(byKey.get('v-dlq')?.headers.get(headers.attempt)).toBe('6')
    expect(byKey.get('v-dlq')?.headers.get(headers.originTopic)).toBe(topic)
    expect(byKey.get('v-dlq')?.headers.get(headers.error)).toContain('gagal sementara')
  }, 30_000)

  test('consumer utama tetap sehat setelah semua skenario', () => {
    expect(consumer.ready).toBe(true)
  })

  test('gagal memindahkan pesan ke topic retry: consumer berhenti tanpa commit, pengganti menerima pesan yang sama', async () => {
    const g = `${group}-fatal`
    const t = `${topic}.fatal`
    await admin.createTopics({ topics: [t], partitions: 1, replicas: 1 })
    const brokenProducer = createProducer('skel-broken', brokers)
    const fatals: unknown[] = []
    const seen: string[] = []
    const failing = new EventConsumer({
      group: g,
      topic: t,
      brokers,
      producer: brokenProducer,
      backoffMs: [],
      handle: async (event) => {
        seen.push(event.id)
        throw new Error('gagal sementara')
      },
      onFatal: (e) => fatals.push(e),
    })
    await failing.start()
    await until(() => failing.ready, 30_000)
    await brokenProducer.close()

    const event = { id: Bun.randomUUIDv7(), type: 'video.metadata_updated', version: 1, occurredAt: new Date().toISOString(), producer: 'video-svc', key: 'v-fatal', data: {} }
    await producer.send({ messages: [{ topic: t, key: 'v-fatal', value: JSON.stringify(event) }] })
    await until(() => fatals.length === 1)
    expect(failing.ready).toBe(false)
    await failing.stop()

    const replacement = new EventConsumer({ group: g, topic: t, brokers, producer, handle: async (e) => void seen.push(e.id) })
    await replacement.start()
    await until(() => seen.filter((id) => id === event.id).length === 2, 30_000)
    await replacement.stop()
    await admin.deleteTopics({ topics: [t, retryTopic(g, t), dlqTopic(g, t)] })
  }, 60_000)
})
