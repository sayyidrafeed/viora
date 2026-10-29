# ADR 028: Policy panggilan sinkron: timeout, satu lapis retry, deadline, breaker terbatas

Status: Diterima (2026-10-28)

## Konteks

Komunikasi utama antar-service adalah event (ADR 004). Beberapa jalur tetap butuh panggilan sinkron untuk read-your-writes atau validasi kepemilikan. Seapedia hampir tidak punya panggilan sinkron karena memakai koreografi dan replika lokal. Klien internalnya ditulis manual dengan timeout tetap dan tanpa deadline.

Sumber verifikasi (`docs/verification.md` no. 11): AWS Builders' Library meminta timeout di setiap panggilan, retry hanya untuk operasi idempoten dan hanya di satu lapis, dengan backoff berjitter. Circuit breaker menambah perilaku modal yang sulit dites. Panduan gRPC meminta yang diteruskan adalah sisa waktu, bukan timestamp absolut. cockatiel 4.0.0 jalan di Bun 1.4.4 dalam smoke test minimal.

## Keputusan

- Panggilan sinkron hanya untuk read-your-writes atau validasi kepemilikan. Setiap panggilan sinkron baru wajib menjelaskan kenapa proyeksi lokal tidak cukup.
- Policy di klien `service-kit` memakai cockatiel:
  - Setiap panggilan punya timeout. Default 2 detik, dan tidak boleh melebihi sisa deadline.
  - Sisa deadline diteruskan lewat header `x-deadline-ms` (sisa milidetik).
  - Retry hanya di klien `service-kit`, hanya untuk GET dan operasi yang membawa idempotency key, dengan backoff berjitter dan anggaran retry per proses.
  - Circuit breaker hanya untuk dependency opsional yang punya fallback. Contoh: history untuk rekomendasi, dengan fallback ke trending.
- Operasi tulis yang dipanggil sinkron dibuat idempoten. `POST /internal/channels/ensure` adalah upsert per `userId`.
- Panggilan antar-service memakai token service dan mengirim `userId` sebagai parameter eksplisit, tanpa meneruskan token user (ADR 006).

Panggilan sinkron yang sudah dibenarkan di grand plan:

| Panggilan | Alasan |
|---|---|
| `GET /internal/videos/:id/owner` dari upload-svc | Validasi kepemilikan dan status sebelum membuat sesi upload |
| `POST /internal/channels/ensure` dari video-svc | Channel dibuat saat video pertama, idempoten |
| `GET /internal/videos/:id/access?userId=` dari helper `canView` | Allowlist video private tidak diproyeksikan ke setiap service. Hasil di-cache 30 detik di `redis-cache` |
| `POST /internal/users/resolve-email` dari video-svc | Mencocokkan undangan dengan user yang emailnya terverifikasi |
| `GET /internal/transcode/jobs/:jobId` dari sweeper video-svc | Menanyakan state job sebelum menandai video gagal |
| `GET /internal/metrics/users/:id/recent-history` | Rekomendasi, dengan breaker dan fallback ke trending |

## Konsekuensi

- Pemilik header deadline adalah `service-kit`, bukan setiap service.
- Satu lapis retry berarti service perantara tidak boleh me-retry panggilan yang sudah di-retry klien.
- Status per grand plan revisi 17 (2026-10-29): `createInternalFetch` di `service-kit` (timeout 2 detik dibatasi sisa deadline, `x-deadline-ms` diteruskan, retry hanya GET atau idempotency key dengan anggaran retry per proses, breaker opsional) dan `serviceAuth` (JWT dengan audience = service tujuan; dev memakai `devServiceTokens`, k3s memakai `projectedServiceTokens`). Dibuktikan `packages/service-kit/test/internal.test.ts` terhadap server HTTP sungguhan. Klien internal hasil generate dan discovery OIDC k3s menyusul di M1.

## Alternatif yang ditolak

- Retry di beberapa lapis. AWS Builders' Library meminta retry hanya di satu lapis.
- Circuit breaker di semua panggilan. Perilaku modal yang sulit dites, jadi dibatasi ke dependency opsional dengan fallback.
- Deadline sebagai timestamp absolut. Rentan clock skew.
- Timeout tetap tanpa deadline (pola klien internal Seapedia).

## Rujukan

- grand-plan §6 (Sinkron), §8 (Visibilitas, akses di service lain), §9, §11 (endpoint internal), §20 revisi 3 dan 16
- `docs/verification.md` no. 11 dan bagian "Pembanding: Seapedia"
