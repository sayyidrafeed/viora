import { SQL } from 'bun'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { z } from 'zod'
import { loadEnv } from '@viora/service-kit'
import { createDb } from './client.ts'

const env = loadEnv('identity-svc migrate', { DATABASE_DIRECT_URL: z.url() })
const sql = new SQL(env.DATABASE_DIRECT_URL)
await migrate(createDb(sql), { migrationsFolder: join(import.meta.dir, '..', '..', 'drizzle') })
await sql.close()
console.info('migrasi identity selesai')
