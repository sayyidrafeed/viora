import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// Setiap error domain punya kelas sendiri dengan status dan kode tetap (§13); onError memetakannya ke satu bentuk error.
export abstract class DomainError extends Error {
  abstract readonly status: ContentfulStatusCode
  abstract readonly code: string
}

export class RouteNotFoundError extends DomainError {
  readonly status = 404
  readonly code = 'not_found'
  constructor() {
    super('Route tidak ada')
  }
}

export class InvalidBodyError extends DomainError {
  readonly status = 400
  readonly code = 'invalid_body'
  constructor(readonly details?: unknown) {
    super('Body tidak valid')
  }
}

export const createRouter = <V extends Record<string, unknown>>() => new Hono<{ Variables: V }>()

export function createApp(service: string) {
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ service, ok: true }))
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      const details = err instanceof InvalidBodyError ? err.details : undefined
      return c.json({ error: { code: err.code, message: err.message, ...(details ? { details } : {}) } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'Terjadi kesalahan internal' } }, 500)
  })
  return app
}
