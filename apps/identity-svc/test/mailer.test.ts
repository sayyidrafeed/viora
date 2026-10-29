// Kontrak adapter Resend (ADR 025) terhadap server HTTP lokal yang meniru POST /emails. Pengiriman sungguhan butuh API key dan domain terverifikasi.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createMailer, logMailer, MailDeliveryError, resendMailer } from '../src/mailer.ts'

type Received = { auth: string | null; idempotencyKey: string | null; body: { from: string; to: string[]; subject: string; text: string } }
const received: Received[] = []
// Respons berikutnya per penerima; kosong berarti 200.
const plan = new Map<string, { status: number; body?: unknown; headers?: Record<string, string> }[]>()
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Received['body']
      received.push({ auth: req.headers.get('authorization'), idempotencyKey: req.headers.get('idempotency-key'), body })
      const next = plan.get(body.to[0]!)?.shift()
      if (next) return Response.json(next.body ?? {}, { status: next.status, headers: next.headers ?? {} })
      return Response.json({ id: crypto.randomUUID() })
    },
  })
})
afterAll(() => server.stop(true))

const mailer = () => resendMailer({ apiKey: 're_test', from: 'Viora <noreply@viora.test>', baseUrl: server.url.origin, retries: 2 })
const sentTo = (to: string) => received.filter((r) => r.body.to[0] === to)

test('mengirim ke /emails dengan bearer key, pengirim, penerima, dan isi teks', async () => {
  await mailer().send({ to: 'a@viora.test', subject: 'Verifikasi email Viora', text: 'link' })
  const [req] = sentTo('a@viora.test')
  expect(req!.auth).toBe('Bearer re_test')
  expect(req!.body).toEqual({ from: 'Viora <noreply@viora.test>', to: ['a@viora.test'], subject: 'Verifikasi email Viora', text: 'link' })
  expect(req!.idempotencyKey).toBeTruthy()
})

test('429 dan 5xx dicoba ulang dengan idempotency key yang sama, menghormati Retry-After', async () => {
  plan.set('b@viora.test', [{ status: 429, headers: { 'retry-after': '0' } }, { status: 503 }])
  await mailer().send({ to: 'b@viora.test', subject: 's', text: 't' })
  const attempts = sentTo('b@viora.test')
  expect(attempts).toHaveLength(3)
  expect(new Set(attempts.map((a) => a.idempotencyKey)).size).toBe(1)
})

test('error 4xx lain tidak dicoba ulang dan membawa pesan Resend', async () => {
  plan.set('c@viora.test', [{ status: 422, body: { statusCode: 422, name: 'validation_error', message: 'The from field is invalid.' } }])
  const sending = mailer().send({ to: 'c@viora.test', subject: 's', text: 't' })
  await expect(sending).rejects.toBeInstanceOf(MailDeliveryError)
  await expect(sending).rejects.toThrow('The from field is invalid.')
  expect(sentTo('c@viora.test')).toHaveLength(1)
})

test('konfigurasi salah membuat service gagal start', () => {
  expect(() => createMailer({ MAIL_PROVIDER: 'resend', MAIL_FROM: 'x' })).toThrow('RESEND_API_KEY')
  expect(() => createMailer({ MAIL_PROVIDER: 'log' }, 'production')).toThrow('production')
  expect(createMailer({ MAIL_PROVIDER: 'log' }, 'development')).toBe(logMailer)
})
