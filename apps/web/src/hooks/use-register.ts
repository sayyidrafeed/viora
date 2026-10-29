import { useForm } from '@tanstack/react-form'
import { useEffect, useRef, useState } from 'react'
import { authClient } from '@/lib/auth/auth-client'
import { authMessage } from '@/lib/auth/messages'
import { focusFirstInvalid } from '@/lib/focus-first-invalid'

export function useRegister() {
  const [error, setError] = useState<string>()
  const [sentTo, setSentTo] = useState<string>()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setError(undefined)
      const { error: failure } = await authClient.signUp.email({ ...value, callbackURL: '/' })
      if (failure) return setError(authMessage(failure.code))
      setSentTo(value.email)
    },
  })

  // Judul berganti saat email terkirim; fokus dipindah ke judul supaya perubahan itu terbaca.
  useEffect(() => {
    if (sentTo) titleRef.current?.focus()
  }, [sentTo])

  return { form, error, sentTo, titleRef, changeEmail: () => setSentTo(undefined) }
}
