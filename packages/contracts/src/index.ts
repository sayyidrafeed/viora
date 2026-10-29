import { z } from 'zod'

export const envelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  version: z.int().positive(),
  occurredAt: z.iso.datetime(),
  producer: z.string().min(1),
  key: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
})

export type EventEnvelope<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  z.infer<typeof envelopeSchema>,
  'data'
> & { data: T }

export const headers = {
  traceparent: 'traceparent',
  tracestate: 'tracestate',
  attempt: 'x-attempt',
  retryNotBefore: 'x-retry-not-before',
  error: 'x-error',
  originTopic: 'x-origin-topic',
  originPartition: 'x-origin-partition',
  originOffset: 'x-origin-offset',
} as const

export const topics = {
  identity: 'identity.v1',
} as const

const stateVersion = z.int().positive()

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
  'channel.deleted': z.object({ channelId: z.string(), ownerUserId: z.string() }),
} as const

export type IdentityEventType = keyof typeof identityEventData
export type IdentityEventDataOf<T extends IdentityEventType> = z.infer<(typeof identityEventData)[T]>
export type DataSchemas = Record<string, z.ZodType<Record<string, unknown>>>

export const retryTopic = (group: string, topic: string) => `retry.${group}.${topic}`
export const dlqTopic = (group: string, topic: string) => `dlq.${group}.${topic}`
