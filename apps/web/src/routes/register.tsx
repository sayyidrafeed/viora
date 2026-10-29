import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthLayout } from '@/components/auth/auth-layout'
import { RegisterForm } from '@/components/auth/register-form'
import { useRegister } from '@/hooks/use-register'
import { useRedirectIfSignedIn } from '@/hooks/use-redirect-if-signed-in'

// Form dirender di server supaya frame pertama tidak kosong; user yang sudah masuk dialihkan di client.
export const Route = createFileRoute('/register')({ component: RegisterPage })

function RegisterPage() {
  useRedirectIfSignedIn()
  const register = useRegister()
  return (
    <AuthLayout
      title={register.sentTo ? 'Cek email kamu' : 'Buat akun'}
      titleRef={register.titleRef}
      footer={
        <>
          Sudah punya akun?{' '}
          <Link to="/login" className="font-medium text-ink underline underline-offset-4">
            Masuk
          </Link>
        </>
      }
    >
      <RegisterForm {...register} />
    </AuthLayout>
  )
}
