// Spike M0 (ADR 026): apakah @platformatic/kafka layak dipakai di Bun terhadap Redpanda.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  Admin,
  compatibilityPartitioner,
  Consumer,
  MessagesStreamFallbackModes,
  MessagesStreamModes,
  ProduceAcks,
  Producer,
  stringDeserializers,
  stringSerializers,
  type Message,
} from '@platformatic/kafka'

const brokers = [process.env.KAFKA_BROKERS ?? '127.0.0.1:19092']
const run = Date.now().toString(36)
const topic = `spike.kafka.${run}`
const admin = new Admin({ clientId: 'spike-admin', bootstrapBrokers: brokers })

type StrMessage = Message<string, string, string, string>

function newConsumer(groupId: string, clientId: string) {
  return new Consumer({
    groupId,
    clientId,
    bootstrapBrokers: brokers,
    deserializers: stringDeserializers,
    autocommit: false,
    sessionTimeout: 10_000,
    heartbeatInterval: 500,
    maxWaitTime: 200,
  })
}

async function collect(stream: AsyncIterable<StrMessage>, count: number, timeoutMs: number) {
  const out: StrMessage[] = []
  const deadline = Date.now() + timeoutMs
  for await (const m of stream) {
    out.push(m)
    if (out.length >= count || Date.now() > deadline) break
  }
  return out
}

const until = async (cond: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout menunggu kondisi')
    await Bun.sleep(50)
  }
}

let producer: Producer<string, string, string, string>

beforeAll(async () => {
  await admin.createTopics({ topics: [topic], partitions: 3, replicas: 1 })
  producer = new Producer({
    clientId: 'spike-producer',
    bootstrapBrokers: brokers,
    serializers: stringSerializers,
    idempotent: true,
    acks: ProduceAcks.ALL,
    partitioner: compatibilityPartitioner,
  })
})

afterAll(async () => {
  await producer.close()
  await admin.deleteTopics({ topics: [topic] })
  await admin.close()
})

test('producer idempoten: dapat producerId, acks=all, header ikut terkirim', async () => {
  const result = await producer.send({
    messages: [{ topic, key: 'video-1', value: '{"n":1}', headers: { traceparent: '00-abc-def-01' } }],
  })
  expect(producer.producerId).toBeDefined()
  expect(producer.producerId! >= 0n).toBe(true)
  expect(result.offsets?.length).toBe(1)
})

test('key yang sama selalu ke partisi yang sama (compatibilityPartitioner)', async () => {
  const r = await producer.send({
    messages: Array.from({ length: 5 }, (_, i) => ({ topic, key: 'video-42', value: `${i}` })),
  })
  const partitions = new Set(r.offsets?.map((o) => o.partition))
  expect(partitions.size).toBe(1)
})

test('consumer group: commit manual, rebalance saat member kedua masuk dan keluar', async () => {
  const group = `spike-group-${run}`
  const keys = Array.from({ length: 30 }, (_, i) => `k${i}`)
  await producer.send({ messages: keys.map((k) => ({ topic, key: k, value: k })) })

  const a = newConsumer(group, 'a')
  const rebalancesA: unknown[] = []
  a.on('consumer:group:rebalance', (p) => rebalancesA.push(p))
  const streamA = await a.consume({ topics: [topic], mode: MessagesStreamModes.EARLIEST })
  const seenA: StrMessage[] = []
  streamA.on('data', async (m: StrMessage) => {
    seenA.push(m)
    await m.commit()
  })
  await until(() => seenA.length >= 36, 15_000)
  const headerMsg = seenA.find((m) => m.key === 'video-1')
  expect(headerMsg?.headers.get('traceparent')).toBe('00-abc-def-01')

  const b = newConsumer(group, 'b')
  const streamB = await b.consume({ topics: [topic], mode: MessagesStreamModes.COMMITTED })
  await until(() => rebalancesA.length >= 1 && b.isActive(), 20_000)

  const seenB: StrMessage[] = []
  streamB.on('data', async (m: StrMessage) => {
    seenB.push(m)
    await m.commit()
  })
  const before = seenA.length
  await producer.send({ messages: keys.map((k) => ({ topic, key: k, value: `round2-${k}` })) })
  await until(() => seenA.length - before + seenB.length >= 30, 15_000)
  expect(seenB.length).toBeGreaterThan(0)
  expect(seenA.length - before).toBeGreaterThan(0)

  const rebalancesBefore = rebalancesA.length
  await streamB.close()
  await b.close()
  await until(() => rebalancesA.length > rebalancesBefore, 20_000)
  const before3 = seenA.length
  await producer.send({ messages: keys.map((k) => ({ topic, key: k, value: `round3-${k}` })) })
  await until(() => seenA.length - before3 >= 30, 15_000)

  await streamA.close()
  await a.close()
}, 90_000)

test('restart memakai offset committed: tidak membaca ulang yang sudah di-commit', async () => {
  const group = `spike-restart-${run}`
  const t = `${topic}.restart`
  await admin.createTopics({ topics: [t], partitions: 1, replicas: 1 })
  await producer.send({ messages: Array.from({ length: 10 }, (_, i) => ({ topic: t, key: 'x', value: `${i}` })) })

  const c1 = newConsumer(group, 'c1')
  const s1 = await c1.consume({ topics: [t], mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST })
  const first = await collect(s1, 4, 10_000)
  for (const m of first) await m.commit()
  await s1.close()
  await c1.close()

  const c2 = newConsumer(group, 'c2')
  const s2 = await c2.consume({ topics: [t], mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST })
  const rest = await collect(s2, 6, 10_000)
  await s2.close()
  await c2.close()
  await admin.deleteTopics({ topics: [t] })

  expect(first.map((m) => m.value)).toEqual(['0', '1', '2', '3'])
  expect(rest.map((m) => m.value)).toEqual(['4', '5', '6', '7', '8', '9'])
}, 60_000)

test('handler yang menunggu lebih lama dari sessionTimeout tidak membuat member dikeluarkan', async () => {
  const group = `spike-slow-${run}`
  const t = `${topic}.slow`
  await admin.createTopics({ topics: [t], partitions: 1, replicas: 1 })
  await producer.send({ messages: [{ topic: t, key: 'x', value: 'a' }, { topic: t, key: 'x', value: 'b' }] })

  const c = newConsumer(group, 'slow')
  const rebalances: unknown[] = []
  c.on('consumer:group:rebalance', (p) => rebalances.push(p))
  const s = await c.consume({ topics: [t], mode: MessagesStreamModes.EARLIEST })
  const got: string[] = []
  for await (const m of s) {
    got.push(m.value)
    if (got.length === 1) await Bun.sleep(12_000)
    await m.commit()
    if (got.length === 2) break
  }
  expect(c.isActive()).toBe(true)
  expect(rebalances.length).toBe(0)
  await s.close()
  await c.close()
  await admin.deleteTopics({ topics: [t] })
  expect(got).toEqual(['a', 'b'])
}, 60_000)
