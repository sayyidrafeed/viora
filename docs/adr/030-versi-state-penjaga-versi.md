# ADR 030: Versi state di payload event dan penjaga versi di proyeksi

Status: Diterima (2026-10-28). Diperbarui 2026-10-29 dari walking skeleton dan identity-svc.

## Konteks

Retry tertunda dan replay DLQ bisa membuat event untuk key yang sama tiba tidak berurutan (ADR 024). Relay mengurutkan menurut `xid`, bukan urutan commit (ADR 004). Dedupe `event_id` hanya membuang duplikat, tidak menolak event lama yang ID-nya berbeda. Seapedia memakai event berisi state penuh dengan penjaga versi entitas (`version < incoming`).

## Keputusan

- Tabel pemilik entitas menyimpan `state_version` yang naik di setiap perubahan baris. Di identity, trigger `BEFORE UPDATE` (`bump_state_version`) menaikkannya. Di `video`, versi naik di setiap penulisan baris: status, visibilitas, metadata, epoch, dan allowlist.
- Event yang membawa state entitas menyertakan `stateVersion`:
  - Semua `video.*` membawa `stateVersion` video.
  - `subscription.*` membawa `stateVersion` baris subscription.
  - `channel.created` dan `channel.updated` membawa `stateVersion` channel.
  - `user.registered` dan `user.profile_updated` membawa `stateVersion` user.
  - `engagement.counts_changed` membawa `stateVersion` dari `video_engagement_count`.
- Consumer proyeksi hanya menerapkan event dengan `stateVersion` lebih baru dari yang tersimpan. Dedupe `event_id` tetap berlaku.
- Efek eksternal (Meilisearch, Workers KV, Redis, Scylla) memakai penjaga yang menerima versi yang sama atau lebih baru, supaya pengiriman ulang setelah crash menerapkan efek yang sama lagi.
- Penjaga versi ada di handler proyeksi milik tiap consumer, bukan di `service-kit`.
- Proyeksi yang barisnya bisa dihapus menyimpan tombstone versi (`user_cards`, `channel_cards`, `video_visibility`), supaya event lama tidak memunculkan lagi data yang sudah dihapus.
- Snapshot backfill (`<entity>.snapshot`) membawa `stateVersion` dan diterapkan dengan penjaga yang sama.

## Konsekuensi

- `state_version` naik di setiap UPDATE, termasuk yang tidak mengirim event (misalnya `updated_at` atau deskripsi channel). Versi bisa melompat. Consumer hanya boleh memakai aturan "lebih baru", bukan "berurutan".
- Pada Scylla, padanannya adalah `USING TIMESTAMP` = `stateVersion` (`video_meta`, `video_engagement`) atau offset Kafka (tabel agregat). Detailnya di ADR 017 dan ADR 018 (M3).
- Walking skeleton membuktikan lewat mutasi: tanpa penjaga versi, test "event lama yang selesai di retry tidak menimpa versi baru" gagal.
- Test identity-svc membuktikan `user.profile_updated` membawa `stateVersion` dari trigger, dan perubahan kolom channel non-publik hanya menaikkan versi tanpa event.
- Event identity yang tidak membawa `stateVersion`: `user.email_verified`, `user.banned`, `user.unbanned`, `user.deleted`, dan `channel.deleted`. §10 menulis "`channel.*` membawa `stateVersion` channel", tapi tabel payload §10 dan `contracts` tidak memberi `stateVersion` ke `channel.deleted`. Apakah tombstone `channel_cards` butuh versi dari event itu masih terbuka.

## Alternatif yang ditolak

- Hanya dedupe `event_id` tanpa versi. Tidak menolak event lama dari retry atau replay (revisi 6).
- Versi hanya naik saat transisi status video (sebelum revisi 9). Perubahan visibilitas, metadata, dan allowlist dibuang oleh penjaga versi.
- Aturan "versi berikutnya harus tepat +1". Tidak cocok karena versi bisa melompat.

## Rujukan

- grand-plan §6 (Efek di luar database, Backfill), §7, §8 (aturan `state_version`), §10 (Versi state di payload), §18A (Hasil spike M0, Hasil identity-svc M0), §20 revisi 6, 9, 11, 12
- `packages/service-kit/test/walking-skeleton.test.ts`, `apps/identity-svc/drizzle/0001_outbox_triggers.sql`, `apps/identity-svc/test/identity.test.ts`, `packages/contracts/src/index.ts`
