# Test strategy

Versi: M0 (2026-10-29). Ringkasan grand plan §14, ditambah cara M0 benar-benar menguji.

## Prinsip

- Sedikit test, tapi setiap test menangkap bug nyata. Tidak ada test yang hanya mengulang implementasi.
- Test integrasi berjalan terhadap infrastruktur asli, bukan mock: Postgres, Redis, dan Redpanda dari Compose profile `core`.
- Test konkurensi dibuktikan lewat mutasi. Test dianggap sah kalau gagal saat penjaga yang diujinya dihapus.
- Tidak ada test komponen UI di jsdom atau happy-dom. Logika UI dipindah ke fungsi murni lalu diuji di level unit.

## Level test

| Level | Isi | Alat | Status M0 |
|---|---|---|---|
| Unit | Hanya aturan domain murni: transisi state machine, aturan view dan dedupe, ambang fan-out, kalkulasi ladder rendisi, parsing cursor | `bun test` | Belum ada aturan domain (mulai M1). Test murni yang ada: aturan BACKWARD skema event (`packages/contracts/test/compat.test.ts`) dan policy panggilan sinkron (`packages/service-kit/test/internal.test.ts`, server HTTP lokal sungguhan) |
| Integrasi | Endpoint service terhadap Postgres dan Redis asli: transaksi, outbox, consumer idempoten, permission | `bun test` + Compose profile `core` | Jalan: identity-svc dan walking skeleton |
| Kontrak | Breaking change OpenAPI, skema event `contracts` cocok dengan producer | oasdiff, test skema | Jalan: payload outbox identity diparse dengan skema `contracts`; CI membandingkan `event-schemas.json` (BACKWARD) dan spec OpenAPI (oasdiff) terhadap base (`tools/ci/check-compat.sh`) |
| Pipeline | Job Flink SQL dengan input tetap, termasuk input duplikat dan terlambat | `tools/flink-test.ts` di profile `stream` | Mulai M3 |
| E2E | Daftar, upload, siap, tonton, like dan subscribe, muncul di feed subscriber | Playwright (web), Maestro (mobile, mulai M6) | M0: `e2e/auth-via-kong.test.ts` menjalankan identity-svc dan web sungguhan di belakang Kong (daftar, verifikasi, token, `/v1/me`, route admin ditolak, trace di Tempo) lewat HTTP. Playwright untuk journey browser mulai M2 |
| Load | Penonton bersamaan, upload paralel, lonjakan video viral | k6 dari mesin terpisah terhadap prod | M7 |

Semua test jalan di CI (`.github/workflows/ci.yml`): job `static` (lint, typecheck, file hasil generate, kompatibilitas kontrak, test tanpa infra) dan job `integration` (Compose `core` + Tempo, test integrasi, spike Kafka, E2E). Pemilihan lane berdasarkan diff (pola fikes) belum dibuat; semua job jalan di setiap push. Status per grand plan revisi 17 (2026-10-29).

## Cara M0 menguji

### Infrastruktur asli

Semua suite di bawah butuh `bun run dev:infra`, yang menyalakan Compose profile `core`: Postgres 17.11 (port 15432), PgBouncer (16432), Redpanda v26.2.6 (19092), Redis 8.6 (16379), dan Kong 3.9.4 (18000, admin 18001). Tidak ada mock untuk database, Redis, atau broker.

### Isolasi per run

- `apps/identity-svc/test/identity.test.ts` membuat database baru per run (`identity_test_<timestamp>`) lewat koneksi langsung, menjalankan migrasi Drizzle ke database itu, lalu menghapusnya dengan `drop database ... with (force)` di akhir.
- `packages/service-kit/test/walking-skeleton.test.ts` memakai database bersama, tapi membuat schema per run (`skel_owner_<run>`, `skel_feed_<run>`), topic per run (`video.v1.<run>`), dan consumer group per run. Topic utama, retry, dan DLQ dihapus di akhir.
- Kunci JWT test dibuat per run di direktori sementara. Tidak ada kunci test di repo.

### PgBouncer di test identity

App di test identity terhubung lewat PgBouncer (transaction pooling, `max_prepared_statements = 200`), sama seperti prod. Migrasi dan pembuatan database memakai koneksi langsung. Grand plan mencatat 261 transaksi di statistik PgBouncer per run. Walking skeleton masih terhubung langsung ke Postgres.

### `NODE_ENV=test`

