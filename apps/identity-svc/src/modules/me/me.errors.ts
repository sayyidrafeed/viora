import { DomainError } from '@viora/service-kit'

export class UserNotFoundError extends DomainError {
  readonly status = 404
  readonly code = 'user_not_found'
  constructor() {
    super('User tidak ditemukan')
  }
}
