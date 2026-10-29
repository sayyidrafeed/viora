# Verifikasi: komunikasi antar-service

Tanggal: 2026-10-28. Cakupan: desain komunikasi sinkron dan asinkron di grand plan §6, §10, §11, §13, dan §15, versi sebelum revisi 3.

Metode: dua riset independen ke docs resmi, spesifikasi, repo sumber, dan metadata npm. Smoke test hanya satu: cockatiel di Bun 1.4.4. Tidak ada broker, cluster, atau client Kafka yang dijalankan. Hasilnya sudah diterapkan ke grand plan sebagai revisi 3 (§20).

Label:

- **Confirmed**: didukung sumber.
- **Partly**: sebagian benar, ada syarat yang belum tertulis di plan.
- **Contradiction**: sumber bertentangan dengan plan.
- **Unknown**: belum ada bukti, butuh spike.

Klaim yang hanya inferensi ditulis "inferensi".

## Ringkasan

| No | Klaim di plan | Status | Perubahan |
|---|---|---|---|
| 1 | Client Kafka di Bun (belum dipilih) | Unknown | Spike `@platformatic/kafka` di M0, fallback proses Kafka di Node |
| 2 | Producer idempoten + ID event deterministik mencegah event ganda | Contradiction | Dedupe di consumer wajib untuk semua consumer |
| 3 | Satu DLQ per topic untuk semua consumer group, replay ke topic asal | Partly | DLQ dan replay per consumer group |
| 4 | `traceparent` di dalam payload envelope | Contradiction (sebagian) | Trace context di header record Kafka |
| 5 | Zod + topic `*.v2`, tanpa schema registry | Partly | Cek kompatibilitas JSON Schema di CI |
| 6 | Urutan per key dijamin relay yang membaca menurut UUIDv7 | Contradiction | Relay tunggal (advisory lock), filter `xid8` + xmin snapshot, producer idempoten |
| 7 | Token service client credentials buatan sendiri | Partly | Diganti projected ServiceAccount token k8s |
| 8 | Satu token user internal untuk semua service | Partly | Token user per audience, auth service terpisah dari identitas user |
| 9 | Outbox polling dengan SKIP LOCKED | Partly | Relay tunggal, NOTIFY hanya pemicu, purge berkala |
| 10 | Consumer idempoten dengan `processed_events` | Confirmed | Tambah purge retensi |
| 11 | Timeout 2 detik, retry GET, circuit breaker | Partly | Satu lapis retry dengan jitter, deadline header, breaker hanya untuk dependency opsional |
| 12 | Satu Postgres, schema dan role per service | Confirmed | Batas pool PgBouncer per role ditulis eksplisit |
| 13 | 12 service (awalnya ditulis 13) untuk satu developer | Partly | Tetap (keputusan user), mitigasi ditulis di ADR 001 |

## Asinkron

### 1. Client Kafka di Bun: Unknown

- `kafkajs` tidak lagi aktif. Rilis terakhir 2.2.4 pada 2023-02-27, commit terakhir 2024-05-16. Sumber: npm, https://github.com/tulios/kafkajs
- `@confluentinc/kafka-javascript` 1.11.0 (2026-10-07) masih aktif, tapi **tidak jalan di Bun** karena addon-nya memakai API NAN/V8, bukan N-API.
  - Issue #264 masih terbuka. Maintainer menulis bahwa runtime selain Node tidak didukung.
  - Kegagalan di Bun 1.3.14 dilaporkan pada 2026-08-08.
  - Sumber: https://github.com/confluentinc/confluent-kafka-javascript/issues/264
- `@platformatic/kafka` 2.14.0 (2026-10-07) ditulis murni TypeScript tanpa addon native, dan punya producer idempoten serta transaksi. README-nya hanya menyebut Node ≥22.22 / ≥24.6. Belum ada bukti jalan di Bun. Sumber: https://github.com/platformatic/kafka
- Client yang divalidasi Redpanda hanya KafkaJS dan confluent-kafka-javascript. Sumber: https://docs.redpanda.com/current/develop/kafka-clients/ (26.2)

