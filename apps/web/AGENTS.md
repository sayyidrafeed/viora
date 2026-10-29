# web

TanStack Start (Vite 8, Tailwind 4), dilayani Kong di http://localhost:18000 bersama `/v1`, jadi cookie sesi Better Auth berlaku tanpa CORS.

- Konvensi §12: `routes/` merangkai halaman dan memegang guard, `components/` hanya JSX, perilaku di `hooks/use-kebab.ts`, logika murni di `lib/<domain>/`. Alias impor `@/`.
- Panggilan API lewat `@viora/api-client` (hasil generate dari spec OpenAPI). JWT diambil dari `/v1/auth/token` dan di-cache sampai 60 detik sebelum kedaluwarsa (`lib/auth/auth-client.ts`).
- UI masih "draft without direction" (antislop R-37): belum ada `DESIGN.md`. Arah desain ditentukan sebelum UI M1.
- Tidak ada test komponen di jsdom (§14). Logika murni diuji di level unit, journey lewat E2E.
- `bun run dev` di port 13000. Di Linux (CI) set `WEB_HOST=0.0.0.0` supaya Kong di Docker bisa menjangkau Vite.
