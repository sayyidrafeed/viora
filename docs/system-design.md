# Viora system design v1

Versi: draft M0 (2026-10-29). Versi final ditulis di M9 (grand plan §17).

Dokumen ini meringkas desain Viora. Detail dan alasan setiap keputusan ada di [grand plan](grand-plan.md) dan [ADR](adr/README.md). Kalau dokumen ini bertentangan dengan grand plan, grand plan (revisi terbaru di §20) yang berlaku.

## 1. Konteks dan batasan

Viora adalah platform video UGC ala YouTube untuk portofolio system design. Pipeline inti dibangun sendiri, termasuk transcoding.

| Batasan | Nilai |
|---|---|
| Tim | Satu orang part-time dengan bantuan agent |
| Platform | Web (TanStack Start) dan mobile (Expo) |
| Prod | Satu dedicated server kelas 64 GB RAM, minimal 16 core / 32 thread, k3s satu node |
| Media | Cloudflare R2 dengan CDN Cloudflare |
| Dev | MacBook 16 GB RAM, 10 core. Hanya subset stack lewat Docker Compose profiles |
| Timeline | Milestone time-boxed 2 sampai 4 minggu, M0 sampai M9 |

Klaim skala YouTube dibuktikan dengan capacity math di dokumen ini dan load test di skala demo. Tidak ada klaim multi-region atau HA yang tidak dijalankan. Detail: grand plan §1.

## 2. Scope

Masuk scope: akun (Google OAuth, email + password dengan verifikasi), upload multipart resumable, transcoding HLS CMAF 240p sampai 1080p, playback adaptif, visibilitas public/unlisted/private, subscribe, like/dislike, komentar bertingkat, feed subscription, trending, rekomendasi, view count dan analytics creator, search, playlist dan history, notifikasi in-app dan push, moderasi dengan report, takedown, dan keberatan.

Stretch (M8): live streaming (RTMP ke LL-HLS) dan simulasi monetisasi tanpa payment.

Di luar scope dan hanya dibahas sebagai scale path: DRM, moderasi otomatis (NSFW, content ID), backup PITR, multi-region.

Detail: grand plan §2.

## 3. NFR dan SLO

| Metrik | Target |
|---|---|
| Time-to-first-frame | p75 < 2 detik dengan cache CDN hangat |
| Waktu proses transcode | Video 10 menit 1080p ≤ 10 menit per job, tanpa waktu antre |
| Waktu antre transcode | Target awal p95 ≤ 45 menit saat burst, ditetapkan setelah pengukuran M1 |
| API baca | p99 < 200 ms di Kong |
| API tulis | p99 < 500 ms di Kong |
| Kesegaran view count | Telat ≤ 2 menit |
| Availability | 99% bulanan untuk demo |
| Kapasitas demo | 500 penonton bersamaan dan 10 upload paralel |

Model konsistensi:

- Strong (satu transaksi Postgres): status video, visibilitas, allowlist, subscription, reaction, komentar, akun.
- Eventual dalam hitungan detik: feed, search index, notifikasi.
- Eventual sampai 2 menit: view count, watch time, analytics.

Cara ukur setiap SLO ada di grand plan §3. SLO doc dengan error budget ditulis di M7.

## 4. Estimasi kapasitas dan model biaya

### Skala YouTube (desain, tidak dijalankan)

Angka dasar: 2 miliar user, 1 miliar jam ditonton per hari, 500 jam video di-upload per menit.

| Besaran | Hasil |
|---|---|
| Jam ditonton per detik | ≈ 11.600 |
| Penonton bersamaan rata-rata | ≈ 41,7 juta |
| Egress rata-rata (2,5 Mbps per penonton) | ≈ 104 Tbps, hampir semuanya dari CDN |
| Heartbeat masuk (per 10 detik) | ≈ 4,2 juta event/detik |
| Video di-upload (rata-rata 15 menit) | ≈ 33/detik, ≈ 2,9 juta/hari |
| Storage sumber | ≈ 1,2 PB/hari |
| Storage hasil transcode (ladder 5 rendisi, ≈ 10,4 Mbps) | ≈ 3,4 PB/hari |

Diagram awal menulis "110k hours/s" dan "120 TB/d". Hitungan yang benar adalah ≈ 11.600 jam/detik dan ≈ 1,2 PB/hari untuk file sumber saja.

