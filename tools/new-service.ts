import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [name, rawPort] = process.argv.slice(2)
const port = Number(rawPort)
if (!name || !/^[a-z]+-svc$/.test(name) || !Number.isInteger(port) || port < 13000 || port > 13999) {
  console.error('pakai: bun run new:service <nama>-svc <port 13xxx>')
  process.exit(1)
}
const dir = join(import.meta.dir, '..', 'apps', name)
if (existsSync(dir)) {
  console.error(`${dir} sudah ada`)
  process.exit(1)
}
mkdirSync(join(dir, 'src', 'modules'), { recursive: true })
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`
const write = (path: string, content: string) => writeFileSync(join(dir, path), content)

write(
  'package.json',
  json({
    name: `@viora/${name}`,
    private: true,
    type: 'module',
    scripts: { dev: 'bun --watch src/index.ts', typecheck: 'tsc -p .', test: 'bun test --pass-with-no-tests' },
    dependencies: { '@viora/contracts': 'workspace:*', '@viora/service-kit': 'workspace:*', hono: '4.13.14', zod: '4.6.7' },
    devDependencies: { '@viora/config': 'workspace:*' },
  }),
)
write('tsconfig.json', json({ extends: '@viora/config/tsconfig.base.json', include: ['src', 'test'] }))
write(
  'src/index.ts',
  `import { createApp, loadEnv, portEnv } from '@viora/service-kit'

const env = loadEnv('${name}', { PORT: portEnv(${port}) })
const app = createApp('${name}')

export default { port: env.PORT, fetch: app.fetch }
`,
)
write('src/modules/.gitkeep', '')
write(
  'AGENTS.md',
  `# ${name}

Konvensi umum ada di AGENTS.md root. Pemilik data dan event service ini dicatat di docs/architecture/owners.md.

- Modul dibuat dengan \`bun run new:module ${name} <modul>\`.
- Port lokal ${port}.

Checklist sebelum service ini dianggap jalan:

- [ ] Baris pemilik di docs/architecture/owners.md (tabel, event yang dikirim, event yang di-consume).
- [ ] Consumer \`user.deleted\` kalau service menyimpan data user (§10).
- [ ] \`bun run outbox:snapshot <entity> --all\` untuk setiap entitas yang dimiliki (§6).
- [ ] Env divalidasi lewat \`loadEnv\` di src/index.ts.
`,
)
symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'))
console.info(`${name} dibuat di apps/${name} (port ${port}). Lanjutkan checklist di apps/${name}/AGENTS.md.`)
