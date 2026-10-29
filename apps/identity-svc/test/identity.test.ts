// Integrasi identity-svc terhadap Postgres dan Redis asli (database baru per run). Butuh `bun run dev:infra`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedisClient, SQL } from 'bun'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { decodeJwt, exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { envelopeSchema, identityEventData, type IdentityEventType } from '@viora/contracts'
import { loadPublicKeys, redisDenylist } from '@viora/service-kit'
import { buildApp } from '../src/app.ts'
import { createAuth } from '../src/auth/auth.ts'
import { createDb, type Db } from '../src/db/client.ts'
import { channel, user } from '../src/db/schema.ts'
import { meService } from '../src/modules/me/index.ts'
import { loadEnv } from '../src/env.ts'
import type { Mail } from '../src/mailer.ts'

// App lewat PgBouncer (transaction pooling) seperti di prod; buat database dan migrasi lewat koneksi langsung.
const directBase = process.env.DATABASE_DIRECT_URL ?? 'postgres://viora:viora-dev@127.0.0.1:15432/viora'
const pooledBase = process.env.DATABASE_URL ?? 'postgres://viora:viora-dev@127.0.0.1:16432/viora'
const dbName = `identity_test_${Date.now().toString(36)}`
const adminSql = new SQL(directBase)
const withDb = (base: string) => Object.assign(new URL(base), { pathname: `/${dbName}` }).toString()
let sql: SQL
let db: Db
const redis = new RedisClient(process.env.REDIS_DURABLE_URL ?? 'redis://127.0.0.1:16379')
const mails: Mail[] = []
let app: ReturnType<typeof buildApp>

const keyDir = mkdtempSync(join(tmpdir(), 'viora-identity-keys-'))
const KID = 'test-2026a'
const BASE = 'http://localhost:18000'

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  writeFileSync(join(keyDir, `${KID}.key.pem`), await exportPKCS8(privateKey))
  writeFileSync(join(keyDir, `${KID}.pub.pem`), await exportSPKI(publicKey))

  await adminSql.unsafe(`create database ${dbName}`)
  const migrator = new SQL(withDb(directBase))
  await migrate(createDb(migrator), { migrationsFolder: join(import.meta.dir, '..', 'drizzle') })
  await migrator.close()
  sql = new SQL(withDb(pooledBase))
  db = createDb(sql)

  const env = loadEnv({
    DATABASE_URL: withDb(pooledBase),
    DATABASE_DIRECT_URL: withDb(directBase),
    REDIS_DURABLE_URL: 'redis://127.0.0.1:16379',
    KAFKA_BROKERS: '127.0.0.1:19092',
    AUTH_SECRET: 'test-secret-yang-panjangnya-lebih-dari-32',
    BASE_URL: BASE,
    TRUSTED_ORIGINS: 'http://localhost:3000,viora://',
    JWT_ISSUER: 'https://viora.local',
    JWT_KEY_DIR: keyDir,
    JWT_ACTIVE_KID: KID,
  })
  const auth = await createAuth({ env, db, mailer: { send: async (m) => void mails.push(m) } })
  app = buildApp({ env, db, auth, denylist: redisDenylist(redis), publicKeys: await loadPublicKeys(keyDir) })
})

afterAll(async () => {
  await sql.close()
  await adminSql.unsafe(`drop database ${dbName} with (force)`)
  await adminSql.close()
  redis.close()
})

const call = (path: string, init: RequestInit = {}) => app.request(new URL(path, BASE).toString(), init)
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
  body: JSON.stringify(body),
})
const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

// Setiap payload outbox harus lolos kontrak envelope dan skema data per tipe, karena dibangun di SQL, bukan di TS.
async function eventsFor(key: string) {
  const rows = (await sql`select payload from identity.outbox where key = ${key} order by xid, seq`) as { payload: unknown }[]
  return rows.map(({ payload }) => {
    const env = envelopeSchema.parse(payload)
    const data = identityEventData[env.type as IdentityEventType].parse(env.data)
    expect(env.producer).toBe('identity-svc')
    return { type: env.type, data: data as Record<string, unknown> }
  })
}

