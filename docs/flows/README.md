# Viora: lo-fi e2e flow

Wireframe lo-fi untuk setiap journey di grand plan (`../grand-plan.md`). Setiap flow punya file `.excalidraw` yang bisa diedit di excalidraw.com dan PNG hasil render.

Cara membaca diagram:

- Kotak berjudul adalah satu layar. Frame lebar untuk web, frame tegak untuk mobile.
- Panah berlabel adalah aksi user. Panah putus-putus adalah cabang (jalur alternatif atau gagal).
- Teks abu-abu di bawah layar menyebut endpoint, event, atau tabel dari grand plan.
- Teks merah `ASUMSI` menandai hal yang belum terverifikasi atau belum diputuskan. Semuanya dikumpulkan di bawah.

## Daftar flow

| No | Flow | File | Bagian grand plan |
|---|---|---|---|
| 01 | Daftar, verifikasi email, masuk, reset password | [PNG](01-auth.png) · [excalidraw](01-auth.excalidraw) | §2, §6, §11 identity |
| 02 | Upload sampai siap tonton, termasuk gagal diproses | [PNG](02-upload.png) · [excalidraw](02-upload.excalidraw) | §8, §9 upload, §10 |
| 03 | Menonton video publik, scrub, resume | [PNG](03-watch.png) · [excalidraw](03-watch.excalidraw) | §9 playback, §12 |
| 04 | Visibilitas, allowlist private, pencabutan akses | [PNG](04-visibility.png) · [excalidraw](04-visibility.excalidraw) | §8 visibilitas, §9 playback |
| 05 | Subscribe dan feed subscription | [PNG](05-subscribe-feed.png) · [excalidraw](05-subscribe-feed.excalidraw) | §9 feed, §10 social |
| 06 | Like dan komentar bertingkat | [PNG](06-like-comment.png) · [excalidraw](06-like-comment.excalidraw) | §7 social, §11 social |
| 07 | Search | [PNG](07-search.png) · [excalidraw](07-search.excalidraw) | §11 search, §12 |
| 08 | Notifikasi in-app dan push + deep link | [PNG](08-notifications.png) · [excalidraw](08-notifications.excalidraw) | §10, §12 mobile |
| 09 | Library: history, watch later, playlist | [PNG](09-library.png) · [excalidraw](09-library.excalidraw) | §7 video, §11 metrics |
| 10 | Rekomendasi dan related video | [PNG](10-recommendations.png) · [excalidraw](10-recommendations.excalidraw) | §9 feed |
| 11 | Analytics creator | [PNG](11-analytics.png) · [excalidraw](11-analytics.excalidraw) | §9 metrics, §12 |
| 12 | Moderasi: report, takedown, keberatan | [PNG](12-moderation.png) · [excalidraw](12-moderation.excalidraw) | §2, §8, §11 |
| 13 | Hapus akun | [PNG](13-delete-account.png) · [excalidraw](13-delete-account.excalidraw) | §10, §11 identity |
| 14 | Mobile inti (Expo) | [PNG](14-mobile.png) · [excalidraw](14-mobile.excalidraw) | §12 mobile, M6 |
| 15 | Live streaming (stretch) | [PNG](15-live.png) · [excalidraw](15-live.excalidraw) | §2, M8 |
| 16 | Ops: dari PR sampai produksi | [PNG](16-ops-release.png) · [excalidraw](16-ops-release.excalidraw) | §15 CI/CD, observability |
| 17 | Ops: DLQ, rebuild Scylla, load test | [PNG](17-ops-operations.png) · [excalidraw](17-ops-operations.excalidraw) | §6 DLQ, §15, M7 |
| 18 | Kelola video, channel, dan subscription | [PNG](18-manage-content.png) · [excalidraw](18-manage-content.excalidraw) | §8, §11 video, identity, social |
| 19 | Admin: report komentar dan ban user | [PNG](19-admin-ban.png) · [excalidraw](19-admin-ban.excalidraw) | §7 identity, §10 `user.banned` |
| 20 | Simulasi monetisasi (stretch) | [PNG](20-monetization-mock.png) · [excalidraw](20-monetization-mock.excalidraw) | §2 stretch, M8 |

Flow 01, 03, dan 06 punya catatan milestone di bagian bawah, karena layarnya memuat elemen dari milestone yang berbeda.

Jalur gagal yang tidak punya flow sendiri tetap muncul sebagai cabang: transcode gagal (02), akses private ditolak (04), search tanpa hasil (07), koneksi putus saat upload mobile (14), DLQ (17).

## Daftar ASUMSI

Teks merah di diagram: hal yang belum terverifikasi dan menunggu spike atau pengukuran.

| Flow | Asumsi | Kapan diverifikasi |
|---|---|---|
| 01 | Penyedia email belum dipilih (Cloudflare Email Service atau Resend) | M0, ADR 025 |
| 02 | Batas 2 GB, 30 menit, kuota 10 upload per hari | Keputusan produk, M1 |
| 03 | Posisi resume ditulis metrics-svc dari heartbeat, bisa tertinggal sampai 10 detik | M3 |
| 04 | Rambatan Workers KV sampai ±60 detik, selama itu segmen lama masih bisa diputar | Spike awal M1 |
| 07 | Video baru bisa dicari ≤10 detik setelah `ready` | M4 |
| 08 | Map deep link exhaustive dari union hasil generate (pola mobile-siera) | M6 |
| 10 | User baru tanpa history melihat trending (cold start) | Diputuskan (revisi 4), perilaku diuji di M5 |
| 11 | Jeda angka views ≤2 menit (SLO) belum diukur | M3, M7 |
| 14 | Upload saat app di background | Spike M6 |
| 15 | Latensi live <5 detik | M8 |
| 17 | Rebuild Scylla hanya lengkap untuk nilai terakhir per key, heartbeat mentah hanya 7 hari | M3 |
| 17 | Server satu node cukup untuk prod dan `preview` bersamaan | M7 |
| 20 | Event impresi iklan dan perhitungan revenue | M8 |

## Temuan untuk grand plan

Semua 20 temuan sudah diputuskan dan diterapkan ke grand plan: temuan DLQ di revisi 3, sisanya di revisi 4 (lihat `../grand-plan.md` §20). Catatan di bawah setiap layar sudah diperbarui sesuai keputusan itu.

## Membuat ulang PNG

```bash
excalidraw render docs/flows/02-upload.excalidraw --out docs/flows/02-upload.png --scale 2
```
