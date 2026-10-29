# ADR 006: Better Auth di identity-svc, JWT ES256, denylist sinkron, token service dari projected ServiceAccount

Status: Diterima (2026-10-28). Diperbarui 2026-10-29 dari spike M0 dan identity-svc (revisi 14 sampai 16).

## Konteks

Kong OSS hanya bisa memverifikasi signature dan `exp` JWT, tidak bisa menerbitkan token atau mengecek `aud` (ADR 007). Setiap service harus bisa memverifikasi token user sendiri tanpa memanggil identity-svc. Token stateless tidak bisa dicabut di Kong, padahal ban dan hapus akun harus langsung berlaku. Komunikasi antar-service butuh identitas service tanpa secret per service.

## Keputusan

Token user:

- identity-svc menerbitkan JWT lewat plugin JWT Better Auth: ES256, umur 10 menit, `sub`, `role`, `iss`, `aud=viora-api`, header `kid`, dan klaim `ev` (email terverifikasi) lewat `definePayload`. Tanpa email. `basePath` Better Auth adalah `/v1/auth`.
- Kunci datang dari keypair ES256 di SOPS lewat keyring kustom (`adapter.getJwks`). `disablePrivateKeyEncryption: true` wajib karena kunci datang mentah.
- Plugin memilih kunci dengan `createdAt` terbaru, jadi keyring memberi kunci aktif (`JWT_ACTIVE_KID`) `createdAt` paling baru. Di kode, kunci aktif mendapat `new Date(1)` dan sisanya `new Date(0)`.
- `adapter.createJwk` melempar error, jadi plugin tidak pernah membuat kunci sendiri. Validasi schema Better Auth 1.7 menuntut tabel `jwks`, jadi tabel itu dibuat dengan `check (false)` (`jwks_from_keyring_only`). Setiap upaya menyimpan kunci gagal di Postgres, dan validasi schema tetap aktif untuk mendeteksi drift.
- `advanced.disableOriginCheck: false` dikunci di konfigurasi. Better Auth 1.7.14 mematikan origin check dan CSRF check secara default saat `NODE_ENV=test` atau `TEST=true`, dan `bun test` men-set `NODE_ENV=test`.
- Route bawaan Better Auth yang melewati denylist dan outbox (`/v1/auth/admin/*`, `/v1/auth/delete-user`) ditolak di Kong dan juga di identity-svc sendiri (404). Admin dan hapus akun hanya lewat route identity-svc (`/v1/admin/users/*`, `DELETE /v1/me`).
- `service-kit` memverifikasi ulang JWT di setiap service: algoritma di-pin ES256, `kid` harus dikenal, `exp` dan `sub` wajib, ditambah `iss`, `aud`, dan denylist. Token yang ada di header tapi tidak valid selalu 401, juga di route `optional`.
- Rotasi kunci manual lewat runbook tiga commit dengan gerbang (§6). `rotationInterval` Better Auth tidak dipakai.

Revokasi:

- Saat ban atau hapus akun, identity-svc menulis userId ke denylist di `redis-durable` lebih dulu, baru mencabut sesi, semuanya sebelum merespons. `deny` memakai TTL pengaman 1 jam. Setelah sesi dicabut, TTL diturunkan ke 600 detik. Unban menghapus kunci denylist.
- Service menjawab 401 `account_banned` untuk user di denylist.

Token service:

- Projected ServiceAccount token Kubernetes dengan `audience` = nama service tujuan, diverifikasi lewat JWKS issuer OIDC k3s yang di-cache. Panggilan antar-service tidak meneruskan token user. Di Compose, `service-kit` memakai issuer dev dengan kunci statis.

## Konsekuensi

- Risiko yang diterima: token segmen video private yang sudah diterbitkan untuk user yang di-ban tetap berlaku sampai kedaluwarsa (durasi video + 30 menit).
- Event identity ditulis trigger Postgres di transaksi Better Auth (ADR 004). `user.deleted` dan `channel.deleted` ditulis eksplisit oleh `DELETE /v1/me`.
- Origin hanya diperiksa untuk request yang membawa cookie. Sign-in tanpa cookie tidak dicek, dan itu semantik CSRF Better Auth.
- Terbukti di M0: keyring 12/12 test di spike, 13/13 test integrasi identity-svc lewat PgBouncer, kontrak token Expo dari sisi server, dan perbaikan dua `DELETE /v1/me` bersamaan (dibuktikan lewat mutasi).
- Belum terbukti: login Google, penyedia email nyata (ADR 025), reload kunci saat file berubah, denylist di route `optional` (benar di kode, belum ada test), pembatalan denylist saat transaksi gagal, `fetch` React Native membaca `set-cookie` di perangkat (M6), discovery OIDC k3s (spike M1).
- Belum dikerjakan di M0: verifikasi token service, route admin ban/unban, `PATCH /v1/me`, route channel.
- Baris `verification` milik email user tidak ikut dihapus saat `DELETE /v1/me` dan kedaluwarsa sendiri. Ini berbeda dengan matriks pembersihan di §10.

## Alternatif yang ditolak

- EdDSA (default Better Auth). Docs Kong hanya menyebut RS256, ES256, dan HS256.
- Kunci di-seed ke `identity.jwks` (revisi 6). Diganti keyring kustom di revisi 7, karena kunci hanya boleh datang dari SOPS.
- `rotationInterval` Better Auth. Plugin `jwt` Kong OSS tidak bisa fetch JWKS, jadi rotasi harus manual dan terkoordinasi.
- After-hook Better Auth untuk event (revisi 7). Lihat ADR 004.
- Token service buatan sendiri dengan client secret (`POST /internal/tokens`, revisi 1). Diganti projected ServiceAccount token di revisi 3.
- mTLS lewat Linkerd. Butuh RAM sekitar 0,5 sampai 0,9 GB untuk 12 service, dan build stabilnya kini dari vendor. Dicatat sebagai scale path.
- Token user dengan `aud` per service (revisi 3). Lihat ADR 007.

## Rujukan

- grand-plan §6 (Identitas dan otorisasi, rotasi kunci JWT), §7 (`identity`), §11, §18A (Hasil spike M0, Hasil identity-svc M0), §20 revisi 3, 5, 7, 14, 15, 16
- `docs/verification.md` no. 7 dan no. 8
- `spikes/auth-keyring`, `apps/identity-svc/src/auth/auth.ts`, `apps/identity-svc/src/auth/keyring.ts`, `apps/identity-svc/src/app.ts`, `packages/service-kit/src/user-auth.ts`, `apps/identity-svc/test/identity.test.ts`
