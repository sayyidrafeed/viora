import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type AppShellProps = { userName: string | undefined; onSignOut: () => void; signingOut: boolean; children: ReactNode }

export function AppShell({ userName, onSignOut, signingOut, children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <header className="material sticky top-0 z-10">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <span className="type-title text-accent">Viora</span>
          <div className="flex min-w-0 items-center gap-3">
            {userName ? <span className="truncate type-label text-ink-muted">{userName}</span> : null}
            <Button variant="quiet" onClick={onSignOut} disabled={signingOut}>
              {signingOut ? 'Keluar...' : 'Keluar'}
            </Button>
          </div>
        </div>
        {/* Efek tepi scroll menggantikan garis 1px: hanya bayangan lembut di bawah material. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full h-3 bg-linear-to-b from-surface/70 to-transparent" />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
