// Pesan untuk kode error Better Auth dan service-kit. Kode yang tidak dikenal memakai pesan umum.
const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email atau password salah.',
  EMAIL_NOT_VERIFIED: 'Email belum diverifikasi. Buka link verifikasi di email yang kami kirim.',
  USER_ALREADY_EXISTS: 'Email ini sudah terdaftar. Masuk dengan email tersebut.',
  PASSWORD_TOO_SHORT: 'Password minimal 8 karakter.',
  account_banned: 'Akun ini diblokir atau sudah dihapus.',
}

export const authMessage = (code: string | undefined) => (code && messages[code]) ?? 'Terjadi kesalahan. Coba lagi sebentar lagi.'
