import { z } from 'zod'

export const portEnv = (defaultPort: number) => z.coerce.number().int().min(1).max(65_535).default(defaultPort)

// Env divalidasi saat start (§13): service gagal start dengan daftar variabel yang kurang, bukan jalan dengan nilai NaN.
export function loadEnv<S extends z.ZodRawShape>(
  service: string,
  shape: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<z.ZodObject<S>> {
  const parsed = z.object(shape).safeParse(source)
  if (!parsed.success) throw new Error(`env ${service} tidak lengkap:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}
