# video-svc

Konvensi umum ada di AGENTS.md root. Pemilik data dan event service ini dicatat di docs/architecture/owners.md.

- Modul dibuat dengan `bun run new:module video-svc <modul>`.
- Port lokal 13004.

Checklist sebelum service ini dianggap jalan:

- [ ] Baris pemilik di docs/architecture/owners.md (tabel, event yang dikirim, event yang di-consume).
- [ ] Consumer `user.deleted` kalau service menyimpan data user (§10).
- [ ] `bun run outbox:snapshot <entity> --all` untuk setiap entitas yang dimiliki (§6).
- [ ] Env divalidasi lewat `loadEnv` di src/index.ts.
