# identity-svc

Pemilik user, sesi, akun, dan channel (schema `identity`). Better Auth dipasang di `/v1/auth`. Kunci JWT ES256 datang dari keyring (`src/auth/keyring.ts`), tidak pernah dari database.

- Event identity ditulis oleh trigger Postgres di `drizzle/0001_outbox_triggers.sql`, kecuali `user.deleted` dan `channel.deleted` yang ditulis `DELETE /v1/me`.
- `advanced.disableOriginCheck: false` di `src/auth/auth.ts` wajib tetap ada. Better Auth mematikan origin dan CSRF check saat `NODE_ENV=test` kalau nilai ini kosong.
- Route bawaan `/v1/auth/admin/*` dan `/v1/auth/delete-user` ditolak di `src/app.ts`. Admin dan hapus akun hanya lewat route identity-svc sendiri.
- Setup lokal: `cp .env.example .env`, isi `AUTH_SECRET`, `bun run keys:dev`, `bun run db:migrate`.
- `bun test --timeout 60000` membuat database baru per run. App lewat PgBouncer, migrasi lewat koneksi langsung.
