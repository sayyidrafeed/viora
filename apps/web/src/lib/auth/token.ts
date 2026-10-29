// JWT dipakai sampai 60 detik sebelum kedaluwarsa, lalu diminta ulang dari sesi cookie (§6: sesi hanya untuk memperbarui JWT).
export const REFRESH_MARGIN_MS = 60_000

export function expiryOf(jwt: string): number {
  const payload = JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
  return (payload.exp ?? 0) * 1000
}

export const isFresh = (expiresAt: number, now: number) => expiresAt - now > REFRESH_MARGIN_MS
