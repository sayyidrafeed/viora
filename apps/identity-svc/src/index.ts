import { RedisClient, SQL } from 'bun'
import { createProducer, loadPublicKeys, OutboxRelay, redisDenylist } from '@viora/service-kit'
import { buildApp } from './app.ts'
import { createDb } from './db/client.ts'
import { identity } from './db/schema.ts'
import { createAuth } from './auth/auth.ts'
import { loadEnv } from './env.ts'
import { logMailer } from './mailer.ts'

const env = loadEnv()
const sql = new SQL(env.DATABASE_URL)
const directSql = new SQL(env.DATABASE_DIRECT_URL, { max: 1 })
const db = createDb(sql)
const denylist = redisDenylist(new RedisClient(env.REDIS_DURABLE_URL))
const auth = await createAuth({ env, db, mailer: logMailer })
const app = buildApp({ env, db, auth, denylist, publicKeys: await loadPublicKeys(env.JWT_KEY_DIR) })

const relay = new OutboxRelay({
  sql: directSql,
  schema: identity.schemaName,
  producer: createProducer('identity-svc-relay', env.KAFKA_BROKERS),
  lockKey: 1001n,
})
relay.start()

export default { port: env.PORT, fetch: app.fetch }
