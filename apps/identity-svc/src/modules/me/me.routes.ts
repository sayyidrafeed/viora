import { createRouter, jsonBody, type RequiredUser, type userAuth } from '@viora/service-kit'
import { meHandlers } from './me.handlers.ts'
import { deleteMeBody } from './me.schema.ts'
import type { meService } from './me.service.ts'

// Urutan middleware §13: sesi → izin → validator.
export function meRoutes(service: ReturnType<typeof meService>, auth: ReturnType<typeof userAuth>) {
  const handlers = meHandlers(service)
  return createRouter<RequiredUser>()
    .use(auth.required)
    .get('/', handlers.get)
    .delete('/', jsonBody(deleteMeBody), handlers.delete)
}
