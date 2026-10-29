import type { SQL } from 'bun'
import { sql, type SQLWrapper } from 'drizzle-orm'
import type { EventEnvelope } from '@viora/contracts'
import type { KafkaProducer } from './kafka.ts'
import { currentTraceparent } from './telemetry.ts'

export const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`nama schema tidak valid: ${name}`)
  return name
}

// Envelope dibangun di satu tempat (fungsi SQL outbox_emit), supaya trigger Postgres dan kode TS menghasilkan bentuk yang sama.
export const outboxDdl = (schema: string, producer: string) => {
  const s = identifier(schema)
  return `
    create table if not exists ${s}.outbox (
      id uuid primary key,
      seq bigint generated always as identity,
      xid xid8 not null default pg_current_xact_id(),
      topic text not null,
      key text not null,
      headers jsonb not null default '{}',
      payload jsonb not null,
      published_at timestamptz
    );
    create index if not exists outbox_unpublished on ${s}.outbox (xid, seq) where published_at is null;

    create or replace function ${s}.uuid_v7() returns uuid language sql volatile as $fn$
      select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
        placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
        from 1 for 6), 52, 1), 53, 1), 'hex')::uuid
    $fn$;

    -- traceparent dibaca dari set_config('viora.traceparent', ..., true) yang dipasang service di transaksi yang sama.
    create or replace function ${s}.outbox_emit(p_topic text, p_type text, p_key text, p_data jsonb, p_version int default 1)
    returns jsonb language plpgsql volatile as $fn$
    declare
      v_id uuid := ${s}.uuid_v7();
      v_envelope jsonb;
    begin
      v_envelope := jsonb_build_object(
        'id', v_id, 'type', p_type, 'version', p_version,
        'occurredAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'producer', '${producer}', 'key', p_key, 'data', p_data);
      insert into ${s}.outbox (id, topic, key, headers, payload)
      values (v_id, p_topic, p_key,
        jsonb_strip_nulls(jsonb_build_object('traceparent', nullif(current_setting('viora.traceparent', true), ''))),
        v_envelope);
      return v_envelope;
    end
    $fn$;`
}

export type NewEvent<T extends Record<string, unknown>> = {
  topic: string
  type: string
  version?: number
  key: string
  data: T
}

type Executor = { execute: (query: SQLWrapper) => Promise<unknown> }

export async function writeOutbox<T extends Record<string, unknown>>(
  tx: Executor,
  schema: string,
  event: NewEvent<T>,
): Promise<EventEnvelope<T>> {
  const fn = sql.raw(`${identifier(schema)}.outbox_emit`)
  const traceparent = currentTraceparent()
  if (traceparent) await tx.execute(sql`select set_config('viora.traceparent', ${traceparent}, true)`)
  const rows = (await tx.execute(
    sql`select ${fn}(${event.topic}, ${event.type}, ${event.key}, ${event.data}::jsonb, ${event.version ?? 1}) as envelope`,
  )) as { envelope: EventEnvelope<T> }[]
  return rows[0]!.envelope
}

type OutboxRow = { id: string; topic: string; key: string; headers: Record<string, string>; payload: EventEnvelope }

export type RelayOptions = {
  sql: SQL
  schema: string
  producer: KafkaProducer
  lockKey: bigint
  pollMs?: number
  batchSize?: number
}

// Satu relay aktif per service: advisory lock sesi di koneksi langsung (bukan lewat PgBouncer transaction pooling).
export class OutboxRelay {
  private conn: Awaited<ReturnType<SQL['reserve']>> | undefined
  private leader = false
  private timer: Timer | undefined
  private running = false

  constructor(private readonly opts: RelayOptions) {}

  get isLeader() {
    return this.leader
  }

  async tryBecomeLeader(): Promise<boolean> {
    if (this.leader) return true
    this.conn ??= await this.opts.sql.reserve()
    const [row] = await this.conn.unsafe('select pg_try_advisory_lock($1) as ok', [this.opts.lockKey.toString()])
    this.leader = row.ok === true
    return this.leader
  }

  // xid < xmin: hanya baris dari transaksi yang semua pendahulunya sudah selesai, supaya commit belakangan tidak terlewat atau tersusul.
  // seq menjaga urutan event dalam satu transaksi; UUIDv7 hanya presisi milidetik.
  async tick(): Promise<string[]> {
    const conn = this.conn
    if (!conn || !this.leader) throw new Error('relay belum menjadi leader')
    const s = identifier(this.opts.schema)
    const rows: OutboxRow[] = await conn.unsafe(
      `select id, topic, key, headers, payload from ${s}.outbox
       where published_at is null and xid < pg_snapshot_xmin(pg_current_snapshot())
       order by xid, seq limit $1`,
      [this.opts.batchSize ?? 100],
    )
    if (rows.length === 0) return []
    await this.opts.producer.send({
      messages: rows.map((r) => ({ topic: r.topic, key: r.key, value: JSON.stringify(r.payload), headers: r.headers })),
    })
    const ids = rows.map((r) => r.id)
    await conn.unsafe(`update ${s}.outbox set published_at = now() where id = any($1::uuid[])`, [ids])
    return ids
  }

  start(onError: (err: unknown) => void = console.error): void {
    this.running = true
    const loop = async () => {
      try {
        if (await this.tryBecomeLeader()) await this.tick()
      } catch (err) {
        onError(err)
        await this.resign()
      }
      if (this.running) this.timer = setTimeout(loop, this.opts.pollMs ?? 200)
    }
    void loop()
  }

  async stop(): Promise<void> {
    this.running = false
    clearTimeout(this.timer)
    await this.resign()
  }

  // Lock sesi dilepas eksplisit, karena koneksi reserved kembali ke pool dan lock-nya ikut terbawa.
  private async resign(): Promise<void> {
    const conn = this.conn
    this.conn = undefined
    this.leader = false
    if (!conn) return
    await conn.unsafe('select pg_advisory_unlock_all()').catch(() => {})
    conn.release()
  }
}
