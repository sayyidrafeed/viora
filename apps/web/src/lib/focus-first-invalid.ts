// Setelah submit tidak valid, fokus pindah ke field pertama yang salah supaya pengguna keyboard dan pembaca layar langsung ke sana.
export const focusFirstInvalid = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
