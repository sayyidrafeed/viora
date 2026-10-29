// Spike M0: keyring kustom Better Auth (ES256 dari file SOPS) dan verifikasi token oleh Kong 3.9 jwt plugin.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { jwt } from 'better-auth/plugins'
import { exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify, SignJWT, decodeProtectedHeader } from 'jose'
import { loadKeyring, refuseKeyMinting } from './keyring.ts'

const KONG_PROXY = process.env.KONG_PROXY ?? 'http://127.0.0.1:18000'
const KONG_ADMIN = process.env.KONG_ADMIN ?? 'http://127.0.0.1:18001'
const UPSTREAM_PORT = 18080

const keyDir = mkdtempSync(join(tmpdir(), 'viora-keys-'))
async function writeKeypair(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  writeFileSync(join(keyDir, `${kid}.key.pem`), await exportPKCS8(privateKey))
  writeFileSync(join(keyDir, `${kid}.pub.pem`), await exportSPKI(publicKey))
  return { privateKey }
}
const pubPem = (kid: string) => readFileSync(join(keyDir, `${kid}.pub.pem`), 'utf8')

const db: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [], jwks: [] }

async function makeAuth(activeKid: string) {
  const keys = await loadKeyring(keyDir, activeKid)
  return betterAuth({
    baseURL: 'http://localhost:3000',
    basePath: '/v1/auth',
    secret: 'spike-secret-at-least-32-characters-long',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt({
        jwks: { keyPairConfig: { alg: 'ES256' }, disablePrivateKeyEncryption: true },
        jwt: {
          issuer: 'https://viora.local',
          audience: 'viora-api',
          expirationTime: '10m',
          definePayload: ({ user }) => ({ role: user.role ?? 'user', ev: user.emailVerified }),
        },
        adapter: { getJwks: async () => keys, createJwk: async () => refuseKeyMinting() },
      }),
    ],
  })
}

async function tokenFor(auth: Awaited<ReturnType<typeof makeAuth>>, email: string) {
  const signUp = await auth.handler(
    new Request('http://localhost:3000/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: 'password-yang-panjang', name: 'Spike' }),
    }),
  )
  expect(signUp.status).toBe(200)
  const cookie = signUp.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const res = await auth.handler(new Request('http://localhost:3000/v1/auth/token', { headers: { cookie } }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { token: string }).token
}

let upstream: ReturnType<typeof Bun.serve>
const kidA = 'k2026a'
const kidB = 'k2026b'
let privA: CryptoKey

const kongRoute = (name: string, path: string, anonymous: boolean) => ({
  name,
  paths: [`~${path}$`],
  strip_path: false,
  plugins: [
    {
      name: 'jwt',
      config: {
        key_claim_name: 'kid',
        claims_to_verify: ['exp'],
        header_names: ['authorization'],
        ...(anonymous ? { anonymous: 'anonymous' } : {}),
      },
    },
  ],
})

