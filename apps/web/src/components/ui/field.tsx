import type { InputHTMLAttributes } from 'react'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; error?: string | undefined }

export function Field({ id, label, error, ...input }: FieldProps) {
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="type-label">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-11 rounded-control border border-line-strong bg-surface px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-invalid:border-danger"
        {...input}
      />
      {error ? (
        <p id={errorId} className="enter type-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
