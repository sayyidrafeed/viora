import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { GetV1MeResponse } from '@viora/api-client'

type ProfileState = { status: 'pending' } | { status: 'error'; message: string } | { status: 'success'; me: GetV1MeResponse }

export function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Memuat profil" className="grid max-w-md gap-1">
      <div className="h-8 w-48 animate-pulse rounded-control bg-line motion-reduce:animate-none" />
      <div className="h-6 w-64 animate-pulse rounded-control bg-line motion-reduce:animate-none" />
    </div>
  )
}

export function ProfilePanel({ state, onRetry }: { state: ProfileState; onRetry: () => void }) {
  if (state.status === 'pending') return <ProfileSkeleton />
  if (state.status === 'error')
    return (
      <section className="grid max-w-md gap-4">
        <h1 className="type-display">Profil tidak bisa dimuat</h1>
        <Alert tone="error">{state.message}</Alert>
        <div>
          <Button variant="quiet" onClick={onRetry}>
            Coba lagi
          </Button>
        </div>
      </section>
    )

  const { me } = state
  return (
    <section className="grid max-w-xl gap-6">
      <div className="grid gap-1">
        <h1 className="type-display break-words">Halo, {me.name}</h1>
        <p className="text-ink-muted break-all">{me.email}</p>
      </div>
      <dl className="enter grid gap-4 rounded-card bg-surface-raised p-5 text-sm sm:grid-cols-2">
        <div className="grid gap-1">
          <dt className="text-ink-muted">Status email</dt>
          <dd>{me.emailVerified ? 'Terverifikasi' : 'Belum terverifikasi'}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-ink-muted">Channel</dt>
          <dd>{me.channel ? `@${me.channel.handle}` : 'Belum ada. Channel dibuat otomatis saat kamu upload video pertama.'}</dd>
        </div>
      </dl>
    </section>
  )
}
