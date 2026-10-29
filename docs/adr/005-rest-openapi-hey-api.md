# ADR 005: REST + OpenAPI + hey-api, bukan gRPC

Status: Diterima (2026-10-28)

## Konteks

Klien web dan mobile memanggil API publik lewat Kong. Service saling memanggil secara sinkron hanya untuk read-your-writes atau validasi kepemilikan (§6, ADR 028). Generator konfigurasi Kong membuat route per operasi OpenAPI (ADR 007), jadi spec OpenAPI juga menjadi sumber routing gateway.

## Keputusan

- REST untuk API publik (`/v1`) dan internal (`/internal`, port terpisah).
- Setiap service punya spec OpenAPI sendiri dari kode (hono-openapi) dan men-generate-nya saat build. Spec ditampilkan lewat Scalar.
- Setiap operasi OpenAPI membawa `x-auth` (`public`, `optional`, `required`) untuk generator Kong.
- Klien antar-service di-generate dari spec masing-masing.
- `packages/api-client` berisi SDK hey-api dan `queryOptions` TanStack untuk web dan mobile, di-generate dari spec gabungan semua service, dengan gate drift di CI. Versi hey-api di-pin persis karena masih tahap pengembangan awal.
- CI menjalankan oasdiff terhadap spec di `main` dan gagal kalau ada breaking change tanpa versi baru.
- Satu bentuk error: `{ "error": { "code", "message", "details"? } }`. Respons sukses tanpa pembungkus. List publik memakai cursor (`{ items, nextCursor }`).

## Konsekuensi

- Hook agent menolak edit file hasil generate (`packages/api-client`, spec OpenAPI).
- Deadline diteruskan lewat header `x-deadline-ms` berisi sisa milidetik, mengikuti pola deadline dari panduan gRPC (ADR 028).
- Status per grand plan revisi 17 (2026-10-29): identity-svc menulis `openapi.json` lewat `hono-openapi` 1.5.0 tanpa server atau database (`bun run openapi`). `packages/api-client` di-generate dengan hey-api 0.99.0 (fetch client dan TanStack Query); hey-api butuh API JavaScript TypeScript, jadi package ini memakai TypeScript 6.0.3 khusus untuk codegen. oasdiff jalan di CI. Klien internal hasil generate menyusul di M1.

## Alternatif yang ditolak

- gRPC. Disebut di judul ADR di §17, tapi grand plan tidak mencatat alasan penolakannya. Alasan ini terbuka dan perlu diisi pemilik keputusan.

## Rujukan

- grand-plan §6 (Sinkron), §11 (Kontrak OpenAPI), §13 (Guardrail), §14 (level Kontrak)
- `docs/verification.md` no. 11
