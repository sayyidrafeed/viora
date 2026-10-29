import { join } from 'node:path'

const serviceDir = join(import.meta.dir, '..', 'apps', 'identity-svc')

// Menjalankan identity-svc sebagai proses nyata dan mengumpulkan stdout-nya; email dev ditulis ke log (ADR 025).
export async function startIdentitySvc(env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', '--env-file=.env', 'src/index.ts'], {
    cwd: serviceDir,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'inherit',
  })
  let output = ''
  void (async () => {
    for await (const chunk of proc.stdout) output += new TextDecoder().decode(chunk)
  })()

  const port = env.PORT ?? '13001'
  const deadline = Date.now() + 30_000
  while (!(await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.ok).catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`identity-svc tidak menyala:\n${output}`)
    await Bun.sleep(200)
  }

  return {
    mailLinkFor: async (email: string) => {
      const pattern = new RegExp(`\\[mail\\] ke=${email.replace('.', '\\.')}[^\\n]*\\n[^\\n]*?(https?://\\S+)`)
      const until = Date.now() + 10_000
      while (Date.now() < until) {
        const link = output.match(pattern)?.[1]
        if (link) return link
        await Bun.sleep(100)
      }
      throw new Error(`email untuk ${email} tidak muncul di log`)
    },
    stop: () => {
      proc.kill()
      return proc.exited
    },
  }
}

// Dev server web (Vite + TanStack Start), dilayani Kong lewat route `/`.
export async function startWeb() {
  const proc = Bun.spawn(['bunx', 'vite', 'dev'], {
    cwd: join(import.meta.dir, '..', 'apps', 'web'),
    stdout: 'ignore',
    stderr: 'inherit',
  })
  const deadline = Date.now() + 60_000
  while (!(await fetch('http://127.0.0.1:13000/login').then((r) => r.ok).catch(() => false))) {
    if (Date.now() > deadline) throw new Error('web tidak menyala')
    await Bun.sleep(500)
  }
  return {
    stop: () => {
      proc.kill()
      return proc.exited
    },
  }
}
