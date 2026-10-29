import { createMiddleware } from 'hono/factory'
import type { z } from 'zod'
import { InvalidBodyError } from './errors.ts'

// Body JSON dibaca tanpa bergantung pada content-type; body kosong dianggap {}.
export function jsonBody<S extends z.ZodType>(schema: S) {
  return createMiddleware<{ Variables: { body: z.infer<S> } }>(async (c, next) => {
    const text = await c.req.text()
    let raw: unknown = {}
    try {
      if (text.trim() !== '') raw = JSON.parse(text)
    } catch {
      throw new InvalidBodyError()
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new InvalidBodyError(parsed.error.issues)
    c.set('body', parsed.data)
    await next()
  })
}
