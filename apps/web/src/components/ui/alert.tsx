import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Alert({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('enter rounded-card p-4 text-sm', tone === 'error' ? 'border border-danger text-danger' : 'bg-surface-raised text-ink')}
    >
      {children}
    </div>
  )
}
