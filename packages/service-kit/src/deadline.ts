import { AsyncLocalStorage } from 'node:async_hooks'
import { createMiddleware } from 'hono/factory'
import { DomainError } from './errors.ts'

export const DEADLINE_HEADER = 'x-deadline-ms'
const deadlines = new AsyncLocalStorage<number>()

export class DeadlineExceededError extends DomainError {
  readonly status = 504
  readonly code = 'deadline_exceeded'
  constructor() {
    super('Batas waktu request habis')
  }
}

// Sisa deadline dikirim sebagai milidetik, bukan timestamp, supaya kebal clock skew (§6 Sinkron).
export const deadlineMiddleware = createMiddleware(async (c, next) => {
  const ms = Number(c.req.header(DEADLINE_HEADER))
  if (!Number.isFinite(ms) || ms <= 0) return next()
  await deadlines.run(Date.now() + ms, next)
})

export const remainingDeadline = () => {
  const at = deadlines.getStore()
  return at === undefined ? Number.POSITIVE_INFINITY : at - Date.now()
}

