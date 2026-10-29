import { z } from 'zod'
import { createRouter, DomainError, type AuthVariables, type userAuth } from '@viora/service-kit'
import type { meService } from './me.service.ts'

const deleteBody = z.object({ purgeComments: z.boolean().default(false) }).strict()

export function meRoutes(service: ReturnType<typeof meService>, auth: ReturnType<typeof userAuth>) {
  return createRouter<AuthVariables>()
    .use(auth.required)
    .get('/', async (c) => c.json(await service.get(c.get('user')!.id)))
    .delete('/', async (c) => {
      const text = await c.req.text()
      let raw: unknown = {}
      try {
        if (text.trim() !== '') raw = JSON.parse(text)
      } catch {
        throw new DomainError(400, 'invalid_body', 'Body tidak valid')
      }
      const body = deleteBody.safeParse(raw)
      if (!body.success) throw new DomainError(400, 'invalid_body', 'Body tidak valid')
      await service.delete(c.get('user')!.id, body.data.purgeComments)
      return c.body(null, 204)
    })
}
