// Aturan field auth, dipakai saat blur dan saat submit.
const rule = (check: (value: string) => boolean, message: string) => ({ value }: { value: string }) =>
  check(value) ? undefined : message

const both = (fn: ReturnType<typeof rule>) => ({ onBlur: fn, onSubmit: fn })

export const nameRules = both(rule((v) => v.trim() !== '', 'Isi nama.'))
export const emailRules = both(rule((v) => v.includes('@'), 'Isi email yang valid.'))
export const passwordRules = both(rule((v) => v !== '', 'Isi password.'))
export const newPasswordRules = both(rule((v) => v.length >= 8, 'Password minimal 8 karakter.'))