Desain partisi pada skala ini: topic heartbeat dipartisi per `sessionId` dengan ratusan partisi, agregat Scylla dipartisi per `videoId` dengan nilai absolut, Postgres metadata di-shard per `channelId`, dan multi-region dengan satu region primary per shard.

### Skala demo (dijalankan)

| Besaran | Hasil |
|---|---|
| Penonton bersamaan | 500, ≈ 1,25 Gbps dari CDN |
| Heartbeat | ≈ 50 event/detik |
| Upload paralel | 10 |
| Throughput transcode | Diukur di M1. Asumsi: 1 worker 7 thread mendekati 1× realtime dengan x264 `veryfast` |

### Model biaya

Komponen skala YouTube: storage (PB/hari × harga per GB), egress CDN per Tbps, compute transcode per jam video, dan operasi R2 kelas A dan B. Grand plan belum memuat harga satuan, jadi angka dolar untuk skala ini masih terbuka.

Komponen skala demo:

| Komponen | Angka di grand plan |
|---|---|
| Dedicated server per bulan | Belum ada angka. Spesifikasi dan harga dicek sebelum M1 |
| R2 storage dan operasi | Belum ada angka |
| Cloudflare Workers paid | $5/bulan dengan 10 juta request, lalu $0,30 per juta |
| Workers KV baca | $0,50 per juta setelah 10 juta |
| Domain | Belum ada angka |

Kalau 500 penonton menonton terus-menerus sebulan penuh, Worker melayani sekitar 324 juta request segmen. Tanpa cache isolate, biayanya sekitar $94 Workers dan $157 KV. Karena itu nilai KV di-cache 10 detik di memori isolate, dan demo tidak dirancang untuk trafik terus-menerus. Semua harga dicek ulang sebelum M1. Detail: grand plan §4.

## 5. Peta service dan kepemilikan data

![Arsitektur Viora](diagrams/architecture.png)

| Service | Tanggung jawab | Data |
|---|---|---|
| Kong 3.9.x OSS | Entry point, routing, verifikasi JWT, rate limit per IP | Tidak ada |
| `identity-svc` | Better Auth, user, channel, JWT, peran admin | Schema `identity` |
| `upload-svc` | Sesi multipart, presigned URL, kuota | Schema `upload` |
| `transcode-svc` | Worker FFmpeg lewat BullMQ | Antrean di `redis-durable` |
| `video-svc` | Metadata, state machine, visibilitas, allowlist, playlist | Schema `video` |
| `social-svc` | Subscribe, reaksi, komentar, report | Schema `social` |
| `feed-svc` | Feed subscription, trending, rekomendasi | Schema `feed`, feed per user di Redis |
| `metrics-svc` | Heartbeat, syarat view dan dedupe, progress, writer agregat | Keyspace Scylla `viora_metrics` |
| `stream-processor` | Job Flink SQL untuk agregat | State Flink |
| `cdc-svc` | Snapshot statistik dari topic agregat ke Postgres | Tidak ada |
| `search-svc` | Indexer dan API search | Schema `search`, index Meilisearch |
| `notification-svc` | Notifikasi in-app, push, email | Schema `notification` |
| `live-svc` (stretch) | Ingest RTMP, LL-HLS | Schema `live` |

Aturan kepemilikan (ADR 001):

- Satu Postgres 17, satu schema dan DB role per service. Role hanya bisa menulis schema miliknya dan tidak bisa membaca schema lain.
- Tidak ada JOIN lintas schema. Data service lain diambil lewat API sinkron atau proyeksi lokal dari event.
- Worker tidak menulis ke database. Hanya `metrics-svc` yang menulis ke Scylla.

Infrastruktur bersama: Postgres 17 + PgBouncer, `redis-cache` (boleh eviction) dan `redis-durable` (`noeviction`), Redpanda, Flink 2.2.x session cluster, ScyllaDB source-available, Meilisearch, R2 + CDN, Worker `media-edge`, dan Resend sebagai penyedia email (ADR 025). Pemilik setiap tabel dan topic: [owners.md](architecture/owners.md). Detail: grand plan §5 dan §7.

## 6. Komunikasi

Sinkron (ADR 005, ADR 028):

- REST dengan OpenAPI per service. Klien antar-service dan `packages/api-client` di-generate dari spec.
- Panggilan sinkron hanya untuk read-your-writes atau validasi kepemilikan. Timeout default 2 detik, header `x-deadline-ms`, retry satu lapis, breaker hanya untuk dependency opsional.
- Token user diverifikasi di Kong lalu di setiap service. Panggilan antar-service memakai projected ServiceAccount token dan tidak meneruskan token user (ADR 006, ADR 007).

