# viora

Monorepo Bun + Turborepo untuk platform video. Rencana dan semua keputusan ada di docs/grand-plan.md; revisi yang lebih baru (§20) mengalahkan teks lama. Kepemilikan tabel dan event per service ada di docs/architecture/owners.md.

## Perintah

- `bun run dev:infra` (profile `core`: Postgres, PgBouncer, Redpanda, Redis, Kong), `bun run dev:obs` (`core` + Tempo, VictoriaMetrics, Grafana di 13300), `bun run dev:infra:down`.
- `bunx turbo run typecheck`, `bunx oxlint .`
- Test integrasi butuh infra menyala: `cd <workspace> && bun test --timeout 60000`.
- `bun run new:service <nama>-svc <port 13xxx>` dan `bun run new:module <nama>-svc <modul>`.
- `bun run test:e2e`: menyalakan identity-svc dan web sendiri, lalu menguji lewat Kong dan Tempo (butuh `dev:obs`).
- File hasil generate tidak diedit tangan (hook `.claude/settings.json` menolaknya): `apps/*/openapi.json` (`bun run openapi`), `infra/kong/kong.yaml` (`bun run kong:config`), `packages/contracts/event-schemas.json` (`bun run schemas`), `packages/api-client/src/generated` (`bun run generate`), `apps/web/src/routeTree.gen.ts` (Vite). CI menjalankan `tools/ci/check-generated.sh`.

Port lokal digeser +10000 dari default: Postgres 15432, PgBouncer 16432, Redis 16379, Redpanda 19092, Kong 18000/18001, Tempo 13200, web 13000, service 13001 sampai 13011. Web dan API diakses lewat Kong di http://localhost:18000.

## Konvensi service (§13)

- Modul di `src/modules/<m>/<m>.{schema,service,handlers,routes,errors,index}.ts`, diimpor dari luar hanya lewat `index.ts`.
- App dan router Hono dibuat lewat `createApp` dan `createRouter` dari `@viora/service-kit`. `new Hono()` langsung ditolak lint.
- Error domain adalah subclass `DomainError` dengan `status` dan `code` tetap. Jangan lempar `Error` biasa untuk kondisi yang diketahui.
- Urutan middleware: sesi (`userAuth().required` atau `.optional`), izin, lalu validator (`jsonBody(schema)`).
- Skema response dan request diturunkan dari tabel Drizzle lewat drizzle-zod kalau bentuknya mengikuti tabel.
- Env divalidasi saat start dengan `loadEnv` dari service-kit. Service gagal start kalau env kurang.
- Panggilan antar-service lewat `createInternalFetch` dan route `/internal` dijaga `serviceAuth` (ADR 028). Tambahkan route publik baru dengan `describeRoute`; route tanpa `x-auth` dianggap `required` oleh generator Kong.
- Service tidak boleh mengimpor kode service lain. Kode bersama hanya lewat `packages/*`, dan package baru butuh dua consumer nyata.

## Event dan data

- Event ditulis ke `<schema>.outbox` di transaksi yang sama dengan perubahan data, lewat `writeOutbox` atau trigger yang memanggil `<schema>.outbox_emit`. Payload diberi tipe dengan `satisfies IdentityEventDataOf<...>` (atau padanannya per domain) dari `@viora/contracts`.
- Consumer memakai `EventConsumer` dan `processOnce`. Semua consumer wajib idempoten, dan proyeksi hanya menerapkan `stateVersion` yang lebih baru. Versi bisa melompat, jadi jangan menganggapnya berurutan.
- Relay outbox memakai koneksi langsung (`DATABASE_DIRECT_URL`), bukan PgBouncer, karena advisory lock butuh sesi.

## Test (§14)

Sedikit test, masing-masing menangkap bug nyata. Integrasi memakai Postgres, Redis, dan Redpanda asli, bukan mock. Tidak ada test yang mengulang implementasi.

## Mesin dev

RAM 16 GB dipakai bersama. Jalankan perintah berat lewat `gated-run heavy|light <cmd>` kalau tersedia, dan jangan jalankan suite penuh paralel.
