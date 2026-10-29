// Policy panggilan sinkron (§6, ADR 028) dan token service, terhadap server HTTP lokal sungguhan. Tidak butuh infra.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { exportSPKI, generateKeyPair } from 'jose'
import {
  createApp,
  createInternalFetch,
  createRouter,
  DEADLINE_HEADER,
  devServiceTokens,
  serviceAuth,
  staticKey,
  type ServiceVariables,
} from '../src/index.ts'

const issuer = 'https://viora.dev.local'
let upstream: ReturnType<typeof Bun.serve>
let caller: ReturnType<typeof Bun.serve>
let tokens: (audience: string) => Promise<string>
const hits = new Map<string, number>()
const seenDeadlines: number[] = []
const hit = (key: string) => hits.set(key, (hits.get(key) ?? 0) + 1).get(key)!

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  tokens = devServiceTokens({ privateKey, issuer, subject: 'system:serviceaccount:viora:video-svc' })

  const internal = createRouter<ServiceVariables>()
    .use(serviceAuth({ audience: 'identity-svc', issuer, keys: await staticKey(await exportSPKI(publicKey)) }))
    .get('/whoami', (c) => c.json({ caller: c.get('caller') }))
    .get('/flaky/:key', (c) => (hit(c.req.param('key')) < 3 ? c.json({}, 503) : c.json({ ok: true })))
    .post('/flaky/:key', (c) => (hit(c.req.param('key')) < 3 ? c.json({}, 503) : c.json({ ok: true })))
    .get('/slow', async (c) => {
      seenDeadlines.push(Number(c.req.header(DEADLINE_HEADER)))
      await Bun.sleep(400)
      return c.json({ ok: true })
    })
  const app = createApp('identity-svc')
  app.route('/internal', internal)
  upstream = Bun.serve({ port: 0, fetch: app.fetch })

  // Service perantara: meneruskan panggilan ke upstream dengan deadline dari request masuk.
  const internalFetch = createInternalFetch({ audience: 'identity-svc', token: tokens, timeoutMs: 2_000 })
  const front = createApp('video-svc')
  front.get('/proxy-slow', async (c) => {
    const res = await internalFetch(new Request(`${upstream.url}internal/slow`))
    return c.json(await res.json(), res.status as 200)
  })
  caller = Bun.serve({ port: 0, fetch: front.fetch })
})

afterAll(() => {
  upstream.stop(true)
  caller.stop(true)
})

describe('token service', () => {
  test('token dengan audience service tujuan diterima dan caller diketahui', async () => {
    const f = createInternalFetch({ audience: 'identity-svc', token: tokens })
    const res = await f(new Request(`${upstream.url}internal/whoami`))
    expect(await res.json()).toEqual({ caller: 'system:serviceaccount:viora:video-svc' })
  })

  test('token untuk audience lain ditolak 401', async () => {
    const f = createInternalFetch({ audience: 'video-svc', token: tokens })
    const res = await f(new Request(`${upstream.url}internal/whoami`))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_token')
  })
})

const retryingFetch = () => createInternalFetch({ audience: 'identity-svc', token: tokens, maxRetries: 2 })

describe('retry satu lapis', () => {
  test('GET dicoba ulang saat 503 sampai berhasil', async () => {
    const res = await retryingFetch()(new Request(`${upstream.url}internal/flaky/get`))
    expect(res.status).toBe(200)
    expect(hits.get('get')).toBe(3)
  })

  test('POST tanpa idempotency key tidak dicoba ulang', async () => {
    const res = await retryingFetch()(new Request(`${upstream.url}internal/flaky/post-plain`, { method: 'POST', body: '{}' }))
    expect(res.status).toBe(503)
    expect(hits.get('post-plain')).toBe(1)
  })

  test('POST dengan idempotency key dicoba ulang, body dikirim ulang utuh', async () => {
    const res = await retryingFetch()(
      new Request(`${upstream.url}internal/flaky/post-key`, {
        method: 'POST',
        body: '{"a":1}',
        headers: { 'idempotency-key': 'k1', 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(200)
    expect(hits.get('post-key')).toBe(3)
  })
})

describe('timeout dan deadline', () => {
  test('panggilan yang melewati timeout dibatalkan', async () => {
    const f = createInternalFetch({ audience: 'identity-svc', token: tokens, timeoutMs: 100, maxRetries: 0 })
    const started = performance.now()
    await expect(f(new Request(`${upstream.url}internal/slow`))).rejects.toThrow()
    expect(performance.now() - started).toBeLessThan(350)
  })

  test('sisa deadline request masuk membatasi panggilan keluar dan diteruskan ke upstream', async () => {
    const started = performance.now()
    const res = await fetch(`${caller.url}proxy-slow`, { headers: { [DEADLINE_HEADER]: '150' } })
    const elapsed = performance.now() - started
    expect(res.status).toBe(504)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('deadline_exceeded')
    expect(elapsed).toBeLessThan(380)
    expect(seenDeadlines.at(-1)).toBeLessThanOrEqual(150)
  })
})
