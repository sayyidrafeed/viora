import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { authClient } from '@/lib/auth/auth-client'

export function useRedirectIfSignedIn() {
  const navigate = useNavigate()
  const { data } = authClient.useSession()
  useEffect(() => {
    if (data) void navigate({ to: '/', replace: true })
  }, [data, navigate])
}
