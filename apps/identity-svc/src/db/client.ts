import type { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema.ts'

export const createDb = (client: SQL) => drizzle({ client, schema })
export type Db = ReturnType<typeof createDb>

// Tabel migrasi tinggal di schema service sendiri, bukan schema `drizzle` bersama.
export const migrationsConfig = { migrationsSchema: 'identity', migrationsTable: '__drizzle_migrations' } as const
