# ADR 001: Microservices sesuai diagram dengan Postgres satu schema per service

Status: Diterima (2026-10-28)

## Konteks

Viora adalah portofolio system design. Diagram awal memakai microservices, satu Postgres, CDN untuk playback, dan pipeline metrics berbasis stream (§5). Tim terdiri dari satu orang part-time dengan bantuan agent (§1). Prod berjalan di satu dedicated server 64 GB RAM dengan k3s satu node (§1, §15).

Verifikasi 2026-10-28 (`docs/verification.md` no. 13) menilai klaim "13 microservice untuk satu developer" sebagai Partly. Fowler menulis bahwa microservices punya biaya tambahan ("microservice premium") dan proyek baru sebaiknya tidak dimulai dengan microservices. Fowler juga mengakui buktinya terbatas dan tidak membahas developer solo.

Seapedia, proyek microservice user sebelumnya, punya 4 service Hono di satu host tanpa Kubernetes dan tanpa trafik produksi. Seapedia pindah dari satu Postgres bersama ke server database per service demi isolasi kegagalan (ADR 0008 Seapedia). Viora sengaja tidak mengikuti langkah itu.

## Keputusan

- Arsitektur mengikuti diagram: 12 service (§5), dibangun bertahap per milestone. Service yang belum dikerjakan cukup berupa skeleton dari scaffolder.
- Satu instance Postgres 17. Setiap service punya schema dan DB role sendiri, dengan hak tulis hanya ke schema miliknya dan tanpa hak baca ke schema lain.
- Tidak ada JOIN lintas schema. Data milik service lain diambil lewat API sinkron (ADR 028) atau disimpan sebagai proyeksi lokal dari event (ADR 004, ADR 030).
- Worker tidak menulis ke database. `transcode-svc` hanya mengirim event, dan `video-svc` sebagai pemilik yang mengubah state.
- Migrasi Drizzle tinggal di folder masing-masing service. Tidak ada `packages/db` bersama.
- Semua kode bersama ada di `packages/service-kit` dan scaffolder (`bun run new:service`, `bun run new:module`).
- PgBouncer membuat satu pool per role. `default_pool_size` dan `max_db_connections` ditulis eksplisit per role supaya total koneksi tidak melewati `max_connections`.

## Konsekuensi

- Risiko yang diterima: satu domain kegagalan Postgres untuk semua service. Pilihan ini diambil karena RAM dan biaya satu node. Anggaran RAM Postgres dan PgBouncer 3 GB (§15).
- Risiko yang diterima: pengalaman microservice dari Seapedia belum memenuhi pengecualian "tim sudah berpengalaman" dari Fowler untuk 12 service di k3s.
- Setiap schema yang mempublikasikan event butuh tabel `outbox`, dan setiap schema yang meng-consume event butuh `processed_events` (§7).
- Kepemilikan tabel dan topic dicatat di `docs/architecture/owners.md`.
- Status per grand plan revisi 18 (2026-10-29): hanya `identity-svc` yang jalan; sepuluh service lain masih skeleton. `tools/db-bootstrap.ts` membuat role `<schema>_svc` per service yang memiliki schema-nya sendiri, tanpa hak di schema lain atau `public` (dibuktikan `tools/db-bootstrap.test.ts`). PgBouncer membuat pool per role dengan `max_user_connections` 10. Role punya hak `CREATE` di database karena migrator Drizzle selalu menjalankan `CREATE SCHEMA IF NOT EXISTS`; semua schema service dibuat lebih dulu oleh bootstrap, jadi role tidak bisa merebut schema service lain.

## Alternatif yang ditolak

- Mulai dari monolith (saran "MonolithFirst" Fowler). Ditolak karena keputusan user: diagram menjadi sumber arsitektur. Mitigasinya adalah pembangunan bertahap, `service-kit`, dan skeleton.
- Server database per service seperti Seapedia. Ditolak karena RAM dan biaya satu node.

## Rujukan

- grand-plan §1, §5 (aturan kepemilikan data), §6 (Postgres dan PgBouncer), §7, §15 (anggaran RAM)
- `docs/verification.md` no. 12, no. 13, dan bagian "Pembanding: Seapedia"
- `docs/architecture/owners.md`
