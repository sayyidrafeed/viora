# ADR 002: Monorepo Bun + Turborepo, tanpa Nx

Status: Diterima (2026-10-28)

## Konteks

Viora punya 11 service, dua klien (web dan mobile), package bersama, infra, dan tools (§13). Kontrak event dan klien API dipakai lintas service dan klien, jadi semuanya ada di satu repo. Mesin dev hanya 16 GB RAM, dan heavy run (full test, typecheck, build image) harus lewat `gated-run heavy`, satu per waktu (§1).

## Keputusan

- Satu repo dengan Bun workspaces dan Turborepo. `package.json` root saat ini: `packageManager` `bun@1.4.4`, workspaces `apps/*`, `packages/*`, `spikes/*`, dan `turbo` 2.11.10.
- Layout mengikuti §13: `apps/` untuk service dan klien, `packages/` (`contracts`, `service-kit`, `api-client`, `design-tokens`, `config`), `infra/`, `tools/`, `docs/`.
- Package baru di `packages/*` hanya boleh dibuat kalau sudah ada dua consumer nyata (aturan dari fikes, dicatat di `docs/architecture/owners.md`).
- Konvensi service dari api-siera: modul `src/modules/<m>/<m>.{schema,service,handlers,routes,errors,index}.ts`, impor modul hanya lewat `index.ts`, app Hono hanya lewat factory `service-kit`.
- Guardrail di repo: AGENTS.md per workspace dengan symlink CLAUDE.md, oxlint dengan aturan batas modul, hook agent yang menolak edit file hasil generate, dan scaffolder `new:service` serta `new:module`.
- CI dibagi per lane berdasarkan diff, dan image hanya dibangun untuk service yang berubah (§15).

## Konsekuensi

- Satu `bun.lock` untuk semua workspace.
- Lint menolak `import { Hono } from 'hono'` di luar `service-kit`, impor ke file internal modul lain, dan impor antar-modul yang tidak lewat `index.ts` (revisi 16, `.oxlintrc.json`).
- Status per grand plan revisi 17 (2026-10-29): `apps/web`, `packages/api-client`, dan workspace `e2e` ada. `apps/mobile` dan `packages/design-tokens` menyusul di M6, karena aturan dua consumer nyata belum terpenuhi untuk design tokens. Aturan lint anti-slop belum ada.
- CI ada di `.github/workflows/ci.yml` dengan dua job (`static` dan `integration`); pemilihan lane per diff belum dibuat.

## Alternatif yang ditolak

- Nx. Disebut di judul ADR di §17, tapi grand plan tidak mencatat alasan penolakannya. Alasan ini terbuka dan perlu diisi pemilik keputusan.
- `packages/db` bersama untuk migrasi. Ditolak di §5: migrasi tinggal di folder service pemilik schema.

## Rujukan

- grand-plan §1, §5 (aturan kepemilikan data), §13, §15 (CI/CD), §20 revisi 16
- `docs/architecture/owners.md`
