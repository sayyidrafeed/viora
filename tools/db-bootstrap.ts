// Role dan schema Postgres per service (§6 Postgres dan PgBouncer, §5 kepemilikan data).
// Setiap service punya satu role yang memiliki schema-nya sendiri dan tidak punya hak di schema lain.
// `bun run db:bootstrap [database]` dijalankan dengan role admin (DATABASE_ADMIN_URL) sebelum migrasi service.
import { SQL } from 'bun'

// Service yang menyimpan data di Postgres (docs/architecture/owners.md). metrics, cdc, search, dan transcode tidak memakai Postgres.
export const serviceSchemas = ['identity', 'upload', 'video', 'social', 'feed', 'notification', 'live'] as const

export const roleOf = (schema: string) => `${schema}_svc`

// Dev memakai password turunan nama role; lingkungan lain mengisi DB_PASSWORD_<ROLE> dari SOPS.
const passwordOf = (role: string, env: Record<string, string | undefined>) =>
  env[`DB_PASSWORD_${role.toUpperCase()}`] ?? `${role.replace('_', '-')}-dev`

const quoteLiteral = (v: string) => `'${v.replaceAll("'", "''")}'`

export async function bootstrapDatabase(admin: SQL, database: string, env: Record<string, string | undefined> = process.env) {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error(`nama database tidak valid: ${database}`)
  await admin.unsafe(`revoke connect on database ${database} from public`)
  for (const schema of serviceSchemas) {
    const role = roleOf(schema)
    const password = quoteLiteral(passwordOf(role, env))
    await admin.unsafe(`
      do $$ begin
        if not exists (select from pg_roles where rolname = '${role}') then
          create role ${role} login password ${password};
        else
          alter role ${role} login password ${password};
        end if;
      end $$;
      alter role ${role} set search_path = ${schema};
      -- Transaksi idle menahan xmin global dan menghentikan relay outbox semua service (§18A).
      alter role ${role} set idle_in_transaction_session_timeout = '30s';
      grant connect on database ${database} to ${role};
      -- Migrator Drizzle selalu menjalankan CREATE SCHEMA IF NOT EXISTS, dan Postgres memeriksa hak CREATE sebelum mengecek schema-nya ada.
      -- Semua schema service dibuat di sini lebih dulu dengan pemilik yang benar, jadi role tidak bisa merebut schema service lain.
      grant create on database ${database} to ${role};
      create schema if not exists ${schema} authorization ${role};
      alter schema ${schema} owner to ${role};
      revoke all on schema ${schema} from public;`)
    // Objek yang dibuat sebelum role ada (database dev lama) dipindah ke pemilik schema.
    await admin.unsafe(`
      do $$ declare r record; begin
        -- Sequence milik kolom identity ikut berpindah bersama tabelnya, jadi hanya tabel dan view yang dipindah.
        for r in select format('%s %I.%I', case c.relkind when 'v' then 'view' else 'table' end, n.nspname, c.relname) as obj
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = '${schema}' and c.relkind in ('r', 'p', 'v') and pg_get_userbyid(c.relowner) <> '${role}'
        loop execute format('alter %s owner to ${role}', r.obj); end loop;
        for r in select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as fn
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = '${schema}' and pg_get_userbyid(p.proowner) <> '${role}'
        loop execute format('alter function %s owner to ${role}', r.fn); end loop;
      end $$;`)
  }
}

if (import.meta.main) {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgres://viora:viora-dev@127.0.0.1:15432/viora'
  const database = process.argv[2] ?? new URL(adminUrl).pathname.slice(1)
  const admin = new SQL(adminUrl)
  await bootstrapDatabase(admin, database)
  await admin.close()
  console.info(`role dan schema service siap di database ${database}: ${serviceSchemas.map(roleOf).join(', ')}`)
}