async function registerVerified(email: string) {
  const signUp = await call('/v1/auth/sign-up/email', json({ email, password: 'password-yang-panjang', name: 'Rafi' }))
  expect(signUp.status).toBe(200)
  const mail = mails.findLast((m) => m.to === email && m.subject.startsWith('Verifikasi'))!
  const verifyUrl = mail.text.match(/https?:\/\/\S+/)![0]
  const verified = await call(verifyUrl)
  expect([200, 302]).toContain(verified.status)
  const cookie = cookiesOf(verified)
  const tokenRes = await call('/v1/auth/token', { headers: { cookie } })
  const { token } = (await tokenRes.json()) as { token: string }
  const [row] = await db.select().from(user).where(eq(user.email, email))
  return { cookie, token, userId: row!.id }
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

describe('daftar, verifikasi, login', () => {
  test('alur email: outbox berisi user.registered tanpa email, lalu user.email_verified; JWT membawa ev=true', async () => {
    const email = 'alur@viora.test'
    const signUp = await call('/v1/auth/sign-up/email', json({ email, password: 'password-yang-panjang', name: 'Alur' }))
    expect(signUp.status).toBe(200)
    const [created] = await db.select().from(user).where(eq(user.email, email))
    expect(await eventsFor(created!.id)).toEqual([
      { type: 'user.registered', data: { userId: created!.id, name: 'Alur', image: null, stateVersion: 1 } },
    ])

    const blocked = await call('/v1/auth/sign-in/email', json({ email, password: 'password-yang-panjang' }))
    expect(blocked.status).toBe(403)

    const { token, userId } = await registerVerifiedExisting(email)
    expect(userId).toBe(created!.id)
    expect((await eventsFor(userId)).map((e) => e.type)).toEqual(['user.registered', 'user.email_verified'])
    expect((await eventsFor(userId))[1]!.data).toEqual({ userId, email })

    const claims = decodeJwt(token)
    expect(claims).toMatchObject({ sub: userId, ev: true, role: 'user', aud: 'viora-api' })

    const me = await call('/v1/me', bearer(token))
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ id: userId, email, emailVerified: true, channel: null })
  })

  test('reset password lewat email', async () => {
    const { userId } = await registerVerified('reset@viora.test')
    const req = await call('/v1/auth/request-password-reset', json({ email: 'reset@viora.test', redirectTo: 'http://localhost:3000/reset' }))
    expect(req.status).toBe(200)
    const link = mails.findLast((m) => m.subject.startsWith('Reset'))!.text.match(/https?:\/\/\S+/)![0]
    const resetToken = new URL((await call(link)).headers.get('location')!, BASE).searchParams.get('token')!
    const reset = await call('/v1/auth/reset-password', json({ newPassword: 'password-baru-yang-panjang', token: resetToken }))
    expect(reset.status).toBe(200)
    const signIn = await call('/v1/auth/sign-in/email', json({ email: 'reset@viora.test', password: 'password-baru-yang-panjang' }))
    expect(signIn.status).toBe(200)
    expect((await eventsFor(userId)).map((e) => e.type)).toEqual(['user.registered', 'user.email_verified'])
  })
})

async function registerVerifiedExisting(email: string) {
  const mail = mails.findLast((m) => m.to === email && m.subject.startsWith('Verifikasi'))!
  const verified = await call(mail.text.match(/https?:\/\/\S+/)![0])
  const cookie = cookiesOf(verified)
  const { token } = (await (await call('/v1/auth/token', { headers: { cookie } })).json()) as { token: string }
  const [row] = await db.select().from(user).where(eq(user.email, email))
  return { cookie, token, userId: row!.id }
}

