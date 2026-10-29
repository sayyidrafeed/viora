import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['identity'],
  // Tabel migrasi per service; satu tabel bersama membuat migrasi service lain terlewat.
  migrations: { schema: 'identity' },
})
