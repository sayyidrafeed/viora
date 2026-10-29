# Event catalog v1

Versi: M0 (2026-10-29). Diperbarui setiap milestone (grand plan §17).

Sumber kebenaran skema adalah `packages/contracts/src` (ADR 027), satu file per domain. Katalog ini merangkum kontrak itu dan grand plan §6 dan §10. Topic `identity.v1`, `upload.v1`, `video.v1`, dan `transcode.v1` sudah punya skema Zod dan snapshot JSON Schema (`packages/contracts/event-schemas.json`). Topic lain berasal dari grand plan §10 dan ditandai "skema Zod menyusul di milestone pemilik".

## Envelope

Setiap event bisnis dibungkus envelope yang sama. Topic agregat Flink tidak memakai envelope (lihat bagian Topic).

| Field | Tipe di `envelopeSchema` | Isi |
|---|---|---|
| `id` | `z.uuid()` | UUIDv7 dari outbox, atau UUID deterministik (hash) untuk producer tanpa outbox. Kunci dedupe consumer |
| `type` | string, regex `^[a-z_]+\.[a-z_]+$` | Contoh `user.registered` |
| `version` | integer positif | Versi skema payload. Default 1 di `outbox_emit` |
| `occurredAt` | `z.iso.datetime()` | ISO 8601 UTC, diisi `clock_timestamp()` saat `outbox_emit` dipanggil |
| `producer` | string tidak kosong | Nama service, misalnya `identity-svc` |
| `key` | string tidak kosong | Partition key, sama dengan key record Kafka |
| `data` | `z.record(z.string(), z.unknown())` | Payload per tipe event, divalidasi terpisah |

- Service dengan database membangun envelope hanya lewat fungsi SQL `<schema>.outbox_emit(topic, type, key, data, version)`. Trigger Postgres dan `writeOutbox` di `service-kit` sama-sama memakainya (ADR 004).
- `traceparent` dan `tracestate` tidak ada di envelope. Keduanya ada di header record Kafka.
- Consumer memvalidasi envelope, lalu `data` dengan skema per tipe (`dataSchemas`). Kegagalan salah satunya adalah `PermanentError` dan langsung ke DLQ.
- Perubahan yang tidak kompatibel menaikkan `version` dan memakai topic baru `*.v2`.

## Topic

| Topic | Event | Producer | Consumer | Key | Skema Zod |
|---|---|---|---|---|---|
| `identity.v1` | `user.registered`, `user.email_verified`, `user.profile_updated`, `user.banned`, `user.unbanned`, `user.deleted`, `channel.created`, `channel.updated`, `channel.deleted` | identity-svc | upload, video, social, feed, search, notification, metrics, live | `userId` | Ada (M0) |
| `upload.v1` | `upload.started`, `upload.completed`, `upload.cancelled`, `upload.abandoned` | upload-svc | video-svc | `videoId` | Menyusul (M1) |
| `video.v1` | `video.created`, `video.uploaded`, `video.ready`, `video.failed`, `video.visibility_changed`, `video.metadata_updated`, `video.blocked`, `video.unblocked`, `video.deleted`, `video.access_invited`, `video.access_revoked`, `video.live_started` | video-svc | upload, transcode, feed, search, notification, social, metrics, video (`media-edge-sync`) | `videoId` | Menyusul (M1) |
| `transcode.v1` | `transcode.started`, `transcode.succeeded`, `transcode.failed` | transcode-svc | video-svc | `videoId` | Menyusul (M1) |
| `social.v1` | `engagement.counts_changed`, `subscription.created`, `subscription.updated`, `subscription.removed`, `reaction.set`, `reaction.removed`, `comment.created`, `comment.deleted`, `report.created` | social-svc | feed, notification, stream-processor, metrics-svc dan video-svc (`engagement.counts_changed`) | `channelId` untuk subscription, `targetId` untuk report, `videoId` untuk lainnya | Menyusul (M2) |
| `playback.heartbeat.v1` | `playback.heartbeat` | metrics-svc | stream-processor | `sessionId` | Menyusul (M3) |
| `metrics.views.v1` | `view.counted`, `view.progress_bucket` | metrics-svc | stream-processor | `videoId` | Menyusul (M3) |
| `metrics.video_totals.v1`, `metrics.video_daily.v1`, `metrics.channel_daily.v1`, `metrics.channel_video_month.v1`, `metrics.retention.v1` | Baris agregat upsert (skema baris, bukan envelope) | stream-processor | metrics-svc (writer), cdc-svc (`video_totals`), feed-svc (`video_daily`) | Key gabungan `raw`, misalnya `videoId\|day` | Menyusul (M3) |
| `metrics.cowatch.v1` | Baris pasangan related video dengan skor | stream-processor | feed-svc | `videoId\|relatedVideoId` | Menyusul (M5) |
| `metrics.v1` | `metrics.stats_snapshot` | cdc-svc | video-svc, feed-svc | `videoId` | Menyusul (M3) |
| `live.v1` (stretch) | `live.started`, `live.ended` | live-svc | feed, notification, video | `videoId` | Menyusul (M8) |

