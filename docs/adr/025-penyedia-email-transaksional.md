# ADR 025: Penyedia email transaksional

Status: Terbuka

## Konteks

Viora mengirim email transaksional di beberapa alur:

- Verifikasi email saat daftar dan reset password, lewat Better Auth di identity-svc (M0).
- Email undangan video private untuk alamat yang belum terdaftar, lewat sender di notification-svc (M2).

Login dengan email + password ditolak 403 sebelum email terverifikasi, jadi tanpa pengiriman email user tidak bisa masuk di prod. Deliverable M0 menyebut "verifikasi email dan reset password lewat penyedia email" (§18).

Kandidat yang disebut grand plan (§5): Cloudflare Email Service dan Resend. Pilihan dijadwalkan di M0, tapi belum dibuat.

## Keputusan

Belum ada keputusan penyedia. Grand plan juga tidak menulis kriteria pemilihan. Pemilik keputusan perlu menetapkan kriteria dan bukti sebelum status berubah menjadi Diterima.

Yang sudah berlaku di kode:

- identity-svc memakai antarmuka `Mailer` dengan satu method `send({ to, subject, text })` (`apps/identity-svc/src/mailer.ts`).
- Implementasi saat ini adalah `logMailer`, yang menulis email ke log supaya link verifikasi bisa diklik di dev. Ini dipakai di `src/index.ts`.
- Better Auth memanggil mailer untuk `sendVerificationEmail` dan `sendResetPassword`.
- Pengiriman email di notification-svc mengikuti tabel `delivery` dan sender terpisah dengan `FOR UPDATE SKIP LOCKED`, sehingga pengiriman ulang event tidak membuat email ganda (§6). Aturan ini tidak bergantung pada penyedia.

## Konsekuensi

- Selama status Terbuka, exit criteria M0 untuk verifikasi email dan reset password lewat penyedia nyata belum terpenuhi (§18A, Drizzle + Better Auth: "penyedia email nyata (ADR 025, sementara log)").
- Penyedia yang dipilih harus bisa dipanggil dari identity-svc dan notification-svc. Secret-nya dikelola lewat SOPS seperti secret lain (§15).
- Alert DLQ dari Grafana ke email owner (ADR 024) adalah kanal terpisah, dan grand plan tidak mengikatnya ke penyedia ini.

## Alternatif yang ditolak

Belum ada. Cloudflare Email Service dan Resend masih sama-sama kandidat.

## Rujukan

- grand-plan §2 (Akun), §5 (infrastruktur bersama), §6 (Pengiriman pesan ke manusia), §8 (Visibilitas, undangan email), §18 (M0, M2), §18A (Hasil identity-svc M0)
- `apps/identity-svc/src/mailer.ts`, `apps/identity-svc/src/auth/auth.ts`, `apps/identity-svc/src/index.ts`
