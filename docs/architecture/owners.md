# Pemilik data dan event

Setiap tabel dan topic punya tepat satu service pemilik. Service lain membaca lewat event atau API pemilik, tidak lewat database pemilik (§5).

Package baru di `packages/*` baru boleh dibuat kalau sudah ada dua consumer nyata.

| Service | Schema dan tabel | Event yang dikirim | Event yang di-consume | Status |
|---|---|---|---|---|
| identity-svc | `identity`: `user`, `session`, `account`, `verification`, `channel`, `outbox` | `identity.v1` | belum ada | M0, jalan |
| upload-svc | `upload` | `upload.v1` | `video.v1`, `identity.v1` | skeleton |
| transcode-svc | tanpa database (BullMQ di Redis) | `transcode.v1` | `video.v1` | skeleton |
| video-svc | `video` | `video.v1` | `upload.v1`, `transcode.v1`, `identity.v1`, `social.v1`, `metrics.v1` | skeleton |
| social-svc | `social` | `social.v1` | `video.v1`, `identity.v1` | skeleton |
| feed-svc | `feed` | belum ada | `video.v1`, `social.v1`, `identity.v1`, `metrics.*` | skeleton |
| metrics-svc | ScyllaDB `viora_metrics`, Redis | `playback.heartbeat.v1`, `metrics.views.v1` | `video.v1`, `social.v1`, `identity.v1`, `metrics.*` | skeleton |
| cdc-svc | tanpa database | `metrics.v1` | `metrics.video_totals.v1` | skeleton |
| search-svc | Meilisearch | belum ada | `video.v1`, `identity.v1` | skeleton |
| notification-svc | `notification` | belum ada | `video.v1`, `social.v1`, `identity.v1`, `live.v1` | skeleton |
| live-svc | `live` | `live.v1` | `identity.v1` | skeleton (stretch) |

Rincian event per topic ada di §10 grand plan. Perbarui tabel ini saat service mulai mengirim atau meng-consume event.
