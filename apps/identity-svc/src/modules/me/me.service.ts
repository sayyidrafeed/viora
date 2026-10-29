import type { Db } from '../../db/client.ts'
import { eq } from 'drizzle-orm'
import { topics } from '@viora/contracts'
import { DomainError, writeOutbox, type Denylist } from '@viora/service-kit'
import { channel, user } from '../../db/schema.ts'

type Deps = { db: Db; denylist: Denylist }

export function meService({ db, denylist }: Deps) {
  return {
    async get(userId: string) {
      const [row] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          role: user.role,
          channel: { id: channel.id, handle: channel.handle, name: channel.name },
        })
        .from(user)
        .leftJoin(channel, eq(channel.ownerUserId, user.id))
        .where(eq(user.id, userId))
      if (!row) throw new DomainError(404, 'user_not_found', 'User tidak ditemukan')
      return { ...row, channel: row.channel?.id ? row.channel : null }
    },

    // Urutan §6: denylist dulu, lalu sesi dicabut (cascade) dan event ditulis di transaksi yang sama, baru TTL denylist berjalan.
    async delete(userId: string, purgeComments: boolean) {
      await denylist.deny(userId)
      try {
        await db.transaction(async (tx) => {
          const [owned] = await tx.select({ id: channel.id }).from(channel).where(eq(channel.ownerUserId, userId))
          const deleted = await tx.delete(user).where(eq(user.id, userId)).returning({ id: user.id })
          if (deleted.length === 0) throw new DomainError(404, 'user_not_found', 'User tidak ditemukan')
          await writeOutbox(tx, 'identity', { topic: topics.identity, type: 'user.deleted', key: userId, data: { userId, purgeComments } })
          if (owned) {
            await writeOutbox(tx, 'identity', {
              topic: topics.identity,
              type: 'channel.deleted',
              key: userId,
              data: { channelId: owned.id, ownerUserId: userId },
            })
          }
        })
      } catch (err) {
        // Kalau request DELETE lain sudah menghapus user ini, denylist miliknya harus tetap ada.
        const stillExists = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, userId))
          .then((rows) => rows.length > 0)
          .catch(() => false)
        if (stillExists) await denylist.allow(userId).catch(() => {})
        throw err
      }
      await denylist.startExpiry(userId)
    },
  }
}
