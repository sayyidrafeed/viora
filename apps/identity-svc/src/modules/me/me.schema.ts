import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { channel, user } from '../../db/schema.ts'

export const meResponse = createSelectSchema(user)
  .pick({ id: true, name: true, email: true, emailVerified: true, image: true, role: true })
  .extend({ channel: createSelectSchema(channel).pick({ id: true, handle: true, name: true }).nullable() })
export type MeResponse = z.infer<typeof meResponse>

export const deleteMeBody = z.object({ purgeComments: z.boolean().default(false) }).strict()
export type DeleteMeBody = z.infer<typeof deleteMeBody>
