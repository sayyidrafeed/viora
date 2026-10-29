# Architecture decision records

Daftar ADR dari grand plan §17. Setiap ADR ditulis di milestone saat keputusannya dibuat. Format: `# ADR NNN: <judul>`, status, lalu bagian Konteks, Keputusan, Konsekuensi, Alternatif yang ditolak, dan Rujukan.

Status yang dipakai:

- Diterima (tanggal): keputusan berlaku. Tanggal 2026-10-28 untuk keputusan dari perencanaan, 2026-10-29 untuk keputusan dari spike M0 dan hardening.
- Terbuka: keputusan belum dibuat.
- Belum ditulis (Mx): ADR dijadwalkan di milestone itu.

Kalau ADR bertentangan dengan grand plan, revisi terbaru di grand plan §20 yang berlaku sampai ADR diperbarui.

| No | Judul | Milestone | Status | Link |
|---|---|---|---|---|
| 001 | Microservices sesuai diagram dengan Postgres satu schema per service | M0 | Diterima (2026-10-28) | [001](001-microservices-postgres-schema-per-service.md) |
| 002 | Monorepo Bun + Turborepo, tanpa Nx | M0 | Diterima (2026-10-28) | [002](002-monorepo-bun-turborepo.md) |
| 003 | Redpanda menggantikan Apache Kafka | M0 | Diterima (2026-10-28) | [003](003-redpanda-menggantikan-apache-kafka.md) |
| 004 | Transactional outbox (relay tunggal, filter xmin) dan consumer idempoten wajib | M0 | Diterima (2026-10-28) | [004](004-transactional-outbox-consumer-idempoten.md) |
| 005 | REST + OpenAPI + hey-api, bukan gRPC | M0 | Diterima (2026-10-28) | [005](005-rest-openapi-hey-api.md) |
| 006 | Better Auth di identity-svc, JWT ES256, denylist sinkron, token service dari projected ServiceAccount | M0 | Diterima (2026-10-28) | [006](006-better-auth-jwt-es256-token-service.md) |
| 007 | Kong 3.9.x OSS DB-less sebagai gateway | M0 | Diterima (2026-10-28) | [007](007-kong-oss-db-less-gateway.md) |
| 008 | TanStack Start untuk web | M0 | Diterima (2026-10-28) | [008](008-tanstack-start-web.md) |
| 009 | BullMQ untuk job transcode, bukan Kafka | M1 | Belum ditulis (M1) | |
| 010 | HLS CMAF saja, tanpa DASH, ladder H.264 | M1 | Belum ditulis (M1) | |
| 011 | Upload multipart presigned langsung ke R2 | M1 | Belum ditulis (M1) | |
| 012 | Cloudflare R2 di belakang Worker `media-edge`: token HMAC dan epoch visibilitas | M1 | Belum ditulis (M1) | |
| 013 | k3s satu node di dedicated server, tanpa staging permanen | M1 | Belum ditulis (M1) | |
| 014 | GitHub Actions + Argo CD | M1 | Belum ditulis (M1) | |
| 015 | Like dan dislike di social-svc, bukan metrics-svc | M2 | Belum ditulis (M2) | |
| 016 | Feed hybrid dengan ambang fan-out 10.000 subscriber | M2 | Belum ditulis (M2) | |
| 017 | Syarat view dan dedupe di metrics-svc, agregasi Flink SQL di satu session cluster | M3 | Belum ditulis (M3) | |
| 018 | ScyllaDB source-available dengan agregat absolut dan `USING TIMESTAMP`, tanpa ClickHouse | M3 | Belum ditulis (M3) | |
| 019 | cdc-svc sebagai sinkronisasi interval dari topic agregat, bukan CDC Scylla | M3 | Belum ditulis (M3) | |
| 020 | Meilisearch untuk search | M4 | Belum ditulis (M4) | |
| 021 | VictoriaMetrics dan VictoriaLogs, bukan Prometheus dan Loki | M0 | Diterima (2026-10-28) | [021](021-victoriametrics-victorialogs.md) |
| 022 | Backup hanya `pg_dump` harian sebagai risiko yang diterima | M1 | Belum ditulis (M1) | |
| 023 | SOPS + age untuk secret | M1 | Belum ditulis (M1) | |
| 024 | Retry bertahap dan DLQ per consumer group | M0 | Diterima (2026-10-28) | [024](024-retry-bertahap-dlq-per-consumer-group.md) |
| 025 | Penyedia email transaksional (Resend) | M0 | Diterima | [025](025-penyedia-email-transaksional.md) |
| 026 | Client Kafka dan runtime proses Kafka di Bun | M0 | Diterima (2026-10-29) | [026](026-client-kafka-runtime-bun.md) |
| 027 | Evolusi skema event: cek kompatibilitas di CI, tanpa registry | M0 | Diterima (2026-10-28) | [027](027-evolusi-skema-event-tanpa-registry.md) |
| 028 | Policy panggilan sinkron: timeout, satu lapis retry, deadline, breaker terbatas | M0 | Diterima (2026-10-28) | [028](028-policy-panggilan-sinkron.md) |
| 029 | Dua Redis: `redis-cache` (boleh eviction) dan `redis-durable` (`noeviction`) | M1 | Belum ditulis (M1) | |
| 030 | Versi state di payload event dan penjaga versi di proyeksi | M0 | Diterima (2026-10-28) | [030](030-versi-state-penjaga-versi.md) |

ADR 004, 006, 007, 024, dan 030 diperbarui 2026-10-29 dengan hasil spike M0 dan hardening (grand plan §20 revisi 14 sampai 16).