Keputusan: spike `@platformatic/kafka` di Bun terhadap Redpanda pada M0 (produce, consumer group, rebalance, producer idempoten). Kalau gagal, proses yang memakai Kafka (relay outbox, consumer, ingest metrics) dijalankan di Node 24, karena Hono jalan di keduanya. Dicatat sebagai ADR 026.

### 2. Producer idempoten dan event ganda: Contradiction

- Redpanda mendukung producer idempoten dan transaksi. Sumber: https://docs.redpanda.com/current/develop/produce-data/idempotent-producers/ (26.2)
- Idempotensi hanya berlaku dalam satu sesi producer. Retry dari aplikasi setelah crash atau restart memakai producer ID baru dan bisa menghasilkan record ganda. Sumber: dokumen Redpanda yang sama, dan KIP-98 (https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)
- Kalimat di plan lama, "retry tidak menghasilkan event ganda bagi consumer", salah. ID event deterministik tetap berguna, tapi sebagai kunci dedupe di consumer.

Keputusan: semua consumer wajib dedupe berdasarkan `event_id`. Setting idempotensi producer ditulis eksplisit (`acks=all`, idempotent on), karena tidak semua client menyalakannya secara default.

### 3. DLQ bersama per topic: Partly

- Penamaan `<topic>-dlt` tanpa nama group adalah default Spring Kafka. Ada header `DLT_ORIGINAL_CONSUMER_GROUP` untuk melacak group asal. Sumber: https://docs.spring.io/spring-kafka/reference/kafka/annotation-error-handling.html
- DLQ di Kafka Connect dibuat per connector, analog dengan DLQ per consumer.
- Inferensi: mengirim ulang isi DLQ ke topic asal membuat semua group menerima record itu lagi, termasuk group yang sudah berhasil memprosesnya, dan urutannya terhadap event baru untuk key yang sama ikut berubah.

Keputusan: DLQ per consumer group (`dlq.<group>.<topic>`). Replay mengirim ke `retry.<group>.<topic>` yang hanya di-consume group itu.

### 4. Trace context di payload: Contradiction (sebagian)

- Spesifikasi messaging OpenTelemetry (status Development) mewajibkan creation context ikut di setiap pesan dan tidak boleh diubah perantara. Spesifikasi itu tidak menentukan mekanismenya untuk Kafka. Sumber: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
- Instrumentasi dan praktik umum memakai header record. Ini bukti sekunder, karena source instrumentasi Kafka resmi belum dibaca.
- Default spesifikasi adalah span link, bukan hubungan parent-child.

Keputusan: `traceparent` dan `tracestate` dipindah ke header record Kafka dan dihapus dari envelope. Span consumer memakai link ke creation context.

### 5. Evolusi skema tanpa registry: Partly

- Redpanda punya Schema Registry bawaan di port 8081 (Avro, Protobuf, JSON Schema). Sumber: https://docs.redpanda.com/current/manage/schema-reg/schema-reg-overview/
- Confluent menyarankan topic baru untuk perubahan yang tidak kompatibel, jadi pola `*.v2` dikenal. Sumber: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
- Tanpa registry atau cek di CI, perubahan yang tidak kompatibel baru ketahuan saat event di-consume.

Keputusan: JSON Schema di-generate dari Zod di `packages/contracts`, lalu CI membandingkannya dengan versi di `main` memakai aturan kompatibilitas BACKWARD. Topic `*.v2` hanya untuk perubahan yang memang tidak kompatibel. Registry bawaan Redpanda dicatat sebagai scale path.

### 6. Urutan per key dari relay outbox: Contradiction

