import type { Db } from './db/client.ts'
import { createApp, RouteNotFoundError, userAuth, type Denylist } from '@viora/service-kit'
import type { CryptoKey } from 'jose'
import { JWT_AUDIENCE } from './auth/auth.ts'
import { meRoutes, meService } from './modules/me/index.ts'

const blocked = () => {
  throw new RouteNotFoundError()
}

export type AppDeps = {
  db: Db
  denylist: Denylist
  publicKeys: Map<string, CryptoKey>
  jwtIssuer: string
  authHandler: (request: Request) => Response | Promise<Response>
}

export function buildApp({ db, denylist, publicKeys, jwtIssuer, authHandler }: AppDeps) {
  const users = userAuth({ keys: publicKeys, issuer: jwtIssuer, audience: JWT_AUDIENCE, denylist })
  const app = createApp('identity-svc')
  // Route bawaan Better Auth ini melewati denylist dan outbox (§6). Kong juga menolaknya, tapi identity-svc sebagai pemilik auth tidak bergantung pada itu.
  app.all('/v1/auth/admin/*', blocked)
  app.all('/v1/auth/delete-user/*', blocked)
  app.on(['GET', 'POST'], '/v1/auth/*', (c) => authHandler(c.req.raw))
  app.route('/v1/me', meRoutes(meService({ db, denylist }), users))
  return app
}
