// Exit criteria M0: daftar dan login lewat Kong, token ES256 diterima Kong dan identity-svc, dan satu trace dari Kong sampai identity-svc di Tempo.
// Butuh `bun run dev:obs`, kong.yaml yang memuat public key penanda tangan, dan apps/identity-svc/.env.
// Test ini menyalakan identity-svc dan web sendiri; port 13000 dan 13001 harus kosong.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { startIdentitySvc, startWeb } from './processes.ts'

const KONG = process.env.KONG_URL ?? 'http://localhost:18000'
const TEMPO = process.env.TEMPO_URL ?? 'http://127.0.0.1:13200'
const email = `e2e-${Date.now().toString(36)}@viora.test`
const password = 'password-yang-panjang'
const origin = { origin: KONG }

let identity: Awaited<ReturnType<typeof startIdentitySvc>>
let web: Awaited<ReturnType<typeof startWeb>>
let token: string

beforeAll(async () => {
  ;[identity, web] = await Promise.all([startIdentitySvc(), startWeb()])
}, 90_000)
afterAll(() => Promise.all([identity.stop(), web.stop()]))

test('halaman web dilayani Kong di origin yang sama dengan /v1', async () => {
  const res = await fetch(`${KONG}/login`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
  expect(await res.text()).toContain('<title>Viora</title>')
})

const cookieFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

test('daftar, verifikasi email, dan dapat JWT lewat Kong', async () => {
  const signUp = await fetch(`${KONG}/v1/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...origin },
    body: JSON.stringify({ email, password, name: 'E2E' }),
  })
  expect(signUp.status).toBe(200)

  const link = await identity.mailLinkFor(email)
  expect(new URL(link).origin).toBe(KONG)
  const verified = await fetch(link, { redirect: 'manual' })
  expect([200, 302]).toContain(verified.status)

  const signIn = await fetch(`${KONG}/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...origin },
    body: JSON.stringify({ email, password }),
  })
  expect(signIn.status).toBe(200)
  const tokenRes = await fetch(`${KONG}/v1/auth/token`, { headers: { cookie: cookieFrom(signIn) } })
  expect(tokenRes.status).toBe(200)
  token = ((await tokenRes.json()) as { token: string }).token
})

test('GET /v1/me lewat Kong: diterima dengan token, ditolak Kong tanpa token', async () => {
  const me = await fetch(`${KONG}/v1/me`, { headers: { authorization: `Bearer ${token}` } })
  expect(me.status).toBe(200)
  expect(await me.json()).toMatchObject({ email, emailVerified: true })
  expect((await fetch(`${KONG}/v1/me`)).status).toBe(401)
})

test('route bawaan Better Auth yang melewati denylist dan outbox tidak dibuka Kong', async () => {
  for (const path of ['/v1/auth/admin/list-users', '/v1/auth/delete-user']) {
    expect((await fetch(`${KONG}${path}`, { method: 'POST', headers: origin })).status).toBe(404)
  }
})

test('satu trace dari Kong sampai identity-svc terlihat di Tempo', async () => {
  const traceId = crypto.randomUUID().replaceAll('-', '')
  const res = await fetch(`${KONG}/v1/me`, {
    headers: { authorization: `Bearer ${token}`, traceparent: `00-${traceId}-${'1'.repeat(16)}-01` },
  })
  expect(res.status).toBe(200)

  let services = new Set<string>()
  const deadline = Date.now() + 30_000
  while (!(services.has('kong') && services.has('identity-svc')) && Date.now() < deadline) {
    await Bun.sleep(1_000)
    const trace = await fetch(`${TEMPO}/api/v2/traces/${traceId}`).then((r) => (r.ok ? r.json() : null))
    const batches = (trace as { trace?: { resourceSpans?: { resource: { attributes: { key: string; value: { stringValue?: string } }[] } }[] } } | null)
      ?.trace?.resourceSpans ?? []
    services = new Set(
      batches.flatMap((b) => b.resource.attributes.filter((a) => a.key === 'service.name').map((a) => a.value.stringValue ?? '')),
    )
  }
  expect([...services].toSorted()).toEqual(['identity-svc', 'kong'])
}, 60_000)
