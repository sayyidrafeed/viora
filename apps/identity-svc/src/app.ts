import type { Db } from './db/client.ts'
import { createApp, RouteNotFoundError, userAuth, type Denylist } from '@viora/service-kit'
import type { CryptoKey } from 'jose'
import type { Auth } from './auth/auth.ts'
import { JWT_AUDIENCE } from './auth/auth.ts'
import type { Env } from './env.ts'
import { meRoutes, meService } from './modules/me/index.ts'

const blocked = () => {
  throw new RouteNotFoundError()
}

export type AppDeps = { env: Env; db: Db; auth: Auth; denylist: Denylist; publicKeys: Map<string, CryptoKey> }

export function buildApp({ env, db, auth, denylist, publicKeys }: AppDeps) {
  const users = userAuth({ keys: publicKeys, issuer: env.JWT_ISSUER, audience: JWT_AUDIENCE, denylist })
  const app = createApp('identity-svc')
  // Route bawaan Better Auth ini melewati denylist dan outbox (§6). Kong juga menolaknya, tapi identity-svc sebagai pemilik auth tidak bergantung pada itu.
  app.all('/v1/auth/admin/*', blocked)
  app.all('/v1/auth/delete-user/*', blocked)
  app.on(['GET', 'POST'], '/v1/auth/*', (c) => auth.handler(c.req.raw))
  app.route('/v1/me', meRoutes(meService({ db, denylist }), users))
  return app
}
