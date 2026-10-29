import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RedisClient } from 'bun'
import { createMiddleware } from 'hono/factory'
import { importSPKI, jwtVerify, type CryptoKey } from 'jose'
import { DomainError } from './errors.ts'

export class UnauthorizedError extends DomainError {
  readonly status = 401
  readonly code = 'unauthorized'
  constructor() {
    super('Butuh login')
  }
}

export class InvalidTokenError extends DomainError {
  readonly status = 401
  readonly code = 'invalid_token'
  constructor() {
    super('Token tidak valid atau kedaluwarsa')
  }
}

export class AccountBannedError extends DomainError {
  readonly status = 401
  readonly code = 'account_banned'
  constructor() {
    super('Akun diblokir atau sudah dihapus')
  }
}

export type UserClaims = { id: string; role: string; emailVerified: boolean }
export type AuthVariables = { user: UserClaims | null }
export type RequiredUser = { user: UserClaims }

export async function loadPublicKeys(dir: string): Promise<Map<string, CryptoKey>> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.pub.pem'))
  const entries = await Promise.all(
    files.map(async (f) => [f.slice(0, -'.pub.pem'.length), await importSPKI(readFileSync(join(dir, f), 'utf8'), 'ES256')] as const),
  )
  return new Map(entries)
}

const denylistKey = (userId: string) => `denylist:user:${userId}`

// Denylist di redis-durable (noeviction). TTL 10 menit = umur JWT terpanjang, dihitung setelah sesi dicabut (§6).
// deny memakai TTL pengaman 1 jam supaya proses yang mati sebelum startExpiry tidak mengunci user selamanya.
export function redisDenylist(redis: RedisClient) {
  return {
    isDenied: async (userId: string) => (await redis.exists(denylistKey(userId))) === true,
    deny: async (userId: string) => void (await redis.set(denylistKey(userId), '1', 'EX', 3600)),
    startExpiry: async (userId: string) => void (await redis.expire(denylistKey(userId), 600)),
    allow: async (userId: string) => void (await redis.del(denylistKey(userId))),
  }
}
export type Denylist = ReturnType<typeof redisDenylist>

type UserAuthOptions = { keys: Map<string, CryptoKey>; issuer: string; audience: string; denylist: Pick<Denylist, 'isDenied'> }

// Kong meneruskan token gagal sebagai anonim di route optional, jadi token yang ada tapi tidak valid selalu 401 di sini.
export function userAuth({ keys, issuer, audience, denylist }: UserAuthOptions) {
  const verify = async (token: string): Promise<UserClaims> => {
    const { payload } = await jwtVerify(
      token,
      async ({ kid }) => {
        const key = kid ? keys.get(kid) : undefined
        if (!key) throw new Error(`kid tidak dikenal: ${kid}`)
        return key
      },
      { issuer, audience, algorithms: ['ES256'], requiredClaims: ['exp', 'sub'] },
    )
    if (!payload.sub) throw new Error('token tanpa sub')
    return { id: payload.sub, role: String(payload.role ?? 'user'), emailVerified: payload.ev === true }
  }

  // Token yang ada di header selalu diverifikasi penuh; hanya ketiadaan header yang dibedakan required vs optional.
  const authenticate = async (header: string): Promise<UserClaims> => {
    let user: UserClaims
    try {
      user = await verify(header.replace(/^bearer\s+/i, ''))
    } catch {
      throw new InvalidTokenError()
    }
    if (await denylist.isDenied(user.id)) throw new AccountBannedError()
    return user
  }

  return {
    required: createMiddleware<{ Variables: RequiredUser }>(async (c, next) => {
      const header = c.req.header('authorization')
      if (!header) throw new UnauthorizedError()
      c.set('user', await authenticate(header))
      await next()
    }),
    optional: createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
      const header = c.req.header('authorization')
      c.set('user', header ? await authenticate(header) : null)
      await next()
    }),
  }
}
