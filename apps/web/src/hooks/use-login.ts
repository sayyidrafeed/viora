import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient, forgetToken } from '@/lib/auth/auth-client'
import { authMessage } from '@/lib/auth/messages'
import { focusFirstInvalid } from '@/lib/focus-first-invalid'

export function useLogin() {
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setError(undefined)
      const { error: failure } = await authClient.signIn.email(value)
      if (failure) return setError(authMessage(failure.code))
      forgetToken()
      await navigate({ to: '/' })
    },
  })
  return { form, error }
}