async function loadKongConfig(kids: string[]) {
  const config = {
    _format_version: '3.0',
    services: [
      {
        name: 'echo',
        url: `http://host.docker.internal:${UPSTREAM_PORT}`,
        routes: [kongRoute('required', '/v1/me', false), kongRoute('optional', '/v1/videos/[^/]+', true)],
      },
    ],
    consumers: [
      { username: 'anonymous' },
      {
        username: 'identity-svc',
        jwt_secrets: kids.map((kid) => ({ key: kid, algorithm: 'ES256', rsa_public_key: pubPem(kid) })),
      },
    ],
  }
  const res = await fetch(`${KONG_ADMIN}/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (res.status !== 201) throw new Error(`Kong menolak config: ${res.status} ${await res.text()}`)
  await Bun.sleep(300)
}

const viaKong = (path: string, token?: string) =>
  fetch(`${KONG_PROXY}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {})

beforeAll(async () => {
  privA = (await writeKeypair(kidA)).privateKey
  await writeKeypair(kidB)
  upstream = Bun.serve({
    port: UPSTREAM_PORT,
    hostname: '0.0.0.0',
    fetch: (req) =>
      Response.json({
        consumer: req.headers.get('x-consumer-username'),
        anonymous: req.headers.get('x-anonymous-consumer'),
      }),
  })
})

afterAll(() => upstream.stop(true))

describe('keyring Better Auth', () => {
  test('token ES256 ber-kid aktif, klaim viora, tanpa menyimpan kunci ke tabel jwks', async () => {
    const auth = await makeAuth(kidA)
    const token = await tokenFor(auth, 'a@viora.test')
    const header = decodeProtectedHeader(token)
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(kidA)

    const { payload } = await jwtVerify(token, await importSPKI(pubPem(kidA), 'ES256'), {
      issuer: 'https://viora.local',
      audience: 'viora-api',
    })
    expect(payload.role).toBe('user')
    expect(payload.ev).toBe(false)
    expect(payload.exp! - payload.iat!).toBe(600)
    expect(payload.email).toBeUndefined()
    expect(db.jwks).toHaveLength(0)
  })

  test('ganti kid aktif (langkah 2 rotasi) langsung menandatangani dengan kunci baru', async () => {
    const auth = await makeAuth(kidB)
    const token = await tokenFor(auth, 'b@viora.test')
    expect(decodeProtectedHeader(token).kid).toBe(kidB)
  })

  test('endpoint /jwks mempublikasikan public key dari keyring', async () => {
    const auth = await makeAuth(kidA)
    const res = await auth.handler(new Request('http://localhost:3000/v1/auth/jwks'))
    const body = (await res.json()) as { keys: { kid: string; d?: string }[] }
    expect(body.keys.map((k) => k.kid).toSorted()).toEqual([kidA, kidB])
    expect(body.keys.every((k) => k.d === undefined)).toBe(true)
  })

  test('keyring tanpa kid aktif gagal saat start, bukan diam-diam membuat kunci', async () => {
    await expect(makeAuth('tidak-ada')).rejects.toThrow('kid aktif')
  })
})

describe('Kong jwt plugin dengan ES256 + key_claim_name kid', () => {
  beforeAll(() => loadKongConfig([kidA]))

  test('token valid dari Better Auth diterima di route required', async () => {
    const token = await tokenFor(await makeAuth(kidA), 'kong1@viora.test')
    const res = await viaKong('/v1/me', token)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { consumer: string }).consumer).toBe('identity-svc')
  })

  test('tanpa token di route required: 401', async () => {
    expect((await viaKong('/v1/me')).status).toBe(401)
  })

  test('signature dirusak: 401', async () => {
    const token = await tokenFor(await makeAuth(kidA), 'kong2@viora.test')
    const [h, p, s] = token.split('.')
    const tampered = `${h}.${p}.${s!.slice(0, -4)}AAAA`
    expect((await viaKong('/v1/me', tampered)).status).toBe(401)
  })

  test('kid yang belum didaftarkan ke Kong (kunci rotasi baru sebelum langkah 1): 401', async () => {
    const token = await tokenFor(await makeAuth(kidB), 'kong3@viora.test')
    expect((await viaKong('/v1/me', token)).status).toBe(401)
  })

  test('token kedaluwarsa: 401 karena claims_to_verify exp', async () => {
    const expired = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'ES256', kid: kidA })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(privA)
    expect((await viaKong('/v1/me', expired)).status).toBe(401)
  })

  test('route optional tanpa token diteruskan sebagai anonim', async () => {
    const res = await viaKong('/v1/videos/abc')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { anonymous: string }).anonymous).toBe('true')
  })

  test('route optional dengan token palsu tetap diteruskan sebagai anonim (service-kit wajib 401)', async () => {
    const res = await viaKong('/v1/videos/abc', 'bukan.token.valid')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { anonymous: string }).anonymous).toBe('true')
  })

  test('dua kid terdaftar saat rotasi: token kunci lama dan baru sama-sama diterima', async () => {
    await loadKongConfig([kidA, kidB])
    const oldT = await tokenFor(await makeAuth(kidA), 'kong4@viora.test')
    const newT = await tokenFor(await makeAuth(kidB), 'kong5@viora.test')
    expect((await viaKong('/v1/me', oldT)).status).toBe(200)
    expect((await viaKong('/v1/me', newT)).status).toBe(200)
  })
})
