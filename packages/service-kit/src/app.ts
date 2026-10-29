import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class DomainError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const createRouter = <V extends Record<string, unknown> = Record<string, never>>() => new Hono<{ Variables: V }>()

export function createApp(service: string) {
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ service, ok: true }))
  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'Terjadi kesalahan internal' } }, 500)
  })
  return app
}
