export type Mail = { to: string; subject: string; text: string }
export type Mailer = { send: (mail: Mail) => Promise<void> }

// Penyedia email belum dipilih (ADR 025). Dev menulis email ke log supaya link verifikasi bisa diklik.
export const logMailer: Mailer = {
  send: async (mail) => console.info(`[mail] ke=${mail.to} subjek="${mail.subject}"\n${mail.text}`),
}
