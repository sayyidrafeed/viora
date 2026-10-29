import type { ReactNode, Ref } from 'react'

// Konten di-anchor ke atas, bukan ditengah vertikal, supaya pesan error atau state sukses tidak menggeser judul.
export function AuthLayout({
  title,
  children,
  footer,
  titleRef,
}: {
  title: string
  children: ReactNode
  footer: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col gap-6 px-4 pt-[12dvh] pb-10">
      <div className="grid gap-1">
        <p className="type-title text-accent">Viora</p>
        <h1 ref={titleRef} tabIndex={-1} className="type-display">
          {title}
        </h1>
      </div>
      {children}
      <div className="type-caption text-ink-muted">{footer}</div>
    </main>
  )
}
