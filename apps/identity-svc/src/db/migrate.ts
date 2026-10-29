import { SQL } from 'bun'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { createDb } from './client.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL wajib diisi')
const sql = new SQL(url)
await migrate(createDb(sql), { migrationsFolder: join(import.meta.dir, '..', '..', 'drizzle') })
await sql.close()
console.info('migrasi identity selesai')
