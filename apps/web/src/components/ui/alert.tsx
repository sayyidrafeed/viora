import type { ReactNode } from 'react'

export function Alert({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'rounded-md border border-danger p-3 text-sm text-danger' : 'rounded-md bg-surface-muted p-3 text-sm'}
    >
      {children}
    </div>
  )
}