Asinkron (ADR 003, ADR 004, ADR 024, ADR 026, ADR 027, ADR 030):

- Redpanda sebagai event log, client `@platformatic/kafka` di Bun dengan `compatibilityPartitioner`.
- Transactional outbox dengan satu relay per service, filter xmin, urutan `(xid, seq)`.
- Semua consumer idempoten lewat `processed_events`, dengan penjaga `stateVersion` di proyeksi.
- Retry tiga tahap: dalam proses, topic `retry.<group>.<topic>`, lalu `dlq.<group>.<topic>`.
- Skema Zod di `packages/contracts`, cek kompatibilitas BACKWARD di CI.

Daftar topic, payload, dan aturan retry: [event catalog](event-catalog.md). Detail: grand plan §6.

## 7. Alur data

Ringkasan per alur. Langkah lengkap ada di grand plan §8 dan §9, dan diagram per journey di `docs/flows/`.

**Upload.** Klien membuat video `draft` (`POST /v1/videos`, butuh klaim `ev`), membuka sesi upload, lalu mengunggah part langsung ke R2 lewat presigned URL. Sesi bisa dilanjutkan dalam 24 jam sejak aktivitas terakhir. `upload.completed` memindahkan video ke `uploaded`, `transcode-svc` membuat job BullMQ `{videoId}-{generation}`, lalu worker menulis rendisi ke `videos/{videoId}/g{generation}/`. `transcode.succeeded` membuat video `ready`. Klien memantau status lewat polling setiap 3 detik.

**Playback.** `GET /v1/videos/:id` mengembalikan `manifestUrl` di domain media dengan token HMAC atas `videoId`, epoch, dan `exp`. Worker `media-edge` memeriksa epoch dan `playable` di Workers KV, lalu membaca dari Cache API atau binding R2. Perubahan visibilitas, block, dan delete menaikkan epoch, sehingga URL lama ditolak setelah rambatan KV ditambah 10 detik cache isolate. Video private memakai token per segmen dengan `sub` penonton.

**Metrics.** Klien membuka sesi playback dan mengirim heartbeat setiap 10 detik. `metrics-svc` menilai syarat view (30 detik, atau 50% untuk video < 60 detik) dan dedupe 24 jam di `redis-durable`, lalu mengirim `view.counted`. Flink SQL menghitung agregat absolut ke topic compacted. Writer di `metrics-svc` menulisnya ke Scylla dengan `USING TIMESTAMP` = offset Kafka. `cdc-svc` mengirim snapshot paling sering sekali per 60 detik per video ke Postgres. Like, dislike, dan komentar dihitung transaksional di `social-svc`.

**Feed.** Feed subscription memakai fan-out hybrid. Channel dengan < 10.000 subscriber di-push ke sorted set `feed:{userId}`. Channel di atas ambang dibaca saat request (pull). Item disaring terhadap `feed.video_cards` saat dibaca, jadi video yang jadi private atau di-block hilang tanpa menghapus dari ribuan sorted set. Trending dihitung setiap 10 menit. Rekomendasi berawal dari co-watch Flink (M5).

## 8. Topologi deploy

| Lingkungan | Isi |
|---|---|
| `local` | Docker Compose dengan profile `core`, `media`, `stream`, `obs` |
| `prod` | k3s satu node, R2, CDN Cloudflare di depan R2 dan Kong |
| `preview` | Namespace kecil untuk service versi uji terhadap infra prod |

Tidak ada staging permanen karena RAM satu server tidak cukup (ADR 013, M1). Kong DB-less tanpa Ingress Controller, Traefik dimatikan, dan firewall hanya menerima HTTP dari rentang IP Cloudflare.

Anggaran RAM prod sekitar 39,5 GB dari 64 GB, dengan batas memori eksplisit per komponen. Komponen terbesar: Flink 6 GB, ScyllaDB 6 GB, transcode (2 worker × 7 thread) 6 GB, Redpanda 4,5 GB. Angka ini diukur ulang di M3 dan M7.

CI/CD: GitHub Actions dengan lane per diff, image per service yang berubah di GHCR, Argo CD menyinkronkan `infra/helm` dan `infra/argocd`. Secret dengan SOPS + age lewat ksops. Backup hanya `pg_dump` harian ke R2 dengan retensi 7 hari. Detail: grand plan §15.

