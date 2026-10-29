# ADR 004: Transactional outbox (relay tunggal, filter xmin) dan consumer idempoten wajib

Status: Diterima (2026-10-28). Diperbarui 2026-10-29 dari spike M0 dan hardening (revisi 14 sampai 16).

## Konteks

Setiap perubahan data yang memengaruhi service lain harus sampai ke Redpanda tanpa hilang dan tanpa ditulis di luar transaksi. Redpanda mengirim minimal sekali, dan idempotensi producer hanya berlaku dalam satu sesi, jadi duplikat tetap mungkin (`docs/verification.md` no. 2). UUIDv7 berurutan saat dibuat, bukan saat commit, sehingga relay berbasis cursor bisa melewatkan transaksi yang commit belakangan (no. 6).

## Keputusan

Outbox:

- Service yang punya database menulis event ke `<schema>.outbox` di transaksi yang sama dengan perubahan data.
- Kolom: `id` (UUIDv7), `seq` (identity, urutan di dalam satu transaksi), `xid` (`xid8`, default `pg_current_xact_id()`), `topic`, `key`, `headers`, `payload`, `published_at`.
- Envelope hanya dibangun oleh fungsi SQL `<schema>.outbox_emit`. Trigger Postgres dan kode TS (`writeOutbox` di `service-kit`) sama-sama memanggilnya, jadi bentuk envelope punya satu pemilik. `traceparent` dibaca dari `set_config('viora.traceparent', ...)` di transaksi yang sama.

Relay:

- Satu relay aktif per service. Leader dipilih lewat advisory lock sesi di koneksi langsung ke Postgres (`DATABASE_DIRECT_URL`), bukan lewat PgBouncer. Kode aplikasi memakai `DATABASE_URL` lewat PgBouncer (transaction pooling, `max_prepared_statements = 200`, port lokal 16432).
- Relay membaca baris dengan `xid < pg_snapshot_xmin(pg_current_snapshot())`, diurutkan `(xid, seq)`.
- Polling setiap 200 ms. `LISTEN/NOTIFY` hanya pemicu tambahan. Baris terkirim dihapus setelah 7 hari.
- Relay melepas advisory lock secara eksplisit (`pg_advisory_unlock_all()`) sebelum koneksi reserved kembali ke pool.
- Kode aplikasi dan `writeOutbox` memakai Drizzle (`bun-sql`). Relay memakai koneksi `Bun.SQL` reserved.

Consumer:

- Semua consumer wajib idempoten. Consumer yang punya database mengklaim `(consumer_group, event_id)` di `<schema>.processed_events` di awal transaksi (`insert ... on conflict do nothing returning`). Pengiriman kedua yang bersamaan menunggu di unique index sampai yang pertama commit, lalu dilewati. Catatan dipurge setelah 14 hari.
- Efek di luar database dijalankan dan ditunggu lebih dulu, baru `processed_events` dan versi proyeksi di-commit. Efek eksternal wajib idempoten menurut key dan versi.
- Service tanpa database (`transcode-svc`, ingest `metrics-svc`) publish langsung dengan ID event deterministik.

## Konsekuensi

- Urutan relay mengikuti `xid`, bukan urutan commit. Penjaga versi wajib di semua proyeksi (ADR 030).
- xmin bersifat global per database, jadi transaksi panjang atau `idle in transaction` di schema mana pun ikut menahan relay. Butuh `idle_in_transaction_session_timeout` per role dan alert umur baris outbox tertua (M7).
- Relay bisa mengirim duplikat setelah crash di antara `send` dan `update published_at`. Consumer menanganinya lewat `processed_events`.
- Terbukti di M0: filter xmin, satu leader untuk dua relay dalam satu proses, klaim `processed_events` (dibuktikan lewat mutasi), urutan `seq` di tabel, dan test identity lewat PgBouncer.
- Belum terbukti: urutan publish ke Kafka untuk transaksi multi-event, leader lintas proses dan saat koneksi putus, purge outbox dan `processed_events`, `LISTEN/NOTIFY` (belum diimplementasikan), `tracestate` di outbox, gangguan broker dan Postgres.
- Migrasi `0001` identity menyalin `outboxDdl` secara manual. Test pembanding keduanya belum ada.

## Alternatif yang ditolak

- Beberapa relay paralel dengan `SKIP LOCKED` (revisi 1). Tidak menjaga urutan. Diganti relay tunggal di revisi 3.
- Mengurutkan dengan UUIDv7. Presisinya milidetik, dan UUIDv7 dari fungsi SQL tidak monoton di dalam milidetik yang sama, sehingga event satu transaksi bisa tertukar (revisi 15).
- Relay di setiap instance tanpa lock, diurutkan `created_at` (pola Seapedia). Bisa publish dua kali dan melewatkan baris yang commit terlambat.
- After-hook Better Auth untuk outbox identity (revisi 7). Berjalan setelah commit, dan adapter Drizzle default-nya tanpa transaksi. Diganti trigger Postgres.
- Advisory lock lewat pool aplikasi. Lock sesi tidak didukung PgBouncer mode transaction. Relay sempat mengambil lock dari pool yang sama dengan app sampai revisi 16.
- Debezium. Disebut di verifikasi, tapi biayanya dibanding polling belum diverifikasi. Polling dipilih sebagai penilaian, bukan temuan bersumber.

## Rujukan

- grand-plan §6 (Asinkron, Postgres dan PgBouncer), §7, §18A (Hasil spike M0, Hasil identity-svc M0), §20 revisi 3, 7, 14, 15, 16
- `docs/verification.md` no. 2, 6, 9, 10, 12
- `packages/service-kit/src/outbox.ts`, `packages/service-kit/src/consumer.ts` (`processOnce`), `packages/service-kit/test/walking-skeleton.test.ts`
- `apps/identity-svc/drizzle/0001_outbox_triggers.sql`, `infra/pgbouncer/pgbouncer.ini`