- UUIDv7 berurutan saat dibuat, bukan saat commit. Transaksi yang commit belakangan dengan ID lebih kecil bisa terlewat oleh pembaca berbasis cursor. Sumber: RFC 9562 §6.2, https://event-driven.io/en/ordering_in_postgres_outbox/ (2022)
- Di Kafka, `max.in.flight.requests.per.connection` > 1 tanpa idempotensi bisa mengacak urutan saat retry. Dengan idempotensi aktif, urutan terjaga sampai 5 in-flight. Sumber: https://kafka.apache.org/42/configuration/producer-configs/
- Beberapa relay paralel dengan `SKIP LOCKED` tidak menjaga urutan. Sumber: dokumentasi PostgreSQL 18 untuk `SKIP LOCKED`, ditambah inferensi.

Keputusan:

- Satu relay aktif per service (leader lewat advisory lock).
- Outbox menyimpan kolom `xid8`. Relay hanya membaca baris dengan xid di bawah `pg_snapshot_xmin(pg_current_snapshot())`, diurutkan `(xid, seq)` sejak revisi 15 (awalnya `(xid, id)`; UUIDv7 tidak monoton di dalam satu milidetik).
- Producer idempoten dengan `acks=all` dan in-flight ≤5.

## Sinkron

### 7. Token service buatan sendiri: Partly

- Projected ServiceAccount token di Kubernetes terikat audience, dirotasi kubelet (pada 80% TTL atau 24 jam), dan otomatis tidak berlaku saat Pod dihapus. Sumber: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
- Source k3s menyetel `service-account-issuer` dan `api-audiences`, jadi discovery OIDC tersedia. Belum diuji di cluster sungguhan. Sumber: https://github.com/k3s-io/k3s/blob/master/pkg/daemons/control/server.go
- Linkerd memberi mTLS otomatis. Tapi sejak 2.15 build stabilnya dari Buoyant, dan open source hanya edge release. RAM-nya diperkirakan ±0,5–0,9 GB untuk 13 service (angka vendor + inferensi). Sumber: https://linkerd.io/2/features/automatic-mtls/, https://docs.buoyant.io/buoyant-enterprise-linkerd/2.18/guides/resource-request-and-limits/
- OWASP menyebut identitas service berbasis token dan mTLS sebagai alternatif yang setara. Tidak ada sumber yang menyatakan token buatan sendiri salah. Alasan memilih identitas bawaan platform adalah inferensi: tidak ada secret per service yang harus disimpan, dirotasi, atau bocor.

Keputusan:

- Token service diganti projected ServiceAccount token dengan audience = nama service tujuan. Verifikasinya lewat JWKS issuer k3s yang di-cache.
- `POST /internal/tokens` dan client secret per service dihapus.
- Di Compose lokal, `service-kit` memakai issuer dev dengan kunci statis dan antarmuka verifikasi yang sama.
- Discovery k3s dibuktikan lewat spike di M1.
- Linkerd tidak dipakai (RAM dan lisensi), dicatat sebagai scale path.

### 8. Token user internal: Partly

> Catatan revisi 5: keputusan token per audience di bawah diganti setelah user memilih Kong OSS sebagai gateway. Plugin `jwt` Kong OSS tidak bisa mengecek `aud` atau menerbitkan token, jadi penggantinya `aud=viora-api` tunggal ditambah NetworkPolicy (port publik hanya dari Kong). Lihat grand plan §6 dan ADR 007.

- Pola gateway yang memvalidasi kredensial luar lalu menerbitkan assertion internal dikenal ("internal assertion" di OWASP, "phantom token" di Curity). Sumber: https://cheatsheetseries.owasp.org/cheatsheets/Identity_Propagation_Patterns_Cheat_Sheet.html
- OWASP meminta audience dan masa berlaku dibatasi, serta melarang memperlebar audience supaya token bisa diteruskan. Service pemanggil tetap harus diautentikasi terpisah. Sumber: https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html
- Satu token yang diterima 13 service bisa di-replay oleh service yang dibobol.

Keputusan:

- Gateway menerbitkan token user dengan `aud` = service tujuan pertama.
- Panggilan sinkron antar-service tidak meneruskan token user. Pemanggil mengautentikasi diri dengan token service, mengirim `userId` sebagai parameter eksplisit, dan otorisasinya dilakukan di service pemanggil.

