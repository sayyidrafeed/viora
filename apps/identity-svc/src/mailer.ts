export type Mail = { to: string; subject: string; text: string }
export type Mailer = { send: (mail: Mail) => Promise<void> }

export class MailDeliveryError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(`email gagal dikirim${status ? ` (${status})` : ''}: ${message}`)
  }
}

// Dev dan test: email ditulis ke log supaya link verifikasi bisa diambil tanpa kotak masuk sungguhan.
export const logMailer: Mailer = {
  send: async (mail) => console.info(`[mail] ke=${mail.to} subjek="${mail.subject}"\n${mail.text}`),
}

type ResendOptions = { apiKey: string; from: string; baseUrl?: string; retries?: number; timeoutMs?: number }

// Resend (ADR 025). Satu idempotency key per email, dipakai ulang di setiap percobaan, supaya retry setelah
// respons yang hilang tidak mengirim email ganda. Hanya 429, 5xx, dan error jaringan yang dicoba ulang.
export function resendMailer({ apiKey, from, baseUrl = 'https://api.resend.com', retries = 2, timeoutMs = 5_000 }: ResendOptions): Mailer {
  return {
    async send({ to, subject, text }) {
      const idempotencyKey = crypto.randomUUID()
      for (let attempt = 0; ; attempt++) {
        let res: Response | undefined
        try {
          res = await fetch(`${baseUrl}/emails`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
            body: JSON.stringify({ from, to: [to], subject, text }),
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (err) {
          if (attempt >= retries) throw new MailDeliveryError(undefined, err instanceof Error ? err.message : String(err))
        }
        if (res?.ok) return
        if (res && res.status !== 429 && res.status < 500) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          throw new MailDeliveryError(res.status, body.message ?? res.statusText)
        }
        if (attempt >= retries) throw new MailDeliveryError(res?.status, 'percobaan ulang habis')
        const retryAfter = Number(res?.headers.get('retry-after'))
        await Bun.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt)
      }
    },
  }
}

type MailEnv = { MAIL_PROVIDER: 'log' | 'resend'; RESEND_API_KEY?: string | undefined; MAIL_FROM?: string | undefined }

// Dipanggil saat start: konfigurasi email yang salah membuat service gagal start, bukan gagal diam-diam saat user mendaftar.
export function createMailer(env: MailEnv, nodeEnv = process.env.NODE_ENV): Mailer {
  if (env.MAIL_PROVIDER === 'log') {
    if (nodeEnv === 'production') throw new Error('MAIL_PROVIDER=log tidak boleh dipakai di production')
    return logMailer
  }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('MAIL_PROVIDER=resend butuh RESEND_API_KEY dan MAIL_FROM')
  return resendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM })
}
