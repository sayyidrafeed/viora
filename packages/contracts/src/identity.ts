import { z } from 'zod'
import { stateVersion } from './envelope.ts'

const channelState = z.object({
  channelId: z.string(),
  ownerUserId: z.string(),
  handle: z.string(),
  name: z.string(),
  avatarKey: z.string().nullable(),
  stateVersion,
})

// Skema `data` per tipe event (§10 Payload). Consumer menolak data yang tidak cocok sebagai error permanen.
export const identityEventData = {
  'user.registered': z.object({ userId: z.string(), name: z.string(), image: z.string().nullable(), stateVersion }),
  'user.email_verified': z.object({ userId: z.string(), email: z.email() }),
  'user.profile_updated': z.object({ userId: z.string(), name: z.string(), image: z.string().nullable(), stateVersion }),
  'user.banned': z.object({
    userId: z.string(),
    reason: z.string().nullish(),
    expiresAt: z.iso.datetime({ offset: true }).nullish(),
  }),
  'user.unbanned': z.object({ userId: z.string() }),
  'user.deleted': z.object({ userId: z.string(), purgeComments: z.boolean() }),
  'channel.created': channelState,
  'channel.updated': channelState,
  // §10: semua channel.* membawa stateVersion, termasuk penghapusan (versi terakhir + 1).
  'channel.deleted': z.object({ channelId: z.string(), ownerUserId: z.string(), stateVersion }),
} as const

export type IdentityEventType = keyof typeof identityEventData
export type IdentityEventDataOf<T extends IdentityEventType> = z.infer<(typeof identityEventData)[T]>