### 9. Outbox polling dengan SKIP LOCKED: Partly

- Pola outbox dan polling publisher memang dikenal, dan relay bisa mengirim duplikat. Sumber: https://microservices.io/patterns/data/transactional-outbox.html
- `LISTEN/NOTIFY` tidak tahan banting untuk listener yang terputus, dan tidak didukung PgBouncer mode transaction. Sumber: https://www.postgresql.org/docs/current/sql-notify.html, https://www.pgbouncer.org/features.html
- Apakah Debezium lebih tangguh di skala ini belum diverifikasi. Polling bisa dipertanggungjawabkan, tapi itu penilaian, bukan temuan bersumber.

Keputusan:

- Polling tetap dipakai, ditambah aturan di poin 6.
- `NOTIFY` hanya sebagai pemicu tambahan lewat koneksi langsung, tidak lewat PgBouncer.
- Baris yang sudah terkirim dihapus setelah 7 hari.

### 10. Consumer idempoten: Confirmed

- Mencatat ID pesan di tabel dengan primary key (subscriber, messageId) dalam transaksi yang sama adalah pola dari microservices.io. Sumber: https://microservices.io/patterns/communication-style/idempotent-consumer.html
- Retensinya tidak disebut sumber mana pun.

Keputusan: primary key `(consumer_group, event_id)`, dipurge setelah 14 hari, dua kali retensi Redpanda 7 hari (inferensi: minimal lebih panjang dari jendela redelivery).

### 11. Timeout, retry, circuit breaker: Partly

- AWS Builders' Library: setiap panggilan butuh timeout, retry hanya untuk operasi idempoten, retry hanya di satu lapis, dan backoff dengan jitter. Circuit breaker menambah perilaku modal yang sulit dites. Sumber: https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter
- Panduan gRPC: teruskan sisa waktu (deadline), bukan timestamp absolut. Sumber: https://grpc.io/docs/guides/deadlines/
- cockatiel 4.0.0 (2026-05-26) jalan di Bun 1.4.4 dalam smoke test minimal.

Keputusan:

- Policy di `service-kit` memakai cockatiel: timeout di setiap panggilan, retry hanya di klien `service-kit` (satu lapis) untuk GET dan operasi dengan idempotency key, backoff dengan jitter dan anggaran retry.
- Header `x-deadline-ms` membawa sisa waktu.
- Circuit breaker hanya untuk dependency opsional yang punya fallback, misalnya history untuk rekomendasi.
- `POST /internal/channels/ensure` dibuat upsert idempoten.

### 12. Satu Postgres, schema dan role per service: Confirmed

- "Schema-per-service" adalah opsi yang dikenal, dengan syarat ada user DB dan grant terpisah. Sumber: https://microservices.io/patterns/data/database-per-service.html
- PgBouncer membuat satu pool per pasangan user dan database, jadi 13 role berarti 13 pool. Mode transaction butuh `max_prepared_statements > 0` dan tidak mendukung advisory lock level sesi. Sumber: https://www.pgbouncer.org/config.html

Keputusan:

- `default_pool_size` dan `max_db_connections` ditulis eksplisit per role.
- Advisory lock leader relay dan `LISTEN` memakai koneksi langsung ke Postgres, tidak lewat PgBouncer.

### 13. 12 service untuk satu developer (awalnya ditulis 13): Partly

- Fowler: microservices punya biaya tambahan ("premium"), dan proyek baru sebaiknya tidak dimulai dengan microservices. Fowler juga mengakui buktinya terbatas, dan artikelnya tidak membahas developer solo. Sumber: https://martinfowler.com/bliki/MicroservicePremium.html, https://martinfowler.com/bliki/MonolithFirst.html

Keputusan: arsitektur tetap mengikuti keputusan user (diagram sebagai sumber). Mitigasi yang ditulis di ADR 001:

