import { RedisClient, SQL } from 'bun'
import { createProducer, loadPublicKeys, OutboxRelay, redisDenylist, startTelemetry } from '@viora/service-kit'
import { buildApp } from './app.ts'
import { createDb } from './db/client.ts'
import { identity } from './db/schema.ts'
import { createAuth } from './auth/auth.ts'
import { loadEnv } from './env.ts'
import { createMailer } from './mailer.ts'

const env = loadEnv()
startTelemetry('identity-svc', env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
const sql = new SQL(env.DATABASE_URL)
const directSql = new SQL(env.DATABASE_DIRECT_URL, { max: 1 })
const db = createDb(sql)
const denylist = redisDenylist(new RedisClient(env.REDIS_DURABLE_URL))
const auth = await createAuth({ env, db, mailer: createMailer(env) })
const app = buildApp({
  db,
  denylist,
  publicKeys: await loadPublicKeys(env.JWT_KEY_DIR),
  jwtIssuer: env.JWT_ISSUER,
  authHandler: auth.handler,
})

const relay = new OutboxRelay({
  sql: directSql,
  schema: identity.schemaName,
  producer: createProducer('identity-svc-relay', env.KAFKA_BROKERS),
  lockKey: 1001n,
})
relay.start()

export default { port: env.PORT, fetch: app.fetch }
