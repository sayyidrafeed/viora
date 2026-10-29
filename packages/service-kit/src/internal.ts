import { context, propagation } from '@opentelemetry/api'
import { circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleWhen, retry, wrap } from 'cockatiel'
import { createMiddleware } from 'hono/factory'
import { importSPKI, jwtVerify, SignJWT, type CryptoKey, type JWTVerifyGetKey } from 'jose'
import { DEADLINE_HEADER, DeadlineExceededError, remainingDeadline } from './deadline.ts'
import { InvalidTokenError, UnauthorizedError } from './user-auth.ts'

class RetryBudgetExhaustedError extends Error {}

// Anggaran retry per proses: retry dibatasi 10% dari request ditambah 10 per jendela 10 detik, supaya retry tidak melipatgandakan beban saat dependency sedang jatuh.
function retryBudget() {
  let windowStart = Date.now()
  let requests = 0
  let retries = 0
  const roll = () => {
    if (Date.now() - windowStart < 10_000) return
    windowStart = Date.now()
    requests = 0
    retries = 0
  }
  return {
    recordRequest: () => {
      roll()
      requests++
    },
    tryRetry: () => {
      roll()
      if (retries >= 10 + requests * 0.1) return false
      retries++
      return true
    },
  }
}
const sharedBudget = retryBudget()

const isTransientError = (err: unknown) =>
  err instanceof TypeError || (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'))
const isTransientResponse = (res: unknown) => res instanceof Response && (res.status >= 500 || res.status === 429)

export type InternalFetchOptions = {
  audience: string
  token: (audience: string) => Promise<string>
  timeoutMs?: number
  maxRetries?: number
  // Hanya untuk dependency opsional yang punya fallback (§6).
  breaker?: boolean
}

// Pengganti fetch untuk panggilan antar-service; dipakai langsung atau sebagai opsi `fetch` klien hasil generate.
export function createInternalFetch({ audience, token, timeoutMs = 2_000, maxRetries = 2, breaker = false }: InternalFetchOptions) {
  const retryPolicy = retry(handleWhen(isTransientError).orWhenResult(isTransientResponse), {
    maxAttempts: maxRetries,
    backoff: new ExponentialBackoff({ initialDelay: 50, maxDelay: 500 }),
  })
  const breakerPolicy = breaker
    ? circuitBreaker(handleWhen(isTransientError).orWhenResult(isTransientResponse), {
        halfOpenAfter: 10_000,
        breaker: new ConsecutiveBreaker(5),
      })
    : undefined

  // Body dibaca sekali supaya bisa dikirim ulang di setiap percobaan.
  const attempt = async (input: Request, body: ArrayBuffer | undefined) => {
    const remaining = remainingDeadline()
    if (remaining <= 0) throw new DeadlineExceededError()
    const budgetMs = Math.min(timeoutMs, remaining)
    const headers = new Headers(input.headers)
    headers.set('authorization', `Bearer ${await token(audience)}`)
    headers.set(DEADLINE_HEADER, String(Math.floor(budgetMs)))
    propagation.inject(context.active(), headers, { set: (h, k, v) => h.set(k, v) })
    try {
      return await fetch(input.url, { method: input.method, headers, body, signal: AbortSignal.timeout(budgetMs) })
    } catch (err) {
      if (remainingDeadline() <= 0) throw new DeadlineExceededError()
      throw err
    }
  }

  return async (input: Request): Promise<Response> => {
    sharedBudget.recordRequest()
    const body = input.body ? await input.arrayBuffer() : undefined
    const once = () => (breakerPolicy ? breakerPolicy.execute(() => attempt(input, body)) : attempt(input, body))
    // Retry hanya satu lapis, di sini, dan hanya untuk GET atau operasi yang membawa idempotency key.
    const retryable = input.method === 'GET' || input.headers.has('idempotency-key')
    if (!retryable) return once()
    let first = true
    return wrap(retryPolicy).execute(() => {
      if (!first && !sharedBudget.tryRetry()) throw new RetryBudgetExhaustedError('anggaran retry habis')
      first = false
      return once()
    })
  }
}

export type ServiceVariables = { caller: string }

// Token service = projected ServiceAccount token k3s dengan audience = nama service tujuan (§6). Di dev memakai issuer statis.
// Prod: keys = createRemoteJWKSet(<JWKS issuer OIDC k3s>) dari jose; dev dan test: staticKey(pem).
export function serviceAuth({ audience, issuer, keys }: { audience: string; issuer: string; keys: JWTVerifyGetKey }) {
  return createMiddleware<{ Variables: ServiceVariables }>(async (c, next) => {
    const header = c.req.header('authorization')
    if (!header) throw new UnauthorizedError()
    try {
      const { payload } = await jwtVerify(header.replace(/^bearer\s+/i, ''), keys, {
        audience,
        issuer,
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['exp', 'sub'],
      })
      c.set('caller', payload.sub!)
    } catch {
      throw new InvalidTokenError()
    }
    await next()
  })
}

// Issuer token service untuk dev lokal dan test, menggantikan kubelet. Token di-cache sampai mendekati kedaluwarsa.
export function devServiceTokens({ privateKey, issuer, subject }: { privateKey: CryptoKey; issuer: string; subject: string }) {
  const cache = new Map<string, { token: string; exp: number }>()
  return async (audience: string) => {
    const cached = cache.get(audience)
    if (cached && cached.exp - Date.now() > 60_000) return cached.token
    const exp = Date.now() + 10 * 60_000
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(exp / 1000))
      .sign(privateKey)
    cache.set(audience, { token, exp })
    return token
  }
}

// Di k3s token dibaca ulang dari file yang dirotasi kubelet: <dir>/<audience>.
export const projectedServiceTokens = (dir: string) => async (audience: string) =>
  (await Bun.file(`${dir}/${audience}`).text()).trim()

export async function staticKey(pem: string): Promise<JWTVerifyGetKey> {
  const key = await importSPKI(pem, 'ES256')
  return async () => key
}
