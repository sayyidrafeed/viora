import type { Context } from 'hono'
import type { RequiredUser } from '@viora/service-kit'
import type { DeleteMeBody } from './me.schema.ts'
import type { meService } from './me.service.ts'

type Authed<V = object> = Context<{ Variables: RequiredUser & V }>

export function meHandlers(service: ReturnType<typeof meService>) {
  return {
    get: async (c: Authed) => c.json(await service.get(c.get('user').id)),
    delete: async (c: Authed<{ body: DeleteMeBody }>) => {
      await service.delete(c.get('user').id, c.get('body').purgeComments)
      return c.body(null, 204)
    },
  }
}
