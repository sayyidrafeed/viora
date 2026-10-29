import { eq } from 'drizzle-orm'
import { topics, type IdentityEventDataOf } from '@viora/contracts'
import { writeOutbox, type Denylist } from '@viora/service-kit'
import type { Db } from '../../db/client.ts'
import { channel, identity, user } from '../../db/schema.ts'
import { UserNotFoundError } from './me.errors.ts'
import type { MeResponse } from './me.schema.ts'

type Deps = { db: Db; denylist: Denylist }

export function meService({ db, denylist }: Deps) {
  return {
    async get(userId: string): Promise<MeResponse> {
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
      if (!row) throw new UserNotFoundError()
      return row
    },

    // Urutan §6: denylist dulu, lalu sesi dicabut (cascade) dan event ditulis di transaksi yang sama, baru TTL denylist berjalan.
    async delete(userId: string, purgeComments: boolean) {
      await denylist.deny(userId)
      try {
        await db.transaction(async (tx) => {
          const [owned] = await tx
            .select({ id: channel.id, stateVersion: channel.stateVersion })
            .from(channel)
            .where(eq(channel.ownerUserId, userId))
          const deleted = await tx.delete(user).where(eq(user.id, userId)).returning({ id: user.id })
          if (deleted.length === 0) throw new UserNotFoundError()
          await writeOutbox(tx, identity.schemaName, {
            topic: topics.identity,
            type: 'user.deleted',
            key: userId,
            data: { userId, purgeComments } satisfies IdentityEventDataOf<'user.deleted'>,
          })
          if (owned) {
            await writeOutbox(tx, identity.schemaName, {
              topic: topics.identity,
              type: 'channel.deleted',
              key: userId,
              data: {
                channelId: owned.id,
                ownerUserId: userId,
                stateVersion: owned.stateVersion + 1,
              } satisfies IdentityEventDataOf<'channel.deleted'>,
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
