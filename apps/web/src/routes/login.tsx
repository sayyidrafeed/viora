import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LoginForm } from '@/components/auth/login-form'
import { useLogin } from '@/hooks/use-login'
import { useRedirectIfSignedIn } from '@/hooks/use-redirect-if-signed-in'

// Form dirender di server supaya frame pertama tidak kosong; user yang sudah masuk dialihkan di client.
export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  useRedirectIfSignedIn()
  const login = useLogin()
  return (
    <AuthLayout
      title="Masuk"
      footer={
        <>
          Belum punya akun?{' '}
          <Link to="/register" className="font-medium text-ink underline underline-offset-4">
            Daftar
          </Link>
        </>
      }
    >
      <LoginForm {...login} />
    </AuthLayout>
  )
}
