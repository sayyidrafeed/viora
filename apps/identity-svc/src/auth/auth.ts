import type { Db } from '../db/client.ts'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, jwt } from 'better-auth/plugins'
import { expo } from '@better-auth/expo'
import type { Env } from '../env.ts'
import type { Mailer } from '../mailer.ts'
import * as schema from '../db/schema.ts'
import { loadKeyring, refuseKeyMinting } from './keyring.ts'

export const JWT_AUDIENCE = 'viora-api'

type AuthDeps = { env: Env; db: Db; mailer: Mailer }

export async function createAuth({ env, db, mailer }: AuthDeps) {
  const keys = await loadKeyring(env.JWT_KEY_DIR, env.JWT_ACTIVE_KID)
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined

  return betterAuth({
    baseURL: env.BASE_URL,
    basePath: '/v1/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, jwks: schema.jwks },
    }),
    advanced: {
      database: { generateId: () => Bun.randomUUIDv7() },
      // Default Better Auth mematikan origin dan CSRF check saat NODE_ENV=test atau TEST=true. Dikunci supaya selalu aktif.
      disableOriginCheck: false,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) =>
        mailer.send({ to: user.email, subject: 'Reset password Viora', text: `Buka link ini untuk membuat password baru: ${url}` }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        mailer.send({ to: user.email, subject: 'Verifikasi email Viora', text: `Buka link ini untuk memverifikasi email: ${url}` }),
    },
    ...(google ? { socialProviders: google } : {}),
    plugins: [
      admin(),
      expo(),
      jwt({
        jwks: { keyPairConfig: { alg: 'ES256' }, disablePrivateKeyEncryption: true },
        jwt: {
          issuer: env.JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expirationTime: '10m',
          definePayload: ({ user }) => ({ role: user.role ?? 'user', ev: user.emailVerified }),
        },
        adapter: { getJwks: async () => keys, createJwk: async () => refuseKeyMinting() },
      }),
    ],
  })
}

export type Auth = Awaited<ReturnType<typeof createAuth>>