Per grand plan revisi 17 (2026-10-29), `topics` di `packages/contracts` berisi `identity.v1`, `upload.v1`, `video.v1`, dan `transcode.v1`. Skema `data`-nya ada di `upload.ts`, `video.ts`, dan `transcode.ts`, mengikuti tabel Payload §10 dan state machine §8. Topic `social.v1`, `metrics.*`, `playback.heartbeat.v1`, dan `live.v1` menyusul di milestone pemiliknya.

Retensi topic: event 7 hari, `metrics.views.v1` tanpa batas waktu, topic agregat di-compact, retry dan DLQ 14 hari (grand plan §9, §10). Tidak ada event `playback.started`. `ttffMs` dibawa heartbeat `seq=1`.

## Header record Kafka

Nama header dari konstanta `headers` di `packages/contracts`.

| Header | Konstanta | Diisi oleh | Isi |
|---|---|---|---|
| `traceparent` | `headers.traceparent` | Relay outbox (dari `set_config('viora.traceparent', ...)` di transaksi), diteruskan ke retry dan DLQ | Konteks trace W3C |
| `tracestate` | `headers.tracestate` | Diteruskan ke retry dan DLQ kalau ada | Konteks trace W3C. Outbox belum menulisnya (revisi 16) |
| `x-attempt` | `headers.attempt` | `EventConsumer` | Total percobaan handler lintas tahap. Maksimal 6 (3 tahap utama + 3 tahap retry) |
| `x-retry-not-before` | `headers.retryNotBefore` | `EventConsumer` saat pindah ke retry | Epoch milidetik. Default sekarang + 60 detik |
| `x-error` | `headers.error` | `EventConsumer` di retry dan DLQ | `Name: message`, dipotong 1.000 karakter |
| `x-origin-topic` | `headers.originTopic` | `EventConsumer`, sekali dari topic utama | Topic asal |
| `x-origin-partition` | `headers.originPartition` | Sama | Partisi asal |
| `x-origin-offset` | `headers.originOffset` | Sama | Offset asal |

## Retry dan DLQ

| Nama | Fungsi | Consumer group |
|---|---|---|
| `<topic>` | Topic utama | `<group>` |
| `retry.<group>.<topic>` | Retry tertunda dan tujuan replay | `retry.<group>` |
| `dlq.<group>.<topic>` | Pesan yang gagal permanen | Tidak di-consume otomatis |

- Nama dibuat oleh `retryTopic(group, topic)` dan `dlqTopic(group, topic)` di `packages/contracts`.
- `EventConsumer` membuat kedua topic saat start kalau belum ada, dengan `retention.ms` 14 hari dan 1 partisi, karena topic itu milik group.
- Alur: 3 percobaan di dalam proses (jeda berjitter sekitar 200 ms lalu 1 detik), lalu `retry.<group>.<topic>` setelah 60 detik dengan 3 percobaan lagi, lalu `dlq.<group>.<topic>`. Error permanen langsung ke DLQ.
- Replay (`bun run dlq:replay <group> <topic>`, group `dlq-replay.<group>`) mengirim dari DLQ ke topic retry milik group itu saja. Payload rusak dilewati dengan `bun run dlq:skip` lalu dibuat ulang dengan `bun run outbox:reemit`. Ketiga perintah ini belum dibuat di M0.
- Event yang usang atau tidak terdaftar di state machine di-ack sebagai no-op dan dicatat di metrik `stale_event_total`, bukan dilempar ke retry.

Detail: [ADR 024](adr/024-retry-bertahap-dlq-per-consumer-group.md).

## Aturan `stateVersion`

- `stateVersion` adalah nilai `state_version` di tabel pemilik, naik di setiap UPDATE baris. Di identity, trigger `BEFORE UPDATE` yang menaikkannya, termasuk untuk UPDATE yang tidak mengirim event. Versi bisa melompat.
- Event yang membawa `stateVersion`: semua `video.*`, `subscription.*`, `channel.created`, `channel.updated`, `user.registered`, `user.profile_updated`, `engagement.counts_changed`, `video.access_revoked`, dan snapshot `<entity>.snapshot`.
- Consumer proyeksi hanya menerapkan event dengan `stateVersion` lebih besar dari yang tersimpan. Aturan "berurutan" (+1) dilarang.
- Efek eksternal menerima versi yang sama atau lebih besar.
- Dedupe `event_id` lewat `processed_events` tetap berlaku di samping penjaga versi.
- Proyeksi yang barisnya dihapus menyimpan tombstone versi, supaya event lama tidak menghidupkannya lagi.
- Grand plan §10 menulis bahwa `channel.*` membawa `stateVersion`, tapi payload `channel.deleted` di §10 dan di `contracts` tidak membawanya. Ini belum diputuskan.

