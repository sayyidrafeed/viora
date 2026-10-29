import { jwtClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { expiryOf, isFresh } from './token'

// Satu origin dengan Kong; di server (SSR) dipakai origin publik dari env.
const baseURL = typeof window === 'undefined' ? (import.meta.env.VITE_PUBLIC_ORIGIN ?? 'http://localhost:18000') : window.location.origin

export const authClient = createAuthClient({ baseURL, basePath: '/v1/auth', plugins: [jwtClient()] })

let cached: { token: string; expiresAt: number } | undefined
// Request paralel saat token habis berbagi satu permintaan /token.
let pending: Promise<string | undefined> | undefined

export function accessToken(): Promise<string | undefined> {
  if (cached && isFresh(cached.expiresAt, Date.now())) return Promise.resolve(cached.token)
  pending ??= authClient
    .token()
    .then(({ data }) => {
      cached = data?.token ? { token: data.token, expiresAt: expiryOf(data.token) } : undefined
      return cached?.token
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}

export function forgetToken() {
  cached = undefined
}
