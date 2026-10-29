import { httpInstrumentationMiddleware } from '@hono/otel'
import { Hono } from 'hono'
import { z } from 'zod'
import { deadlineMiddleware } from './deadline.ts'
import { DomainError, InvalidBodyError } from './errors.ts'

export const errorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})

// Kelas route untuk generator Kong (§6). Tanpa tanda, route dianggap `required`.
export type AuthClass = 'public' | 'optional' | 'required'

export const createRouter = <V extends Record<string, unknown>>() => new Hono<{ Variables: V }>()

export function createApp(service: string) {
  const app = new Hono()
  // Query string dibuang dari url.full: link verifikasi email dan reset password membawa token di query.
  app.use(httpInstrumentationMiddleware({ serviceName: service, getUrlFull: (c) => new URL(c.req.url).origin + c.req.path }))
  app.use(deadlineMiddleware)
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
