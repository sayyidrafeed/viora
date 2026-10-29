import { z } from 'zod'
import { stateVersion } from './envelope.ts'

// State machine §8.
export const videoStatus = z.enum(['draft', 'uploading', 'uploaded', 'processing', 'ready', 'failed', 'blocked', 'abandoned', 'live', 'deleted'])
export const visibility = z.enum(['public', 'unlisted', 'private'])

const videoRef = { videoId: z.string(), channelId: z.string(), ownerUserId: z.string() }
const access = { status: videoStatus, visibility, epoch: z.int().nonnegative(), playable: z.boolean() }

// Kartu video: dipakai proyeksi feed, search, notifikasi, dan media-edge-sync.
const videoCard = z.object({
  ...videoRef,
  ...access,
  title: z.string(),
  thumbnailKey: z.string().nullable(),
  durationS: z.number().nonnegative().nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  firstPublished: z.boolean(),
  stateVersion,
})

const videoRemoved = z.object({ ...videoRef, ...access, reason: z.string().nullable(), stateVersion })

export const videoEventData = {
  'video.created': videoCard,
  'video.uploaded': z.object({
    videoId: z.string(),
    sourceKey: z.string(),
    generation: z.int().positive(),
    source: z.enum(['upload', 'live']),
    stateVersion,
  }),
  'video.ready': videoCard,
  'video.unblocked': videoCard,
  'video.metadata_updated': videoCard,
  'video.live_started': videoCard,
  'video.visibility_changed': videoCard.extend({ from: visibility }),
  'video.blocked': videoRemoved,
  'video.deleted': videoRemoved,
  'video.failed': videoRemoved,
  'video.access_invited': z.object({
    videoId: z.string(),
    email: z.email(),
    inviterName: z.string(),
    videoTitle: z.string(),
    registeredUserId: z.string().optional(),
  }),
  'video.access_revoked': z.object({ videoId: z.string(), userId: z.string(), epoch: z.int().nonnegative(), stateVersion }),
} as const

export type VideoEventType = keyof typeof videoEventData
export type VideoEventDataOf<T extends VideoEventType> = z.infer<(typeof videoEventData)[T]>
