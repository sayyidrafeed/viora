# ADR 027: Evolusi skema event: cek kompatibilitas di CI, tanpa registry

Status: Diterima (2026-10-28)

## Konteks

Producer dan consumer event ada di service berbeda yang di-deploy terpisah. Tanpa registry atau cek di CI, perubahan skema yang tidak kompatibel baru ketahuan saat event di-consume (`docs/verification.md` no. 5). Redpanda punya Schema Registry bawaan (port 8081, Avro, Protobuf, JSON Schema). Confluent menyarankan topic baru untuk perubahan yang tidak kompatibel.

## Keputusan

- Skema Zod di `packages/contracts` adalah sumber kebenaran untuk envelope, nama topic, header, dan `data` per tipe event.
- CI men-generate JSON Schema dari Zod, lalu membandingkannya dengan versi di `main` memakai aturan kompatibilitas BACKWARD. Perubahan yang melanggar gagal di CI.
- Perubahan yang memang tidak kompatibel menaikkan `version` di envelope dan memakai topic baru (`*.v2`), dengan periode dual-write sampai semua consumer pindah.
- Producer memvalidasi payload dengan Zod sebelum publish.
- Consumer memvalidasi envelope dan `data` per tipe event sebelum handler dipanggil (`dataSchemas` di `EventConsumer`). Kegagalan validasi menjadi `PermanentError` dan langsung ke DLQ (ADR 024).
- Topic agregat Flink (`metrics.video_totals.v1` dan lainnya) berisi baris tabel, jadi skemanya ditulis sebagai skema baris di `packages/contracts`, bukan `EventEnvelope`.
- Schema Registry bawaan Redpanda dicatat sebagai scale path.

## Konsekuensi

- `packages/contracts` memuat `envelopeSchema`, `headers`, `topics` (`identity.v1`, `upload.v1`, `video.v1`, `transcode.v1`), skema `data` per tipe untuk keempat topic itu, serta `retryTopic` dan `dlqTopic`. Skema topic lain menyusul di milestone pemilik (lihat `docs/event-catalog.md`).
- Test identity-svc mem-parse setiap payload outbox dengan skema `contracts`, jadi trigger SQL dan skema Zod tidak bisa menyimpang tanpa test gagal.
- Payload `data` yang tidak cocok skema sempat melewati retry tertunda sebelum DLQ di walking skeleton, karena hanya envelope yang divalidasi. Revisi 14 menjadikan validasi `data` per tipe sebagai `PermanentError`.
- Event yang tipenya tidak punya skema di `dataSchemas` hanya divalidasi envelope-nya.
- Status per grand plan revisi 17 (2026-10-29): snapshot `packages/contracts/event-schemas.json` di-generate dari Zod. CI gagal kalau snapshot tidak sesuai kode, dan membandingkannya dengan snapshot di base memakai aturan BACKWARD (`packages/contracts/scripts/compat.ts`, `tools/ci/check-compat.sh`): field wajib baru, nilai enum yang dihapus, tipe yang tidak lagi diterima, dan event yang dihapus ditolak.

## Alternatif yang ditolak

- Schema Registry bawaan Redpanda. Tidak dipakai sekarang dan dicatat sebagai scale path. Grand plan tidak mencatat alasan selain itu.
- Zod + topic `*.v2` tanpa cek di CI (desain sebelum revisi 3). Perubahan tidak kompatibel baru ketahuan saat di-consume.

## Rujukan

- grand-plan §6 (Evolusi skema event), §9 (Topic output), §10 (Envelope), §18A (Temuan yang mengubah rencana), §20 revisi 3 dan 14
- `docs/verification.md` no. 5
- `packages/contracts/src/index.ts`, `packages/service-kit/src/consumer.ts` (`parseEvent`), `apps/identity-svc/test/identity.test.ts`
