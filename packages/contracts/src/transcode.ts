import { z } from 'zod'

const job = { videoId: z.string(), generation: z.int().positive() }

export const transcodeEventData = {
  'transcode.started': z.object(job),
  'transcode.succeeded': z.object({
    ...job,
    durationS: z.number().positive(),
    renditions: z.array(z.object({ height: z.int().positive(), bitrateKbps: z.int().positive(), playlistKey: z.string() })).min(1),
    manifestKey: z.string(),
    thumbnailKeys: z.array(z.string()),
    spriteKey: z.string(),
  }),
  // Dikirim sekali per generasi oleh listener final (§9).
  'transcode.failed': z.object({ ...job, attempts: z.int().positive(), reason: z.enum(['exhausted', 'invalid_input']), error: z.string() }),
} as const

export type TranscodeEventType = keyof typeof transcodeEventData
export type TranscodeEventDataOf<T extends TranscodeEventType> = z.infer<(typeof transcodeEventData)[T]>