Detail: [ADR 030](adr/030-versi-state-penjaga-versi.md).

## Payload `identity.v1`

Skema dari `identityEventData` di `packages/contracts`. `z.object` membuang field yang tidak terdaftar saat parse. Producer `identity-svc`, `version` 1, key `userId` untuk semua event (event channel memakai `owner_user_id`).

| Event | Field | Pemicu |
|---|---|---|
| `user.registered` | `userId: string`, `name: string`, `image: string \| null`, `stateVersion: int > 0` | Trigger, insert `user`. Tanpa email |
| `user.email_verified` | `userId: string`, `email: z.email()` | Trigger, `email_verified` dari false ke true, atau insert yang sudah terverifikasi (Google) |
| `user.profile_updated` | `userId: string`, `name: string`, `image: string \| null`, `stateVersion: int > 0` | Trigger, `name` atau `image` berubah |
| `user.banned` | `userId: string`, `reason: string \| null \| undefined`, `expiresAt: ISO datetime dengan offset \| null \| undefined` | Trigger, `banned` jadi true |
| `user.unbanned` | `userId: string` | Trigger, `banned` jadi false |
| `user.deleted` | `userId: string`, `purgeComments: boolean` | Ditulis eksplisit oleh `DELETE /v1/me` |
| `channel.created` | `channelId: string`, `ownerUserId: string`, `handle: string`, `name: string`, `avatarKey: string \| null`, `stateVersion: int > 0` | Trigger, insert `channel` |
| `channel.updated` | Sama dengan `channel.created` | Trigger, `handle`, `name`, atau `avatar_key` berubah. Kolom lain hanya menaikkan versi |
| `channel.deleted` | `channelId: string`, `ownerUserId: string` | Ditulis eksplisit oleh `DELETE /v1/me` di transaksi yang sama dengan `user.deleted` |

Login ulang, perubahan `updated_at`, sesi, dan deskripsi channel tidak mengirim event.

## Payload topic lain

Field minimum dari grand plan §10. Untuk `upload.v1`, `video.v1`, dan `transcode.v1`, skema Zod di `packages/contracts` adalah acuan; topic lain menyusul di milestone pemilik. `?` berarti opsional.

| Event | Field |
|---|---|
| `video.created` | Data kartu video dengan `status=draft` dan `playable=false` |
| `video.access_invited` | `videoId`, `email`, `inviterName`, `videoTitle`, `registeredUserId?` |
| `video.access_revoked` | `videoId`, `userId`, `epoch`, `stateVersion` |
| `upload.started` | `videoId`, `userId`, `uploadId` |
| `upload.completed` | `videoId`, `uploadId`, `userId`, `sourceKey`, `sizeBytes` |
| `upload.cancelled`, `upload.abandoned` | `videoId`, `uploadId` |
| `video.uploaded` | `videoId`, `sourceKey`, `generation`, `source` (`upload` atau `live`), `stateVersion` |
| `transcode.started` | `videoId`, `generation` |
| `transcode.succeeded` | `videoId`, `generation`, `durationS`, `renditions[]` (`height`, `bitrateKbps`, `playlistKey`), `manifestKey`, `thumbnailKeys[]`, `spriteKey` |
| `transcode.failed` | `videoId`, `generation`, `attempts`, `reason` (`exhausted`, `invalid_input`), `error` |
| Kartu video: `video.ready`, `video.unblocked`, `video.visibility_changed`, `video.metadata_updated`, `video.live_started` | `videoId`, `channelId`, `ownerUserId`, `status`, `visibility`, `epoch`, `playable`, `title`, `thumbnailKey`, `durationS`, `publishedAt`, `firstPublished`, `stateVersion`. `video.visibility_changed` menambah `from` |
| `video.blocked`, `video.deleted`, `video.failed` | `videoId`, `channelId`, `ownerUserId`, `status`, `visibility`, `epoch`, `playable`, `reason`, `stateVersion` |
| `subscription.created`, `subscription.updated`, `subscription.removed` | `active`, `userId`, `channelId`, `notify`, `stateVersion` |
| `engagement.counts_changed` | `videoId`, `likes`, `dislikes`, `comments`, `stateVersion` |
| `reaction.set` | `userId`, `videoId`, `kind`, `previousKind?` |
| `reaction.removed` | `userId`, `videoId`, `previousKind` |
| `comment.created` | `commentId`, `videoId`, `authorId`, `parentId?`, `rootId?`, `parentAuthorId?` |
| `comment.deleted` | `commentId`, `videoId` |
| `report.created` | `reportId`, `targetType`, `targetId`, `reason` |
| `playback.heartbeat` | `sessionId`, `seq`, `videoId`, `channelId`, `durationS`, `userId?`, `anonId`, `ipHash`, `positionS`, `watchedDeltaS`, `renditionHeight`, `occurredAt` |
| `view.counted` | `videoId`, `channelId`, `sessionId`, `identityHash`, `hashKeyId`, `occurredAt`. Tanpa `ownerUserId` karena topic disimpan tanpa batas |
| `view.progress_bucket` | `videoId`, `sessionId`, `bucket`, `occurredAt` |
| `metrics.stats_snapshot` | `videoId`, `views`, `watchSeconds`, `sourceOffset` |
| `live.started` | `liveId`, `videoId`, `channelId` |
| `live.ended` | `liveId`, `videoId`, `sourceKey` |