describe('trigger outbox', () => {
  test('ubah profil menaikkan stateVersion dan mengirim user.profile_updated; login ulang tidak mengirim event', async () => {
    const { cookie, userId } = await registerVerified('profil@viora.test')
    const res = await call('/v1/auth/update-user', json({ name: 'Nama Baru' }, { cookie }))
    expect(res.status).toBe(200)
    const signIn = await call('/v1/auth/sign-in/email', json({ email: 'profil@viora.test', password: 'password-yang-panjang' }))
    expect(signIn.status).toBe(200)

    const [row] = await db.select().from(user).where(eq(user.id, userId))
    const events = await eventsFor(userId)
    expect(events.map((e) => e.type)).toEqual(['user.registered', 'user.email_verified', 'user.profile_updated'])
    expect(events[2]!.data).toEqual({ userId, name: 'Nama Baru', image: null, stateVersion: row!.stateVersion })
    expect(row!.stateVersion).toBeGreaterThan(1)
  })

  test('channel: insert dan perubahan kolom publik mengirim event, kolom lain hanya menaikkan versi', async () => {
    const { userId } = await registerVerified('channel@viora.test')
    const channelId = Bun.randomUUIDv7()
    await db.insert(channel).values({ id: channelId, ownerUserId: userId, handle: 'rafi', name: 'Rafi' })
    await db.update(channel).set({ description: 'deskripsi' }).where(eq(channel.id, channelId))
    await db.update(channel).set({ name: 'Rafi TV' }).where(eq(channel.id, channelId))

    const events = (await eventsFor(userId)).filter((e) => e.type.startsWith('channel.'))
    expect(events).toEqual([
      { type: 'channel.created', data: { channelId, ownerUserId: userId, handle: 'rafi', name: 'Rafi', avatarKey: null, stateVersion: 1 } },
      { type: 'channel.updated', data: { channelId, ownerUserId: userId, handle: 'rafi', name: 'Rafi TV', avatarKey: null, stateVersion: 3 } },
    ])
  })

  test('ban dan unban mengirim user.banned (alasan, kedaluwarsa) dan user.unbanned', async () => {
    const { userId } = await registerVerified('ban@viora.test')
    const expires = new Date('2026-12-01T00:00:00Z')
    await db.update(user).set({ banned: true, banReason: 'spam', banExpires: expires }).where(eq(user.id, userId))
    await db.update(user).set({ banned: false, banReason: null, banExpires: null }).where(eq(user.id, userId))
    const events = (await eventsFor(userId)).filter((e) => e.type.includes('ban'))
    expect(events.map((e) => e.type)).toEqual(['user.banned', 'user.unbanned'])
    expect(events[0]!.data.reason).toBe('spam')
    expect(new Date(events[0]!.data.expiresAt as string).toISOString()).toBe(expires.toISOString())
  })

  test('transaksi yang batal tidak meninggalkan event', async () => {
    const id = Bun.randomUUIDv7()
    await db
      .transaction(async (tx) => {
        await tx.insert(user).values({ id, name: 'Batal', email: 'batal@viora.test' })
        throw new Error('batal')
      })
      .catch(() => {})
    expect(await eventsFor(id)).toEqual([])
  })
})

