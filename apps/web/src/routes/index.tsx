import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { ProfilePanel, ProfileSkeleton } from '@/components/profile-panel'
import { useMe } from '@/hooks/use-me'
import { useSignOut } from '@/hooks/use-sign-out'
import { errorCode } from '@/lib/api/client'
import { authClient } from '@/lib/auth/auth-client'
import { authMessage } from '@/lib/auth/messages'

// Shell M0 client-only karena sesi dicek di browser; server mengirim kerangka yang sama dengan state memuat (§12: SSR beranda menyusul bersama feed).
export const Route = createFileRoute('/')({
  ssr: false,
  pendingMs: 0,
  pendingComponent: () => (
    <AppShell userName={undefined} onSignOut={() => {}} signingOut>
      <ProfileSkeleton />
    </AppShell>
  ),
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: '/login' })
  },
  component: HomePage,
})

function HomePage() {
  const me = useMe()
  const { signOut, signingOut } = useSignOut()
  const state =
    me.status === 'success'
      ? { status: 'success' as const, me: me.data }
      : me.status === 'error'
        ? { status: 'error' as const, message: authMessage(errorCode(me.error)) }
        : { status: 'pending' as const }
  return (
    <AppShell userName={me.data?.name} onSignOut={() => void signOut()} signingOut={signingOut}>
      <ProfilePanel state={state} onRetry={() => void me.refetch()} />
    </AppShell>
  )
}
