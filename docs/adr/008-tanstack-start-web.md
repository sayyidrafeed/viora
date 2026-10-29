# ADR 008: TanStack Start untuk web

Status: Diterima (2026-10-28)

## Konteks

Halaman tonton, channel, landing, dan search perlu SSR dengan meta Open Graph dari server. Halaman studio, pengaturan, dan admin boleh client-only. Web dan mobile memakai SDK yang sama dari `packages/api-client` (ADR 005). Semua trafik HTTP masuk lewat Kong, termasuk SSR (ADR 007).

## Keputusan

- `apps/web` memakai TanStack Start dengan SSR untuk `/watch/:id`, `/@:handle`, `/`, dan halaman search.
- Library TanStack yang dipakai: Router, Query, Form, Pacer (throttle heartbeat, debounce search), dan Charts (analytics creator).
- TanStack DB hanya dipakai kalau ada kasus yang tidak bisa diselesaikan Query dengan optimistic update. Keputusan itu ditulis sebagai ADR terpisah saat terjadi.
- Web mengambil JWT dari header `set-auth-jwt` saat `getSession`, atau dari `/v1/auth/token`, lalu mengirimnya sebagai bearer ke Kong. Sesi cookie Better Auth hanya dipakai untuk memperbarui JWT.
- SSR meneruskan `CF-Connecting-IP` dari request asli, supaya request SSR tidak berbagi satu bucket rate limit.
- Halaman `/admin/*` client-only dan dijaga `role=admin` di `beforeLoad`.
- UI: Tailwind 4 dan shadcn. Konvensi dari web-siera: `routes/` merangkai halaman dan memegang guard, `components/` hanya JSX, perilaku di hooks, logika murni di `lib/<domain>/`, alias `@/`, nama hook `use-kebab.ts`.

## Konsekuensi

- Grand plan mencatat TanStack Start 1.0 sudah stabil.
- SSR TanStack Charts butuh `initialWidth` atau `width` eksplisit supaya tidak bergeser saat hydration. Docs TanStack Charts dibaca lewat Context7 sebelum M5.
- Tidak ada test komponen UI di jsdom atau happy-dom. Logika UI dipindah ke fungsi murni dan diuji di level unit (lihat `docs/test-strategy.md`).
- Status per grand plan revisi 17 (2026-10-29): `apps/web` (TanStack Start 1.169, Vite 8, Tailwind 4) berisi halaman daftar, masuk, dan shell yang memanggil `/v1/me` lewat `@viora/api-client`, semuanya dilayani Kong di satu origin. Halaman auth dan shell client-only (`ssr: false`). UI masih "draft without direction" sampai ada `DESIGN.md`.

## Alternatif yang ditolak

Alasan di bawah ditulis technical architect atas delegasi pemilik proyek (2026-10-29). Keputusannya sendiri sudah dibuat di grand plan; yang ditambahkan di sini hanya alasannya.

- Next.js (App Router). Ditulis di sketsa stack awal sebelum grand plan, lalu diganti. Model React Server Components dan server actions-nya tumpang tindih dengan arsitektur viora, karena data selalu datang dari API service lewat Kong, bukan dari database yang diakses server web. Fitur terbaiknya juga paling mulus di platform Vercel, sedangkan viora jalan di k3s sendiri.
- React Router v7 (framework mode). Setara untuk SSR, tapi tidak memberi router dengan search params bertipe dan integrasi Query, Form, Pacer, dan Charts dari keluarga TanStack yang dipakai di seluruh web (§12).
- SPA Vite murni. Lebih sederhana, tapi §12 butuh SSR dan meta Open Graph untuk `/watch/:id` dan `/@:handle`.
- Risiko yang diterima: TanStack Start lebih muda dari Next.js, dan API-nya masih bergerak (contoh: output build Vite 8 berbeda dari docs hosting lama). Versi di-pin persis di `apps/web/package.json`.

## Rujukan

- grand-plan §5 (Klien), §6 (Identitas dan otorisasi, IP asli), §12 (Web), §14, §18 (M0), §18A
