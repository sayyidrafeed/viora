import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { emailRules, nameRules, newPasswordRules } from '@/lib/auth/validators'
import type { useRegister } from '@/hooks/use-register'

export function RegisterForm({ form, error, sentTo, changeEmail }: ReturnType<typeof useRegister>) {
  if (sentTo)
    return (
      <div className="grid gap-4">
        <Alert tone="info">
          Link verifikasi sudah dikirim ke <strong className="break-all">{sentTo}</strong>. Buka link itu untuk mengaktifkan akun dan
          langsung masuk.
        </Alert>
        <Button variant="quiet" onClick={changeEmail}>
          Ganti email
        </Button>
      </div>
    )

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form.Field name="name" validators={nameRules}>
        {(field) => (
          <Field
            id="name"
            label="Nama"
            autoComplete="name"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            error={field.state.meta.errors[0]}
          />
        )}
      </form.Field>
      <form.Field name="email" validators={emailRules}>
        {(field) => (
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            error={field.state.meta.errors[0]}
          />
        )}
      </form.Field>
      <form.Field name="password" validators={newPasswordRules}>
        {(field) => (
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            error={field.state.meta.errors[0]}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Memproses...' : 'Buat akun'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