- Service dibangun bertahap per milestone.
- Semua kode bersama ada di `service-kit` dan scaffolder.
- Service yang belum dikerjakan cukup berupa skeleton.

## Belum terverifikasi

- `@platformatic/kafka` di Bun (spike M0).
- Discovery OIDC k3s di cluster sungguhan (spike M1).
- Apakah `@platformatic/kafka` menyalakan idempotensi secara default.
- Source instrumentasi OpenTelemetry Kafka resmi.
- Biaya operasional Debezium dibanding polling.
- Batas koneksi Postgres per role (`CONNECTION LIMIT`).

## Pembanding: Seapedia

Seapedia (https://github.com/sayyidrafeed/Seapedia, HEAD 2ee8466, 2026-10-27) adalah proyek microservice user sebelumnya: monorepo Bun dengan 4 service Hono (identity, catalog, commerce, search), Kong 3.9 sebagai gateway, RabbitMQ, dan database per service (Postgres, MongoDB, Elasticsearch). Dibaca dari shallow clone, tidak dijalankan.

### Yang dipakai ulang di viora

- Pemisahan `packages/platform` (tanpa logika domain) dan `packages/contracts`, setara `service-kit` dan `contracts` di viora.
- Skema event Zod dibagi bersama dan divalidasi di producer maupun consumer.
- Event berisi state penuh dengan penjaga versi entitas (`version < incoming`) untuk consumer proyeksi.
- ADR dengan status dan supersession.
- CI yang hanya membangun yang berubah, dan gate drift OpenAPI.
- PGlite untuk test database yang cepat.
- Penanganan celah eventual consistency dengan status antara (`409 PRODUCT_SYNCING`).

### Celah Seapedia yang sudah ditutup viora

- Relay outbox di setiap instance tanpa lock, diurutkan `created_at`. Bisa publish dua kali dan melewatkan baris yang commit terlambat.
- Inbox hanya untuk efek counter.
- Tidak ada tracing, hanya `x-request-id`.
- Klien internal ditulis manual dengan timeout tetap dan tanpa deadline.
- Identitas service memakai client secret statis dan token endpoint di identity. Viora menghapus keduanya lewat projected ServiceAccount token.

### Bertentangan dengan viora

| Topik | Seapedia | Viora | Status |
|---|---|---|---|
| Database | Pindah dari satu Postgres bersama ke server per service demi isolasi kegagalan (ADR 0008) | Satu Postgres, schema dan role per service | Keputusan user tetap. ADR 001 wajib menulis trade-off: satu domain kegagalan bersama, dipilih karena RAM dan biaya |
| Gateway | Gateway Hono buatan sendiri diganti Kong (ADR 0004 ke 0007) untuk cek JWT tanpa state dan konfigurasi deklaratif | Gateway Hono buatan sendiri | Diputuskan di revisi 5: viora ikut memakai Kong 3.9.x OSS |
| Panggilan sinkron | Hampir nol, karena koreografi dan replika lokal | REST internal di beberapa jalur | ADR 028 menambah aturan: panggilan sinkron baru harus disertai alasan kenapa proyeksi lokal tidak cukup |
| Retry sebelum parkir | Antrean retry dengan TTL 5 detik, lalu `<queue>.parked` setelah 5 kali | Langsung DLQ setelah 5 kali | Diputuskan di revisi 5: retry bertahap dengan topic retry tertunda sebelum DLQ |

### Pengalaman microservice (catatan "MonolithFirst" Fowler)

Seapedia membuktikan pola-polanya dikuasai: proyek itu sendiri berawal dari modular monolith lalu dipecah (ADR 0001). Tapi skalanya 4 service di satu host, tanpa Kubernetes, tanpa trafik produksi, dan ADR-nya berumur beberapa minggu. Untuk 13 service di k3s, ini belum memenuhi pengecualian "tim sudah berpengalaman". ADR 001 menulisnya apa adanya sebagai risiko yang diterima.