`bun test` men-set `NODE_ENV=test`. Better Auth 1.7.14 mematikan origin check dan CSRF check secara default dalam kondisi itu, jadi test CSRF bisa lolos tanpa pemeriksaan apa pun. Konfigurasi identity-svc mengunci `advanced.disableOriginCheck: false`, dan test Expo membuktikan origin asing ditolak 403.

### Test balapan yang dibuktikan lewat mutasi

| Test | Mutasi yang membuatnya gagal |
|---|---|
| Walking skeleton: event lama yang selesai di retry tidak menimpa versi baru | Menghapus penjaga versi di handler proyeksi |
| Walking skeleton: event yang sama di consumer utama dan retry bersamaan hanya diterapkan sekali | Menghapus klaim `processed_events` |
| Walking skeleton: gagal memindahkan pesan ke retry membuat consumer berhenti tanpa commit | Menghapus penanda fatal |
| identity-svc: dua `DELETE /v1/me` bersamaan, satu berhasil, satu 404, denylist tetap ada | Grand plan mencatat test ini dibuktikan lewat mutasi, tanpa menyebut mutasinya |

## Suite yang ada

| File | Jumlah test | Yang dibuktikan |
|---|---|---|
| `spikes/kafka-bun/kafka.spike.test.ts` | 5 | `@platformatic/kafka` di Bun: producer idempoten, `compatibilityPartitioner`, rebalance, restart dari offset committed, handler lambat tidak dikeluarkan (ADR 026) |
| `spikes/auth-keyring/auth.spike.test.ts` | 12 | Keyring Better Auth tanpa menyimpan kunci, rotasi `kid`, Kong menerima token ES256 dan menolak token rusak, kedaluwarsa, atau `kid` asing, route `optional` meneruskan token palsu (ADR 006, ADR 007) |
| `packages/service-kit/test/walking-skeleton.test.ts` | 9 | Filter xmin, satu leader relay, jalur normal sampai efek eksternal, dua balapan, crash setelah efek sebelum commit, DLQ, consumer tetap sehat, kegagalan kirim ke retry (ADR 004, ADR 024, ADR 030) |
| `apps/identity-svc/test/identity.test.ts` | 13 | Daftar, verifikasi, reset password, trigger outbox per kolom, transaksi batal tanpa event, `/v1/me`, `DELETE /v1/me`, route bawaan Better Auth ditolak, penghapusan bersamaan, token dari sesi Expo |

Catatan per suite:

- Suite `auth-keyring` menimpa konfigurasi deklaratif Kong lokal lewat admin API. Test hanya mengecek status 401, bukan alasannya di log Kong.
- Efek eksternal di walking skeleton adalah store di memori dengan penjaga versi, pengganti Meilisearch, KV, atau Redis.
- Selain suite di atas, grand plan mencatat satu smoke test proses nyata: identity-svc jalan sebagai server dengan relay aktif, dan daftar lewat HTTP menghasilkan `user.registered` yang diterima `EventConsumer` dalam 176 ms (satu sampel). Smoke test ini tidak berupa file test di repo.

## Menjalankan

- Per package: `bun test` di folder package (identity-svc memakai `bun test --timeout 60000`).
- Semua package: `bun run test` di root (`turbo run test`). Ini heavy run, jadi lewat `gated-run heavy` di mesin dev 16 GB.
- Typecheck semua package (`bun run typecheck`) juga heavy run.

## Belum dibuktikan di M0

Daftar dari grand plan §18A:

- `dlq:replay`, `dlq:skip`, purge `processed_events` dan outbox.
- Propagasi span OTel.
- Leader relay lintas proses dan saat koneksi putus, gangguan broker dan Postgres.
- Urutan publish ke Kafka untuk transaksi multi-event.
- Dedupe producer saat retry kirim, broker restart, throughput.
- Reload kunci saat file berubah, denylist di route `optional`, pembatalan denylist saat transaksi gagal (hanya dicek verifier dengan fake).
- Login Google, pengiriman ke Resend sungguhan (kontrak adapter diuji di `apps/identity-svc/test/mailer.test.ts`, ADR 025), `fetch` React Native membaca `set-cookie` di perangkat (M6).
- Test pembanding migrasi `0001` identity dengan `outboxDdl`.

## Rujukan

- grand plan §14, §15 (Lingkungan), §18A (Hasil spike M0, Hasil identity-svc M0), §20 revisi 14 sampai 16
- `infra/compose/compose.yaml`, `infra/pgbouncer/pgbouncer.ini`
