import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type AppShellProps = { userName: string | undefined; onSignOut: () => void; signingOut: boolean; children: ReactNode }

export function AppShell({ userName, onSignOut, signingOut, children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <span className="text-base font-semibold tracking-tight text-accent">Viora</span>
          <div className="flex min-w-0 items-center gap-3">
            {userName ? <span className="truncate text-sm text-ink-muted">{userName}</span> : null}
            <Button variant="quiet" onClick={onSignOut} disabled={signingOut}>
              {signingOut ? 'Keluar...' : 'Keluar'}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