describe('/v1/me', () => {
  test('tanpa token 401 unauthorized, token rusak 401 invalid_token', async () => {
    const none = await call('/v1/me')
    expect(none.status).toBe(401)
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('unauthorized')
    const bad = await call('/v1/me', bearer('a.b.c'))
    expect(bad.status).toBe(401)
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_token')
  })

  test('DELETE /v1/me: data hilang, user.deleted dan channel.deleted ditulis, token lama langsung ditolak', async () => {
    const { token, userId } = await registerVerified('hapus@viora.test')
    const channelId = Bun.randomUUIDv7()
    await db.insert(channel).values({ id: channelId, ownerUserId: userId, handle: 'hapus', name: 'Hapus' })

    const res = await call('/v1/me', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ purgeComments: true }),
    })
    expect(res.status).toBe(204)

    expect(await db.select().from(user).where(eq(user.id, userId))).toEqual([])
    expect(await db.select().from(channel).where(eq(channel.id, channelId))).toEqual([])
    const [count] = (await sql`select count(*)::int as n from identity.session where user_id = ${userId}`) as { n: number }[]
    expect(count!.n).toBe(0)

    const events = await eventsFor(userId)
    expect(events.slice(-2)).toEqual([
      { type: 'user.deleted', data: { userId, purgeComments: true } },
      { type: 'channel.deleted', data: { channelId, ownerUserId: userId } },
    ])

    const after = await call('/v1/me', bearer(token))
    expect(after.status).toBe(401)
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe('account_banned')
    const ttl = await redis.ttl(`denylist:user:${userId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(600)
  })
})

// Meniru @better-auth/expo 1.7.14 (client.js init hook): credentials omit, cookie dikirim manual, expo-origin = scheme app.
const expoHeaders = (cookie?: string) => ({
  'expo-origin': 'viora://',
  'x-skip-oauth-proxy': 'true',
  ...(cookie ? { cookie } : {}),
})

describe('batas akses dan penghapusan akun', () => {
  test('route bawaan Better Auth yang melewati denylist dan outbox ditolak di identity-svc', async () => {
    const { cookie } = await registerVerified('blok@viora.test')
    for (const path of ['/v1/auth/admin/list-users', '/v1/auth/admin/ban-user', '/v1/auth/delete-user', '/v1/auth/delete-user/callback']) {
      const res = await call(path, json({ userId: 'x' }, { cookie }))
      expect(res.status).toBe(404)
    }
  })

  test('DELETE /v1/me membaca purgeComments tanpa content-type, dan body kosong dengan content-type json tetap 204', async () => {
    const a = await registerVerified('body-a@viora.test')
    const resA = await call('/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${a.token}` }, body: '{"purgeComments":true}' })
    expect(resA.status).toBe(204)
    expect((await eventsFor(a.userId)).find((e) => e.type === 'user.deleted')!.data).toEqual({ userId: a.userId, purgeComments: true })

    const b = await registerVerified('body-b@viora.test')
    const resB = await call('/v1/me', { method: 'DELETE', headers: { authorization: `bearer ${b.token}`, 'content-type': 'application/json' } })
    expect(resB.status).toBe(204)
  })

  // Langsung lewat service supaya kedua request pasti melewati middleware sebelum salah satunya menulis denylist.
  test('dua penghapusan bersamaan: satu berhasil, satu 404, dan denylist tetap ada', async () => {
    const { userId } = await registerVerified('dobel-hapus@viora.test')
    const service = meService({ db, denylist: redisDenylist(redis) })
    const results = await Promise.allSettled([service.delete(userId, false), service.delete(userId, false)])
    expect(results.map((r) => r.status).toSorted()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ status: 404 })
    expect(await redis.exists(`denylist:user:${userId}`)).toBe(true)
    expect((await eventsFor(userId)).filter((e) => e.type === 'user.deleted')).toHaveLength(1)
  })
})

describe('token dari sesi Expo (kontrak @better-auth/expo)', () => {
  test('login dari app (tanpa header Origin) lalu /v1/auth/token dengan cookie tersimpan menghasilkan JWT', async () => {
    const { userId } = await registerVerified('expo@viora.test')
    const signIn = await call('/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...expoHeaders() },
      body: JSON.stringify({ email: 'expo@viora.test', password: 'password-yang-panjang' }),
    })
    expect(signIn.status).toBe(200)
    const stored = cookiesOf(signIn)
    expect(stored).toContain('better-auth.session_token=')

    const res = await call('/v1/auth/token', { headers: expoHeaders(stored) })
    expect(res.status).toBe(200)
    const { token } = (await res.json()) as { token: string }
    expect(decodeJwt(token)).toMatchObject({ sub: userId, ev: true })
    expect((await call('/v1/me', bearer(token))).status).toBe(200)
  })

  // Better Auth hanya memeriksa origin untuk request yang membawa cookie (CSRF); sign-in tanpa cookie tidak dicek.
  test('POST dari app yang membawa cookie: scheme viora:// diterima, scheme lain ditolak', async () => {
    await registerVerified('expo-csrf@viora.test')
    const signIn = await call('/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...expoHeaders() },
      body: JSON.stringify({ email: 'expo-csrf@viora.test', password: 'password-yang-panjang' }),
    })
    expect(signIn.status).toBe(200)
    const stored = cookiesOf(signIn)
    const update = (origin: string) =>
      call('/v1/auth/update-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: stored, 'expo-origin': origin },
        body: JSON.stringify({ name: 'Dari App' }),
      })
    expect((await update('evil://')).status).toBe(403)
    expect((await update('viora://')).status).toBe(200)
    const browser = await call('/v1/auth/update-user', json({ name: 'CSRF' }, { cookie: stored, origin: 'https://evil.example' }))
    expect(browser.status).toBe(403)
  })
})
