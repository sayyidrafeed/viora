# ADR 025: Penyedia email transaksional

Status: Diterima (2026-10-29)

## Konteks

Viora mengirim email transaksional di beberapa alur:

- Verifikasi email saat daftar dan reset password, lewat Better Auth di identity-svc (M0).
- Email undangan video private untuk alamat yang belum terdaftar, lewat sender di notification-svc (M2).

Login dengan email + password ditolak 403 sebelum email terverifikasi, jadi tanpa pengiriman email user tidak bisa masuk di prod. Deliverable M0 menyebut "verifikasi email dan reset password lewat penyedia email" (§18).

Kandidat yang disebut grand plan (§5): Cloudflare Email Service dan Resend. Pemilik proyek memilih Resend (2026-10-29).

## Keputusan

Resend menjadi penyedia email transaksional, dipanggil lewat REST API (`POST https://api.resend.com/emails`) dengan `fetch`, tanpa SDK.

- identity-svc memakai antarmuka `Mailer` (`send({ to, subject, text })`, `apps/identity-svc/src/mailer.ts`). `createMailer` memilih implementasi dari `MAIL_PROVIDER`:
  - `log` untuk dev dan test, email ditulis ke log;
  - `resend` untuk lingkungan yang mengirim email sungguhan.
  Pilihan ini eksplisit, tidak ditebak dari ada atau tidaknya API key.
- Service gagal start kalau `MAIL_PROVIDER=resend` tanpa `RESEND_API_KEY` dan `MAIL_FROM`, atau kalau `MAIL_PROVIDER=log` dipakai saat `NODE_ENV=production`. Konfigurasi yang salah ketahuan saat deploy, bukan saat user mendaftar.
- Setiap email memakai satu `Idempotency-Key` yang sama di semua percobaan. Resend menyimpan key 24 jam dan mengembalikan respons pertama untuk key yang sama, jadi retry setelah respons yang hilang tidak mengirim email ganda.
- Hanya 429, 5xx, dan error jaringan yang dicoba ulang (maksimal 2 kali, menghormati `Retry-After`). Error 4xx lain langsung gagal dengan pesan dari Resend.
- notification-svc (M2) memakai adapter yang sama lewat tabel `delivery` dan sender terpisah (§6). Kalau dipakai di dua service, adapter dipindah ke package bersama sesuai aturan dua consumer.

Alasan memilih Resend (keputusan pemilik, alasan ditulis technical architect):

- API kirim email satu endpoint dengan idempotency key bawaan, sehingga aturan "pengiriman ulang tidak membuat email ganda" (§6) bisa dipenuhi tanpa tabel dedupe tambahan di identity-svc.
- Kode error dan batas rate terdokumentasi: default 10 request per detik per team, 429 saat terlampaui. Volume email transaksional viora jauh di bawah itu.
- Bisa dipanggil dari service mana pun lewat HTTPS, tidak terikat ke Worker.

## Konsekuensi

- Pengiriman sungguhan butuh dua langkah dari pemilik proyek: domain pengirim diverifikasi di Resend (record DNS SPF dan DKIM), dan API key disimpan di SOPS sebagai `RESEND_API_KEY`. Sampai itu terjadi, semua lingkungan memakai `MAIL_PROVIDER=log`.
- Kontrak adapter diuji terhadap server HTTP lokal yang meniru `POST /emails` (`apps/identity-svc/test/mailer.test.ts`). Pengiriman ke Resend sungguhan belum diuji.
- Risiko yang diterima: ketergantungan pada vendor. Karena semua pemanggilan lewat antarmuka `Mailer`, mengganti penyedia hanya menambah satu adapter.
- Belum ditangani: perilaku Better Auth kalau pengiriman verifikasi gagal saat sign-up (apakah pendaftaran dibatalkan atau user bisa meminta kirim ulang lewat `/send-verification-email`). Dicek saat domain sudah aktif.
- Alert DLQ dari Grafana ke email owner (ADR 024) tetap kanal terpisah.

## Alternatif yang ditolak

- Cloudflare Email Service. Kelebihannya satu vendor dengan R2 dan Worker yang sudah dipakai. Tidak dievaluasi lebih jauh setelah pemilik memilih Resend. Kalau nanti dipilih, cukup menambah adapter `Mailer`.
- SDK resmi Resend. Tidak dipakai karena hanya satu endpoint yang dibutuhkan, dan `fetch` menghindari dependency baru.

## Rujukan

- grand-plan §2 (Akun), §5 (infrastruktur bersama), §6 (Pengiriman pesan ke manusia), §8 (Visibilitas, undangan email), §18 (M0, M2), §18A (Hasil identity-svc M0)
- `apps/identity-svc/src/mailer.ts`, `apps/identity-svc/src/auth/auth.ts`, `apps/identity-svc/src/index.ts`, `apps/identity-svc/test/mailer.test.ts`
- Resend API: `POST /emails`, header `Idempotency-Key`, kode error, dan rate limit (dokumentasi resend.com/docs/api-reference, dicek 2026-10-29)
