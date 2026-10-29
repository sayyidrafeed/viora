# ADR 026: Client Kafka dan runtime proses Kafka di Bun

Status: Diterima (2026-10-29)

## Konteks

Service ditulis dengan Hono di Bun. Relay outbox, consumer, dan ingest metrics butuh client Kafka yang jalan terhadap Redpanda (ADR 003). Kondisi client per 2026-10-28 (`docs/verification.md` no. 1):

- `kafkajs` tidak lagi aktif. Rilis terakhir 2.2.4 pada 2023-02-27.
- `@confluentinc/kafka-javascript` masih aktif, tapi addon-nya memakai API NAN/V8, bukan N-API, sehingga tidak jalan di Bun. Maintainer menulis bahwa runtime selain Node tidak didukung.
- `@platformatic/kafka` 2.14.0 ditulis murni TypeScript tanpa addon native, punya producer idempoten dan transaksi. README-nya hanya menyebut Node, dan belum ada bukti jalan di Bun.

Rencana awal: spike `@platformatic/kafka` di Bun pada M0. Kalau gagal, proses Kafka dijalankan di Node 24.

## Keputusan

- Client: `@platformatic/kafka` 2.14.0.
- Proses yang memakai Kafka jalan di Bun. Fallback Node tidak dibutuhkan.
- Producer (`createProducer` di `service-kit`): `idempotent: true`, `acks: ProduceAcks.ALL`, serializer string, dan `partitioner: compatibilityPartitioner`. Partitioner bawaan `@platformatic/kafka` tidak sama dengan klien Java, jadi key yang sama bisa jatuh ke partisi berbeda dari producer lain (Flink, rpk).
- Consumer (`createConsumer`): `autocommit: false`, `sessionTimeout` 10 detik, `heartbeatInterval` 1 detik, `maxWaitTime` 200 ms. Offset di-commit manual setelah pesan diproses atau dipindah ke retry/DLQ (ADR 024).

## Konsekuensi

Hasil spike M0 (2026-10-29), di Bun 1.4.4 terhadap Redpanda v26.2.6: lolos 5/5 test, dua kali berturut-turut.

- Producer dengan `idempotent: true` mendapat `producerId` dari broker dengan `acks=all`. Header `traceparent` ikut terkirim.
- Key yang sama selalu ke partisi yang sama dengan `compatibilityPartitioner`.
- Rebalance saat member kedua masuk dan keluar berjalan, dan restart melanjutkan dari offset committed.
- Handler yang menunggu 12 detik (lebih lama dari `sessionTimeout` 10 detik) tidak membuat member dikeluarkan.

Yang belum dibuktikan:

- Dedupe producer saat retry kirim (tidak diuji langsung).
- Broker restart dan pemulihan koneksi.
- Throughput dan proses yang berjalan berhari-hari.

Risiko yang diterima: `@platformatic/kafka` tidak ada di daftar client yang divalidasi Redpanda. Kalau masalah muncul di luar cakupan spike, fallback Node 24 tetap tersedia karena Hono jalan di keduanya.

`max.in.flight.requests.per.connection` ≤ 5 diminta di §6, tapi `createProducer` tidak men-set-nya secara eksplisit. Nilai default library belum diverifikasi.

## Alternatif yang ditolak

- `kafkajs`. Tidak aktif sejak 2023.
- `@confluentinc/kafka-javascript`. Tidak jalan di Bun.
- Menjalankan proses Kafka di Node 24. Tidak dibutuhkan setelah spike lolos.

## Rujukan

- grand-plan §6 (Asinkron: Client Kafka, Producer), §18A (Hasil spike M0), §19, §20 revisi 3 dan 14
- `docs/verification.md` no. 1 dan no. 2
- `spikes/kafka-bun/kafka.spike.test.ts`, `packages/service-kit/src/kafka.ts`
