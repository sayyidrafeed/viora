import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient, forgetToken } from '@/lib/auth/auth-client'

export function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    try {
      await authClient.signOut()
      forgetToken()
      queryClient.clear()
      await navigate({ to: '/login' })
    } finally {
      setSigningOut(false)
    }
  }
  return { signOut, signingOut }
}
