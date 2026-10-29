import { client } from '@viora/api-client/client'
import { accessToken } from '@/lib/auth/auth-client'

// Panggilan /v1 lewat Kong di origin yang sama; token dipasang hanya untuk operasi yang membutuhkan bearer.
client.setConfig({ baseUrl: '', auth: () => accessToken() })

export type ApiError = { error: { code: string; message: string } }
export const errorCode = (err: unknown) => (err as Partial<ApiError> | undefined)?.error?.code
