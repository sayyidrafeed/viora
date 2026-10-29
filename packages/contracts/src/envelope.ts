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
  upload: 'upload.v1',
  video: 'video.v1',
  transcode: 'transcode.v1',
} as const

export const stateVersion = z.int().positive()

export type DataSchemas = Record<string, z.ZodType<Record<string, unknown>>>

export const retryTopic = (group: string, topic: string) => `retry.${group}.${topic}`
export const dlqTopic = (group: string, topic: string) => `dlq.${group}.${topic}`