Status per grand plan revisi 17 (2026-10-29): profile `core` (Postgres 17.11, PgBouncer, Redpanda v26.2.6, Redis 8.6, Kong 3.9.4) dan `obs` (Tempo 2.10, VictoriaMetrics, Grafana) ada di Compose. Port infra lokal digeser +10000, service 13001 sampai 13011, web 13000. CI GitHub Actions ada; Argo CD, Helm, dan GHCR mulai M1.

## 9. Observability

VictoriaMetrics + vmagent, VictoriaLogs, Tempo, Grafana, Sentry free tier, dan OpenTelemetry Collector (ADR 021). Trace context mengalir lewat header `traceparent` di HTTP dan di header record Kafka. Span consumer memakai span link ke creation context.

Dashboard wajib: RED per service, lag consumer per group, kedalaman dan umur antrean transcode, rasio cache hit CDN, burn rate SLO, dan jumlah pesan retry dan DLQ per group. Alert DLQ menyala kalau DLQ berisi pesan selama 5 menit.

Status per grand plan revisi 17 (2026-10-29): OTel dipasang di `service-kit` (span HTTP lewat `@hono/otel`, `traceparent` ke outbox dan header Kafka, span consumer dengan link) dan plugin `opentelemetry` Kong. Trace Kong sampai identity-svc terlihat di Tempo (dibuktikan E2E). VictoriaMetrics men-scrape metrik Kong. VictoriaLogs, vmagent, Sentry, dashboard, dan alert belum ada. Detail: grand plan §6 (Tracing) dan §15.

## 10. Keamanan

| Risiko | Kontrol utama |
|---|---|
| File upload berbahaya | ffprobe di sandbox worker, batas ukuran dan durasi, worker tanpa jaringan selain R2, Redis, Redpanda |
| Penyalahgunaan presigned URL | URL per part dengan TTL 15 menit, sesi terikat ke user dan `videoId` |
| Hotlinking dan scraping | Token HMAC manifest 5 menit, token per segmen untuk video private, epoch di Worker |
| Spam view dan bot | Dedupe per identitas per 24 jam, rate limit heartbeat, validasi lompatan posisi |
| Akses lintas service | DB role per schema, projected ServiceAccount token, NetworkPolicy port publik hanya dari Kong |
| User di-ban atau dihapus | Denylist sinkron di `redis-durable` sebelum sesi dicabut, 401 `account_banned` di setiap service |
| Kebocoran secret | SOPS, tidak ada secret di image atau log, scan secret di CI |

Risiko yang diterima: token user tunggal `aud=viora-api` tanpa audience per service (ADR 007), dan token segmen private yang sudah terbit tetap berlaku sampai kedaluwarsa setelah ban (ADR 006). Threat model ditulis di M7. Detail: grand plan §16.

## 11. Risiko

Risiko terbuka yang paling memengaruhi desain (grand plan §19):

| Risiko | Kapan dicek | Mitigasi |
|---|---|---|
| Ketentuan Cloudflare untuk video lewat CDN tidak menyebut R2 dan Workers | Gate awal M1 | Konfirmasi tertulis, atau Bunny CDN di depan R2 |
| Desain Worker `media-edge` dan rambatan KV belum diuji | Spike M1 | Prototipe sebelum `video-svc` |
| Asumsi throughput transcode di CPU | M1 | Ukur beberapa preset x264, turunkan ladder jika perlu |
| RAM satu node tidak cukup | M3 dan M7 | Batas memori per pod, ukur pemakaian nyata |
| Semantik Flink SQL (dedupe, state, runner) | Spike M3 | Data sintetis dengan input duplikat dan terlambat |
| Kong OSS berhenti di 3.9.x | M7 dan setiap rilis | Pin versi, jalur keluar di ADR 007 belum diverifikasi |
| Discovery OIDC ServiceAccount k3s | Spike M1 | TokenReview API, atau token dari identity-svc |
| Relay outbox tertahan transaksi panjang di database yang sama | M7 | `idle_in_transaction_session_timeout` per role, alert umur outbox tertua |
| Scope lengkap untuk satu orang | Setiap milestone | Milestone time-boxed, fitur yang lewat waktu pindah ke backlog |

Spike M0 sudah menutup risiko client Kafka di Bun (ADR 026), rantai keyring Better Auth + Kong (ADR 006, ADR 007), dan walking skeleton outbox sampai consumer (ADR 004, ADR 024). Hasilnya di grand plan §18A.
