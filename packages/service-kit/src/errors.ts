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
