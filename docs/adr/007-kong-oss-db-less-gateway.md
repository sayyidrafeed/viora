# ADR 007: Kong 3.9.x OSS DB-less sebagai gateway

Status: Diterima (2026-10-28). Diperbarui 2026-10-29 dari spike M0 dan identity-svc.

## Konteks

Revisi 5 mengganti gateway Hono buatan sendiri dengan Kong atas keputusan user, mengikuti Seapedia. Kong menangani routing dan cek token secara deklaratif, jadi tidak ada kode gateway yang dirawat. Kong OSS punya batas yang membentuk sisa desain: plugin `jwt` tidak bisa mengecek `aud`, tidak bisa menerbitkan token, tidak bisa fetch JWKS, dan `proxy-cache` tidak menggabungkan miss yang bersamaan.

## Keputusan

- Kong Gateway OSS 3.9.x (Apache-2.0), di-pin. Lokal dan spike memakai 3.9.4. Deployment DB-less biasa dengan `infra/kong/kong.yaml`, tanpa Kong Ingress Controller. Traefik bawaan k3s dimatikan.
- `kong.yaml` di-generate oleh `tools/kong-config.ts` per environment, dan CI gagal kalau file tidak sesuai hasil generate:
  - Route per operasi OpenAPI (method + path regex yang di-anchor), bukan per prefix service.
  - Kelas route dari `x-auth`: `public`, `optional` (plugin `jwt` dengan consumer `anonymous`), atau `required` (default).
  - Route Better Auth memakai daftar tetap path `/v1/auth/*` yang diizinkan. Sisanya ditolak, termasuk `/v1/auth/admin/*` dan `/v1/auth/delete-user`.
  - Route statis `public` untuk SSR `apps/web`, dengan rate limit per IP.
  - Credential `jwt` memakai `key_claim_name: kid`. `claims_to_verify: [exp]` wajib diisi, dan generator memastikan `rsa_public_key` terisi untuk ES256.
- Plugin (semua OSS): `jwt`, `rate-limiting` per IP dengan policy Redis, `prometheus`, `cors`, `request-size-limiting`, `opentelemetry`.
- IP asli: `trusted_ips` berisi rentang IP Cloudflare dan CIDR pod `apps/web`, `real_ip_header` = `CF-Connecting-IP`, diteruskan ke service lewat `X-Real-IP`.
- Token per audience diganti NetworkPolicy: port publik setiap service hanya menerima trafik dari pod Kong, dan port `/internal` hanya dari pod service lain dengan token service.
- Rate limit per user dan request collapsing (singleflight + micro-cache 1 detik di `redis-cache`, hanya data publik) dipindah ke `service-kit`.

## Konsekuensi

- Route `optional` meneruskan token palsu sebagai anonim (dibuktikan spike M0), jadi aturan 401 di `service-kit` wajib (ADR 006).
- Risiko yang diterima: token user tidak per audience. Service yang dibobol bisa me-replay token curian kalau NetworkPolicy salah konfigurasi. Ini menyimpang dari saran OWASP. Mitigasi: test NetworkPolicy di CI atau `preview` (M1).
- Risiko yang diterima: tidak ada Kong OSS 3.10 ke atas, dan free mode Enterprise sudah dihapus. Jalur keluar (Envoy Gateway, APISIX) belum diverifikasi.
- Metrik OTel Kong hanya ada di Enterprise 3.13+, jadi SLO latensi diukur lewat plugin `prometheus` (ADR 021).
- Kong DB-less tidak memuat ulang file konfigurasi. Rotasi kunci memakai anotasi checksum yang memaksa rollout.
- Memori sekitar 190 MiB saat idle (pengukuran lokal 3.9.4). Anggaran prod 0,5 GB.
- Terbukti di M0 (spike, 12/12): token dari Better Auth diterima, 401 untuk signature rusak, `kid` belum terdaftar, token kedaluwarsa, dan route `required` tanpa token. Dua `kid` sekaligus diterima. Test hanya mengecek status, bukan alasan di log Kong.
- Status per grand plan revisi 17 (2026-10-29): `tools/kong-config.ts` membuat `infra/kong/kong.yaml` dari spec OpenAPI (route regex per operasi, `x-auth` dengan default `required`), daftar route Better Auth yang dibuka, route `/` ke web, dan route prefix `/v1/` yang menjawab 404 untuk path API lain, termasuk route admin bawaan. Router Kong memakai regex Rust tanpa lookahead, jadi penolakan memakai route prefix, bukan regex negatif. identity-svc tetap menolak sendiri route admin bawaan. CI gagal kalau `kong.yaml` berbeda dari hasil generate.

## Alternatif yang ditolak

- Gateway Hono buatan sendiri (sebelum revisi 5). Diganti atas keputusan user.
- Token user dengan `aud` per service (revisi 3). Plugin `jwt` OSS tidak bisa mengecek `aud` atau menerbitkan token.
- Kong Ingress Controller. Menambah satu pod dan CRD.
- `proxy-cache` Kong untuk request collapsing. Tidak menggabungkan miss yang bersamaan.
- Rate limit per user di Kong. Consumer plugin `jwt` adalah penerbit token, bukan user.

## Rujukan

- grand-plan §6 (Gateway: Kong, Pengganti token per audience), §16, §18A, §19, §20 revisi 5, 6, 7, 9
- `docs/verification.md` no. 8 dan bagian "Pembanding: Seapedia"
- `spikes/auth-keyring/auth.spike.test.ts`, `infra/kong/kong.yaml`, `apps/identity-svc/src/app.ts`
