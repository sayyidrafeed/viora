import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import type { useLogin } from '@/hooks/use-login'

export function LoginForm({ form, error }: ReturnType<typeof useLogin>) {
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
      <form.Field name="email" validators={{ onSubmit: ({ value }) => (value.includes('@') ? undefined : 'Isi email yang valid.') }}>
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
      <form.Field name="password" validators={{ onSubmit: ({ value }) => (value ? undefined : 'Isi password.') }}>
        {(field) => (
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
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
            {submitting ? 'Memproses...' : 'Masuk ke Viora'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
