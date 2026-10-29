# ADR 024: Retry bertahap (dalam proses, lalu topic retry tertunda) dan DLQ per consumer group

Status: Diterima (2026-10-28). Diperbarui 2026-10-29 dari walking skeleton dan hardening (revisi 14 sampai 16).

## Konteks

Consumer bisa gagal karena masalah sementara (database sibuk, timeout) atau permanen (payload salah). Menahan partisi terlalu lama menghentikan pesan lain untuk key yang berbeda. Satu DLQ per topic dengan replay ke topic asal membuat semua group menerima ulang record itu dan mengubah urutannya terhadap event baru (`docs/verification.md` no. 3). Seapedia memakai antrean retry dengan jeda sebelum pesan diparkir, dan user memilih pola itu di revisi 5.

## Keputusan

- Tahap 1, di dalam proses: 3 percobaan handler dengan 2 jeda berjitter (sekitar 200 ms, lalu 1 detik). Di kode, jeda = `ms/2 + random × ms`.
- Tahap 2, retry tertunda: pesan dipindah ke `retry.<group>.<topic>` dengan header `x-retry-not-before` (sekarang + 60 detik). Consumer retry milik group itu (group Kafka `retry.<group>`) menunggu sampai waktunya, lalu memproses ulang dengan aturan tahap 1. Offset topic asal tetap maju.
- Tahap 3: kalau tahap 2 juga gagal, pesan dipindah ke `dlq.<group>.<topic>`.
- Header `x-attempt` berisi total percobaan handler lintas tahap: 3 di tahap utama ditambah 3 di tahap retry = 6.
- Pesan di retry dan DLQ membawa `x-error`, `x-origin-topic`, `x-origin-partition`, `x-origin-offset`, serta `traceparent` dan `tracestate` dari pesan asal.
- Error permanen langsung ke DLQ tanpa retry. Envelope tidak valid dan `data` yang gagal validasi skema per tipe event menjadi `PermanentError`.
- `EventConsumer` membuat sendiri topic retry dan DLQ miliknya saat start, dengan retensi 14 hari, karena topic itu milik group.
- Kalau produce ke retry atau DLQ gagal, atau commit gagal, loop consumer berhenti tanpa commit dan `ready` menjadi false. Probe Kubernetes memakai penanda ini, jadi pod di-restart dan pesan dikirim ulang dari offset terakhir.
- Alat operasional: `bun run dlq:replay <group> <topic>` mengirim dari DLQ ke `retry.<group>.<topic>` dengan consumer group `dlq-replay.<group>`. `bun run dlq:skip <group> <topic> <offset>` mencatat alasan, lalu `bun run outbox:reemit <service> <entity> <id>` membuat event baru dari baris pemilik.
- Alert: pesan di DLQ lebih dari 0 selama 5 menit, dari Grafana ke email owner proyek.
- Job Flink tidak punya DLQ. Producer memvalidasi payload dengan Zod sebelum publish, dan source Flink memakai `json.ignore-parse-errors=true` dengan metrik record yang dilewati.

## Konsekuensi

- Replay hanya diterima group pemilik, dan urutan di topic asal tidak terganggu.
- Event retry bisa tiba setelah event yang lebih baru untuk key yang sama. Penjaga versi wajib (ADR 030). Walking skeleton membuktikan ini lewat mutasi.
- Topic retry dan DLQ menyimpan payload, termasuk data pribadi, selama 14 hari. Retensi ini masuk daftar privasi (§18 M4).
- Topic retry dan DLQ dibuat dengan 1 partisi. Consumer retry menunggu `x-retry-not-before` pesan demi pesan.
- Terbukti di M0: envelope rusak langsung diparkir, kegagalan menetap lewat retry lalu DLQ, dan kegagalan kirim ke retry menghentikan consumer tanpa commit.
- Belum terbukti atau belum dibuat: `dlq:replay`, `dlq:skip`, `outbox:reemit`, alert DLQ, dashboard retry dan DLQ.

## Alternatif yang ditolak

- Satu DLQ per topic untuk semua group dengan replay ke topic asal. Mengirim ulang ke group yang sudah berhasil dan mengacak urutan.
- Langsung ke DLQ setelah 5 kali tanpa retry tertunda (desain sebelum revisi 5).
- `x-attempt` berisi nomor tahap (sebelum revisi 16). DLQ harus membawa jumlah percobaan.

## Rujukan

- grand-plan §6 (Retry bertahap, lalu DLQ per consumer group), §10 (retensi retry dan DLQ), §18A (Hasil spike M0, Hasil identity-svc M0), §20 revisi 3, 5, 14, 15, 16
- `docs/verification.md` no. 3
- `packages/service-kit/src/consumer.ts`, `packages/contracts/src/index.ts` (`headers`, `retryTopic`, `dlqTopic`), `packages/service-kit/test/walking-skeleton.test.ts`
