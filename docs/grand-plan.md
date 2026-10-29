# Viora grand plan

Viora adalah platform video ala YouTube yang dibangun sebagai portofolio system design. Dokumen ini merangkum semua keputusan dari sesi grilling (7 ronde) dan menjadi sumber untuk dokumen turunan di M0: system design doc, ADR, PRD per milestone, dan event catalog.

Status: disetujui sebagai rencana. M0 dimulai 2026-10-29: scaffold monorepo, spike, dan walking skeleton ada di repo [sayyidrafeed/viora](https://github.com/sayyidrafeed/viora) (belum ada infrastruktur server).

Revisi 1 sampai 15 tercatat di bagian 20. Revisi 6 sampai 13 berasal dari delapan ronde review independen yang mengunci kontrak event, pipeline metrics, autentikasi, dan journey end-to-end. Revisi 14 dan 15 berisi hasil spike M0 dan identity-svc. Kalau ada teks yang bertentangan, revisi yang lebih baru yang berlaku.

## Daftar isi

1. Konteks dan batasan
2. Scope fitur
3. NFR dan SLO
4. Estimasi kapasitas
5. Arsitektur dan peta service
6. Komunikasi antar-service
7. Data model per schema
8. State machine video dan visibilitas
9. Alur utama
10. Katalog event
11. API publik per service
12. Web dan mobile
13. Monorepo dan konvensi kode
14. Strategi test
15. Infra dan operasional
16. Keamanan
17. Dokumen dan ADR
18. Roadmap M0 sampai M9
18A. Penilaian kesiapan
19. Risiko dan hal yang wajib dicek
20. Riwayat revisi

---

## 1. Konteks dan batasan

| Hal | Keputusan |
|---|---|
| Tujuan | Portofolio system design. Pipeline inti dibangun sendiri, termasuk transcoding. |
| Jenis konten | UGC publik: siapa saja bisa upload dan menonton. |
| Skala desain | Skala YouTube di design doc. Stack yang sama dijalankan sungguhan di skala demo. |
| Tim | Solo dengan bantuan agent, part-time. |
| Timeline | Tanpa deadline keras. Tiap milestone time-boxed 2 sampai 4 minggu dan berakhir dengan demo jalan. |
| Platform | Web (TanStack Start) dan mobile (Expo). |
| Budget | Hemat. Satu dedicated server kelas 64 GB RAM dan minimal 16 core / 32 thread untuk k3s, video di Cloudflare R2 dengan CDN Cloudflare. Spesifikasi dan harga dicek sebelum M1. |
| Repo | Publik di akun GitHub `sayyidrafeed`. Repo dibuat dan di-push hanya atas perintah eksplisit. |
| Mesin dev | MacBook 16 GB RAM, 10 core. Stack penuh tidak boleh jalan sekaligus di lokal. |

Batas penting yang mengikat seluruh rencana:

- Mesin lokal hanya menjalankan subset stack lewat Docker Compose profiles (lihat bagian 15).
- Semua heavy run (full test, typecheck, build image) lewat `gated-run heavy`, satu per waktu.
- Klaim skala YouTube dibuktikan dengan capacity math di design doc dan load test di skala demo. Tidak ada klaim multi-region atau HA yang tidak dijalankan.

## 2. Scope fitur

### Masuk scope

| Area | Fitur |
|---|---|
| Akun | Sign up dan login (Google OAuth, email + password dengan verifikasi dan reset lewat email), satu channel per user, channel dibuat saat upload pertama, hapus akun. |
| Upload | Multipart resumable langsung ke R2, kuota per user, validasi file dengan ffprobe. |
| Transcoding | FFmpeg, HLS CMAF, ladder 240p sampai 1080p, thumbnail 3 kandidat, sprite preview. |
| Playback | Adaptive bitrate (hls.js di web, expo-video di mobile), resume dari posisi terakhir. |
| Visibilitas | Public, unlisted, private dengan allowlist user. |
| Sosial | Subscribe, like dan dislike, komentar bertingkat. |
| Feed | Feed subscription (hybrid fan-out), trending, rekomendasi personal. |
| Metrics | View count dengan dedupe, watch time, analytics creator dengan TanStack Charts. |
| Discovery | Search video dan channel. |
| Library | Playlist, watch later, watch history. |
| Notifikasi | In-app dan push mobile. |
| Moderasi | Tombol report (termasuk alasan hak cipta), status `blocked`, takedown oleh admin, proses keberatan sederhana dari owner, rate limit, kuota upload. |

### Stretch (M8)

- Live streaming: ingest RTMP, output LL-HLS.
- Simulasi monetisasi: slot iklan mock dan laporan revenue share di analytics creator. Tidak ada payment sungguhan.

### Di luar scope

- DRM (Widevine, FairPlay). Lisensinya tidak tersedia untuk proyek personal. Cukup dibahas di design doc.
- Moderasi otomatis (NSFW detection, content ID). Ditulis sebagai fase lanjut di design doc.
- Backup dengan PITR dan restore drill. Hanya `pg_dump` harian (lihat bagian 15).
- Multi-region. Dibahas di design doc sebagai scale path.

## 3. NFR dan SLO

| Metrik | Target | Cara ukur |
|---|---|---|
| Time-to-first-frame playback | p75 < 2 detik dengan cache CDN hangat | `ttffMs` di heartbeat pertama (`seq=1`), dicatat metrics-svc sebagai histogram OTel |
| Waktu proses transcode | Video 10 menit 1080p diproses dalam ≤ 10 menit per job, tidak termasuk waktu antre | Selisih waktu event `transcode.started` dan `transcode.succeeded` |
| Waktu antre transcode | Diukur di M1, lalu ditetapkan. Perkiraan awal: 10 upload 10 menit sekaligus = 100 menit-worker. Dengan 2 worker × 7 thread, antrean butuh sekitar 50 menit untuk habis, jadi target awal p95 ≤ 45 menit saat burst | Umur job BullMQ saat diambil worker |
| API baca (feed, metadata) | p99 < 200 ms di Kong | Plugin `prometheus` Kong per route (metrik OTel Kong baru ada di Enterprise 3.13+) |
| API tulis | p99 < 500 ms di Kong | Plugin `prometheus` Kong per route |
| Kesegaran view count | Telat ≤ 2 menit | Selisih waktu heartbeat dan update agregat di Scylla |
| Konsistensi data milik user | Read-your-writes untuk status video, like sendiri, subscribe | Test integrasi |
| Availability | 99% bulanan untuk demo | Uptime check eksternal |
| Kapasitas demo | 500 penonton bersamaan dan 10 upload paralel | Load test k6 dari mesin terpisah terhadap prod dengan data sintetis |

Model konsistensi per data:

- Strong (Postgres, satu transaksi): status video, visibilitas, allowlist, subscription, reaction, komentar, akun.
- Eventual dalam hitungan detik: feed, search index, notifikasi.
- Eventual sampai 2 menit: view count, watch time, analytics.

## 4. Estimasi kapasitas

### Skala YouTube (untuk design doc)

Angka dasar dari diagram awal: 2 miliar user, 1 miliar jam ditonton per hari, 500 jam video di-upload per menit.

| Besaran | Hitungan | Hasil |
|---|---|---|
| Jam ditonton per detik | 1e9 / 86.400 | ≈ 11.600 jam/detik |
| Penonton bersamaan rata-rata | 1e9 jam / 24 jam | ≈ 41,7 juta |
| Egress rata-rata | 41,7 juta × 2,5 Mbps | ≈ 104 Tbps, hampir semuanya dari CDN |
| Heartbeat masuk | 41,7 juta / 10 detik | ≈ 4,2 juta event/detik |
| Jam di-upload per hari | 500 × 1.440 | 720.000 jam/hari |
| Video di-upload per detik (rata-rata 15 menit) | 500 jam/menit ÷ 0,25 jam ÷ 60 | ≈ 33 video/detik, ≈ 2,9 juta/hari |
| Storage sumber per hari | 2,9 juta × 0,4 GB | ≈ 1,2 PB/hari |
| Storage hasil transcode per hari | 720.000 jam × ≈ 4,7 GB/jam (ladder 5 rendisi, total ≈ 10,4 Mbps) | ≈ 3,4 PB/hari |

Dua koreksi untuk diagram awal yang perlu ditulis di design doc:

- Diagram menulis "110k hours/s". Hitungan yang benar ≈ 11.600 jam/detik.
- Diagram menulis "3M × 0,4 GB = 120 TB/d". Hitungan yang benar ≈ 1,2 PB/hari untuk file sumber saja.

Desain partisi yang mengikuti angka ini (ditulis di design doc, tidak dijalankan):

- Topic heartbeat dipartisi per `sessionId` dengan ratusan partisi, supaya video viral tidak membebani satu partisi. Flink melakukan pre-agregasi per partisi, lalu menggabungkan per `videoId`.
- Agregat Scylla dipartisi per `videoId`. Nilainya absolut (bukan counter), jadi tulis ulang bersifat idempoten.
- Postgres untuk metadata di-shard per `channelId` saat satu instance tidak cukup.
- Multi-region: blob direplikasi antar region, metadata punya satu region primary per shard, CDN melayani dari edge terdekat.

### Skala demo (yang dijalankan)

| Besaran | Hasil |
|---|---|
| Penonton bersamaan | 500, ≈ 1,25 Gbps dari CDN, origin R2 hanya melayani cache miss |
| Heartbeat | ≈ 50 event/detik |
| Upload paralel | 10 |
| Throughput transcode | Diukur di M1. Asumsi awal: 1 worker dengan 7 thread memproses ladder penuh mendekati 1× realtime dengan preset x264 `veryfast`. Kalau lebih lambat, ladder default diturunkan atau target antre di bagian 3 disesuaikan. |

### Model biaya

Ditulis lengkap di design doc M0. Komponen yang dihitung:

- Skala YouTube: storage (PB/hari × harga per GB), egress CDN per Tbps, compute transcode per jam video, operasi R2 kelas A dan B.
- Skala demo: server dedicated per bulan, R2 storage dan operasi, Cloudflare Workers paid ($5/bulan dengan 10 juta request, lalu $0,30 per juta), baca Workers KV ($0,50 per juta setelah 10 juta). Penonton bersamaan 500 yang terus-menerus akan menghasilkan sekitar 324 juta request segmen per bulan (sekitar $94 Workers dan $157 KV tanpa cache isolate). Karena itu nilai KV di-cache di memori isolate, dan demo tidak dirancang untuk trafik terus-menerus. Load test beberapa jam biayanya kecil. Ditambah domain. Harga dicek ulang sebelum M1.

## 5. Arsitektur dan peta service

Arsitektur mengikuti diagram awal: microservices, satu Postgres, CDN untuk playback, pipeline metrics berbasis stream. Diagram final ada di `docs/diagrams/architecture.png`.

| Service | Tanggung jawab | Data yang dimiliki | Asal |
|---|---|---|---|
| Kong 3.9.x OSS (DB-less) | Entry point API publik, routing ke service, verifikasi signature dan `exp` JWT user, rate limit per IP. Bukan service buatan sendiri, konfigurasinya deklaratif di repo | Tidak ada | Diagram ("LB Router Gateway"), mengikuti Seapedia |
| `identity-svc` | Better Auth, user, channel, penerbitan JWT user, peran admin | Schema `identity` | Baru |
| `upload-svc` | Membuat sesi multipart, presigned URL per part, menyelesaikan upload, kuota, membersihkan upload yang ditinggal | Schema `upload` | Diagram |
| `transcode-svc` | Worker FFmpeg lewat BullMQ, menulis rendisi ke R2 | Antrean BullMQ di `redis-durable` | Diagram |
| `video-svc` | Metadata video, state machine, visibilitas, allowlist, URL manifest bertanda tangan, playlist, watch later | Schema `video` | Diagram |
| `social-svc` | Subscribe, like dan dislike, komentar bertingkat, report | Schema `social` | Baru |
| `feed-svc` | Feed subscription hybrid, trending, rekomendasi (di diagram: "recommendation svc") | Schema `feed`, feed per user di Redis | Diagram |
| `metrics-svc` | Menerima heartbeat, menilai syarat view per sesi dan dedupe 24 jam (Redis), menulis posisi resume dan history langsung ke Scylla, writer agregat dari Flink ke Scylla, metrik TTFF, API baca stats dan analytics | Keyspace Scylla `viora_metrics` | Diagram |
| `stream-processor` | Job Flink SQL: agregasi absolut dari view yang sudah lolos dedupe, watch time, subscriber per hari, retensi, co-watch. Like, dislike, dan komentar dihitung transaksional di social-svc. Satu topic output per jenis agregat. Tidak menulis langsung ke Scylla | Tidak ada (state Flink) | Diagram |
| `cdc-svc` | Sinkronisasi interval sesuai diagram: membaca `metrics.video_totals.v1`, mengirim snapshot statistik per video paling sering sekali per 60 detik untuk disalin ke Postgres | Tidak ada | Diagram |
| `search-svc` | Indexer Meilisearch dari event, API search. Versi terakhir setiap dokumen disimpan di tabel Postgres `search.doc_version` (bersama `processed_events`). Untuk setiap event, consumer mengunci baris `doc_version`, membandingkan versi, menulis ke Meilisearch dan menunggu task-nya selesai, lalu commit versi dan `processed_events`. Versi yang sama diterapkan ulang (idempoten). Versi tidak dibaca dari Meilisearch, karena penulisannya async | Schema `search` dan index Meilisearch | Baru |
| `notification-svc` | Notifikasi in-app dan push Expo | Schema `notification` | Baru |
| `live-svc` | Ingest RTMP, LL-HLS (stretch) | Schema `live` | Baru |

Klien:

- `apps/web`: TanStack Start (SSR untuk halaman tonton, channel, dan landing).
- `apps/mobile`: Expo.

Infrastruktur bersama:

- Postgres 17 (satu instance, satu schema per service)
- Redis/Valkey `redis-cache` (feed per user, request collapsing untuk metadata publik, rate limit per user). Boleh eviction, setiap key punya TTL. Kehilangan isinya hanya memperlambat, tidak mengubah hasil.
- Redis/Valkey `redis-durable` dengan `maxmemory-policy noeviction` dan alert memori: antrean BullMQ, denylist JWT, state sesi view, dan kunci dedupe view. Semua kunci di sini harus tetap ada sampai TTL-nya habis, karena kehilangannya membuat user yang di-ban lolos atau view terhitung dua kali.
- Redpanda (event log)
- Flink 2.2.x dengan konektor Kafka `5.0.0-2.2`, di-deploy lewat Flink Kubernetes Operator sebagai satu session cluster. Image session cluster (`viora-flink`) berisi Flink, konektor, SQL runner generik, dan file SQL semua job. `FlinkSessionJob` mengambil jar runner dari `jarURI` HTTP (Deployment nginx kecil `flink-artifacts` di cluster yang menyajikan jar itu), dengan argumen path file SQL di dalam image session cluster. Kalau operator tidak bisa menjalankan session job dengan cara ini (dicek di spike M3), fallback-nya Flink SQL Gateway: CI mengirim file SQL lewat REST, dan job dipulihkan dari savepoint setelah restart. Webhook operator dimatikan (`webhook.create=false`) supaya tidak butuh cert-manager. Logika bisnis tetap SQL, dan runner adalah satu-satunya kode JVM.
- ScyllaDB versi source-available yang di-pin (free tier 50 vCPU dan 10 TB per organisasi, cukup untuk satu node demo). Edisi AGPL berhenti di 6.2.x. Lisensi dicatat di ADR 018.
- Meilisearch
- Cloudflare R2 (blob) dan CDN Cloudflare
- Cloudflare Worker `media-edge` di depan R2: validasi token akses video dan epoch visibilitas, cache lewat Cache API
- Penyedia email transaksional untuk verifikasi dan reset password (Cloudflare Email Service atau Resend, dipilih di M0)

### Aturan kepemilikan data

- Satu instance Postgres, satu schema per service. Tiap service punya DB role sendiri dengan hak tulis hanya ke schema miliknya. Role itu tidak punya hak baca ke schema lain.
- Tidak ada JOIN lintas schema. Data milik service lain diambil lewat API sinkron atau disimpan sebagai proyeksi lokal dari event.
- Contoh proyeksi lokal: `feed-svc` menyimpan salinan subscription (`feed.subscriptions`) dan metadata ringkas video (`feed.video_cards`) dari event `social` dan `video`.
- Worker tidak menulis ke database. `transcode-svc` hanya mengirim event, lalu `video-svc` sebagai pemilik yang mengubah state.
- Migrasi Drizzle tinggal di folder masing-masing service. Tidak ada `packages/db` bersama.

## 6. Komunikasi antar-service

Bagian ini direvisi setelah verifikasi ke docs resmi (revisi 3). Sumber dan alasan setiap keputusan ada di `docs/verification.md`.

### Identitas dan otorisasi

- **Token user (pola Seapedia).** identity-svc menerbitkan access token JWT lewat plugin JWT Better Auth, berumur 10 menit, berisi `sub` (userId), `role`, `iss`, `aud=viora-api`, dan header `kid`. Algoritma di-pin ES256. Default Better Auth adalah EdDSA, dan docs Kong hanya menyebut RS256, ES256, dan HS256. Payload dipangkas dengan `definePayload` supaya tidak membawa seluruh objek user.
  - Better Auth dipasang dengan `basePath` `/v1/auth`.
  - Kunci penandatangan disuplai lewat hook keyring kustom plugin JWT (`adapter.getJwks`) dari keypair ES256 yang di-mount dari SOPS. Plugin memilih kunci dengan `createdAt` terbaru, jadi keyring memberi kunci aktif (`JWT_ACTIVE_KID`) `createdAt` paling baru. `adapter.createJwk` melempar error, dan tabel `jwks` diberi `check (false)`, sehingga plugin tidak pernah membuat atau menyimpan kunci sendiri (dibuktikan di M0).
  - Public key yang sama di-mount ke Kong dan ke setiap service. `service-kit` memverifikasi JWT user secara lokal dengan kunci itu, tanpa memanggil identity-svc.
  - Web: TanStack Start mengambil JWT dari header `set-auth-jwt` saat `getSession`, atau dari `/v1/auth/token`, lalu mengirimnya sebagai bearer ke Kong. Sesi cookie Better Auth hanya dipakai untuk memperbarui JWT.
  - Mobile: app memanggil `/v1/auth/token` dengan sesi dari `@better-auth/expo`. Kontrak server sudah dibuktikan di M0 (lihat §18A). Yang tersisa dicek di perangkat pada M6: apakah `fetch` React Native bisa membaca header `set-cookie`.
  - Kong memverifikasi signature dan `exp`. Setiap service memverifikasi ulang di `service-kit`, termasuk `iss`, `aud`, dan denylist.
  - Revokasi: saat ban atau hapus akun, identity-svc menulis userId ke denylist di `redis-durable` lebih dulu, baru mencabut sesi Better Auth, semuanya sebelum merespons. Urutan ini mencegah token yang dibuat di antara keduanya lolos. TTL denylist 10 menit dihitung setelah sesi dicabut. Unban menghapus kunci denylist. Event `user.banned` dan `user.deleted` dikirim sesudahnya untuk service lain. Setiap service mengecek denylist ini, juga di route `optional`, dan menjawab 401 dengan kode `account_banned`. Klien web dan mobile menangani kode ini dengan `AccountReset` dan pesan, bukan dengan mencoba memperbarui token.
  - Token segmen video private yang sudah diterbitkan untuk user yang di-ban tetap berlaku sampai kedaluwarsa (durasi video + 30 menit). Ini risiko yang diterima dan dicatat di ADR 006.
  - Event identity ditulis ke outbox oleh trigger Postgres di tabel `identity.user` dan `identity.channel`, di transaksi yang sama dengan penulisan Better Auth. After-hook Better Auth tidak dipakai, karena berjalan setelah commit dan adapter Drizzle default-nya tanpa transaksi. Trigger `BEFORE UPDATE` menaikkan `state_version`. Pemetaan perubahan ke event:

    | Perubahan | Event |
    |---|---|
    | Insert `user` | `user.registered` (tanpa email) |
    | `email_verified` berubah dari false ke true (termasuk user Google yang langsung terverifikasi saat insert) | `user.email_verified` |
    | `name` atau `image` berubah | `user.profile_updated` |
    | `banned` berubah ke true atau false | `user.banned` atau `user.unbanned` |
    | Insert atau update `channel` | `channel.created` atau `channel.updated` |
    | Kolom lain (`updated_at`, sesi) | Tidak ada event |

  - Penghapusan tidak lewat trigger. `DELETE /v1/me` menulis baris outbox `user.deleted` (dengan `purgeComments` dari body request) dan `channel.deleted` secara eksplisit di transaksi yang sama dengan penghapusan baris, karena trigger tidak bisa membaca parameter request.
  - Job rekonsiliasi harian membandingkan tabel `user` dengan outbox sebagai pengaman.
  - Endpoint bawaan Better Auth yang melewati denylist dan outbox (`/v1/auth/admin/*`, `/v1/auth/delete-user`) ditolak di Kong. Admin dan hapus akun hanya lewat route identity-svc sendiri (`/v1/admin/users/*`, `DELETE /v1/me`).
  - Token di JWT memuat klaim `ev` (email sudah terverifikasi) lewat `definePayload`, dipakai video-svc dan upload-svc untuk aturan upload.
  - Token yang ada di header tapi tidak valid (kedaluwarsa atau palsu) selalu dijawab 401 oleh `service-kit`, termasuk di route `optional`. Plugin `jwt` Kong dengan consumer `anonymous` meneruskan token gagal sebagai anonim, jadi pengecekan ini wajib di service supaya klien tahu harus memperbarui token.
- **Pengganti token per audience.** Plugin `jwt` Kong OSS tidak bisa mengecek `aud` dan tidak bisa menerbitkan token, jadi token per audience dari revisi 3 tidak dipakai. Risiko replay token user oleh service yang dibobol ditahan lewat NetworkPolicy (aktif bawaan di k3s):
  - Setiap service membuka dua port: port publik untuk `/v1` yang hanya menerima trafik dari pod Kong, dan port internal untuk `/internal` yang hanya menerima trafik dari pod service lain dengan token service.
  - Service yang dibobol tidak bisa memanggil port publik service lain dengan token user curian.
  - Ini menyimpang dari saran OWASP (audience per penerima) dan dicatat sebagai risiko yang diterima di ADR 007.
- **Token service.** Setiap service memakai projected ServiceAccount token Kubernetes dengan `audience` = nama service tujuan. Kubelet yang merotasinya, dan `service-kit` membaca ulang file token. Service tujuan memverifikasi token lewat JWKS issuer OIDC k3s yang di-cache. Tidak ada client secret per service.
- **Panggilan antar-service tidak meneruskan token user.** Pemanggil mengautentikasi diri dengan token service dan mengirim `userId` sebagai parameter eksplisit. Otorisasi aksi user dilakukan di service yang menerima token user lewat Kong.
- **Dev lokal.** Di Compose tidak ada Kubernetes, jadi `service-kit` memakai issuer dev dengan kunci statis dan antarmuka verifikasi yang sama (URL JWKS bisa dikonfigurasi).
- Discovery OIDC k3s dibuktikan lewat spike di M1. mTLS lewat Linkerd tidak dipakai karena RAM (±0,5–0,9 GB untuk 12 service) dan karena build stabilnya kini dari vendor. Linkerd dicatat sebagai scale path.

### Sinkron

- REST internal. Setiap service punya OpenAPI sendiri (hono-openapi), dan klien antar-service di-generate dari spec itu.
- Panggilan sinkron hanya untuk kebutuhan read-your-writes atau validasi kepemilikan. Contoh: `upload-svc` memastikan pemanggil adalah owner `videoId` sebelum membuat sesi upload.
- Policy di klien `service-kit` (cockatiel):
  - Setiap panggilan punya timeout. Default 2 detik, dan tidak boleh melebihi sisa deadline.
  - Sisa deadline diteruskan lewat header `x-deadline-ms` (sisa milidetik, bukan timestamp, supaya kebal clock skew).
  - Retry hanya di satu lapis (klien `service-kit`), hanya untuk GET dan operasi yang membawa idempotency key, dengan backoff berjitter dan anggaran retry per proses.
  - Circuit breaker hanya untuk dependency opsional yang punya fallback. Contoh: history untuk rekomendasi, dengan fallback ke trending.
- Operasi tulis yang dipanggil sinkron dibuat idempoten. `POST /internal/channels/ensure` adalah upsert per `userId`.

### Asinkron

- Redpanda sebagai event log. Format event diatur di bagian 10.
- **Client Kafka.** Kandidatnya `@platformatic/kafka` (TypeScript murni, tanpa addon native). `kafkajs` sudah tidak aktif sejak 2023, dan `@confluentinc/kafka-javascript` tidak jalan di Bun. Spike di M0 membuktikan produce, consumer group, rebalance, dan producer idempoten di Bun terhadap Redpanda. Kalau gagal, proses yang memakai Kafka (relay outbox, consumer, ingest metrics) dijalankan di Node 24.
- **Producer.** Idempotensi dinyalakan eksplisit, dengan `acks=all` dan `max.in.flight.requests.per.connection` ≤ 5. Idempotensi ini hanya melindungi retry di dalam satu sesi producer. Setelah crash atau restart, record ganda tetap mungkin terjadi. Partitioner wajib `compatibilityPartitioner`: partitioner bawaan `@platformatic/kafka` tidak sama dengan klien Java, jadi key yang sama bisa jatuh ke partisi berbeda dari producer lain (Flink, rpk) (spike M0).
- **Transactional outbox.** Service yang punya database menulis event ke tabel `<schema>.outbox` di transaksi yang sama dengan perubahan data. Kolom outbox: `id` (UUIDv7), `seq` (identity, urutan di dalam satu transaksi), `xid` (`xid8`, diisi `pg_current_xact_id()`), `topic`, `key`, `headers`, `payload`, `published_at`. Envelope dibangun oleh satu fungsi SQL `<schema>.outbox_emit`, yang dipakai trigger maupun kode TS. Jadi bentuk envelope hanya punya satu pemilik.
- **Relay outbox.**
  - Satu relay aktif per service. Leader dipilih lewat advisory lock di koneksi langsung ke Postgres, bukan lewat PgBouncer.
  - Relay membaca baris yang belum terkirim dengan `xid < pg_snapshot_xmin(pg_current_snapshot())`, diurutkan `(xid, seq)`. Filter ini mencegah transaksi yang commit belakangan terlewat. UUIDv7 tidak dipakai untuk urutan: presisinya hanya milidetik, sehingga dua event dalam satu transaksi bisa tertukar (ditemukan di M0).
  - Polling setiap 200 ms. `LISTEN/NOTIFY` hanya dipakai sebagai pemicu tambahan, karena tidak tahan banting untuk listener yang terputus.
  - Baris yang sudah terkirim dihapus setelah 7 hari.
- **Consumer idempoten (wajib untuk semua consumer).** Redpanda mengirim minimal sekali, dan relay maupun producer bisa menghasilkan duplikat.
- **Efek di luar database consumer.** Kalau handler menulis ke sistem lain (Meilisearch, Workers KV, Redis, Scylla), efek itu dijalankan dan ditunggu sampai berhasil lebih dulu, baru `processed_events` dan versi proyeksi di-commit. Efek eksternal wajib idempoten (ditulis menurut key dan versi), dan penjaga versi menerima versi yang sama atau lebih baru. Jadi kalau proses mati di antara efek dan commit, pengiriman ulang hanya menerapkan efek yang sama sekali lagi, tidak membuangnya.
- **Pengiriman pesan ke manusia (push dan email).** Handler `notification-svc` hanya menulis baris `notification` dan `delivery` (status `pending`) di transaksinya. Proses sender terpisah mengambil `delivery` yang `pending` dengan `FOR UPDATE SKIP LOCKED`, mengirim, lalu menandai `sent`. Karena satu notifikasi hanya punya satu baris `delivery` per kanal, pengiriman ulang event tidak membuat push atau email ganda.
- **Backfill untuk consumer baru.** Retensi topic event hanya 7 hari, jadi consumer yang baru dibangun (misalnya social di M2, `video_meta` di M3, search di M4) tidak bisa membangun proyeksinya dari event lama. Setiap service pemilik entitas menyediakan `bun run outbox:snapshot <entity> --all`, yang mengirim event `<entity>.snapshot` berisi state terkini dan `stateVersion` dari setiap baris. Proyeksi menerapkan snapshot dengan penjaga versi biasa. Fan-out feed, notifikasi, dan Flink mengabaikan tipe snapshot. Meminta snapshot masuk checklist `new:service`.
  - Consumer yang punya database mencatat `(consumer_group, event_id)` di `<schema>.processed_events` dalam transaksi yang sama dengan efeknya. Catatan dipurge setelah 14 hari.
  - `transcode-svc` memakai `jobId` BullMQ (`{videoId}-{generation}`), dengan `removeOnComplete` setelah 7 hari supaya `video.uploaded` yang dikirim ulang dalam rentang itu tidak memicu transcode lagi.
  - Writer agregat di `metrics-svc` menulis nilai absolut per key, jadi tulis ulang tidak mengubah hasil.
- **Service tanpa database** (`transcode-svc`, ingest `metrics-svc`) mempublikasikan langsung ke Redpanda. ID event transcode dibuat deterministik dari `jobId` dan nama tahap. ID heartbeat dari hash(`sessionId`, `seq`), dan ID `view.counted` dari hash(`sessionId`, `"view"`). Duplikat setelah restart punya ID yang sama dan dibuang consumer.
- **Retry bertahap, lalu DLQ per consumer group** (pola Seapedia: retry dengan jeda sebelum diparkir).
  - Tahap 1, di dalam proses: 3 percobaan dengan jeda berjitter di antaranya (sekitar 200 ms, lalu 1 detik). Kegagalan sementara (database sibuk, timeout) biasanya selesai di sini tanpa menahan partisi lama.
  - Tahap 2, retry tertunda: pesan dipindah ke `retry.<group>.<topic>` dengan header `x-retry-not-before` (sekarang + 60 detik) dan `x-attempt`. Consumer retry milik group itu menunggu sampai waktunya, lalu memproses ulang dengan aturan tahap 1. Offset topic asal tetap maju, jadi pesan lain tidak tertahan.
  - Tahap 3: kalau tahap 2 juga gagal, pesan dipindah ke `dlq.<group>.<topic>` beserta error, jumlah percobaan, dan offset asal.
  - `bun run dlq:replay <group> <topic>` mengirim pesan dari DLQ ke `retry.<group>.<topic>`, yang hanya di-consume group itu. Group lain tidak menerima ulang, dan urutan event di topic asal tidak terganggu. Replay memakai consumer group sendiri (`dlq-replay.<group>`), jadi menjalankannya lagi melanjutkan dari posisi terakhir, tidak mengirim ulang semuanya.
  - Kalau payload-nya sendiri yang salah, perbaikan consumer tidak menolong. Untuk kasus ini ada `bun run dlq:skip <group> <topic> <offset>` (mencatat alasan), lalu `bun run outbox:reemit <service> <entity> <id>` yang membuat event baru dari baris pemilik saat ini.
  - Alert: pesan di DLQ lebih dari 0 selama 5 menit, dikirim dari Grafana ke email owner proyek.
  - Job Flink tidak punya DLQ. Producer memvalidasi payload dengan Zod sebelum publish, dan source Flink memakai `json.ignore-parse-errors=true` dengan metrik jumlah record yang dilewati.
  - Error permanen (payload gagal validasi skema) langsung ke DLQ tanpa retry.
  - Jumlah pesan di topic retry dan DLQ per group masuk dashboard dan alert.
- BullMQ hanya dipakai di dalam `transcode-svc` untuk job transcode yang lama. Job dibuat saat `transcode-svc` menerima event `video.uploaded`.

### Evolusi skema event

- Skema Zod di `packages/contracts` adalah sumber kebenaran. CI men-generate JSON Schema dari Zod, lalu membandingkannya dengan versi di `main` memakai aturan kompatibilitas BACKWARD. Perubahan yang melanggar akan gagal di CI, bukan baru ketahuan saat event di-consume.
- Perubahan yang memang tidak kompatibel memakai topic baru (`*.v2`) dengan periode dual-write sampai semua consumer pindah.
- Schema Registry bawaan Redpanda dicatat sebagai scale path.

### Tracing

- OpenTelemetry di semua service sejak M0.
- HTTP: header `traceparent` standar.
- Kafka: `traceparent` dan `tracestate` di header record, bukan di payload. Span consumer memakai span link ke creation context, sesuai spesifikasi messaging OpenTelemetry.
- Satu upload bisa diikuti dari Kong (plugin `opentelemetry` OSS) sampai event `video.ready` lewat link itu.

### Postgres dan PgBouncer

- Setiap service punya role sendiri, dan PgBouncer membuat satu pool per role. `default_pool_size` dan `max_db_connections` ditulis eksplisit per role supaya total koneksi tidak melewati `max_connections` Postgres.
- Mode transaction pooling dengan `max_prepared_statements > 0`. Advisory lock relay dan `LISTEN` memakai koneksi langsung.

### Gateway: Kong

Keputusan user (revisi 5): gateway Hono buatan sendiri diganti Kong, mengikuti Seapedia. Kong menangani routing dan cek token secara deklaratif, jadi tidak ada kode gateway yang perlu dirawat.

- **Versi.** Kong Gateway OSS 3.9.x (Apache-2.0), di-pin. 3.9.4 rilis 2026-10-12 dan masih mendapat patch, tapi tidak ada OSS 3.10 ke atas, dan free mode Enterprise sudah dihapus. Jalur keluar kalau 3.9 berhenti di-patch (Envoy Gateway, APISIX) belum diverifikasi dan dicatat di ADR 007.
- **Deploy.** Deployment Kong DB-less biasa dengan konfigurasi deklaratif `infra/kong/kong.yaml`, tanpa Kong Ingress Controller (menghemat satu pod dan CRD). Traefik bawaan k3s dimatikan (`--disable=traefik`). Memori ±190 MiB saat idle (pengukuran lokal 3.9.4), diukur ulang saat load test.
- **Konfigurasi dibuat dari kode.** `tools/kong-config.ts` men-generate `kong.yaml` per environment:
  - Route dibuat per operasi OpenAPI (method + path regex yang di-anchor), bukan per prefix service. Ini menghindari tabrakan seperti `/v1/me` dengan `/v1/me/videos` atau `/v1/videos/:id` dengan `/v1/videos/:id/comments`.
  - Setiap operasi OpenAPI diberi `x-auth`: `public` (tanpa plugin `jwt`), `optional` (plugin `jwt` dengan consumer `anonymous`, misalnya `GET /v1/videos/:id`, trending, rekomendasi, search, daftar komentar, sesi playback, heartbeat), atau `required` (default). Route Better Auth tidak ada di spec OpenAPI, jadi generator memakai daftar tetap path `/v1/auth/*` yang diizinkan (`public`) dan menolak sisanya. Generator juga menambah route statis `public` untuk `apps/web` (SSR `/`, `/watch/*`, `/@*`, aset), dengan rate limit per IP, karena Traefik dimatikan dan semua trafik HTTP masuk lewat Kong.
  - Public key disimpan tanpa enkripsi di repo (`infra/keys/*.pub.pem`), private key di SOPS. Jadi CI bisa membuat `kong.yaml` tanpa kunci age, dan `kong.yaml` bisa dibuat sebelum identity-svc menyala. Schema plugin `jwt` tidak mewajibkan `rsa_public_key` untuk ES256 (kalau kosong hanya gagal 401 saat runtime), jadi generator memastikan field itu terisi.
  - Credential `jwt` memakai `key_claim_name: kid`, sehingga dua kunci saat rotasi tidak bertabrakan.
  - CI gagal kalau `kong.yaml` tidak sesuai hasil generate.
- **Rotasi kunci JWT.** `rotationInterval` Better Auth tidak dipakai. Rotasi manual lewat runbook dengan tiga commit dan gerbang di antaranya:
  1. Tambah public key baru (`kid` baru) ke Kong dan ke daftar kunci verifikasi service. Kong DB-less tidak memuat ulang file konfigurasi, jadi `kong.yaml` diberi anotasi checksum yang memaksa rollout. `service-kit` memantau file kunci yang di-mount, memuat ulang saat berubah, dan melaporkan `kid` yang dimuat sebagai metrik. Gerbang: rollout Kong selesai dan semua pod service melaporkan `kid` baru.
  2. Keyring identity-svc pindah menandatangani dengan `kid` baru. Tunggu rollout identity-svc selesai, lalu tunggu 10 menit (umur JWT terpanjang).
  3. Hapus public key lama.
- **Plugin yang dipakai (semua OSS):**
  - `jwt` untuk signature dan `exp`. `claims_to_verify: [exp]` wajib diisi generator, karena plugin tidak memeriksa `exp` kalau tidak diminta.
  - `rate-limiting` dengan policy Redis, per IP
  - `prometheus` untuk latensi per route (SLO di §3)
  - `cors`
  - `request-size-limiting`
  - `opentelemetry`
- **IP asli.** Kong berada di belakang CDN Cloudflare, jadi tanpa konfigurasi ia hanya melihat IP Cloudflare. `trusted_ips` diisi rentang IP Cloudflare dan `real_ip_header` di-set ke `CF-Connecting-IP`. Kong meneruskan IP asli ke service lewat `X-Real-IP`, yang dipakai untuk rate limit per IP dan `ipHash` view. CIDR pod `apps/web` juga masuk `trusted_ips`, dan SSR meneruskan `CF-Connecting-IP` dari request asli, supaya request SSR tidak berbagi satu bucket rate limit. Firewall server hanya menerima trafik HTTP dari rentang IP Cloudflare.
- **Rate limit per user** tidak bisa di Kong, karena consumer plugin `jwt` adalah penerbit token, bukan user. Rate limit per user dipasang di middleware `service-kit` (token bucket di Redis).
- **Request collapsing** tidak ada di Kong OSS (`proxy-cache` tidak menggabungkan miss yang bersamaan). Singleflight per key ditambah micro-cache 1 detik di `redis-cache` dipindah ke `service-kit`. Yang di-cache hanya bagian publik: metadata video untuk `GET /v1/videos/:id` dan daftar trending. Hak akses dan token manifest dihitung per request.
- **Dev lokal.** Kong DB-less ikut di Compose profile `core` dengan `kong.yaml` yang sama.

## 7. Data model per schema

Semua ID memakai UUIDv7. Semua tabel punya `created_at` dan `updated_at`. Setiap schema yang mempublikasikan event punya tabel `outbox`, dan setiap schema yang meng-consume event punya tabel `processed_events`.

### `identity`

| Tabel | Kolom inti |
|---|---|
| `user`, `session`, `account`, `verification` | Tabel standar Better Auth, ditambah `role` (`user`, `admin`), kolom plugin admin `banned`, `ban_reason`, `ban_expires`, dan `state_version` (dinaikkan trigger) |
| `channel` | `id`, `owner_user_id` (unik), `handle` (unik), `name`, `description`, `avatar_key`, `banner_key`, `state_version` |

Kunci penandatangan JWT tidak disimpan di database (lihat §6). Trigger Postgres di `user` dan `channel` menulis event ke `identity.outbox`.

### `upload`

| Tabel | Kolom inti |
|---|---|
| `upload_session` | `id`, `video_id`, `user_id`, `object_key`, `s3_upload_id`, `size_bytes`, `part_size`, `parts_total`, `file_fingerprint` (ukuran, nama, dan hash 1 MB pertama, untuk mencocokkan file yang dipilih ulang), `status` (`active`, `completed`, `aborted`, `abandoned`), `expires_at` (24 jam sejak aktivitas terakhir, bergeser setiap ada part) |

Indeks unik parsial `upload_session(video_id) WHERE status = 'active'` mencegah dua sesi aktif untuk satu video, walaupun dua `POST /v1/uploads` datang berdekatan sebelum video-svc memperbarui status.
| `upload_part` | `upload_session_id`, `part_number`, `etag`, `size_bytes` (untuk resume) |
| `quota_usage` | `user_id`, `day`, `uploads_count`, `bytes_total` |

### `video`

| Tabel | Kolom inti |
|---|---|
| `video` | `id`, `channel_id`, `owner_user_id`, `title`, `description`, `status`, `visibility`, `visibility_epoch`, `transcode_generation`, `failed_reason`, `duration_s`, `source_key`, `manifest_key`, `thumbnail_key`, `sprite_key`, `current_upload_id`, `published_at`, `blocked_reason`, `deleted_at`, `state_version` |
| `video_rendition` | `video_id`, `height`, `bitrate_kbps`, `codec`, `playlist_key` |
| `video_access` | `id`, `video_id`, `user_id`, `email_masked` (misalnya `d***@mail.com`, untuk ditampilkan ke owner). Allowlist video private |
| `video_access_invite` | `id`, `video_id`, `email_hash`, `email_masked`, `invited_by`, `expires_at` (30 hari). Baris dihapus saat cocok (dipindah ke `video_access`) atau saat kedaluwarsa. Undangan untuk email yang belum terdaftar atau belum terverifikasi, dicocokkan saat `user.email_verified` |
| `appeal` | `id`, `video_id`, `owner_user_id`, `message`, `status` (`open`, `accepted`, `rejected`), `resolved_by`. Keberatan owner atas takedown. Dimiliki video-svc karena yang berubah adalah state video |
| `video_stats` | `video_id`, `views`, `watch_seconds`, `source_offset`, `likes`, `dislikes`, `comments`, `engagement_state_version`, `synced_at`. Dimiliki dan ditulis `video-svc`: views dan watch seconds dari `metrics.stats_snapshot` (hanya kalau `source_offset` lebih besar), like, dislike, dan komentar dari `engagement.counts_changed` (hanya kalau `stateVersion` lebih besar). Dipakai untuk sorting dan data long-tail |
| `playlist` | `id`, `owner_user_id`, `title`, `visibility`, `kind` (`custom`, `watch_later`) |
| `playlist_item` | `playlist_id`, `video_id`, `position`, `added_at` |
| `channel_cards` | Proyeksi `channel.created` dan `channel.updated`: `channel_id`, `handle`, `name`, `avatar_key`. Dipakai halaman tonton |

### `social`

| Tabel | Kolom inti |
|---|---|
| `subscription` | `user_id`, `channel_id`, `notify` (bool), `active` (bool), `state_version`, PK gabungan. Unsubscribe men-set `active=false` (soft delete), supaya `state_version` terus naik saat subscribe ulang |
| `reaction` | `user_id`, `video_id`, `kind` (`like`, `dislike`), PK gabungan |
| `comment` | `id`, `video_id`, `author_id`, `parent_id`, `root_id`, `depth`, `body`, `deleted_at`. Kedalaman dibatasi 2 (komentar, balasan, balasan ke balasan ditampilkan datar di bawah root) |
| `report` | `id`, `target_type` (`video`, `comment`, `channel`), `target_id`, `reporter_id`, `reason` (termasuk `copyright`), `status` (`open`, `actioned`, `dismissed`) |
| `channel_subscriber_count` | `channel_id`, `count`. Diperbarui di transaksi yang sama dengan subscribe dan unsubscribe |
| `video_visibility` | Proyeksi `video.v1`: `video_id`, `visibility`, `status`, `playable`, `owner_user_id`, `state_version`. Dipakai `canView`. Baris tetap ada setelah video dihapus (sebagai tombstone versi) |
| `video_engagement_count` | `video_id`, `likes`, `dislikes`, `comments`, `state_version`. Diperbarui di transaksi yang sama dengan reaksi dan komentar. Sumber resmi jumlah like, dislike, dan komentar |
| `user_cards`, `channel_cards` | Proyeksi `identity.v1` dengan `state_version` dan penanda `deleted`. Saat user atau channel dihapus, baris tidak dihapus fisik tapi dikosongkan dan ditandai `deleted` (tombstone), sehingga event lama dari retry atau replay tidak memunculkan lagi nama dan avatar. Isi: nama dan avatar untuk penulis komentar dan daftar subscription |

### `feed`

| Tabel | Kolom inti |
|---|---|
| `subscriptions` | Proyeksi dari event `social` (dengan `state_version`) |
| `video_cards` | Proyeksi ringkas video `ready` + `public` dari event `video`: judul, thumbnail, durasi, `channel_id`, `owner_user_id`, `published_at`. Penjaga versi memakai `feed.video_visibility` (memuat semua video, termasuk yang sudah dihapus dari kartu), sehingga event lama tidak bisa memasukkan kembali video yang sudah dikeluarkan |
| `video_visibility` | Proyeksi semua video dari `video.v1` (`status`, `visibility`, `playable`, `owner_user_id`, `state_version`). Dipakai `canView` untuk related dan sebagai penjaga versi `video_cards` |
| `channel_cards` | Proyeksi `channel.created` dan `channel.updated` untuk nama, handle, dan avatar di kartu feed |
| `video_reactions` | `video_id`, `likes`, `dislikes`, `comments`, `state_version`. Proyeksi `engagement.counts_changed` untuk trending |
| `video_daily_views` | `video_id`, `day`, `views`, `source_offset`. Proyeksi `metrics.video_daily.v1` dengan penjaga offset Kafka untuk skor pertumbuhan trending (hari ini dibanding kemarin) |
| `channel_fanout` | `channel_id`, `subscriber_count` (dihitung dari baris aktif `feed.subscriptions`), `mode`. Pindah ke `pull` saat ≥ 10.000, kembali ke `push` saat < 9.000 (histeresis). Saat mode berubah, sorted set subscriber channel itu dianggap cache miss dan dibangun ulang saat dibaca |
| `trending_snapshot` | `window`, `rank`, `video_id`, `score`, `computed_at` |
| `video_stats` | Proyeksi total views dari `metrics.stats_snapshot` |
| `related_video` | `video_id`, `related_video_id`, `score`, proyeksi dari topic co-watch Flink |

Redis: `feed:{userId}` berupa sorted set dengan skor `published_at`, maksimal 500 item.

### `notification`

| Tabel | Kolom inti |
|---|---|
| `notification` | `id`, `user_id`, `type`, `actor_user_id`, `payload`, `read_at`. Nama pengirim tidak disalin ke `payload`, tapi dibaca dari `user_cards` saat ditampilkan, jadi pengirim yang menghapus akun tampil sebagai "Pengguna dihapus" |
| `invite_delivery` | `id`, `video_id`, `email`, `status`, `sent_at`. Dihapus 14 hari setelah terkirim |
| `delivery` | `notification_id`, `channel` (`push`, `email`), `status` (`pending`, `sent`, `failed`), `attempts`, unik per (`notification_id`, `channel`) |
| `push_token` | `user_id`, `expo_token`, `platform`, `last_seen_at` |
| `subscriptions` | Proyeksi subscription dengan `notify=true` dari event `social`, untuk menentukan penerima notifikasi upload baru |
| `user_cards`, `channel_cards` | Proyeksi `identity.v1` untuk nama dan avatar pengirim dan nama channel di notifikasi |

### `live` (stretch)

| Tabel | Kolom inti |
|---|---|
| `live_stream` | `id`, `channel_id`, `stream_key_hash`, `status`, `started_at`, `ended_at`, `vod_video_id` |

### ScyllaDB keyspace `viora_metrics`

| Tabel | Partition key | Isi | Ditulis oleh |
|---|---|---|---|
| `video_totals` | `video_id` | `views`, `watch_seconds` | Writer agregat |
| `video_engagement` | `video_id` | `likes`, `dislikes`, `comments`. Ditulis dari `engagement.counts_changed` dengan `USING TIMESTAMP` = `stateVersion`. Tabel terpisah supaya rebuild tabel agregat (`TRUNCATE`) dan tombstone dengan timestamp offset tidak menyentuhnya | Consumer `social.v1` |
| `views_by_video_day` | `video_id` | Clustering `day`: `views` (jumlah `view.counted`, sudah unik per identitas per 24 jam), `watch_seconds` | Writer agregat |
| `views_by_channel_day` | `channel_id` | Clustering `day`: `views`, `watch_seconds`, `subscribers_gained` | Writer agregat |
| `views_by_channel_video_month` | (`channel_id`, `month`) | Clustering `video_id`: `views`, `watch_seconds`. Video teratas diurutkan di aplikasi | Writer agregat |
| `retention_by_video` | `video_id` | Clustering `bucket` (0 sampai 9, tiap 10% durasi): `viewers` | Writer agregat |
| `video_meta` | `video_id` | Ditulis dengan `USING TIMESTAMP` = `stateVersion`, sehingga urutan tulis tidak bergantung pada consumer mana yang selesai duluan. Kolom: `channel_id`, `owner_user_id`, `duration_s`, `status`, `visibility`, `playable`, `state_version`. Proyeksi `video.v1` untuk pengayaan heartbeat, cek owner analytics, dan `canView` | Consumer `video.v1` |
| `watch_progress` | `user_id` | Clustering `video_id`: `position_s`, `updated_at` | Ingest heartbeat |
| `watch_history` | `user_id` | Clustering `watched_at DESC` (waktu mulai sesi), `session_id`: `video_id`. Ditulis sekali per sesi saat heartbeat pertama | Ingest heartbeat |

Aturan tulis:

- Hanya `metrics-svc` yang menulis ke keyspace ini.
- Agregat dari Flink ditulis sebagai upsert nilai absolut dengan `USING TIMESTAMP` = offset Kafka record asal (lihat §9). Scylla memakai last-write-wins menurut timestamp, dan offset per key selalu naik, jadi pesan lama yang datang terlambat (dari topic retry, replay DLQ, atau rebuild) tidak bisa menimpa nilai yang lebih baru.
- Progress dan history ditulis langsung oleh ingest heartbeat dengan `USING TIMESTAMP` = waktu heartbeat. Data per user ini tidak lewat topic Redpanda, sehingga `user.deleted` cukup menghapus partisi `user_id` di dua tabel itu.
- Tipe counter Scylla tidak dipakai karena tidak idempoten dan tidak didukung CDC Scylla.

## 8. State machine video dan visibilitas

### Status

```
draft ──> uploading ──> uploaded ──> processing ──> ready ──> blocked
  │  ▲        │   ▲                      │            │
  │  └────────┤   └── abandoned          └──> failed  │
  │ (batal)   └──> abandoned                 │        │
  ├──> live ──> uploaded  (stretch)          │        │
  └──────────────── deleted <────────────────┴────────┘
```

| Transisi | Pemicu | Pelaku |
|---|---|---|
| `draft → uploading` | Event `upload.started` | `video-svc` |
| `uploading → uploaded` | Event `upload.completed` | `video-svc` |
| `uploading → abandoned` | Event `upload.abandoned` (multipart tidak selesai dalam 24 jam) | `video-svc` |
| `abandoned → uploading` | Event `upload.started` dari sesi upload baru untuk video yang sama | `video-svc` |
| `uploading → draft` | Event `upload.cancelled` (owner membatalkan). Video bisa di-upload ulang | `video-svc` |
| `draft → live` | Event `live.started` untuk video yang dibuat `live-svc`. Mengirim `video.live_started` berisi data kartu | `video-svc` |
| `live → uploaded` | Event `live.ended` dengan `sourceKey` rekaman | `video-svc` |
| `uploaded → processing` | Event `transcode.started` | `video-svc` |
| `uploaded → ready` dan `uploaded → failed` | Event `transcode.succeeded` atau `transcode.failed` untuk `generation` saat ini yang tiba sebelum `transcode.started` (urutan bisa acak setelah retry tertunda) | `video-svc` |
| `processing → ready` | Event `transcode.succeeded` | `video-svc` |
| `processing → failed` | Event `transcode.failed` (dikirim sekali per generasi, lihat aturan retry) | `video-svc` |
| `failed → uploaded` | Owner menekan retry (`POST /v1/videos/:id/retry`). Hanya untuk `failed_reason=exhausted`. `video.uploaded` dikirim ulang | `video-svc` |
| `failed → uploading` | `failed_reason=invalid_input`: owner harus meng-upload file baru (`upload.started`) | `video-svc` |
| `ready → blocked` | Admin takedown. Epoch naik dan `playable=false`. Selama `blocked`, visibilitas tidak bisa diubah, dan owner hanya boleh punya satu keberatan terbuka (maksimal dua per takedown) | `video-svc` |
| `blocked → ready` | Admin membatalkan takedown, atau keberatan owner diterima. Epoch naik, `playable=true`, mengirim `video.unblocked` | `video-svc` |
| semua → `deleted` | Owner atau admin menghapus. Soft delete: epoch naik, `playable=false`, `title` dan `description` langsung dikosongkan. Baris dan file R2 (`sources/` dan `videos/`) dihapus permanen oleh job harian setelah 7 hari | `video-svc` |

Aturan:

- Transisi diimplementasikan dengan pola `defineWorkflow` dari api-siera. Perintah API yang meminta transisi tidak terdaftar ditolak dengan `DomainError`. Event yang meminta transisi tidak terdaftar atau sudah usang (misalnya `transcode.started` setelah `failed`, `transcode.succeeded` untuk video `deleted`, event transcode dengan `generation` lama) di-ack sebagai no-op dan dicatat di metrik `stale_event_total`, tidak dilempar ke retry atau DLQ.
- `transcode_generation` naik setiap kali video masuk ke status `uploaded`, dari jalur mana pun: upload selesai, retry manual, upload ulang setelah `invalid_input`, atau rekaman live. Dengan begitu `jobId` dan ID event transcode selalu baru dan tidak terbuang oleh dedupe.
- Kolom `current_upload_id` di `video` menyimpan sesi upload yang aktif dan dikosongkan setiap kali sesi itu selesai (`completed`, `cancelled`, atau `abandoned`). `upload.started` mengisinya. Pemeriksaan "`uploadId` lain" hanya berlaku selama `current_upload_id` tidak kosong dan sesinya belum `terminal` di `upload_tracking`. Jadi sesi baru setelah abandon dan `upload.completed` yang datang lebih awal tetap diproses, sedangkan event dari sesi lama yang sudah ditinggal diabaikan.
- Tabel `video.upload_tracking(upload_id, video_id, terminal)` mencatat setiap `uploadId` yang pernah dilihat. Event akhir (`completed`, `cancelled`, `abandoned`) menandainya `terminal`. `upload.started` untuk `uploadId` yang sudah `terminal` diabaikan, jadi `started` yang terlambat tidak bisa mengembalikan video ke `uploading` untuk sesi yang sudah selesai.
- `upload.completed` yang tiba sebelum `upload.started` untuk `uploadId` yang sama menjalankan transisi ke `uploaded` langsung dari `draft`, `abandoned`, atau `failed` (`invalid_input`). `upload.started` yang datang belakangan menjadi no-op.
- `state_version` naik di setiap penulisan baris `video`: status, visibilitas, metadata, epoch, dan perubahan allowlist. Event yang membawa `state_version` lebih kecil dari yang tersimpan di proyeksi diabaikan.
- Aturan retry transcode:
  - Satu generasi transcode adalah satu job BullMQ dengan `jobId = {videoId}-{generation}`. BullMQ menolak titik dua di custom job ID.
  - Worker yang mati di tengah job ditangani mekanisme stalled job BullMQ, dengan `maxStalledCount: 3` di-set eksplisit (default-nya 1). Apakah job yang melewati batas stall lalu diulang menurut `attempts` belum terverifikasi dan dicek di spike M1.
  - Hasil transcode ditulis ke `videos/{videoId}/g{generation}/...`, dan manifest master ditulis paling akhir. Sisa file dari percobaan yang mati tidak tercampur dengan hasil generasi lain. Job purge menghapus folder generasi lama.
  - `transcode.started` dikirim sekali saat percobaan pertama generasi itu dimulai.
  - Error sementara (worker mati, R2 timeout) diulang BullMQ sampai 3 percobaan dengan backoff eksponensial. Tidak ada event per percobaan.
  - `transcode.failed` dikirim sekali, setelah percobaan ke-3 gagal atau langsung saat error permanen (file tidak valid, durasi melebihi batas). Field `reason` membedakan keduanya.
  - `transcode.failed` hanya dikirim oleh satu producer: listener `QueueEvents` di `transcode-svc` untuk event `failed`, dan hanya kalau job gagal final (`attemptsMade >= attempts`, atau error `UnrecoverableError`). ID event-nya deterministik dari `jobId`. Worker tidak mengirim `transcode.failed` sendiri. Untuk error permanen (`invalid_input`), worker melempar `UnrecoverableError` dengan alasan itu supaya BullMQ berhenti mengulang, lalu listener membaca alasan dari `failedReason`. Ini mencakup job yang gagal karena stall, di mana tidak ada kode worker yang berjalan. Sebagai pengaman, sweeper di video-svc memeriksa video yang `processing` lebih lama dari batas = `durationS` × 3 percobaan × 2 + 1 jam (minimal 2 jam). Sebelum menandai `failed` (`exhausted`), sweeper menanyakan state job ke `transcode-svc` (`GET /internal/transcode/jobs/:jobId`), dan hanya menandai gagal kalau job tidak ada atau sudah gagal final. Video yang tertahan di `uploaded` lebih dari 30 menit tanpa `transcode.started` dan tanpa job membuat sweeper mengirim ulang `video.uploaded` lewat outbox (generasi yang sama), bukan menggagalkannya.
  - Retry manual membuat generasi baru, jadi ID event deterministiknya berbeda dari generasi sebelumnya.
  - Event transcode dengan `generation` lebih lama dari `transcode_generation` di video diabaikan.

### Visibilitas

Visibilitas adalah kolom terpisah dari status. Video hanya bisa ditonton orang lain saat `status = ready`, atau `status = live` untuk siaran (stretch).

| Visibilitas | Siapa yang bisa menonton | Muncul di feed, search, channel, trending |
|---|---|---|
| `public` | Semua orang | Ya |
| `unlisted` | Siapa saja yang punya link | Tidak |
| `private` | Owner dan user di allowlist `video_access`. Undangan hanya lewat email | Tidak |

- View di video unlisted dan private tetap dihitung.
- **Akses di service lain.** Endpoint yang menyentuh video di service selain video-svc (komentar dan reaksi di social-svc, stats dan heartbeat di metrics-svc, related di feed-svc) mengecek hak tonton lewat helper `canView` di `service-kit`:
  - Untuk video public dan unlisted, helper membaca proyeksi lokal yang memuat semua video (bukan hanya yang tampil di feed): `video_visibility` di feed dan social, `video_meta` di metrics. Semuanya diisi dari `video.v1` dengan penjaga `stateVersion` dan memuat `status`, `visibility`, dan `playable`. Video yang tidak `playable` (di-block atau dihapus) ditolak untuk semua orang kecuali owner.
  - Untuk video private, helper memanggil `GET /internal/videos/:id/access?userId=`, lalu menyimpan hasilnya di `redis-cache` selama 30 detik.
  - Panggilan sinkron ini dicatat di ADR 028 sebagai pengecualian yang dibenarkan, karena allowlist tidak diproyeksikan ke setiap service.
- Allowlist hanya menerima email. `video-svc` memanggil `POST /internal/users/resolve-email` ke identity-svc, yang hanya mengembalikan user dengan email terverifikasi. Kalau ada, `video_access` langsung diisi. Kalau tidak, undangan disimpan di `video_access_invite` dan dicocokkan saat `user.email_verified`, bukan saat `user.registered`, supaya orang yang mendaftar duluan dengan email itu tanpa memverifikasinya tidak bisa membajak undangan. Respons ke owner selalu "undangan terkirim", supaya endpoint ini tidak bisa dipakai mengecek siapa yang punya akun.
- Setiap undangan mengirim event `video.access_invited` (email penerima, nama pengundang, judul video, `registeredUserId` kalau sudah terdaftar). `notification-svc` mengirim email undangan lewat penyedia email transaksional, ditambah notifikasi in-app dan push (dengan deep link ke video) kalau penerimanya sudah terdaftar. Topic `video.v1` disimpan 7 hari (topic retry dan DLQ 14 hari). Di notification-svc, email penerima hanya disimpan di tabel `invite_delivery` yang dihapus 14 hari setelah terkirim, tidak di `notification.payload`.
- Owner melihat dan mengelola allowlist lewat `GET /v1/videos/:id/access` (email tersamar) dan `DELETE /v1/videos/:id/access/:entryId`. Penghapusan menaikkan epoch dan mengirim `video.access_revoked`, sehingga `media-edge-sync` menulis epoch baru ke KV.
- Token private membawa `sub` (userId penonton) untuk audit. Menghapus user dari allowlist menaikkan epoch. Penonton lain yang masih berhak otomatis mendapat token baru lewat `GET /v1/videos/:id`.
- Setiap perubahan yang menaikkan epoch selalu mengirim event `video.*` (visibilitas, block, unblock, hapus, `video.access_revoked`), jadi `media-edge-sync` pasti berjalan.
- Setiap perubahan visibilitas mengirim `video.visibility_changed` berisi data kartu lengkap, termasuk `status` dan `stateVersion`. Proyeksi hanya memasukkan video kalau `status` adalah `ready` dan `visibility` adalah `public`, dan hanya menerima event dengan `stateVersion` lebih baru dari yang tersimpan.
- `published_at` diisi saat video pertama kali berstatus `ready` dengan visibilitas `public`. Video yang baru dijadikan public belakangan mendapat `published_at` saat itu.
- Consumer `media-edge-sync` (proses di dalam video-svc, consumer group sendiri atas `video.v1`) menulis `{videoId: {status, visibility, epoch, playable, reason, prefix, durationS, stateVersion}}` ke Workers KV (`prefix` = `videos/{videoId}/g{generation}`) lewat API Cloudflare. Isinya dibaca dari baris `video` di Postgres saat event diproses, bukan dari payload event. Event lama yang datang dari topic retry tetap menghasilkan state terbaru, jadi pencabutan akses tidak bisa tertimpa. Entri KV sudah ditulis sejak video dibuat (`draft`, `playable=false`), sehingga Worker tidak pernah menyimpan cache "kunci tidak ada" untuk video baru. Karena lewat event, penulisan ini punya retry, DLQ, dan alert lag seperti consumer lain. `visibility_epoch` naik saat:
- Consumer utama dan consumer retry bisa memproses video yang sama bersamaan. Karena Workers KV tidak punya compare-and-set, `media-edge-sync` mengambil advisory lock Postgres per `videoId` mulai dari membaca baris `video` sampai PUT ke KV selesai. Setelah PUT, ia membaca `state_version` lagi, dan kalau sudah berubah, ia menulis ulang. Dengan begitu tulisan yang tertunda tidak bisa mengembalikan epoch lama atau `playable=true`.
  - visibilitas berubah,
  - video di-block, di-unblock, atau dihapus,
  - ada user yang dihapus dari allowlist.
- Worker `media-edge` menolak URL yang epoch-nya bukan epoch terbaru. Kalau `playable=false`, Worker membalas 451 untuk video yang di-block dan 410 untuk video yang dihapus. Respons yang sudah ter-cache dengan epoch lama ikut berhenti dilayani karena Worker memeriksa epoch sebelum membaca cache. Docs Workers KV menyebut rambatan "60 detik atau lebih", jadi jeda ini bukan batas pasti. Worker memakai `cacheTtl` eksplisit, dan jedanya diukur di spike M1.

## 9. Alur utama

### Upload sampai siap tonton

1. Klien memanggil `POST /v1/videos` dengan judul dan visibilitas. video-svc menolak kalau klaim `ev` di JWT false (email belum terverifikasi). `video-svc` memanggil `POST /internal/channels/ensure` ke `identity-svc` (idempoten, membuat channel jika user belum punya, lalu mengirim `channel.created`), membuat video `draft`, menulis `video.created` ke outbox di transaksi yang sama, dan mengembalikan `videoId`. `media-edge-sync` menulis entri KV `playable=false` dari event itu.
2. Klien memanggil `POST /v1/uploads` dengan `videoId`, nama file, dan ukuran. `upload-svc` memanggil `GET /internal/videos/:id/owner` yang mengembalikan pemilik dan status. Sesi hanya dibuat kalau status video `draft`, `abandoned`, atau `failed` dengan `failed_reason=invalid_input`. Lalu `upload-svc` memeriksa kuota (10 video per hari dihitung saat sesi pertama sebuah video dibuat, bukan per sesi, ditambah 2 GB per file), membuat multipart upload di R2, dan mengembalikan `uploadId` dan ukuran part. Event `upload.started` keluar lewat outbox. `upload-svc` juga meng-consume `video.deleted` untuk membatalkan multipart yang masih berjalan.
3. Klien meminta presigned URL per batch part (`POST /v1/uploads/:id/parts`), mengunggah part langsung ke R2, lalu melaporkan ETag setiap part. Setiap laporan part menggeser `expires_at` ke 24 jam berikutnya. Kalau koneksi putus atau browser ditutup, klien web mencari sesi lewat `GET /v1/uploads?videoId=`, meminta user memilih file lagi, mencocokkan `file_fingerprint`, lalu melanjutkan dari part yang sudah selesai. URL part yang kedaluwarsa cukup diminta ulang.
   - Cron abandon menjalankan `UPDATE upload_session SET status='abandoned' WHERE status='active' AND expires_at < now()` bersama baris outbox `upload.abandoned` di satu transaksi, lalu membatalkan multipart di R2. `POST /v1/uploads/:id/complete` hanya berhasil kalau status masih `active`, sehingga cron dan `complete` tidak bisa sama-sama menang.
4. Klien memanggil `POST /v1/uploads/:id/complete`. `upload-svc` menyelesaikan multipart di R2 dan mengirim `upload.completed`.
5. `video-svc` mengubah status ke `uploaded` dan mengirim `video.uploaded`. `transcode-svc` meng-consume event itu dan membuat job BullMQ.
6. Worker menjalankan ffprobe untuk validasi (format, durasi ≤ 30 menit), lalu FFmpeg untuk ladder rendisi, thumbnail, dan sprite. Hasilnya ditulis ke R2 dan event `transcode.succeeded` dikirim.
7. `video-svc` mengubah status ke `ready`, mengisi `video_rendition`, lalu mengirim `video.ready`. `feed-svc` dan `search-svc` bereaksi. `notification-svc` memberi tahu owner (video siap, gagal, di-block, atau dibuka blokirnya), dan memberi tahu subscriber dengan `notify=true` hanya saat kartu membawa `firstPublished=true`, yaitu saat `published_at` pertama kali diisi.

Klien memantau status lewat polling `GET /v1/videos/:id` setiap 3 detik selama status `uploaded` atau `processing`. Layar hanya menampilkan "Memproses...", karena transcode tidak mengirim progres per rendisi.

Membatalkan upload (`DELETE /v1/uploads/:id`) membatalkan multipart di R2, lalu mengirim `upload.cancelled`. Video kembali ke `draft`.

### Layout storage R2

```
sources/{videoId}/source.{ext}
videos/{videoId}/g{generation}/master.m3u8
videos/{videoId}/g{generation}/{height}p/index.m3u8
videos/{videoId}/g{generation}/{height}p/init.mp4
videos/{videoId}/g{generation}/{height}p/seg_{n}.m4s
videos/{videoId}/g{generation}/thumbs/{1,2,3}.jpg
videos/{videoId}/g{generation}/sprite/{n}.jpg + sprite.vtt
```

### Playback

Semua file video disajikan lewat domain media (misalnya `media.viora.<domain>`) yang ditangani Worker `media-edge`. R2 tidak diakses langsung dengan presigned URL karena presigned URL R2 hanya berlaku di endpoint S3 dan melewati cache CDN.

1. `GET /v1/videos/:id` mengembalikan metadata dan `manifestUrl` berbentuk `https://media.../v/{videoId}/{epoch}/master.m3u8?t={token}` jika pemanggil berhak menonton. `token` adalah HMAC atas `videoId`, `epoch`, `exp`, dan untuk video private juga `sub` (userId penonton). Video yang di-block mengembalikan 451 dengan alasan ke selain owner. Owner tetap melihat metadata dan statusnya.
2. Worker memeriksa epoch dan `playable` di Workers KV. Untuk video public dan unlisted, hanya manifest yang wajib token (`exp` 5 menit), sedangkan playlist rendisi dan segmen boleh diambil tanpa token selama epoch-nya benar. Untuk video private, Worker menulis ulang playlist supaya setiap URL segmen membawa token dengan `exp` = durasi video (`durationS` dari KV) + 30 menit, karena hls.js memuat playlist VOD sekali di awal. `exp` 5 menit hanya berlaku untuk manifest. Token dibawa di query string, bukan cookie, supaya bekerja sama di hls.js dan expo-video.
   - Kalau epoch di URL bukan epoch terbaru, Worker membalas 403 dengan kode `stale_epoch`. Player web (hls.js) membaca kode ini dari error response, memanggil ulang `GET /v1/videos/:id`, lalu memuat ulang manifest baru di posisi yang sama. expo-video tidak membuka status HTTP segmen, jadi aplikasi mobile menangani setiap error player dengan memanggil `GET /v1/videos/:id` dan memuat ulang kalau epoch berubah (dibuktikan di spike M6). Kalau penonton sudah tidak berhak, `GET /v1/videos/:id` membalas 403 `video_private` dan player menampilkan pesan.
3. Worker memetakan `/v/{videoId}/{epoch}/...` ke key R2 `{prefix}/...` dari KV, membaca dari Cache API dulu, lalu dari binding R2 jika cache miss. Kunci cache dibuat tanpa query `t` supaya semua penonton berbagi cache. Respons 206 (range) tidak di-cache karena `cache.put` menolaknya. Video public dan unlisted di-cache bersama, video private tidak.
   - Nilai KV disimpan di memori isolate Worker selama 10 detik untuk menekan jumlah baca KV (lihat model biaya). Batas atas pencabutan akses jadi rambatan KV (`cacheTtl` minimum 30 detik, rambatan antar lokasi sampai 60 detik atau lebih) ditambah 10 detik.
4. Player (hls.js atau expo-video) memilih rendisi sesuai bandwidth.
5. Saat pemutaran dimulai, klien memanggil `POST /v1/playback/sessions` dan mendapat `sessionId`. Heartbeat pertama (`seq=1`, saat frame pertama tampil) membawa `ttffMs`. Setelah itu heartbeat dikirim setiap 10 detik ke `POST /v1/playback/heartbeats` (di-throttle dengan TanStack Pacer di web).

Detail implementasi Worker (bentuk token, cara rewrite playlist untuk video private) divalidasi lewat spike di awal M1. Secret HMAC disimpan di SOPS untuk video-svc dan dipasang ke Worker dengan `wrangler secret`. Bucket R2 diberi aturan CORS yang mengekspos header `ETag`, karena klien membaca ETag setiap part saat upload multipart.

Cloudflare WAF punya autentikasi token HMAC bawaan (`is_timed_hmac_valid_v0`, paket Pro ke atas), tapi tanpa pencabutan berbasis epoch. Karena itu Worker tetap dipakai.

Live (M8):

- Satu siaran terikat ke satu video, dan `live_stream.id` sama dengan `videoId`. Saat live dibuat, `live-svc` membuat video `draft` lewat `POST /internal/videos`.
- **Ingest.** MediaMTX memvalidasi stream key lewat hook auth HTTP ke `live-svc` (yang mencocokkan `stream_key_hash`). Hook `runOnReady` dan `runOnNotReady` memberi tahu `live-svc` saat siaran mulai dan putus. `live-svc` lalu mengirim `live.started`, dan video-svc menjalankan `draft → live` serta mengisi `published_at` kalau visibilitasnya public. Notifikasi subscriber dikirim di titik ini, jadi VOD-nya nanti tidak mengirim notifikasi kedua (`firstPublished=false`).
- **Putus tanpa diakhiri.** Kalau OBS putus dan tidak tersambung lagi dalam 60 detik, siaran diakhiri otomatis.
- **Rekaman.** MediaMTX merekam segmen fMP4 di disk lokal. Saat siaran berakhir, `live-svc` me-remux rekaman menjadi satu MP4 dengan FFmpeg, meng-upload-nya ke `sources/{videoId}/source.mp4`, lalu mengirim `live.ended`. Batas durasi untuk sumber live adalah 4 jam (bukan 30 menit). `video.uploaded` membawa `source=live` supaya validasi transcode memakai batas itu.
- **Playback.** LL-HLS butuh blocking playlist reload, yang tidak bisa dilayani R2. Worker `media-edge` membaca `status` di KV: kalau `live`, request diteruskan ke MediaMTX sebagai origin tanpa cache untuk playlist. Kalau tidak, dibaca dari R2. Kalau LL-HLS lewat Worker tidak stabil, fallback-nya HLS biasa dengan latensi 6 sampai 10 detik.
- **View dan penonton.** Untuk siaran, view dihitung setelah 30 detik menonton (aturan 50% tidak berlaku karena durasinya belum diketahui). Jumlah penonton dihitung `metrics-svc` dari sesi yang mengirim heartbeat dalam 30 detik terakhir (sorted set per `videoId` di Redis), lewat `GET /v1/live/:videoId/viewers`.
- **Selama siaran.** Notifikasi subscriber untuk live ditunda 90 detik setelah `live.started`, supaya status `live` sudah merambat di Workers KV saat penonton membuka link. `durationS` siaran kosong, jadi token segmen siaran private memakai `exp` tetap 6 jam, dan validasi posisi heartbeat memakai waktu sejak siaran mulai sebagai batas atas.

### Hitung view dan metrics

Desain ini direvisi di revisi 6. Penilaian syarat view dipindah dari window session Flink ke `metrics-svc`. Alasannya, window session Flink baru mengeluarkan hasil setelah sesi ditutup, sehingga SLO 2 menit tidak tercapai. Selain itu, TTL state Flink berlaku untuk seluruh job, jadi dedupe 24 jam akan ikut mereset total sepanjang waktu.

1. **Ingest dan penilaian per sesi (`metrics-svc`).**
   - Heartbeat divalidasi: posisi tidak boleh melompat melebihi durasi, dan rate per sesi dibatasi.
   - `channelId`, `ownerUserId`, `durationS`, dan `visibility` ditambahkan dari tabel Scylla `video_meta` milik metrics-svc, yang diisi dari event `video.v1` dengan penjaga `stateVersion`. Tabel ini juga dipakai untuk cek kepemilikan analytics owner.
   - IP asli diambil dari header `X-Real-IP` yang diisi Kong dari `CF-Connecting-IP`, lalu di-hash jadi `ipHash`.
   - Identitas penonton:
     - `anonId`: UUID acak di cookie first-party `viora_anon` (HttpOnly, 1 tahun), diset SSR saat kunjungan pertama. Aplikasi mobile menyimpan nilai setara di MMKV.
     - `sessionId`: diterbitkan `metrics-svc` lewat `POST /v1/playback/sessions` saat pemutaran dimulai. Klien mengirimnya di setiap heartbeat bersama `seq` yang naik satu per heartbeat.
     - ID event heartbeat = hash(`sessionId`, `seq`), jadi heartbeat yang dikirim ulang punya ID yang sama dan dibuang Flink.
   - State sesi di `redis-durable` menjumlahkan detik yang ditonton dari `watchedDeltaS` (selisih detik sejak heartbeat sebelumnya, dibatasi maksimal 15). Saat sesi mencapai 30 detik, atau 50% durasi untuk video di bawah 60 detik, `metrics-svc` menjalankan `SET NX` pada `viewed:{videoId}:{userId atau ipHash+anonId}` dengan TTL 24 jam. Kalau berhasil, event `view.counted` dikirim ke `metrics.views.v1` dengan key `videoId` dan ID = hash(`sessionId`, `"view"`).
   - `identityHash` di `view.counted` (dipakai `co_watch`) adalah HMAC atas identitas. Event membawa `hashKeyId`, dan `co_watch` hanya memasangkan view dengan `hashKeyId` yang sama. Kunci disimpan di Kubernetes Secret `view-hash-keys`, tidak di SOPS atau git dan tidak ikut backup. CronJob `hash-key-rotator` membuat kunci baru setiap 30 hari dan menghapus kunci yang berumur lebih dari 37 hari dari Secret itu. Setelah dihapus, hash tidak bisa lagi dikaitkan ke user. Pasangan co-watch yang melintasi batas rotasi hilang (sekitar 7 dari 30 hari), dan ini diterima.
   - State sesi view di `redis-durable` punya TTL 6 jam.
   - Hanya heartbeat yang diterima skrip Lua (bukan duplikat atau `seq` lama) yang dikirim ke `playback.heartbeat.v1` (key `sessionId`), dengan `watchedDeltaS` yang sudah dibatasi maksimal 15, untuk watch time.
   - Heartbeat diproses di Redis lewat satu skrip Lua atomik yang menolak `seq` ≤ `lastSeq` sesi itu, jadi heartbeat yang dikirim ulang tidak menambah detik tontonan.
   - Saat sesi pertama kali mencapai bucket 10% durasi yang baru (posisi maksimum disimpan di state sesi), `metrics-svc` mengirim `view.progress_bucket` ke `metrics.views.v1` dengan ID = hash(`sessionId`, `"bucket"`, n). Retensi lalu cukup dihitung dengan `COUNT` per (`videoId`, `bucket`), tanpa `COUNT DISTINCT` atas semua sesi.
   - Posisi resume ditulis langsung ke Scylla di setiap heartbeat. History ditulis sekali per sesi.
   - `ttffMs` dari heartbeat `seq=1` dicatat sebagai histogram OTel untuk SLO.
2. **Agregasi (Flink SQL, tanpa window event-time).** Semua job berjalan di satu Flink session cluster (satu JobManager dan satu TaskManager) sebagai `FlinkSessionJob`, bukan satu cluster per job, supaya muat di anggaran RAM.
   - Mini-batch dinyalakan dengan tiga setelan: `table.exec.mini-batch.enabled=true`, `allow-latency=30 s`, dan `size=5000`.
   - Tidak ada watermark. Hari dihitung dari `occurredAt` yang diisi `metrics-svc` saat ingest (bukan jam klien), sebagai kolom biasa.
   - **Dedupe input.** Producer dan relay bisa mengirim duplikat, jadi setiap job lebih dulu men-dedupe dengan `GROUP BY eventId` dan hint `STATE_TTL` 2 hari. Hint ini berlaku per operator di Flink 2.2, jadi job tidak perlu dipisah menurut TTL.
   - `totals`: total views per video (dari `view.counted`) dan watch seconds (dari heartbeat). Agregasi setelah dedupe tanpa TTL. Ukuran state sebanding jumlah video, bukan jumlah event. Like, dislike, dan komentar tidak dihitung Flink (lihat langkah 6).
   - Startup dan upgrade job: deploy pertama membaca input dari `earliest-offset`. Upgrade memakai savepoint (`upgradeMode: savepoint` di operator), jadi state tidak hilang. Kalau state benar-benar hilang, views dihitung ulang tepat dari `metrics.views.v1`, tapi total watch seconds sepanjang waktu hanya bisa dibangun dari heartbeat 7 hari terakhir. Kehilangan ini diterima dan dicatat di ADR 017. Writer tetap menulisnya karena offset-nya lebih tinggi, jadi runbook mewajibkan menghentikan writer sebelum job tanpa state dijalankan, lalu memutuskan secara manual.
   - `daily`: agregat per (`videoId`, `day`), per (`channelId`, `day`) termasuk `subscribers_gained` (dari `subscription.created` dengan `active=true`), dan per (`channelId`, `month`, `videoId`). Tanpa TTL, supaya event terlambat tidak mengulang hitungan dari nol dan menimpa nilai lama. Event dengan `occurredAt` lebih tua dari 48 jam dibuang di awal job. State tumbuh sekitar satu baris per video per hari. Di skala besar, ini diganti TTL ditambah filter yang sama.
   - `retention`: `COUNT` per (`videoId`, `bucket`) dari `view.progress_bucket`.
   - `co_watch`: query batch yang dijalankan CronJob harian ke session cluster, membaca `metrics.views.v1` 7 hari terakhir (`scan.bounded.mode=timestamp`). Setiap baris membawa `computedAt`. `feed-svc` mengganti seluruh daftar related sebuah video dengan hasil `computedAt` terbaru, jadi pasangan yang hilang dari hitungan ulang ikut terhapus.
3. **Topic output.** Satu topic per jenis agregat, di-compact. Setiap sink punya satu kolom kunci string hasil penggabungan (misalnya `videoId|day`) sebagai PRIMARY KEY dengan `'key.format' = 'raw'`. Format `json` menghasilkan kunci berupa objek JSON (`{"k":"..."}`) bahkan untuk satu kolom. Value memakai format `json`.
   - `metrics.video_totals.v1` (key `videoId`)
   - `metrics.video_daily.v1` (`videoId|day`)
   - `metrics.channel_daily.v1` (`channelId|day`)
   - `metrics.channel_video_month.v1` (`channelId|month|videoId`)
   - `metrics.retention.v1` (`videoId|bucket`)
   - `metrics.cowatch.v1` (`videoId|relatedVideoId`)

   Karena topic ini berisi baris tabel (bukan event bisnis), skemanya ditulis sebagai skema baris di `packages/contracts`, bukan `EventEnvelope`. Tidak ada data per user di topic ini. Tidak ada `updatedAt` dari Flink, karena waktu proses adalah fungsi non-deterministik yang bisa ditolak planner untuk update stream, dan `MAX(occurredAt)` tidak naik saat event terlambat masuk.

   Retensi input: `metrics.views.v1` disimpan tanpa batas waktu (volumenya kecil di skala demo, dan `identityHash`-nya tidak bisa dikaitkan ke user setelah 37 hari), supaya `totals` bisa dihitung ulang dari awal. Heartbeat dan `social.v1` disimpan 7 hari, jadi watch seconds dan `subscribers_gained` hanya bisa dihitung ulang untuk 7 hari terakhir. Di skala besar, retensi tanpa batas diganti snapshot berkala.
4. **Writer agregat (`metrics-svc`)** meng-consume topic-topic itu dan menulis ke Scylla dengan `USING TIMESTAMP` = offset Kafka record asal. `upsert-kafka` mempartisi menurut key, jadi semua update untuk satu key berada di partisi yang sama dengan offset yang selalu naik. Ini memberi urutan per key yang pasti, termasuk untuk pesan yang datang lewat topic retry (offset asal dibawa di header). Tombstone (value null, dari retraksi yang membuat baris hilang) ditulis sebagai `DELETE ... USING TIMESTAMP` offset yang sama.
   - Membangun ulang: writer dihentikan, tabel agregat dari Flink (`video_totals`, `views_by_*`, `retention_by_video`) di-`TRUNCATE`, lalu writer dijalankan lagi dari offset awal. `video_engagement` tidak ikut di-truncate. Kalau tabel itu hilang, `bun run outbox:reemit social engagement --all` mengirim ulang jumlah terkini dari Postgres (nilai absolut, jadi aman). Kalau topic agregat pernah dibuat ulang (offset kembali ke 0), tabel wajib di-`TRUNCATE` dulu, dan penjaga `source_offset` di `video_stats`, `feed.video_stats`, dan `feed.video_daily_views` di-reset ke -1 lewat runbook.
   - Compaction menyimpan nilai terakhir per key, jadi data harian tidak hilang.
5. **`cdc-svc`** meng-consume `metrics.video_totals.v1` dan mengirim `metrics.stats_snapshot` (views dan watch seconds) untuk setiap video yang berubah. Throttle-nya trailing edge: perubahan pertama membuka jendela 60 detik, dan snapshot dengan nilai terakhir dikirim saat jendela ditutup. Offset yang di-commit adalah offset pertama terkecil di antara semua jendela yang masih terbuka, jadi crash tidak menghilangkan perubahan video lain yang jendelanya belum ditutup. Snapshot membawa `sourceOffset`, dan ID event-nya deterministik dari `videoId` dan `sourceOffset`. Consumer hanya menerapkan snapshot dengan `sourceOffset` lebih besar. `video-svc` memperbarui `video_stats`, dan `feed-svc` memperbarui proyeksinya untuk trending.
6. **Like, dislike, dan komentar** dihitung transaksional oleh social-svc di `video_engagement_count`, lalu dikirim sebagai `engagement.counts_changed` (nilai absolut dengan `stateVersion`). Writer di metrics-svc menulis ke tabel `video_engagement` dengan `USING TIMESTAMP` = `stateVersion`. video-svc memperbarui kolom yang sama di `video_stats`, dan feed-svc memperbarui `video_reactions`. Angka ini tidak perlu `social.v1` disimpan lama untuk rebuild.

Flink SQL tidak punya konektor Cassandra atau Scylla untuk SQL (konektor yang ada hanya DataStream), jadi semua job menulis ke Redpanda. Validasi semantik query (dedupe dengan `STATE_TTL`, input duplikat, restart tanpa state, ukuran state) dilakukan di spike awal M3 dengan data sintetis.

### Feed

- Fan-out dijalankan setiap kali video masuk ke kondisi `ready` dan `public`: lewat `video.ready`, `video.visibility_changed` ke public, atau `video.unblocked`. `ZADD` ke sorted set bersifat idempoten, jadi fan-out ulang aman. `feed-svc` memeriksa `channel_fanout.mode`.
  - Mode `push`: video ditambahkan ke `feed:{userId}` lewat skrip Lua yang hanya menambah kalau key sudah ada (key yang sudah di-evict tidak dibuat ulang dengan satu item, jadi pembangunan ulang saat cache miss tetap terjadi). Key feed punya TTL 7 hari. Dikerjakan per batch 1.000 user.
  - Mode `pull`: tidak ada fan-out.
- `GET /v1/feed/subscriptions` menggabungkan sorted set Redis milik user dengan video terbaru dari channel ber-mode `pull` yang dia subscribe, lalu memotongnya dengan cursor.
- Saat dibaca, setiap item disaring terhadap `feed.video_cards`. Video yang sudah tidak ready atau tidak public (dijadikan private, di-block, dihapus) dibuang dari hasil dan dihapus dari sorted set secara malas. Tidak perlu menghapus dari ribuan sorted set saat visibilitas berubah.
- Kalau `feed:{userId}` kosong (cache miss), `feed-svc` membangun ulang dari `feed.video_cards` dan `feed.subscriptions`.
- Trending dihitung setiap 10 menit lalu disimpan sebagai `trending_snapshot`. Skornya dari like (`video_reactions`), kebaruan, dan mulai M3 pertumbuhan views hari ini dibanding kemarin (`video_daily_views`).
- Aturan tampil: rekomendasi, related, dan trending hanya boleh menampilkan video yang ada di `feed.video_cards` (ready dan public). Co-watch ikut menghitung video unlisted dan private, jadi filter ini mencegah video itu bocor.
- Cold start: user tanpa history, termasuk penonton anonim, melihat trending di tab Untukmu. Video baru yang belum punya pasangan co-watch memakai video terbaru dari channel yang sama sebagai related, sampai `co_watch` berikutnya berjalan.
- Rekomendasi (M5) berawal dari co-watch: `feed-svc` meng-consume `metrics.cowatch.v1` ke tabel `related_video`. Feed rekomendasi user diambil dari related video atas history terbaru user (lewat API internal `metrics-svc`). Pengembangan lanjutan (embedding, pgvector) dicatat di design doc.

## 10. Katalog event

### Envelope

```ts
type EventEnvelope<T> = {
  id: string            // UUIDv7 dari outbox, atau UUIDv5 deterministik (hash) untuk producer tanpa outbox. Skema Zod menerima keduanya. Kunci dedupe consumer
  type: string          // contoh: "video.ready"
  version: number       // versi skema payload
  occurredAt: string    // ISO 8601
  producer: string      // nama service
  key: string           // partition key
  data: T
  // traceparent dan tracestate ada di header record Kafka, bukan di sini
}
```

Skema Zod setiap event ada di `packages/contracts`. Kompatibilitas dicek di CI (lihat §6, evolusi skema). Perubahan yang tidak kompatibel menaikkan `version` dan memakai topic baru (`*.v2`).

### Topic dan event

| Topic | Event | Producer | Consumer | Key |
|---|---|---|---|---|
| `identity.v1` | `user.registered`, `user.email_verified`, `user.profile_updated`, `user.banned`, `user.unbanned`, `user.deleted`, `channel.created`, `channel.updated`, `channel.deleted` | identity-svc | upload, video, social, feed, search, notification, metrics, live | `userId` |
| `upload.v1` | `upload.started`, `upload.completed`, `upload.cancelled`, `upload.abandoned` | upload-svc | video-svc | `videoId` |
| `video.v1` | `video.created`, `video.uploaded`, `video.ready`, `video.failed`, `video.visibility_changed`, `video.metadata_updated`, `video.blocked`, `video.unblocked`, `video.deleted`, `video.access_invited`, `video.access_revoked`, `video.live_started` | video-svc | upload, transcode, feed, search, notification, social, metrics, video (`media-edge-sync`) | `videoId` |
| `transcode.v1` | `transcode.started`, `transcode.succeeded`, `transcode.failed` | transcode-svc | video-svc | `videoId` |
| `social.v1` | `engagement.counts_changed`, `subscription.created`, `subscription.updated`, `subscription.removed`, `reaction.set`, `reaction.removed`, `comment.created`, `comment.deleted`, `report.created` | social-svc | feed, notification, stream-processor, metrics-svc dan video-svc (`engagement.counts_changed`) | `channelId` untuk subscription, `targetId` untuk report, `videoId` untuk lainnya |
| `playback.heartbeat.v1` | `playback.heartbeat` | metrics-svc | stream-processor | `sessionId` |
| `metrics.views.v1` | `view.counted` (sudah lolos syarat dan dedupe), `view.progress_bucket` | metrics-svc | stream-processor | `videoId` |
| `metrics.video_totals.v1`, `metrics.video_daily.v1`, `metrics.channel_daily.v1`, `metrics.channel_video_month.v1`, `metrics.retention.v1` | Baris agregat upsert (skema baris, bukan envelope) | stream-processor | metrics-svc (writer), cdc-svc (`video_totals`), feed-svc (`video_daily`) | Key gabungan, lihat §9 |
| `metrics.cowatch.v1` | Baris pasangan related video dengan skor | stream-processor | feed-svc | `videoId\|relatedVideoId` |
| `metrics.v1` | `metrics.stats_snapshot` | cdc-svc | video-svc, feed-svc | `videoId` |
| `live.v1` (stretch) | `live.started`, `live.ended` | live-svc | feed, notification, video | `videoId` |

Retensi topic retry dan DLQ 14 hari. Setiap consumer group punya topic retry tertunda `retry.<group>.<topic>` (juga dipakai replay) dan DLQ `dlq.<group>.<topic>` (lihat bagian 6).

Tidak ada event `playback.started`. `ttffMs` dibawa heartbeat `seq=1`, dan `metrics-svc` hanya mencatatnya sebagai metrik OTel.

### Versi state di payload

Retry tertunda dan replay DLQ bisa membuat event untuk key yang sama tiba tidak berurutan. Karena itu setiap event yang membawa state entitas menyertakan `stateVersion` (nilai `state_version` di tabel pemilik, naik setiap perubahan):

- Semua `video.*` membawa `stateVersion` video.
- `subscription.*` membawa `stateVersion` baris subscription.
- `channel.*` membawa `stateVersion` channel.

Consumer proyeksi hanya menerapkan event dengan `stateVersion` lebih baru dari yang tersimpan (pola penjaga versi dari Seapedia). Dedupe `event_id` tetap berlaku.

### Penghapusan akun

`user.deleted` memicu setiap service menghapus atau menganonimkan data milik user itu di schema masing-masing. Video milik user ikut dihapus lewat alur `deleted` biasa. `metrics-svc` menghapus partisi user di `watch_progress` dan `watch_history`, dan kunci dedupe view di Redis kedaluwarsa sendiri dalam 24 jam. Komentar dianonimkan secara default (penulis menjadi "Pengguna dihapus", isi tetap ada supaya thread balasan tidak rusak). Kalau user memintanya (`DELETE /v1/me` dengan body `{ "purgeComments": true }`), isi komentar juga diganti "[komentar dihapus]".

Setiap service yang menyimpan data user wajib meng-consume `user.deleted`. Aturan ini ditulis di `owners.md` dan masuk checklist `new:service`. Matriks pembersihan:

| Service | Tindakan |
|---|---|
| identity-svc | Hapus `user`, `session`, `account`, `verification`, dan `channel` di transaksi `DELETE /v1/me`, lalu tulis `user.deleted` dan `channel.deleted` |
| upload-svc | Batalkan multipart yang masih berjalan, hapus `upload_session`, `upload_part`, `quota_usage` |
| video-svc | Semua video milik user ke `deleted`. Hapus playlist milik user, baris `video_access` user, dan `video_access_invite` yang dibuat user. Item playlist orang lain yang berisi video user ikut hilang saat video di-purge. `appeal` milik user dihapus |
| social-svc | Hapus subscription dan reaksi user, perbarui `video_engagement_count` dan `channel_subscriber_count`, dan kirim `subscription.removed` dan `engagement.counts_changed` untuk setiap baris yang terdampak. Komentar dianonimkan atau di-purge sesuai `purgeComments`. `reporter_id` di `report` dikosongkan. Hapus `user_cards` dan `channel_cards` user. Saat `channel.deleted`, subscription orang lain ke channel itu di-set `active=false` dan `subscription.removed` dikirim |
| feed-svc | Hapus `feed:{userId}`, proyeksi subscription user, dan kartu channel user (`channel.deleted`) |
| search-svc | Hapus dokumen channel user. Dokumen video terhapus lewat `video.deleted` |
| notification-svc | Hapus `invite_delivery` yang dikirim user. Hapus notifikasi, push token, proyeksi `subscriptions`, `user_cards`, dan `channel_cards` milik user |
| metrics-svc | Hapus partisi user di `watch_progress` dan `watch_history`. Kosongkan `owner_user_id` di `video_meta` untuk video user |
| video-svc (proyeksi) | Hapus `channel_cards` channel user |
| live-svc | Akhiri siaran aktif, hapus `live_stream` milik channel user |

### Payload

Ditulis lengkap sebagai skema Zod di event catalog M0. Field minimum:

| Event | Field |
|---|---|
| `user.registered` | `userId`, `name`, `image`, `stateVersion` |
| `user.profile_updated` | `userId`, `name`, `image`, `stateVersion` |
| `user.banned`, `user.unbanned` | `userId`, `reason?`, `expiresAt?` |
| `user.email_verified` | `userId`, `email` |
| `user.deleted` | `userId`, `purgeComments` |
| `channel.deleted` | `channelId`, `ownerUserId` |
| `video.created` | Data kartu video dengan `status=draft` dan `playable=false` |
| `video.access_invited` | `videoId`, `email`, `inviterName`, `videoTitle`, `registeredUserId?` |
| `video.access_revoked` | `videoId`, `userId`, `epoch`, `stateVersion` |
| `channel.created`, `channel.updated` | `channelId`, `ownerUserId`, `handle`, `name`, `avatarKey`, `stateVersion` |
| `upload.started` | `videoId`, `userId`, `uploadId` |
| `upload.completed` | `videoId`, `uploadId`, `userId`, `sourceKey`, `sizeBytes` |
| `upload.cancelled`, `upload.abandoned` | `videoId`, `uploadId` |
| `video.uploaded` | `videoId`, `sourceKey`, `generation`, `source` (`upload` atau `live`), `stateVersion` |
| `transcode.started` | `videoId`, `generation` |
| `transcode.succeeded` | `videoId`, `generation`, `durationS`, `renditions[]` (`height`, `bitrateKbps`, `playlistKey`), `manifestKey`, `thumbnailKeys[]`, `spriteKey` |
| `transcode.failed` | `videoId`, `generation`, `attempts`, `reason` (`exhausted`, `invalid_input`), `error` |
| Kartu video: `video.ready`, `video.unblocked`, `video.visibility_changed`, `video.metadata_updated`, `video.live_started` | `videoId`, `channelId`, `ownerUserId`, `status`, `visibility`, `epoch`, `playable`, `title`, `thumbnailKey`, `durationS`, `publishedAt`, `firstPublished`, `stateVersion`. `video.visibility_changed` menambahkan `from` |
| `video.blocked`, `video.deleted`, `video.failed` | `videoId`, `channelId`, `ownerUserId`, `status`, `visibility`, `epoch`, `playable`, `reason`, `stateVersion` |
| `subscription.created` (subscribe pertama dan subscribe ulang setelah `active=false`), `subscription.updated` (hanya toggle `notify`), `subscription.removed` (`active` jadi false). `subscribers_gained` menghitung `created` | `active`, `userId`, `channelId`, `notify`, `stateVersion` |
| `engagement.counts_changed` | `videoId`, `likes`, `dislikes`, `comments`, `stateVersion` |
| `reaction.set` | `userId`, `videoId`, `kind`, `previousKind?` |
| `reaction.removed` | `userId`, `videoId`, `previousKind` |
| `comment.created` | `commentId`, `videoId`, `authorId`, `parentId?`, `rootId?`, `parentAuthorId?` (untuk notifikasi balasan) |
| `comment.deleted` | `commentId`, `videoId` |
| `report.created` | `reportId`, `targetType`, `targetId`, `reason` |
| `playback.heartbeat` | `sessionId`, `seq`, `videoId`, `channelId`, `durationS`, `userId?`, `anonId`, `ipHash`, `positionS`, `watchedDeltaS`, `renditionHeight`, `occurredAt` |
| `view.counted` | `videoId`, `channelId`, `sessionId`, `identityHash`, `hashKeyId`, `occurredAt`. Tanpa `ownerUserId`, karena topic ini disimpan tanpa batas |
| `view.progress_bucket` | `videoId`, `sessionId`, `bucket`, `occurredAt` |
| `metrics.stats_snapshot` | `videoId`, `views`, `watchSeconds`, `sourceOffset` |
| `live.started` | `liveId`, `videoId`, `channelId` |
| `live.ended` | `liveId`, `videoId`, `sourceKey` |

## 11. API publik per service

Semua route publik lewat Kong dengan prefix `/v1`. Error memakai satu bentuk: `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Respons sukses mengembalikan data langsung tanpa pembungkus `success`. List publik memakai cursor (`?cursor=&limit=`, respons `{ items, nextCursor }`). List admin boleh memakai offset.

| Service | Endpoint utama |
|---|---|
| identity | `/v1/auth/*` (Better Auth), `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me`, `GET /v1/channels/by-handle/:handle`, `GET /v1/channels/:id`, `PATCH /v1/channels/me` (handle `me` dan `by-handle` dicadangkan), `POST /v1/admin/users/:id/ban`, `POST /v1/admin/users/:id/unban` (route identity-svc yang memanggil plugin admin Better Auth, menulis denylist, lalu outbox). Endpoint bawaan `/v1/auth/admin/*` dan `/v1/auth/delete-user` ditolak Kong |
| upload | `GET /v1/uploads?videoId=` (sesi aktif untuk resume), `POST /v1/uploads`, `GET /v1/uploads/:id`, `POST /v1/uploads/:id/parts`, `PUT /v1/uploads/:id/parts/:n` (laporan ETag), `POST /v1/uploads/:id/complete`, `DELETE /v1/uploads/:id` |
| video | `POST /v1/videos`, `GET /v1/videos/:id`, `PATCH /v1/videos/:id`, `DELETE /v1/videos/:id`, `POST /v1/videos/:id/retry`, `PUT /v1/videos/:id/access` (undang lewat email), `GET /v1/videos/:id/access`, `DELETE /v1/videos/:id/access/:entryId`, `GET /v1/channels/:id/videos`, `GET /v1/me/videos`, `POST /v1/admin/videos/:id/block`, `POST /v1/admin/videos/:id/unblock`, `POST /v1/videos/:id/appeal`, `GET /v1/admin/appeals`, `POST /v1/admin/appeals/:id/resolve` (`accepted` membuka blokir, atau `rejected`). Playlist: `POST /v1/playlists`, `GET /v1/me/playlists`, `GET /v1/playlists/:id`, `PATCH /v1/playlists/:id`, `DELETE /v1/playlists/:id`, `POST /v1/playlists/:id/items`, `PATCH /v1/playlists/:id/items/:videoId` (posisi), `DELETE /v1/playlists/:id/items/:videoId`. `GET /v1/channels/:id/videos` ikut mengembalikan jumlah video public. `GET /v1/videos?ids=` (batch, maksimal 50) untuk kartu di history, playlist, dan notifikasi. Internal: `POST /internal/videos` (dipakai live-svc), `GET /internal/videos/:id/access?userId=` |
| social | `PUT /v1/channels/:id/subscription`, `DELETE /v1/channels/:id/subscription`, `GET /v1/me/subscriptions`, `PUT /v1/videos/:id/reaction`, `DELETE /v1/videos/:id/reaction`, `GET /v1/videos/:id/comments`, `POST /v1/videos/:id/comments`, `GET /v1/comments/:id/replies`, `DELETE /v1/comments/:id`, `POST /v1/reports`, `GET /v1/admin/reports`, `POST /v1/admin/reports/:id/resolve` (`actioned` atau `dismissed`), `DELETE /v1/admin/comments/:id`, `GET /v1/channels/:id/subscriber-count`, `GET /v1/videos/:id/reactions` (jumlah like dan dislike dari `video_engagement_count` plus reaksi milik user) |
| feed | `GET /v1/feed/subscriptions`, `GET /v1/feed/trending`, `GET /v1/feed/recommended`, `GET /v1/videos/:id/related` |
| metrics | `POST /v1/playback/heartbeats`, `GET /v1/videos/:id/stats`, `GET /v1/me/history`, `GET /v1/me/progress/:videoId`, `POST /v1/playback/sessions`, `GET /v1/studio/analytics?range=`, `GET /v1/studio/videos/:id/analytics?range=` (khusus owner, dicek lewat proyeksi video ke owner dari `video.v1`), `GET /v1/live/:id/viewers` |
| search | `GET /v1/search?q=&type=&limit=`. Saran saat mengetik memakai endpoint yang sama dengan `limit=5` |
| notification | `GET /v1/notifications`, `POST /v1/notifications/read`, `PUT /v1/me/push-token` |
| live | `POST /v1/live`, `GET /v1/live/:id`, `POST /v1/live/:id/end`, `POST /v1/live/:id/stream-key/rotate` (key lama langsung tidak berlaku, key baru ditampilkan sekali) |

Endpoint internal (tidak diekspos Kong, di port internal terpisah) memakai prefix `/internal` dan wajib token service (projected ServiceAccount token dengan audience service tujuan). Contoh: `GET /internal/videos/:id/owner`, `POST /internal/channels/ensure` (upsert idempoten), `POST /internal/users/resolve-email`, `GET /internal/metrics/users/:id/recent-history` (milik metrics-svc).

Kontrak OpenAPI:

- Setiap service men-generate spec saat build.
- CI menjalankan oasdiff terhadap spec di `main` dan gagal jika ada breaking change tanpa versi baru.
- `packages/api-client` berisi SDK hey-api dan `queryOptions` TanStack untuk web dan mobile, di-generate dari spec OpenAPI gabungan semua service (pola Seapedia, dengan gate drift di CI).

## 12. Web dan mobile

### Web (`apps/web`)

- TanStack Start: SSR untuk `/watch/:id`, `/@:handle`, `/`, dan halaman search. Meta Open Graph dirender di server. Halaman studio dan pengaturan boleh client-only.
- TanStack Router, Query, Form, Pacer (throttle heartbeat, debounce search), dan Charts (analytics creator).
- TanStack DB hanya dipakai kalau ada kasus yang tidak bisa diselesaikan Query dengan optimistic update. Keputusan itu ditulis sebagai ADR saat terjadi.
- Halaman admin: route `/admin/*` di `apps/web`, client-only, dijaga `role=admin` di `beforeLoad`. Isinya antrean report (video, komentar, channel), keberatan, dan ban user.
- TanStack Start 1.0 sudah stabil. SSR TanStack Charts butuh `initialWidth` atau `width` eksplisit supaya tidak bergeser saat hydration.
- Docs TanStack Charts wajib dibaca lewat Context7 (`/tanstack/charts`) sebelum M5 dimulai, bersama skill `design-a-chart` dan `coordinate-charts-with-tanstack`.
- Player: hls.js dengan pemilih kualitas, preview sprite saat scrub, dan resume posisi.
- UI: Tailwind 4 dan shadcn. Mengikuti skill antislop dan Emil Kowalski untuk polish dan motion.
- Konvensi dari web-siera: `routes/` merangkai halaman dan memegang guard, `components/` hanya JSX, perilaku di hooks, logika murni di `lib/<domain>/`. Satu gaya alias import (`@/`), nama hook `use-kebab.ts`.

### Mobile (`apps/mobile`)

- Expo, Expo Router, Uniwind, MMKV, SecureStore, expo-video. Auth memakai integrasi resmi `@better-auth/expo`, yang menyimpan sesi di SecureStore.
- Memakai `packages/api-client` dan `packages/design-tokens` yang sama dengan web.
- Push notification lewat Expo Push Service: dikirim per batch 100, receipt diperiksa job 15 menit kemudian, dan token dengan error `DeviceNotRegistered` dihapus.
- Deep link: Universal Links (iOS) dan App Links (Android) di `https://<domain>/watch/:id?t=&comment=` (dipakai push upload baru, balasan komentar, dan undangan video private), dengan skema `viora://` sebagai fallback. URL yang sama bisa dibuka di web, jadi push dan share memakai satu URL.
- Refresh token: saat menerima 401 biasa (bukan `account_banned`), klien memperbarui JWT lewat `/v1/auth/token` satu kali (single-flight, request lain menunggu), lalu mengulang request.
- Autoplay di feed: kartu feed tidak membawa URL manifest. Untuk item yang sedang terlihat, app memanggil `GET /v1/videos/:id` dan mem-prefetch item berikutnya. Autoplay tanpa suara tidak mengirim heartbeat dan tidak dihitung view. Heartbeat baru dikirim setelah user tap atau menyalakan suara.
- Upload dari galeri memakai alur multipart yang sama dengan web.

Konvensi yang diambil dari mobile-siera dan fikes:

| Asal | Diambil |
|---|---|
| mobile-siera | `src/app` hanya route tipis yang merangkai screen dari `src/features/<domain>/`. Satu hook satu concern, nama file sama dengan export. Data hanya lewat SDK hasil generate. Env `EXPO_PUBLIC_*` divalidasi zod. `onlineManager` TanStack terhubung ke expo-network dan `focusManager` ke AppState. Map deep link push yang exhaustive atas union hasil generate. Lint melarang `toSorted` dan method ES2023 sejenis yang tidak didukung Hermes. Paket dipasang hanya lewat `expo install`. Setiap screen menangani loading, error, empty, dan pull-to-refresh |
| fikes | Satu pemilik reset (`AccountReset`) yang menghapus cache query, MMKV, dan state upload saat logout atau ganti akun. Wrapper `src/storage` untuk MMKV. FlashList v2 untuk semua list. Lint melarang `Text` bawaan React Native dan impor root paket ikon. `inlineRequires` di Metro. `runtimeVersion` berbasis fingerprint. Lane CI berbasis diff dengan `expo export` sebagai cek build |

Yang harus dirancang sendiri karena kedua repo belum punya:

- Upload multipart yang bisa dilanjutkan: `uploadId`, ETag per part, dan part yang selesai disimpan di MMKV. URL part yang kedaluwarsa diminta ulang. Upload saat app di-background atau dimatikan dikaji di spike M6 (background task atau modul upload native), karena XHR berhenti saat app ditangguhkan. Upload file utuh lewat `fetch(uri).blob()` seperti di mobile-siera tidak dipakai karena gagal untuk video besar.
- Playback dengan expo-video: HLS adaptif, PiP, audio background, kontrol lock screen. Di feed hanya item yang terlihat yang diputar, dengan pool player dan pelepasan player supaya memori terkendali.
- Thumbnail dengan expo-image: `recyclingKey`, cache disk, placeholder blurhash.
- Deep link push ke video tertentu dan ke detik tertentu.
- `eas.json` dengan profil development, preview, dan production, masing-masing dengan channel update sendiri.
- E2E di perangkat dengan Maestro untuk alur pilih video, upload, dan putar.

## 13. Monorepo dan konvensi kode

### Layout

```
viora/
├─ apps/
│  ├─ web/  mobile/
│  ├─ identity-svc/  upload-svc/  transcode-svc/  video-svc/
│  ├─ social-svc/  feed-svc/  metrics-svc/  cdc-svc/
│  ├─ search-svc/  notification-svc/  live-svc/
├─ packages/
│  ├─ contracts/       # skema event Zod, nama topic, tipe envelope
│  ├─ service-kit/     # factory Hono, DomainError, verifikasi token user dan service, klien internal + policy cockatiel, OTel, outbox relay, consumer idempoten, DLQ
│  ├─ api-client/      # SDK hey-api + queryOptions (generated, versi hey-api di-pin persis karena masih tahap pengembangan awal)
│  ├─ design-tokens/   # dipakai web dan mobile
│  └─ config/          # tsconfig, oxlint, skema env
├─ infra/
│  ├─ compose/         # profile core, media, stream, obs
│  ├─ helm/            # chart per service + chart infra
│  ├─ argocd/          # Application manifest
│  ├─ flink/           # stream-processor: job Flink SQL (totals, daily, retention, co_watch) + image SQL runner
│  └─ media-edge/      # Cloudflare Worker di depan R2 (wrangler)
├─ tools/              # scaffolder new:module, new:service, skrip CI
├─ docs/
└─ turbo.json
```

Bun workspaces dan Turborepo. Package baru hanya boleh dibuat jika sudah ada dua consumer nyata (aturan dari fikes, dicatat di `docs/architecture/owners.md`).

### Konvensi service (diadaptasi dari api-siera)

- Modul berbentuk `src/modules/<m>/<m>.{schema,service,handlers,routes,errors,index}.ts`. Repository hanya ditambahkan jika modul butuh.
- Modul diimpor hanya lewat `index.ts`. Lint menolak impor ke file internal modul lain.
- Semua app dan middleware Hono dibuat lewat factory di `service-kit`. `new Hono()` langsung dilarang lint.
- Service melempar subclass `DomainError`. `onError` terpusat memetakannya ke HTTP dengan bentuk error tunggal.
- Urutan middleware: `requireSession → requirePermission(resource, action) → validator`.
- drizzle-zod menjadi satu sumber skema. Skema validasi request diturunkan dari skema tabel.
- Env divalidasi saat startup. Service gagal start jika env kurang.

### Guardrail

- AGENTS.md per workspace, di-symlink ke CLAUDE.md. Root di bawah 150 baris.
- oxlint dengan aturan anti-slop versi ramping, aturan batas modul, dan larangan service mengimpor kode service lain (hanya lewat `packages/*`).
- Hook agent yang menolak edit file hasil generate (`packages/api-client`, spec OpenAPI).
- `git push` tidak pernah di-pre-allow di `.claude/settings.json`.
- Scaffolder `bun run new:service` dan `bun run new:module`, beserta checklist modul.

## 14. Strategi test

Prinsipnya sedikit test, tapi setiap test menangkap bug nyata. Tidak ada test yang hanya mengulang implementasi.

| Level | Isi | Alat |
|---|---|---|
| Unit | Hanya aturan domain murni: transisi state machine, aturan view dan dedupe, ambang fan-out, kalkulasi ladder rendisi, parsing cursor | `bun test` |
| Integrasi | Endpoint service terhadap Postgres dan Redis asli: transaksi, outbox, consumer idempoten, permission | `bun test` + Compose profile `core` |
| Kontrak | Breaking change OpenAPI, skema event `contracts` cocok dengan producer | oasdiff, test skema |
| Pipeline | Job Flink SQL dengan input tetap dan output agregat yang diharapkan, termasuk input duplikat dan terlambat | `tools/flink-test.ts`: menulis fixture ke topic di profile `stream`, menjalankan job lewat SQL runner, lalu membandingkan isi topic output |
| E2E | Journey inti: daftar → upload → siap → tonton → like dan subscribe → muncul di feed subscriber | Playwright (web), Maestro (mobile, mulai M6) |
| Load | Skenario penonton bersamaan, upload paralel, lonjakan video viral | k6 dari mesin terpisah terhadap prod |

Tidak ada test komponen UI di jsdom atau happy-dom. Logika UI dipindah ke fungsi murni lalu diuji di level unit.

Semua test jalan di CI. Lane dipilih berdasarkan diff, mengikuti pola fikes.

## 15. Infra dan operasional

### Lingkungan

| Lingkungan | Isi |
|---|---|
| `local` | Docker Compose dengan profile. `core`: Postgres, `redis-cache`, `redis-durable`, Redpanda (mode dev), MinIO, Meilisearch, Kong (DB-less), service yang sedang dikerjakan. `media`: tambah transcode-svc. `stream`: tambah Flink dan Scylla. `obs`: tambah VictoriaMetrics, VictoriaLogs, Tempo, Grafana. Playback lokal: `video-svc` dengan flag dev mengembalikan URL MinIO presigned langsung, tanpa Worker. Logika Worker `media-edge` diuji dengan `wrangler dev` terhadap bucket R2 dan namespace KV khusus dev. |
| `prod` | k3s satu node di dedicated server. Video di R2, CDN Cloudflare di depan R2 dan Kong. |
| `preview` | Namespace kecil untuk service versi uji yang dicoba terhadap infra prod. Tidak menggandakan Postgres, Redpanda, Flink, atau Scylla, karena RAM tidak cukup. Load test dijalankan dari mesin terpisah terhadap prod dengan data sintetis yang ditandai, di luar jam demo. |

Tidak ada staging permanen karena RAM satu server tidak cukup. Keputusan ini dicatat di ADR.

### Anggaran RAM satu node (perkiraan, diukur ulang di M3 dan M7)

Redpanda dan Scylla secara default mengambil seluruh RAM, jadi setiap komponen diberi batas memori eksplisit.

| Komponen | RAM | Thread | Catatan |
|---|---|---|---|
| OS dan k3s | 3 GB | 1 | k3s butuh minimal 2 GB |
| Postgres dan PgBouncer | 3 GB | 2 | |
| `redis-cache` dan `redis-durable` | 1,5 GB | 1 | `redis-durable` dengan alert memori |
| Redpanda | 4,5 GB | 2 | Panduan Redpanda: minimal sekitar 2,2 GiB per core |
| Flink session cluster (operator, JobManager, TaskManager) | 6 GB | 3 | Satu cluster untuk semua job, state backend RocksDB |
| ScyllaDB | 6 GB | 2 | `--memory` dan `--smp 2` eksplisit, mode developer di bawah rekomendasi produksi |
| Meilisearch | 1,5 GB | 1 | |
| Kong | 0,5 GB | 1 | |
| 12 service dan web | 3 GB | 2 | |
| Transcode (2 worker) | 6 GB | 14 | 7 thread per worker |
| Observability | 3 GB | 2 | |
| Argo CD | 1,5 GB | 1 | |
| **Total** | **±39,5 GB** | **32** | Sisa sekitar 24 GB RAM untuk lonjakan dan cache halaman. CPU penuh saat transcode berjalan, jadi worker transcode diberi prioritas lebih rendah (CPU request kecil, limit tinggi) supaya API tetap responsif |


### CI/CD

- GitHub Actions dengan lane per diff: lint, typecheck, unit + integrasi, oasdiff, E2E (untuk perubahan yang menyentuh journey inti), build image.
- Image dibangun hanya untuk service yang berubah, ditandai dengan SHA commit, lalu di-push ke GHCR.
- Argo CD di cluster menyinkronkan `infra/helm` dan `infra/argocd`. CI meng-update tag image di repo, lalu Argo yang menerapkannya. Rollback dilakukan dengan revert commit tag.
- Action di workflow dikunci per SHA.

### Observability

| Kebutuhan | Alat |
|---|---|
| Metrics | VictoriaMetrics single-node + vmagent |
| Log | VictoriaLogs |
| Trace | Tempo (VictoriaTraces dicek kematangannya di M7) |
| Dashboard | Grafana |
| Error | Sentry free tier |
| Pengumpul | OpenTelemetry Collector |

NetworkPolicy mengizinkan vmagent dan OTel Collector dari namespace observability menjangkau port metrik setiap service.

Dashboard wajib:

- RED (rate, error, durasi) per service
- Lag consumer Redpanda per group
- Kedalaman dan umur antrean transcode
- Rasio cache hit CDN
- Burn rate SLO

### Secret

- SOPS + age. Secret terenkripsi disimpan di git dan didekripsi Argo CD lewat ksops. ksops butuh `kustomize.buildOptions: --enable-alpha-plugins --enable-exec` dan repo-server yang di-patch, dan hanya bekerja dengan Kustomize. Karena itu secret dikelola di Argo CD Application berbasis Kustomize yang terpisah dari chart Helm.
- Kunci age tidak pernah masuk repo.
- Di lokal: `.env` yang di-gitignore, divalidasi skema env saat startup.

### Backup

- Hanya CronJob `pg_dump` harian ke R2 dengan retensi 7 hari, aktif sejak prod pertama kali jalan di M1.
- Video di R2 tidak dibackup terpisah.
- Tabel agregat Scylla bisa dibangun ulang dengan mengosongkan tabel lalu memutar ulang topic agregat (`metrics.video_totals.v1` dan lainnya). Topic itu di-compact dengan key gabungan, jadi nilai terakhir setiap baris tetap tersimpan. Progress dan history per user tidak bisa dibangun ulang, karena tidak lewat topic. Heartbeat mentah hanya disimpan 7 hari.
- Risiko ini diterima dan dicatat di ADR.

## 16. Keamanan

Threat model ringan ditulis di M7. Risiko yang sudah terlihat dan kontrolnya:

| Risiko | Kontrol |
|---|---|
| File upload berbahaya atau bukan video | ffprobe di sandbox worker sebelum diproses, batas ukuran dan durasi, worker tanpa akses jaringan selain R2, Redis (BullMQ), dan Redpanda |
| Penyalahgunaan presigned URL upload | URL per part dengan TTL 15 menit, ukuran part dibatasi, sesi terikat ke user dan `videoId` |
| Hotlinking dan scraping video | Token HMAC di manifest dengan TTL 5 menit, token di setiap request untuk video private, epoch visibilitas di Worker, rate limit di Kong |
| Konten melanggar hak cipta | Report dengan alasan `copyright`, takedown admin, keberatan owner. Halaman kebijakan sederhana di web. Content ID otomatis di luar scope |
| Spam view dan bot | Dedupe view per identitas per 24 jam, rate limit heartbeat per sesi, validasi lompatan posisi |
| Spam komentar dan report | Rate limit per user, user yang di-ban tidak bisa menulis |
| Akses lintas service | DB role per schema, projected ServiceAccount token per audience, token user tidak diteruskan antar-service, NetworkPolicy: port publik hanya dari Kong, port `/internal` hanya dari service |
| Kebocoran secret | SOPS, tidak ada secret di image atau log, scan secret di CI |

## 17. Dokumen dan ADR

### Dokumen yang diproduksi

| Dokumen | Kapan | Isi |
|---|---|---|
| System design doc | Draft di M0, final di M9 | Requirement, capacity math skala YouTube, arsitektur, scale path, multi-region, DRM, moderasi otomatis |
| ADR | Ditulis saat keputusan dibuat | Format: konteks, opsi, keputusan, konsekuensi |
| PRD ringan per milestone | Awal setiap milestone | 1 sampai 2 halaman: tujuan, user story, acceptance criteria, di luar scope |
| ERD dan state machine | M0, di-update per milestone | Diagram per schema |
| Event catalog | M0, di-update per milestone | Tabel topic, producer, consumer, payload, key |
| OpenAPI | Generated | Dari kode, ditampilkan lewat Scalar |
| SLO doc | M7 | Target, cara ukur, error budget |
| Load test report | M7 | Skrip k6, hasil, analisis bottleneck |
| Threat model | M7 | Aset, ancaman, kontrol |
| Runbook | M7 | Transcode macet, lag consumer, disk penuh, restore `pg_dump`, rotasi kunci JWT |
| Test strategy | M0 | Ringkasan bagian 14 |
| Changelog | Akhir setiap milestone | Release notes |
| Postmortem | Jika terjadi insiden | Kronologi, penyebab, perbaikan |

### Daftar ADR awal

| No | Judul | Milestone |
|---|---|---|
| 001 | Microservices sesuai diagram dengan Postgres satu schema per service. Menulis risiko "microservice premium", pengalaman dari Seapedia (4 service, belum di k8s), dan trade-off satu domain kegagalan Postgres yang di Seapedia sengaja ditinggalkan | M0 |
| 002 | Monorepo Bun + Turborepo, tanpa Nx | M0 |
| 003 | Redpanda menggantikan Apache Kafka | M0 |
| 004 | Transactional outbox (relay tunggal, filter xmin) dan consumer idempoten wajib | M0 |
| 005 | REST + OpenAPI + hey-api, bukan gRPC | M0 |
| 006 | Better Auth di identity-svc: JWT ES256 10 menit `aud=viora-api`, keypair dari SOPS, denylist sinkron. Token service dari projected ServiceAccount | M0 |
| 007 | Kong 3.9.x OSS DB-less sebagai gateway (keputusan user, mengikuti Seapedia): versi di-pin, konfigurasi di-generate, token per audience diganti NetworkPolicy, collapsing pindah ke service-kit | M0 |
| 008 | TanStack Start untuk web | M0 |
| 009 | BullMQ untuk job transcode, bukan Kafka | M1 |
| 010 | HLS CMAF saja, tanpa DASH, ladder H.264 | M1 |
| 011 | Upload multipart presigned langsung ke R2 | M1 |
| 012 | Cloudflare R2 di belakang Worker `media-edge`: token HMAC dan epoch visibilitas | M1 |
| 013 | k3s satu node di dedicated server, tanpa staging permanen | M1 |
| 014 | GitHub Actions + Argo CD | M1 |
| 015 | Like dan dislike di social-svc, bukan metrics-svc | M2 |
| 016 | Feed hybrid dengan ambang fan-out 10.000 subscriber | M2 |
| 017 | Syarat view dan dedupe 24 jam di metrics-svc (Redis), agregasi Flink SQL tanpa window event-time di satu session cluster, dedupe `eventId` dengan hint `STATE_TTL`, satu topic per agregat dengan key `raw`, urutan tulis dari offset Kafka | M3 |
| 018 | ScyllaDB source-available (versi di-pin, free tier) dengan agregat absolut dan `USING TIMESTAMP`, tanpa ClickHouse | M3 |
| 019 | cdc-svc sebagai sinkronisasi interval dari topic agregat, bukan CDC Scylla | M3 |
| 020 | Meilisearch untuk search | M4 |
| 021 | VictoriaMetrics dan VictoriaLogs, bukan Prometheus dan Loki | M0 |
| 022 | Backup hanya `pg_dump` harian sebagai risiko yang diterima | M1 |
| 023 | SOPS + age untuk secret | M1 |
| 024 | Retry bertahap (dalam proses, lalu topic retry tertunda) dan DLQ per consumer group | M0 |
| 025 | Penyedia email transaksional | M0 |
| 026 | Client Kafka dan runtime proses Kafka (Bun atau Node) | M0 |
| 027 | Evolusi skema event: cek kompatibilitas di CI, tanpa registry | M0 |
| 028 | Policy panggilan sinkron: timeout, satu lapis retry, deadline, breaker terbatas. Panggilan sinkron baru wajib menjelaskan kenapa proyeksi lokal tidak cukup (pelajaran Seapedia) | M0 |
| 029 | Dua Redis: `redis-cache` (boleh eviction) dan `redis-durable` (`noeviction`: BullMQ, denylist, state view) | M1 |
| 030 | Versi state di payload event dan penjaga versi di proyeksi | M0 |

## 18. Roadmap M0 sampai M9

Setiap milestone diawali PRD ringan dan diakhiri demo, changelog, serta ADR yang terkait.

### M0. Fondasi

Deliverable:

- Monorepo dengan semua folder `apps` dan `packages` dari bagian 13. Service yang belum dikerjakan cukup berupa skeleton dari scaffolder.
- `service-kit`: factory, DomainError, verifikasi token user dan service (issuer dev untuk lokal), klien internal dengan policy timeout, retry, dan deadline, OTel dengan propagasi lewat header Kafka, outbox relay (leader advisory lock, filter xmin), consumer idempoten, DLQ per group.
- Trigger outbox `identity.user` dan `identity.channel` dengan pemetaan kolom ke event, `state_version` user, dan penulisan eksplisit `user.deleted` di `DELETE /v1/me`.
- Keyring kustom Better Auth dari keypair ES256 di SOPS (spike: plugin tidak membuat kunci sendiri), trigger outbox di `identity.user` dan `identity.channel`, `tools/kong-config.ts` dengan kelas route `public`, `optional`, dan `required` serta penolakan route bawaan admin.
- Spike client Kafka: `@platformatic/kafka` di Bun terhadap Redpanda (produce, consumer group, rebalance, producer idempoten). Hasilnya menentukan runtime proses Kafka (ADR 026).
- CI cek kompatibilitas JSON Schema event terhadap `main`.
- `contracts`: envelope dan skema event untuk M1.
- `identity-svc` di belakang Kong jalan: daftar, login, verifikasi email dan reset password lewat penyedia email, `GET /v1/me`.
- `apps/web` dengan TanStack Start: halaman login dan shell aplikasi.
- Compose profile `core` dan `obs`.
- CI lane: lint, typecheck, test, oasdiff.
- AGENTS.md, `owners.md`, aturan lint batas modul, hook pelindung file generate.
- Dokumen: system design doc v1 (termasuk model biaya), ADR 001 sampai 008, 021, 024 sampai 028, 030, event catalog v1, test strategy.

Exit criteria:

- Login dari web lewat Kong berhasil di lokal.
- Mobile (atau script uji) bisa mendapat JWT dari `/v1/auth/token` dengan sesi Expo.
- Trace satu request terlihat di Tempo, dari Kong sampai identity-svc.
- CI hijau di branch pertama.

### M1. Upload, transcode, playback

Deliverable:

- Gate di awal M1: konfirmasi tertulis dari Cloudflare (dukungan atau docs) bahwa menyajikan video lewat Worker dengan binding R2 termasuk layanan Developer Platform yang diizinkan. Kalau tidak bisa dikonfirmasi, playback pindah ke Bunny CDN di depan R2 sebelum `video-svc` dibangun.
- Spike di awal: Worker `media-edge` dengan token HMAC, epoch, cache isolate, dan pengukuran rambatan KV, throughput FFmpeg di server target, perilaku stalled job BullMQ saat worker dimatikan, discovery OIDC ServiceAccount di k3s.
- Validasi output HLS dengan `mediastreamvalidator` Apple: segmen 4 detik dengan GOP 2 detik yang selaras IDR, tag `AVERAGE-BANDWIDTH` dan `FRAME-RATE`, I-frame playlist. Kalau FFmpeg saja tidak memenuhi, packaging pindah ke Shaka Packager.
- `upload-svc`, `video-svc`, `transcode-svc` dengan state machine lengkap, termasuk `failed`, `abandoned`, `deleted`, dan retry per generasi.
- R2 di belakang Worker `media-edge`.
- Halaman upload (dengan resume) dan halaman tonton SSR dengan hls.js.
- Server produksi: k3s, Argo CD, SOPS, image GHCR, domain di Cloudflare, CronJob `pg_dump` harian.
- ADR 009 sampai 014, 022, 023, dan 029.

Exit criteria:

- Video 10 menit 1080p yang di-upload di prod bisa ditonton lewat CDN dengan ABR.
- Waktu transcode tercatat dan dibandingkan dengan target SLO.
- Upload yang diputus di tengah bisa dilanjutkan.
- Video private tidak bisa diakses tanpa hak.
- Mengubah video public ke private membuat URL lama ditolak dalam ≤2 menit (rambatan KV ditambah cache isolate 10 detik), dengan angka nyata dari pengukuran.

### M2. Sosial dan feed

Deliverable:

- `social-svc`: subscribe (dengan toggle `notify`), like dan dislike, komentar bertingkat, report.
- `feed-svc`: feed subscription hybrid, trending versi awal berbasis like dan kebaruan.
- `notification-svc` versi awal: proyeksi kartu, tabel `notification` dan `delivery`, dan sender email untuk undangan video private. In-app dan push menyusul di M4.
- Visibilitas lengkap dengan allowlist lewat email (termasuk undangan untuk email yang belum terdaftar), takedown admin, unblock, keberatan owner, resolve report, ban user.
- Halaman `/admin` di `apps/web`.
- Helper `canView` dan proyeksi visibilitas untuk komentar dan reaksi di video private.
- Jumlah subscriber channel (`channel_subscriber_count`).
- Halaman channel, beranda, panel komentar.
- E2E Playwright untuk journey inti pertama.
- ADR 015 dan 016.

Exit criteria:

- Video baru dari channel kecil muncul di feed subscriber dalam 5 detik.
- Channel di atas ambang memakai mode pull, dan hasil feed-nya tetap benar.
- Video yang diubah ke private hilang dari feed. Video yang di-unblock kembali ke feed.

### M3. Pipeline metrics

Deliverable:

- Spike awal: semantik job Flink SQL dengan data sintetis (lihat §19).
- `metrics-svc` (ingest heartbeat dengan pengayaan dan IP asli, penilaian view per sesi dan dedupe di `redis-durable`, progress dan history ke Scylla, proyeksi `video_meta`, writer agregat dengan `USING TIMESTAMP`, API baca, metrik TTFF), Flink session cluster dengan job `totals` dan `daily` (agregat per video dan per channel per hari), Scylla, `cdc-svc`.
- Angka views dan watch time dari pipeline. Like, dislike, dan komentar dari social-svc lewat `engagement.counts_changed`. Resume playback dan watch history.
- Trending memakai pertumbuhan views.
- Compose profile `stream`.
- ADR 017 sampai 019.

Exit criteria:

- View count ter-update dalam 2 menit.
- Refresh berulang dari user yang sama tidak menambah view.
- Restart job Flink dari checkpoint tidak membuat angka views dobel.
- `video_stats` di Postgres sama dengan Scylla dalam 2 menit.

### M4. Search, library, notifikasi

Deliverable:

- `search-svc` dengan Meilisearch, halaman search dengan debounce.
- Playlist dan watch later, halaman history.
- `notification-svc`: notifikasi in-app untuk upload baru dari channel yang di-subscribe dan untuk balasan komentar.
- Hapus akun (`DELETE /v1/me`) dengan event `user.deleted` yang diproses semua service.
- ADR 020.

Exit criteria:

- Video baru bisa dicari dalam 10 detik setelah `ready`.
- Video yang diubah ke private atau di-block hilang dari hasil search.
- Akun yang dihapus tidak menyisakan data pribadi di tabel operasional mana pun (Postgres, Scylla, Meilisearch), sesuai matriks pembersihan di §10. Yang hilang sendiri setelah retensinya habis: topic retry dan DLQ (14 hari), `invite_delivery` (14 hari setelah terkirim), `video_access_invite` yang tidak cocok (30 hari), kunci dedupe view (24 jam) dan state sesi view (6 jam) di Redis, outbox (7 hari), log Redpanda `identity.v1`, `video.v1`, `social.v1`, dan heartbeat (7 hari), `pg_dump` (7 hari). `identityHash` di `metrics.views.v1` tidak bisa dikaitkan lagi setelah kuncinya dimusnahkan (37 hari). Ini ditulis di kebijakan privasi.
- Notifikasi muncul untuk subscriber yang mengaktifkan `notify`.

### M5. Rekomendasi dan analytics creator

Deliverable:

- Job Flink `co_watch`, proyeksi `related_video` di `feed-svc`, `GET /v1/feed/recommended` dan related videos, cold start ke trending.
- Event `view.progress_bucket`, job Flink `retention`, agregat per (`channelId`, `month`, `videoId`), tabel `retention_by_video` dan `views_by_channel_video_month`, analytics khusus owner.
- Studio analytics dengan TanStack Charts: views per hari, watch time, subscriber, video teratas.
- Sebelum mulai: baca docs TanStack Charts lewat Context7 dan skill chart yang terpasang.

Exit criteria:

- Dashboard analytics menampilkan data nyata dari Scylla untuk rentang 7 dan 28 hari.
- Rekomendasi berbeda antar user yang punya history berbeda.

### M6. Mobile

Deliverable:

- Aplikasi Expo: login, beranda, tonton, upload, komentar, subscribe, notifikasi push.
- `design-tokens` dipakai web dan mobile.
- Spike di awal: upload saat app di-background, pool player expo-video di FlashList.
- Konvensi mobile dari bagian 12, `eas.json` tiga profil, flow Maestro untuk pilih, upload, dan putar.

Exit criteria:

- Build development berjalan di simulator iOS dan Android.
- Push notification diterima di perangkat dan membuka video yang tepat.
- Upload dari galeri sampai `ready` berhasil, termasuk setelah koneksi putus di tengah.
- Scroll feed panjang tidak menahan lebih dari satu player aktif.

### M7. Hardening

Deliverable:

- Load test k6 dari mesin terpisah (runner GitHub Actions atau laptop), bukan dari node prod, supaya CPU runner tidak mengganggu hasil. Target prod dengan data sintetis: 500 penonton bersamaan, 10 upload paralel, skenario video viral. Pemakaian RAM dan CPU per komponen dibandingkan dengan anggaran di §15.
- SLO doc, dashboard Grafana wajib, alert burn rate.
- Threat model, runbook (termasuk replay DLQ dan rebuild Scylla).
- Evaluasi VictoriaTraces vs Tempo.

Exit criteria:

- Semua SLO di bagian 3 terpenuhi di load test, atau bottleneck-nya terdokumentasi dengan rencana perbaikan.
- Satu restore `pg_dump` pernah dicoba ke database sementara di instance Postgres prod, lalu dihapus.

### M8. Stretch

Deliverable:

- `live-svc`: ingest RTMP lewat MediaMTX, output LL-HLS lewat Worker `media-edge`, rekaman live menjadi video VOD (`live.ended` → `live → uploaded`), jumlah penonton, rotasi stream key.
- Simulasi monetisasi: slot iklan mock di player dan laporan revenue share di studio analytics.

Exit criteria:

- Siaran dari OBS bisa ditonton di web dengan latensi di bawah 5 detik.

### M9. Packaging portofolio

Deliverable:

- README dengan cara menjalankan lokal dan link demo.
- System design doc final dan diagram arsitektur final.
- Video demo dan tulisan ringkas yang menjelaskan keputusan utama, angka load test, dan hal yang akan diubah di skala nyata.
- Repo dipublikasikan di akun `sayyidrafeed` (atas perintah eksplisit).

Exit criteria:

- Orang lain bisa menjalankan profile `core` dari README tanpa bantuan.

## 18A. Penilaian kesiapan (setelah review berulang)

Dokumen ini melewati delapan ronde review independen, masing-masing oleh reviewer baru yang tidak membawa konteks ronde sebelumnya (revisi 6 sampai 13). Hasil per ronde:

| Ronde | Confidence (dokumen) | Temuan High |
|---|---|---|
| 1 | 5 sampai 6 | 11 |
| 2 | 6 | 8 |
| 3 | 5 sampai 6 | 10 |
| 4 | 6 sampai 7 | 5 |
| 5 | 7 | 2 |
| 6 | 7 | 1 |
| 7 | 7 | 3 |
| 8 | 6 (7,5 setelah spike) | 3 |

Temuan bergeser dari kesalahan desain besar (pipeline metrics, autentikasi, kunci Kong) ke kasus pinggir konkurensi dan retensi. Reviewer terakhir menyimpulkan bahwa review dokumen hampir tidak menemukan hal baru. Cara tercepat menaikkan confidence adalah menjalankan spike dan walking skeleton tipis dengan test konkurensi, bukan menambah review.

Target 9/10 tidak bisa dicapai di atas kertas. Sisa ketidakpastian ada di hal yang hanya bisa dibuktikan dengan menjalankannya:

| Spike | Milestone | Yang dibuktikan |
|---|---|---|
| `@platformatic/kafka` di Bun | M0 | Produce, consumer group, rebalance, idempoten |
| Keyring kustom Better Auth, `/v1/auth/token` dari Expo, ES256 + `kid` di Kong | M0 | Rantai autentikasi |
| Walking skeleton: satu event dari outbox lewat Redpanda ke consumer dengan retry, DLQ, dan test balapan consumer utama vs retry | M0 | Aturan §6 di kode, termasuk efek eksternal |
| Ketentuan Cloudflare, Worker + KV (rambatan nyata, cache isolate), discovery OIDC k3s, FFmpeg + `mediastreamvalidator`, stall BullMQ | M1 | Media dan infra |
| Flink: `STATE_TTL` dedupe, `jarURI` session job, kunci `raw`, timestamp offset di Scylla | M3 | Pipeline metrics |
| expo-video error handling, upload saat background | M6 | Mobile |

Perkiraan: kalau spike M0 dan M1 berhasil tanpa mengubah desain, confidence naik ke sekitar 8/10. Setelah spike M3 dan walking skeleton lolos test konkurensi, sekitar 9/10.

### Hasil spike M0 (2026-10-29)

Semua dijalankan di Bun 1.4.4 terhadap Redpanda v26.2.6, Postgres 17.11, dan Kong 3.9.4 di Compose profile `core`.

| Spike | Hasil | Bukti | Belum dibuktikan |
|---|---|---|---|
| `@platformatic/kafka` 2.14.0 di Bun | Lolos, 5/5 test, dua kali berturut-turut. Producer dengan `idempotent: true` mendapat `producerId` dari broker dengan `acks=all` (dedupe saat retry kirim tidak diuji langsung), header `traceparent` ikut terkirim, rebalance saat member masuk dan keluar, restart melanjutkan dari offset committed, dan handler yang menunggu 12 detik (lebih lama dari `sessionTimeout` 10 detik) tidak membuat member dikeluarkan. Keputusan ADR 026: proses Kafka jalan di Bun, fallback Node tidak dibutuhkan | `spikes/kafka-bun` | Dedupe producer saat retry kirim, broker restart dan pemulihan koneksi, throughput, berjalan berhari-hari |
| Keyring Better Auth 1.7.14 + Kong | Lolos, 12/12 test. `adapter.getJwks` menyuplai kunci ES256 dari file PEM, `createJwk` dibuat melempar error supaya plugin tidak pernah membuat kunci, dan tabel `jwks` tetap kosong. `disablePrivateKeyEncryption: true` wajib, karena kunci datang dari SOPS dalam bentuk mentah. Plugin memilih kunci dengan `createdAt` terbaru, jadi keyring memberi kunci aktif `createdAt` paling baru. Token berisi `kid` aktif, `aud=viora-api`, umur 600 detik, dan tanpa email. Kong menerima token dari Better Auth (membaca `kid` dari header JWT) dan menjawab 401 untuk signature rusak, `kid` yang belum terdaftar, token kedaluwarsa, dan route `required` tanpa token. Dua `kid` terdaftar bersamaan (rotasi) diterima keduanya. Test hanya mengecek status 401, bukan alasannya di log Kong. Suite ini menimpa konfigurasi deklaratif Kong lokal lewat admin API. Route `optional` meneruskan token palsu sebagai anonim, jadi aturan 401 di `service-kit` memang wajib | `spikes/auth-keyring` | `/v1/auth/token` dari sesi `@better-auth/expo`, adapter Drizzle + trigger outbox identity |
| Walking skeleton | Lolos, 9/9 test, stabil di beberapa run berturut-turut. Latensi outbox ke proyeksi ±60 ms dengan polling 50 ms (satu sampel per run, bukan pengukuran beban). Filter xmin menahan transaksi yang commit lebih awal sampai transaksi yang mulai lebih dulu selesai, lalu mengirim keduanya sesuai urutan xid. Advisory lock hanya memberi satu leader (diuji dua relay dalam satu proses). Kalau pengiriman ke topic retry gagal, consumer berhenti tanpa commit dan `ready` menjadi false, lalu consumer pengganti menerima pesan yang sama. Tiga test dibuktikan lewat mutasi: tanpa penjaga versi, test event basi di retry gagal; tanpa klaim `processed_events`, test event ganda bersamaan gagal; tanpa penanda fatal, test kegagalan kirim ke retry gagal. Penjaga versi ada di handler proyeksi (milik tiap consumer), bukan di `service-kit`, dan efek eksternal di test berupa store di memori dengan penjaga versi | `packages/service-kit` (`outbox.ts`, `consumer.ts`, `test/walking-skeleton.test.ts`) | `dlq:replay` dan `dlq:skip`, purge `processed_events` dan outbox, propagasi span OTel, Drizzle (skeleton memakai `Bun.SQL`), leader relay lintas proses dan saat koneksi putus, gangguan broker dan Postgres |

Temuan yang mengubah rencana:

- Partitioner `compatibilityPartitioner` wajib di semua producer (ditambahkan di §6, Producer).
- Payload `data` harus divalidasi per tipe event sebelum handler dipanggil. Di skeleton, event dengan `data` yang salah bentuk melewati retry dulu sebelum masuk DLQ, karena hanya envelope yang divalidasi. Kegagalan validasi skema `data` harus menjadi `PermanentError` supaya langsung ke DLQ (sesuai §6).
- Klaim `processed_events` dilakukan di awal transaksi (`insert ... on conflict do nothing returning`). Pengiriman kedua yang bersamaan menunggu di unique index sampai yang pertama commit, lalu dilewati. Efek eksternal tetap jalan di dalam transaksi sebelum commit.
- Relay melepas advisory lock secara eksplisit sebelum koneksi reserved kembali ke pool. Kalau tidak, lock ikut terbawa ke koneksi pool.
- Loop consumer yang gagal memindahkan pesan ke retry atau DLQ, atau gagal commit, berhenti tanpa commit dan menandai diri tidak sehat. Probe Kubernetes memakai penanda ini, jadi pod di-restart dan pesan dikirim ulang dari offset terakhir. Review verifier menemukan versi awal skeleton diam-diam berhenti consume dalam kasus ini.
- Relay ikut tertahan oleh transaksi panjang atau `idle in transaction` di mana pun dalam database yang sama, karena xmin bersifat global. Butuh `idle_in_transaction_session_timeout` per role dan alert umur baris outbox tertua (M7).

Keputusan terbuka: `service-kit` saat ini memakai `Bun.SQL`, sedangkan rencana memakai Drizzle. Penulisan outbox harus bisa jalan di transaksi Drizzle (driver `bun-sql`). Ini diputuskan saat identity-svc dibangun.

### Hasil identity-svc M0 (2026-10-29)

Diuji di Postgres 17, Redis 8.6, dan Redpanda asli. Test integrasi memakai database baru per run: 10/10 lolos, tiga kali berturut-turut, dan diulang verifier independen. Setelah review verifier ditambah tiga test regresi (13 total). Ketiganya baru lolos typecheck dan belum dijalankan, karena infra lokal sedang dimatikan. Ditambah satu smoke test proses nyata: identity-svc dijalankan sebagai server dengan relay aktif. Daftar lewat HTTP menghasilkan `user.registered` di topic `identity.v1`, diterima `EventConsumer` dengan validasi data per tipe, dalam 176 ms (satu sampel).

| Bagian | Hasil | Belum dibuktikan |
|---|---|---|
| Drizzle + Better Auth | Adapter Drizzle (`bun-sql`) dengan schema `identity`, plugin admin, Expo, dan JWT keyring. Id user UUIDv7. Daftar, verifikasi email, login (ditolak 403 sebelum verifikasi), reset password, dan `/v1/auth/token` dengan klaim `ev` jalan | Login Google (butuh kredensial), penyedia email nyata (ADR 025, sementara log) |
| Trigger outbox | `user.registered` (tanpa email), `user.email_verified`, `user.profile_updated` dengan `stateVersion` dari trigger, `user.banned` (alasan, kedaluwarsa), `user.unbanned`, `channel.created`, `channel.updated` (hanya kolom publik). Login ulang dan perubahan deskripsi channel tidak mengirim event. Transaksi yang batal tidak meninggalkan event. Setiap payload di test diparse dengan skema `contracts` | Job rekonsiliasi harian |
| `DELETE /v1/me` | Denylist ditulis dulu, lalu user, sesi, dan channel terhapus, dan `user.deleted` + `channel.deleted` ditulis di satu transaksi. Token lama langsung 401 `account_banned`, TTL denylist ≤ 600 detik | Pembatalan denylist saat transaksi gagal (hanya dicek verifier dengan fake), baris `verification` milik email user tidak ikut dihapus (kedaluwarsa sendiri) |
| `/v1/me` dan verifikasi token di `service-kit` | Tanpa token 401 `unauthorized`, token rusak 401 `invalid_token`. Algoritma di-pin ES256, `kid` asing ditolak, `exp` dan `sub` wajib | Reload kunci saat file berubah (rotasi langkah 1), denylist di route `optional` (benar di kode, belum ada test) |
| Spike token Expo | Meniru `@better-auth/expo` 1.7.14 sesuai source kliennya: `credentials: omit`, cookie dikirim manual, `expo-origin: viora://`. Login tanpa header Origin dan `/v1/auth/token` dengan cookie tersimpan menghasilkan JWT yang diterima `/v1/me`. POST yang membawa cookie dengan scheme lain, atau origin browser asing, ditolak 403 | `fetch` React Native membaca `set-cookie` di perangkat (M6) |

Temuan yang mengubah rencana:

- **Better Auth 1.7.14 mematikan origin check dan CSRF check secara default saat `NODE_ENV=test` atau `TEST=true`.** `bun test` men-set `NODE_ENV=test`, jadi test CSRF lolos padahal tidak ada pemeriksaan. Pod yang tidak sengaja jalan dengan env itu juga akan terbuka. `advanced.disableOriginCheck: false` dikunci di konfigurasi, dan ada test yang membuktikan origin asing ditolak.
- Origin hanya diperiksa untuk request yang membawa cookie. Sign-in tanpa cookie tidak dicek; itu semantik CSRF Better Auth, bukan celah.
- Validasi schema Better Auth 1.7 menuntut tabel `jwks` walaupun kunci datang dari keyring. Tabel dibuat dengan constraint `check (false)`, jadi setiap upaya menyimpan kunci ke database gagal di Postgres. Validasi schema tetap aktif untuk mendeteksi drift.
- Urutan outbox di dalam satu transaksi memakai kolom `seq`, karena UUIDv7 dari fungsi SQL tidak monoton di dalam milidetik yang sama (test `DELETE /v1/me` sempat gagal acak). Urutan di tabel sudah dibuktikan, tapi urutan publish oleh relay ke Kafka untuk transaksi multi-event belum diuji.
- `EventConsumer` membuat sendiri topic `retry.<group>.<topic>` dan `dlq.<group>.<topic>` dengan retensi 14 hari saat start, karena topic itu milik group.
- Keputusan terbuka Drizzle vs `Bun.SQL` selesai: kode aplikasi dan `writeOutbox` memakai Drizzle (`bun-sql`), sedangkan relay memakai koneksi `Bun.SQL` reserved untuk advisory lock.
- Port service lokal digeser ke 13001–13011 (port 3000-an sudah dipakai proses lain di mesin dev), konsisten dengan port infra +10000.

Perbaikan dari review verifier independen (test regresinya belum dijalankan):

- Dua `DELETE /v1/me` bersamaan: request yang kalah (404) dulu menghapus denylist milik user yang sudah dihapus, sehingga JWT yang masih berlaku lolos lagi di service lain. Sekarang denylist hanya dibatalkan kalau user masih ada.
- Body `DELETE /v1/me` dibaca tanpa bergantung pada `content-type`. Sebelumnya `{"purgeComments":true}` tanpa header itu diabaikan diam-diam, dan body kosong dengan `content-type: application/json` dijawab 400.
- Route bawaan Better Auth `/v1/auth/admin/*` dan `/v1/auth/delete-user` ditolak di identity-svc sendiri, tidak hanya di Kong. Sebelum generator Kong ada, ban lewat route admin bawaan menulis `user.banned` tanpa denylist.
- `deny` memakai TTL pengaman 1 jam, supaya proses yang mati sebelum `startExpiry` tidak mengunci user selamanya.
- `AUTH_SECRET` yang masih nilai contoh ditolak saat start. Header `bearer` huruf kecil diterima.
- Catatan tanpa perubahan:
  - `state_version` naik di setiap UPDATE, termasuk yang tidak mengirim event, jadi versi bisa melompat. Consumer hanya boleh memakai aturan "lebih baru", bukan "berurutan".
  - Urutan relay mengikuti `xid`, bukan urutan commit, jadi penjaga versi wajib di semua proyeksi.
  - Migrasi `0001` menyalin `outboxDdl` secara manual. Test pembanding keduanya belum ada.

Belum dikerjakan di M0: `tools/kong-config.ts` dan login web lewat Kong, `PATCH /v1/me`, route channel, route admin ban/unban, role database per service, OTel, `apps/web`.

Perkiraan confidence setelah spike M0: sekitar 7,5/10. Desain tidak berubah kecuali partitioner dan validasi `data`. Sisa jalan ke 8/10 adalah spike M1.

## 19. Risiko dan hal yang wajib dicek

| Risiko | Dampak | Kapan dicek | Mitigasi |
|---|---|---|---|
| Ketentuan Cloudflare (diperbarui 2026-09-28): di luar Enterprise, video lewat CDN harus memakai layanan berbayar seperti Developer Platform, Images, atau Stream. R2 dan Workers tidak disebut eksplisit | Akun bisa dibatasi | Gate awal M1 | Minta konfirmasi tertulis. Kalau tidak ada, Bunny CDN di depan R2 |
| Desain Worker `media-edge` (token HMAC, epoch di Workers KV, Cache API) belum diuji | Playback private atau pencabutan akses tidak bekerja | Spike awal M1 | Prototipe kecil sebelum membangun `video-svc` |
| Jeda rambatan Workers KV saat visibilitas berubah | Video private masih bisa diputar beberapa detik | M1 | Diterima sebagai batas, dicatat di ADR 012 |
| Harga dan spesifikasi dedicated server | Budget meleset | Sebelum M1 | Cek harga terbaru, pilih yang sesuai RAM 64 GB |
| RAM satu node tidak cukup untuk Flink, Scylla, Redpanda, Meilisearch, Kong, 12 service, dan observability | Pod di-evict | M3 dan M7 | Batas memori per pod, ukur pemakaian nyata, tunda observability berat ke `preview` jika perlu |
| Asumsi throughput transcode di CPU | SLO transcode gagal | M1 | Ukur dengan beberapa preset x264, turunkan ladder default jika perlu |
| Semantik Flink SQL: deduplikasi atas update stream, ukuran state job `totals` tanpa TTL, image SQL runner di operator | Job salah hitung atau kehabisan memori | Spike awal M3 | Data sintetis dengan input duplikat dan terlambat, state backend RocksDB, batas memori dari anggaran §15 |
| Lisensi ScyllaDB source-available | Syarat bisa berubah | M3 | Versi di-pin, lisensi dicatat di ADR 018, image resmi dipakai tanpa redistribusi |
| Biaya Workers dan KV kalau trafik demo tinggi terus-menerus | Melewati budget | M1 dan M7 | Cache isolate untuk KV, pantau tagihan, demo tidak dibuka untuk trafik terus-menerus |
| Kematangan VictoriaTraces | Pilihan trace | M7 | Tetap Tempo sampai terbukti |
| Kong OSS berhenti di 3.9.x | Tidak ada fitur baru, patch bisa berhenti | M7 dan setiap rilis | Pin 3.9.x, pantau rilis patch, jalur keluar dicatat di ADR 007 |
| Token user tidak per audience (batas plugin `jwt` OSS) | Token curian bisa dipakai ke service lain kalau NetworkPolicy salah konfigurasi | M1 | Test NetworkPolicy di CI atau `preview`: pod service tidak bisa menjangkau port publik service lain |
| `@platformatic/kafka` belum terbukti jalan di Bun | Seluruh komunikasi async tertunda | Spike M0 | Proses Kafka dijalankan di Node 24 |
| Discovery OIDC ServiceAccount k3s belum diuji di cluster | Token service tidak bisa diverifikasi | Spike M1 | TokenReview API, atau kembali ke token buatan identity-svc |
| Mesin lokal 16 GB | Dev lambat atau macet | Sepanjang proyek | Compose profile, `gated-run`, hanya jalankan profile yang dibutuhkan |
| Akun `gh` aktif berganti global ke `sayyidrafeed` | Push salah akun di proyek NalarX | Sekarang | Atur identitas git per folder di viora, atau switch kembali saat kerja NalarX |
| Scope lengkap untuk satu orang | Proyek tidak selesai | Setiap milestone | Milestone time-boxed. Fitur yang lewat waktu dipindah ke backlog lewat PRD berikutnya |

## 20. Riwayat revisi

Revisi lama tidak diedit. Kalau sebuah revisi bertentangan dengan revisi yang lebih baru, revisi yang lebih baru yang berlaku. Contohnya, `SKIP LOCKED` dan client credentials di revisi 1 dan 3 sudah diganti.

### Revisi 1, 2026-10-28

Sumber: review independen atas versi pertama dokumen ini. Klaim teknis di bawah berasal dari reviewer dengan tingkat keyakinan sedang sampai tinggi, dan wajib dikonfirmasi lewat docs resmi atau spike di milestone yang disebut.

| Perubahan | Alasan | Konfirmasi di |
|---|---|---|
| Counter Scylla dan CDC Scylla diganti agregat absolut dari Flink ke topic Redpanda, lalu writer di `metrics-svc` | CDC Scylla tidak mendukung tabel counter, counter dobel saat replay, Flink SQL tidak punya sink Scylla | Spike awal M3 |
| `cdc-svc` tetap ada sebagai sinkronisasi interval dari topic agregat | Menjaga peran "sync metrics at intervals" dari diagram tanpa CDC Scylla | M3 |
| Signed URL R2 dan signed cookie Cloudflare diganti Worker `media-edge` dengan token HMAC dan epoch visibilitas | Presigned R2 melewati cache CDN, Cloudflare tidak punya signed cookie native, layout lama tidak bisa mencabut akses segmen yang sudah ter-cache | Spike awal M1 |
| Topic heartbeat dikunci per `sessionId`, heartbeat diperkaya `channelId` | Menghindari partisi panas untuk video viral, memungkinkan agregat per channel | M3 |
| Event baru: `video.unblocked`, `subscription.updated`, `user.deleted`. Payload kartu di `video.visibility_changed` | Feed, search, dan notifikasi tidak bisa memperbarui proyeksi tanpa event ini | M0 (event catalog) |
| Aturan retry transcode per generasi, `jobId` per generasi (format final `{videoId}-{generation}` di revisi 6) | Aturan lama bertentangan dan membuat retry manual terdedupe | M1 |
| SLO transcode dipisah antara waktu proses dan waktu antre | 10 upload paralel dengan satu worker tidak mungkin memenuhi target lama | M1 |
| Token service lewat client credentials, mobile memakai `@better-auth/expo` | Plugin JWT Better Auth menerbitkan token sesi user, bukan identitas service | M0 |
| `channel` dibuat lewat `POST /internal/channels/ensure` saat video pertama | Alur lama tidak pernah membuat channel | M1 |
| Exit criteria search dipindah ke M4, trending M2 berbasis like dan kebaruan | Search baru ada di M4, metrics baru ada di M3 | M2 |
| Co-watch dihitung Flink, dikonsumsi `feed-svc` | `feed-svc` tidak punya sumber watch history | M5 |
| Ditambahkan: DLQ dan replay, relay outbox `SKIP LOCKED`, hapus akun, penyedia email, model biaya, proses hak cipta dan keberatan, `pg_dump` sejak M1 | Celah yang belum tercakup maupun dikecualikan | M0 sampai M4 |

### Revisi 2, 2026-10-28

Sumber: pembacaan repo mobile-siera dan fikes (`apps/mobile`). Konvensi mobile yang diambil, dan celah khusus aplikasi video yang harus dirancang sendiri, ditambahkan ke bagian 12. M6 mendapat spike upload background dan pool player, `eas.json` tiga profil, dan E2E Maestro. Kedua repo belum pernah di-build atau dijalankan dalam review ini.

### Revisi 3, 2026-10-28

Sumber: verifikasi komunikasi antar-service ke docs resmi. Laporan lengkap ada di `docs/verification.md`.

| Perubahan | Alasan |
|---|---|
| Token service buatan sendiri (`POST /internal/tokens`, client secret) diganti projected ServiceAccount token | Identitas bawaan platform, dirotasi otomatis, tanpa secret per service |
| Token user diberi `aud` per service, tidak diteruskan antar-service | OWASP: jangan memperlebar audience, autentikasi service terpisah dari identitas user |
| Dedupe consumer wajib untuk semua consumer | Producer idempoten hanya berlaku dalam satu sesi, duplikat tetap mungkin |
| Relay outbox tunggal dengan filter `xid8` dan xmin snapshot | Urutan UUIDv7 tidak menjamin urutan commit, relay paralel merusak urutan |
| DLQ dan replay per consumer group | Replay ke topic asal mengirim ulang ke semua group |
| Trace context di header Kafka | Spesifikasi messaging OpenTelemetry, dan konteks tetap terbaca di DLQ |
| Cek kompatibilitas JSON Schema di CI | Tanpa registry, perubahan tidak kompatibel baru ketahuan saat event di-consume |
| Policy sinkron: satu lapis retry, deadline header, breaker terbatas, ensure channel idempoten | AWS Builders' Library dan panduan deadline gRPC |
| Spike client Kafka di M0, fallback ke Node 24 | kafkajs tidak aktif, confluent-kafka-javascript tidak jalan di Bun |
| Batas pool PgBouncer per role, koneksi langsung untuk advisory lock dan LISTEN | Satu pool per role, mode transaction tidak mendukung keduanya |

### Revisi 4, 2026-10-28

Sumber: 19 temuan dari wireframe flow (`docs/flows/README.md`), diputuskan user satu per satu. Satu temuan lain (DLQ) sudah selesai di revisi 3.

| Temuan | Keputusan |
|---|---|
| 1. Takedown dan hapus tidak sampai ke media-edge | KV menyimpan `{visibility, epoch, playable}`. Block, unblock, dan delete menaikkan epoch. Worker membalas 451 atau 410 |
| 2. Allowlist tidak bisa mencari user | Undangan hanya lewat email, `video_access_invite` untuk email yang belum terdaftar, respons selalu sama |
| 3. User yang dihapus dari allowlist masih bisa menonton | Penghapusan menaikkan epoch, token private membawa `sub` |
| 4. Aksi admin tanpa endpoint, kepemilikan `appeal` | Endpoint resolve report, resolve appeal, ban/unban, hapus komentar. `appeal` pindah ke schema `video` |
| 5. Rekaman live tanpa jalur state | Transisi `draft → uploaded` dari `live.ended` |
| 6. Live, jumlah penonton, visibilitas live | Live lewat `media-edge` dan baris video, penonton dari heartbeat 30 detik di Redis |
| 7. Co-watch membocorkan video tidak public | Rekomendasi, related, dan trending hanya dari `feed.video_cards` |
| 9. Endpoint playlist wildcard | Daftar endpoint eksplisit |
| 10. Batalkan upload | `upload.cancelled` mengembalikan video ke `draft`, layar hanya "Memproses..." |
| 11. Consumer `user.deleted` | upload, search, dan live ditambahkan, aturan di `owners.md` |
| 12. Autoplay feed mobile | Manifest diambil per item yang terlihat, autoplay tanpa suara tidak dihitung view |
| 13. Jumlah subscriber dan video | `channel_subscriber_count` di social, jumlah video di endpoint video channel |
| 14. Analytics owner dan video teratas | Endpoint analytics owner, tabel `views_by_channel_video_month` |
| 15. Kurva retensi | Masuk M5, job Flink `retention`, tabel `retention_by_video` |
| 16. Halaman admin | Route `/admin/*` dijaga `role=admin` |
| 17. Deep link | Universal Links dan App Links, `viora://` sebagai fallback |
| 18. Rotasi stream key | `POST /v1/live/:id/stream-key/rotate` |
| 19. Saran search | Endpoint yang sama dengan `limit=5` |
| 20. Keputusan produk | Cold start ke trending. Komentar akun yang dihapus dianonimkan, isinya diganti hanya kalau diminta |

### Revisi 5, 2026-10-28

Sumber: keputusan user mengikuti Seapedia, ditambah riset Kong (source Kong 3.9.4, Docker Hub, docs Better Auth dan k3s).

| Perubahan | Alasan |
|---|---|
| Gateway Hono buatan sendiri diganti Kong 3.9.x OSS DB-less, Traefik dimatikan | Keputusan user. Konfigurasi deklaratif, tidak ada kode gateway yang dirawat |
| Token user diterbitkan identity-svc (plugin JWT Better Auth, 10 menit, `aud=viora-api`), diverifikasi Kong lalu diverifikasi ulang tiap service | Kong OSS tidak bisa menerbitkan token atau mengecek `aud` |
| Token per audience diganti NetworkPolicy (port publik hanya dari Kong) | Batas plugin `jwt` OSS, NetworkPolicy aktif bawaan di k3s |
| Revokasi lewat denylist Redis dari `user.banned` dan `user.deleted` | Token stateless tidak bisa dicabut di Kong |
| Rate limit per user dan request collapsing pindah ke `service-kit` | Consumer Kong adalah penerbit token, `proxy-cache` OSS tidak menggabungkan miss |
| `kong.yaml` di-generate dari kode dan JWKS, rotasi kunci manual | Plugin `jwt` OSS tidak bisa fetch JWKS |
| Retry bertahap sebelum DLQ | Keputusan user, pola Seapedia |

### Revisi 6, 2026-10-28

Sumber: ronde 1 review berulang, yaitu dua reviewer independen (konsistensi dan kebenaran teknis ke docs resmi).

| Perubahan | Alasan |
|---|---|
| Syarat view dan dedupe 24 jam dipindah ke metrics-svc (Redis). Flink hanya agregasi tanpa window event-time, job dipisah menurut TTL | Window session Flink baru keluar setelah sesi ditutup. TTL state berlaku untuk seluruh job dan akan mereset total |
| Satu topic per jenis agregat dengan key gabungan. Progress dan history langsung ke Scylla | Satu topic compacted dengan key tunggal menghapus baris harian dan menyimpan data user selamanya |
| Tulis Scylla dengan `USING TIMESTAMP` | Last-write-wins: pesan lama dari retry atau replay bisa menimpa nilai baru |
| `stateVersion` di payload `video.*`, `subscription.*`, `channel.*` dan penjaga versi di proyeksi | Retry tertunda dan replay mengacak urutan per key |
| Payload event ditulis lengkap, termasuk `ownerUserId` dan `status` di kartu video | Consumer tidak punya data untuk analytics owner, notifikasi balasan, dan filter status |
| Sync Workers KV jadi consumer `media-edge-sync` dengan retry dan DLQ | Penulisan di luar transaksi bisa hilang dan takedown tidak berlaku |
| Kunci JWT ES256 dari SOPS di-seed ke `identity.jwks`, `key_claim_name=kid`, kelas route `public`, `optional`, `required`, satu base path `/v1/auth`, route per operasi OpenAPI | `kong.yaml` tidak bisa dibuat sebelum kunci ada, rute anonim dan tabrakan path belum ditangani |
| IP asli dari `CF-Connecting-IP` lewat `trusted_ips` Kong | Di belakang Cloudflare, Kong hanya melihat IP Cloudflare |
| Denylist ditulis sinkron oleh identity-svc. Kolom ban mengikuti plugin admin Better Auth | Jeda async membuka celah. Nama kolom salah |
| Proyeksi notifikasi, kartu channel, reaksi feed. Feed disaring saat dibaca | Sumber data notifikasi, nama channel, dan trending M2 belum ada. Penghapusan dari ribuan sorted set tidak praktis |
| `jobId` BullMQ `{videoId}-{generation}`, Redis terpisah untuk BullMQ (`noeviction`) | BullMQ menolak titik dua dan butuh `noeviction` |
| Gate ketentuan Cloudflare di awal M1, validasi HLS Apple, live lewat MediaMTX sebagai origin | Ketentuan video belum menyebut R2/Workers, LL-HLS tidak bisa dilayani R2 |
| Flink 2.2.x dan konektor `5.0.0-2.2` di-pin, lisensi Scylla dicatat, anggaran RAM per komponen, server minimal 16 core, SLO antre transcode realistis | Versi, lisensi, dan kapasitas belum ditulis |
| Status `live`, jalur `abandoned` dan `failed(invalid_input)` kembali ke upload, `transcode_attempt` dihapus, ADR 021 dan 022 dipindah ke M0 dan M1 | State machine dan urutan ADR belum lengkap |

### Revisi 7, 2026-10-28

Sumber: ronde 2 review berulang (reviewer konsistensi dan reviewer teknis baru).

| Perubahan | Alasan |
|---|---|
| Outbox identity lewat trigger Postgres, bukan after-hook Better Auth | After-hook berjalan setelah commit, dan adapter Drizzle default-nya tanpa transaksi |
| Kunci JWT dari SOPS lewat keyring kustom (`adapter.getJwks`), public key di-mount ke Kong dan setiap service | Service tidak punya sumber kunci, dan port publik identity hanya bisa dijangkau Kong |
| Route bawaan Better Auth untuk admin dan hapus akun ditolak Kong. Token tidak valid dijawab 401 di semua route | Route bawaan melewati denylist dan outbox. Consumer `anonymous` menelan token yang gagal |
| `media-edge-sync` menulis state dari baris Postgres, entri KV dibuat sejak `draft` | Event lama bisa menimpa pencabutan akses, dan cache negatif KV membuat video baru tidak bisa diputar |
| Fan-out dan notifikasi di setiap transisi ke ready dan public, notifikasi subscriber hanya saat `firstPublished` | Video yang dijadikan public atau di-unblock tidak kembali ke feed |
| Helper `canView` dengan proyeksi visibilitas dan panggilan internal untuk video private | Komentar, reaksi, dan stats video private bisa diakses tanpa hak |
| `redis-durable` (`noeviction`) untuk BullMQ, denylist, dan state view. Proyeksi metrics di Scylla `video_meta` | Eviction menghapus denylist dan kunci dedupe |
| Flink: dedupe `eventId` dengan hint `STATE_TTL`, `daily` tanpa TTL dengan filter 48 jam, retensi dari `view.progress_bucket`, satu session cluster, mini-batch tiga setelan, kunci string tunggal, `co_watch` lewat CronJob dengan `computedAt` | Input tidak idempoten, TTL menimpa nilai lama, `COUNT DISTINCT` tanpa batas, satu cluster per job melampaui RAM |
| Rebuild Scylla dengan `TRUNCATE` (bukan `DELETE`) saat writer berhenti, retensi `metrics.views.v1` tanpa batas | Tombstone `DELETE` menyembunyikan tulisan lama, dan `totals` perlu input lengkap |
| Subscription soft delete, payload profil user dan proyeksi kartu, batch `GET /v1/videos?ids=`, `GET /v1/videos/:id/reactions` untuk M2 | Versi subscription ter-reset, data tampilan dan angka like M2 tidak punya sumber |
| Pengecekan status di `POST /v1/uploads`, upload-svc meng-consume `video.deleted`, `POST /internal/videos` untuk live | Sesi upload bisa dibuka untuk video yang sudah siap |
| SSR meneruskan IP asli, micro-cache hanya data publik, SLO latensi dari plugin `prometheus` Kong, anggaran CPU per komponen (32 thread) | Rate limit SSR satu bucket, token per user ter-cache, metrik OTel Kong hanya ada di Enterprise, CPU belum dihitung |
| Exit criteria M1, M4, dan M7 serta penempatan ADR diselaraskan | Bertentangan dengan anggaran preview, retensi log, dan rambatan KV |

### Revisi 8, 2026-10-28

Sumber: ronde 3 review berulang, yaitu reviewer gabungan dan trace enam journey end-to-end.

| Perubahan | Alasan |
|---|---|
| Event `video.created`, `video.access_invited`, `video.access_revoked`, `user.email_verified`, `channel.deleted`. Pemetaan kolom ke event di trigger identity, `state_version` user, `user.deleted` ditulis eksplisit oleh route | Entri KV draft, email undangan, dan pencabutan allowlist tidak punya pemicu. Trigger tidak bisa membawa `purgeComments` |
| Undangan dicocokkan saat email terverifikasi, `resolve-email` hanya untuk email terverifikasi, owner bisa melihat dan menghapus allowlist | Undangan bisa dibajak dengan mendaftar duluan memakai email itu |
| Transisi `uploaded → ready` dan `uploaded → failed` | `transcode.succeeded` yang tiba sebelum `started` membuat video macet di DLQ |
| `anonId` (cookie 1 tahun), `sessionId` dari `POST /v1/playback/sessions`, `seq`, `watchedDeltaS`, ID heartbeat hash(`sessionId`, `seq`) | Refresh dihitung sebagai view baru, watch time tidak bisa dijumlahkan, dedupe heartbeat tidak berarti |
| Kunci sink `raw`, urutan tulis Scylla dari offset Kafka, tombstone sebagai `DELETE` dengan offset yang sama, snapshot dengan `sourceOffset` | Kunci JSON tetap objek, `updatedAt` dari Flink non-deterministik atau tidak naik |
| `identityHash` dengan kunci mingguan yang dimusnahkan setelah 14 hari, judul dan deskripsi video yang dihapus langsung dikosongkan, matriks pembersihan per service | Data pribadi tersimpan tanpa batas, pembersihan akun tidak lengkap |
| Proyeksi visibilitas semua video untuk `canView` (feed, social, metrics) dengan `status` dan `playable` | Video unlisted ditolak di related, video yang di-block tetap menerima stats |
| Worker membalas `stale_epoch` dan player memuat ulang, token segmen video private berlaku sepanjang durasi video, `sub` di token private | Player macet setelah epoch naik, segmen gagal setelah 5 menit |
| `claims_to_verify: [exp]` di Kong, Flink session cluster dengan file SQL di image dan webhook operator mati, `dlq:skip`, `outbox:reemit`, replay dengan cursor, alert DLQ | `exp` tidak dicek tanpa setelan itu, lokasi SQL dan cert-manager belum jelas, payload rusak tidak punya jalan keluar |
| Upload butuh email terverifikasi, notifikasi owner saat block dan unblock, aturan keberatan, receipt push, k6 dari mesin terpisah, angka thread transcode diseragamkan | Celah kecil dari trace journey |

### Revisi 9, 2026-10-28

Sumber: ronde 4 review berulang (reviewer gabungan dan trace enam journey tambahan).

| Perubahan | Alasan |
|---|---|
| `state_version` video naik di setiap penulisan baris, bukan hanya transisi status | Perubahan visibilitas, metadata, dan allowlist dibuang oleh penjaga versi |
| Penjaga versi kartu feed memakai proyeksi semua video, search menyimpan versi di Postgres dan menunggu task Meilisearch | Event lama bisa memasukkan kembali video yang sudah dikeluarkan, dan baca-lalu-tulis Meilisearch tidak aman |
| Event yang usang atau tidak terdaftar di-ack sebagai no-op, `upload.completed` bisa mendahului `upload.started` | Event terlambat masuk DLQ dan memicu alert palsu |
| Like, dislike, dan komentar dihitung transaksional di social-svc dan dikirim sebagai `engagement.counts_changed`, Flink hanya views dan watch time | `social.v1` berisi userId dan tidak boleh disimpan lama hanya demi rebuild |
| `expires_at` upload bergeser per part, cron abandon transaksional, `complete` hanya untuk sesi aktif, resume web lewat `GET /v1/uploads?videoId=` dan fingerprint file | Resume di jam ke-23 dibatalkan, dan web tidak punya cara melanjutkan |
| Output transcode per generasi, `maxStalledCount: 3`, `removeOnComplete` 7 hari | Sisa file dari percobaan mati tercampur, stall kedua menggagalkan job |
| Mobile memuat ulang lewat `GET /v1/videos/:id` di setiap error player, push undangan dengan deep link | expo-video tidak membuka status HTTP segmen |
| Live: id sama dengan `videoId`, auth stream key lewat hook MediaMTX, rekaman di-remux ke R2, batas 4 jam, status di KV untuk memilih origin, aturan view tanpa 50% | Rekaman lebih dari 30 menit gagal, ingest tidak terautentikasi, Worker tidak tahu origin |
| Rotasi kunci tiga commit dengan gerbang, kunci di-reload otomatis, public key di repo tanpa enkripsi. Urutan denylist sebelum cabut sesi, kode `account_banned`, unban menghapus denylist | Verifier bisa belum punya kunci baru, klien berputar memperbarui token |
| Route statis Kong untuk SSR web, `prometheus` di daftar plugin, klaim `ev` di JWT, kuota hanya di upload-svc, `active` di payload subscription, trailing-edge throttle di cdc-svc, histeresis mode fan-out, `video_daily_views` untuk trending, rotasi `identityHash` 30 hari, matriks pembersihan dilengkapi, retensi `video.v1` dan `social.v1` 7 hari | Celah sedang dari kedua reviewer |

### Revisi 10, 2026-10-28

Sumber: ronde 5 review berulang (reviewer lengkap dan pemburu teks usang).

| Perubahan | Alasan |
|---|---|
| `transcode_generation` naik setiap kali video masuk `uploaded`, kolom `current_upload_id` | Upload ulang setelah `invalid_input` memakai generasi lama dan terbuang oleh dedupe. Event dari sesi lama bisa mengganggu sesi baru |
| Tabel Scylla `video_engagement` terpisah, snapshot cdc hanya views dan watch time, `video_stats` dengan dua penjaga versi | Jumlah like tidak bisa di-rebuild dan bisa tertutup tombstone offset |
| Skrip Lua penolak `seq` lama, ID `view.progress_bucket`, history sekali per sesi | Heartbeat ulang menggelembungkan tontonan, history ditulis setiap 10 detik |
| `durationS` di KV, gerbang rotasi Kong lewat checksum rollout, `jarURI` HTTP untuk runner Flink dengan fallback SQL Gateway | Worker tidak bisa menghitung `exp` token segmen, Kong tidak melaporkan `kid`, jar lokal belum tentu didukung session job |
| Aturan event subscribe ulang, `GET /v1/uploads?videoId=` di §11, sumber TTFF dari heartbeat `seq=1`, daftar consumer dilengkapi, 13 teks usang diperbaiki | Kontrak dan teks yang tertinggal dari revisi 8 dan 9 |

### Revisi 11, 2026-10-28

Sumber: ronde 6 review berulang.

| Perubahan | Alasan |
|---|---|
| `uploadId` di `upload.completed`, tabel `upload_tracking`, indeks unik sesi aktif per video | video-svc tidak bisa mencocokkan sesi, `started` yang terlambat menghidupkan sesi yang sudah selesai, dua sesi bisa terbuka bersamaan |
| Tombstone untuk `user_cards` dan `channel_cards` | Event lama memunculkan lagi nama dan avatar setelah akun dihapus |
| Hanya heartbeat yang diterima Lua yang dipublikasikan, dengan delta yang dibatasi. Commit offset cdc dari jendela terbuka paling awal. Penjaga offset di `video_daily_views` dan reset saat rebuild | Watch time bisa menggelembung, crash menghilangkan perubahan, snapshot ditolak setelah topic dibuat ulang |
| Startup `earliest-offset`, upgrade lewat savepoint, kehilangan watch seconds lama diterima kalau state hilang | Restart tanpa state menimpa total sepanjang waktu |
| Listener `QueueEvents` dan sweeper `processing` | Job yang gagal karena stall tidak mengirim `transcode.failed` |
| `source` di `video.uploaded`, notifikasi live ditunda 90 detik, `exp` 6 jam untuk siaran private | Kontrak live belum lengkap |

### Revisi 12, 2026-10-28

Sumber: ronde 7 review berulang. Tiga temuan dijadikan aturan umum, supaya satu kelas masalah tertutup sekaligus.

| Perubahan | Alasan |
|---|---|
| Aturan efek eksternal: efek dulu, lalu commit, efek idempoten, penjaga versi menerima versi yang sama | Crash di antara commit dan efek membuat efek hilang (contohnya video private tetap bisa dicari) |
| Push dan email lewat tabel `delivery` dan sender terpisah | Pengiriman ulang event membuat pesan ganda |
| `outbox:snapshot` untuk backfill consumer baru | Retensi 7 hari membuat proyeksi di service yang dibangun belakangan tidak bisa diisi |
| `current_upload_id` dikosongkan saat sesi selesai | Sesi baru setelah abandon ikut diabaikan |
| Satu producer untuk `transcode.failed` (listener final) | Dua producer bisa saling menimpa alasan gagal |
| `hashKeyId`, kunci hash di Secret dengan CronJob rotasi, `ownerUserId` dihapus dari topic tanpa batas, retensi retry dan DLQ 14 hari | Rotasi kunci tidak bisa dijalankan, data pribadi di topic tanpa batas |
| ZADD hanya ke key yang ada, TTL key feed, sender email undangan masuk M2 | Feed terpotong setelah eviction, email undangan tidak punya pengirim di M2 |

### Revisi 13, 2026-10-28

Sumber: ronde 8 review berulang (khusus temuan High). Loop review dihentikan setelah revisi ini (lihat §18A).

| Perubahan | Alasan |
|---|---|
| Advisory lock per `videoId` dan baca ulang setelah PUT di `media-edge-sync`, `video_meta` ditulis dengan `USING TIMESTAMP` = `stateVersion` | Consumer retry bisa menimpa state yang lebih baru, sehingga video yang dicabut atau di-block bisa diputar lagi |
| Batas sweeper bergantung durasi dan menanyakan state job, sweep `uploaded` mengirim ulang alih-alih menggagalkan | Transcode panjang (termasuk rekaman live) digagalkan oleh batas 2 jam |
| Tabel `invite_delivery` dengan purge 14 hari, nama pengirim notifikasi dibaca saat tampil, undangan dihapus saat cocok atau setelah 30 hari, retensi retry dan DLQ masuk daftar privasi | Email undangan tersimpan melewati retensi yang dijanjikan |

### Revisi 14, 2026-10-29

Sumber: spike M0 dan walking skeleton (lihat §18A, Hasil spike M0).

| Perubahan | Alasan |
|---|---|
| Producer wajib `compatibilityPartitioner` | Partitioner bawaan `@platformatic/kafka` berbeda dengan klien Java, sehingga urutan per key bisa pecah lintas producer |
| ADR 026 diputuskan: proses Kafka jalan di Bun | Spike produce, consumer group, rebalance, dan idempotensi lolos di Bun |
| Validasi `data` per tipe event menjadi `PermanentError` | Payload salah bentuk sempat melewati retry tertunda sebelum DLQ |
| Keyring: `disablePrivateKeyEncryption`, `createJwk` melempar error, kunci aktif diberi `createdAt` terbaru | Perilaku plugin JWT Better Auth 1.7.14 yang dibuktikan spike |
| Tahap 1 retry: 3 percobaan dengan 2 jeda (200 ms, 1 detik) | Teks lama menyebut tiga jeda untuk tiga percobaan |
| Consumer berhenti dan tidak sehat saat produce ke retry/DLQ atau commit gagal | Versi awal berhenti consume tanpa tanda |

### Revisi 15, 2026-10-29

Sumber: identity-svc M0 dan spike token Expo (lihat §18A, Hasil identity-svc M0).

| Perubahan | Alasan |
|---|---|
| `advanced.disableOriginCheck: false` wajib di konfigurasi Better Auth | Default Better Auth 1.7.14 mematikan origin dan CSRF check saat `NODE_ENV=test` atau `TEST=true` |
| Kolom `seq` di outbox, relay mengurutkan `(xid, seq)` | UUIDv7 tidak monoton di dalam satu milidetik, jadi event satu transaksi bisa tertukar |
| Envelope dibangun fungsi SQL `outbox_emit` | Trigger dan kode TS harus menghasilkan envelope yang sama, dari satu pemilik |
| Tabel `jwks` dengan `check (false)` | Validasi schema Better Auth menuntut tabelnya, sementara kunci hanya boleh dari keyring |
| `EventConsumer` membuat topic retry dan DLQ miliknya | Topic itu milik consumer group, dengan retensi 14 hari |
| Kontrak token Expo dari sisi server terbukti, sisa pengecekan di perangkat dipindah ke M6 | Spike M0 |
