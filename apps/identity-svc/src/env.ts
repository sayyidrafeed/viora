import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().default(13001),
  DATABASE_URL: z.url(),
  REDIS_DURABLE_URL: z.url(),
  AUTH_SECRET: z.string().min(32).refine((v) => !v.startsWith('ganti-'), 'AUTH_SECRET masih nilai contoh'),
  BASE_URL: z.url(),
  TRUSTED_ORIGINS: z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  JWT_ISSUER: z.url(),
  JWT_KEY_DIR: z.string().min(1),
  JWT_ACTIVE_KID: z.string().min(1),
  KAFKA_BROKERS: z.string().transform((v) => v.split(',')),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) throw new Error(`env identity-svc tidak lengkap:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}
