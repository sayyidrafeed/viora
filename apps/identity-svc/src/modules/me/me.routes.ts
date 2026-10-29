import { describeRoute, resolver } from 'hono-openapi'
import { createRouter, errorBody, jsonBody, type RequiredUser, type userAuth } from '@viora/service-kit'
import { meHandlers } from './me.handlers.ts'
import { deleteMeBody, meResponse } from './me.schema.ts'
import type { meService } from './me.service.ts'

const json = (schema: Parameters<typeof resolver>[0]) => ({ 'application/json': { schema: resolver(schema) } })
const authErrors = { 401: { description: 'Token tidak ada, tidak valid, atau akun diblokir', content: json(errorBody) } }

// Urutan middleware §13: sesi → izin → validator.
export function meRoutes(service: ReturnType<typeof meService>, auth: ReturnType<typeof userAuth>) {
  const handlers = meHandlers(service)
  return createRouter<RequiredUser>()
    .use(auth.required)
    .get(
      '/',
      describeRoute({
        tags: ['me'],
        summary: 'Profil user yang sedang login beserta channel-nya',
        responses: { 200: { description: 'Profil', content: json(meResponse) }, ...authErrors },
      }),
      handlers.get,
    )
    .delete(
      '/',
      describeRoute({
        tags: ['me'],
        summary: 'Hapus akun beserta channel; token lama langsung ditolak',
        requestBody: { required: false, content: json(deleteMeBody) },
        responses: {
          204: { description: 'Akun dihapus' },
          400: { description: 'Body tidak valid', content: json(errorBody) },
          ...authErrors,
          404: { description: 'User sudah dihapus', content: json(errorBody) },
        },
      }),
      jsonBody(deleteMeBody),
      handlers.delete,
    )
}
