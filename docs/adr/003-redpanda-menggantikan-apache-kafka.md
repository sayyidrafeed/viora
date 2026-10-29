# ADR 003: Redpanda menggantikan Apache Kafka

Status: Diterima (2026-10-28)

## Konteks

Komunikasi asinkron antar-service memakai event log (§6). Pipeline metrics membaca event dengan Flink lewat konektor Kafka, dan agregatnya ditulis ke topic compacted (§9). Semua jalan di satu node bersama Flink, Scylla, Postgres, dan 12 service (§15).

## Keputusan

- Redpanda sebagai event log, berbicara protokol Kafka. Versi lokal: `redpandadata/redpanda:v26.2.6` di Compose profile `core` (mode dev).
- Anggaran prod: 4,5 GB RAM dan 2 thread, dengan batas memori eksplisit karena Redpanda secara default mengambil seluruh RAM. Panduan Redpanda: minimal sekitar 2,2 GiB per core (§15).
- Retensi topic event 7 hari. Topic retry dan DLQ 14 hari. Topic agregat di-compact. `metrics.views.v1` disimpan tanpa batas waktu (§9, §10).
- Schema Registry bawaan Redpanda tidak dipakai sekarang dan dicatat sebagai scale path (ADR 027).
- Client Kafka dan runtime-nya diputuskan di ADR 026.

## Konsekuensi

- Redpanda mendukung producer idempoten dan transaksi, tapi idempotensi hanya berlaku dalam satu sesi producer. Consumer tetap wajib dedupe (`docs/verification.md` no. 2, ADR 004).
- Client yang divalidasi Redpanda hanya KafkaJS dan confluent-kafka-javascript. `@platformatic/kafka` tidak ada di daftar itu, dan perilakunya terhadap Redpanda hanya dibuktikan lewat spike M0 (ADR 026).
- Spike M0 membuktikan produce, consumer group, rebalance, dan restart dari offset terhadap Redpanda v26.2.6 (§18A). Broker restart dan pemulihan koneksi belum diuji.
- Mode dev di lokal tidak sama dengan konfigurasi prod. Pengukuran RAM nyata dijadwalkan di M3 dan M7.

## Alternatif yang ditolak

- Apache Kafka. Disebut di judul ADR di §17, tapi grand plan tidak mencatat alasan memilih Redpanda di atas Kafka. Alasan ini terbuka dan perlu diisi pemilik keputusan.

## Rujukan

- grand-plan §5 (infrastruktur bersama), §6 (Asinkron), §9, §10, §15 (anggaran RAM), §18A (Hasil spike M0)
- `docs/verification.md` no. 1 dan no. 2
- `infra/compose/compose.yaml`, `spikes/kafka-bun`
