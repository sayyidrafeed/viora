import { z } from 'zod'

const uploadRef = { videoId: z.string(), uploadId: z.string() }

export const uploadEventData = {
  'upload.started': z.object({ ...uploadRef, userId: z.string() }),
  'upload.completed': z.object({ ...uploadRef, userId: z.string(), sourceKey: z.string(), sizeBytes: z.int().positive() }),
  'upload.cancelled': z.object(uploadRef),
  'upload.abandoned': z.object(uploadRef),
} as const

export type UploadEventType = keyof typeof uploadEventData
export type UploadEventDataOf<T extends UploadEventType> = z.infer<(typeof uploadEventData)[T]>
