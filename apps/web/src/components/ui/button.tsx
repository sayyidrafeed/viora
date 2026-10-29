import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

// Radius kontrol 10px dan tinggi 44px (DESIGN.md); mengecil saat ditekan, bukan saat dilepas.
const button = cva(
  'press inline-flex h-11 items-center justify-center rounded-control px-4 type-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:brightness-110',
        quiet: 'bg-surface-raised text-ink hover:brightness-95 dark:hover:brightness-125',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
)

export function Button({ className, variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant }), className)} {...props} />
}
