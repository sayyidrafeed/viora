import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

// Radius kecil dan seragam (R-11); tinggi 44px memenuhi target sentuh (R-03).
const button = cva(
  'inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-surface hover:opacity-90',
        quiet: 'border border-line bg-surface text-ink hover:bg-surface-muted',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
)

export function Button({ className, variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant }), className)} {...props} />
}