Aturan khusus `subscription.*`: `created` untuk subscribe pertama dan subscribe ulang setelah `active=false`, `updated` hanya untuk toggle `notify`, `removed` saat `active` jadi false. ID event untuk producer tanpa outbox dibuat deterministik: transcode dari `jobId` dan nama tahap, heartbeat dari hash(`sessionId`, `seq`), `view.counted` dari hash(`sessionId`, `"view"`), `view.progress_bucket` dari hash(`sessionId`, `"bucket"`, n), snapshot dari `videoId` dan `sourceOffset`.

## Penghapusan akun

`user.deleted` memicu setiap service menghapus atau menganonimkan data milik user di schema masing-masing. Setiap service yang menyimpan data user wajib meng-consume event ini (aturan di `docs/architecture/owners.md` dan checklist `new:service`). Komentar dianonimkan secara default. Kalau `purgeComments` true, isinya diganti "[komentar dihapus]".

| Service | Tindakan |
|---|---|
| identity-svc | Hapus `user`, `session`, `account`, `verification`, dan `channel` di transaksi `DELETE /v1/me`, lalu tulis `user.deleted` dan `channel.deleted` |
| upload-svc | Batalkan multipart yang berjalan, hapus `upload_session`, `upload_part`, `quota_usage` |
| video-svc | Semua video user ke `deleted`. Hapus playlist user, baris `video_access` user, `video_access_invite` yang dibuat user, dan `appeal` milik user |
| video-svc (proyeksi) | Hapus `channel_cards` channel user |
| social-svc | Hapus subscription dan reaksi user, perbarui hitungan, kirim `subscription.removed` dan `engagement.counts_changed`. Anonimkan atau purge komentar. Kosongkan `reporter_id`. Hapus `user_cards` dan `channel_cards`. Saat `channel.deleted`, subscription orang lain ke channel itu di-set `active=false` |
| feed-svc | Hapus `feed:{userId}`, proyeksi subscription user, dan kartu channel user |
| search-svc | Hapus dokumen channel user. Dokumen video terhapus lewat `video.deleted` |
| notification-svc | Hapus `invite_delivery` yang dikirim user, notifikasi, push token, proyeksi `subscriptions`, `user_cards`, `channel_cards` |
| metrics-svc | Hapus partisi user di `watch_progress` dan `watch_history`. Kosongkan `owner_user_id` di `video_meta` |
| live-svc | Akhiri siaran aktif, hapus `live_stream` milik channel user |

Status M0: identity-svc menghapus `user`, sesi, dan `channel` lalu menulis kedua event dalam satu transaksi. Baris `verification` milik email user belum ikut dihapus dan kedaluwarsa sendiri (grand plan §18A). Ini berbeda dengan baris identity-svc di matriks di atas.

Data yang hilang sendiri setelah retensinya habis: topic retry dan DLQ (14 hari), `invite_delivery` (14 hari setelah terkirim), `video_access_invite` yang tidak cocok (30 hari), kunci dedupe view (24 jam), state sesi view (6 jam), outbox (7 hari), log Redpanda `identity.v1`, `video.v1`, `social.v1`, dan heartbeat (7 hari), `pg_dump` (7 hari). `identityHash` di `metrics.views.v1` tidak bisa dikaitkan lagi setelah kuncinya dimusnahkan (37 hari).

## Rujukan

- grand plan §6 (Asinkron, Evolusi skema), §8, §9, §10, §18 (M4 exit criteria), §18A, §20 revisi 14 sampai 16
- `packages/contracts/src/index.ts`, `packages/service-kit/src/outbox.ts`, `packages/service-kit/src/consumer.ts`, `apps/identity-svc/drizzle/0001_outbox_triggers.sql`, `apps/identity-svc/src/modules/me/me.service.ts`
