# @viora/service-kit

Kode bersama semua service: factory Hono dan `DomainError`, `loadEnv`, `jsonBody`, verifikasi JWT user dan denylist, relay outbox, `EventConsumer` dengan retry bertahap dan DLQ, `processOnce`.

- Perubahan di sini mengenai semua service. Jalankan `bun test --timeout 60000` (butuh infra) sebelum selesai.
- `test/walking-skeleton.test.ts` memuat test balapan consumer utama vs retry. Test itu dibuktikan lewat mutasi, jadi jangan dilemahkan.
- Envelope event hanya dibangun oleh fungsi SQL `outbox_emit` dari `outboxDdl`. Migrasi service menyalin hasilnya, jadi perubahan di `outboxDdl` butuh migrasi baru di setiap service.
