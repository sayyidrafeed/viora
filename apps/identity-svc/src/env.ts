import { loadEnv as load, portEnv } from '@viora/service-kit'
import { z } from 'zod'

const shape = {
  PORT: portEnv(13001),
  // DATABASE_URL lewat PgBouncer (transaction pooling); DATABASE_DIRECT_URL langsung ke Postgres untuk advisory lock relay dan migrasi (§6).
  DATABASE_URL: z.url(),
  DATABASE_DIRECT_URL: z.url(),
  REDIS_DURABLE_URL: z.url(),
  AUTH_SECRET: z.string().min(32).refine((v) => !v.startsWith('ganti-'), 'AUTH_SECRET masih nilai contoh'),
  BASE_URL: z.url(),
  TRUSTED_ORIGINS: z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  JWT_ISSUER: z.url(),
  JWT_KEY_DIR: z.string().min(1),
  JWT_ACTIVE_KID: z.string().min(1),
  KAFKA_BROKERS: z.string().transform((v) => v.split(',')),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
}

export type Env = z.infer<z.ZodObject<typeof shape>>

export const loadEnv = (source?: Record<string, string | undefined>) => load('identity-svc', shape, source)
