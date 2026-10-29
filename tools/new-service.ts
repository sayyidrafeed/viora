import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const name = process.argv[2]
const port = Number(process.argv[3])
if (!name || !/^[a-z]+-svc$/.test(name) || !Number.isInteger(port)) {
  console.error('pakai: bun run new:service <nama>-svc <port 130xx>')
  process.exit(1)
}
const dir = join(import.meta.dir, '..', 'apps', name)
if (existsSync(dir)) {
  console.error(`${dir} sudah ada`)
  process.exit(1)
}
mkdirSync(join(dir, 'src', 'modules'), { recursive: true })
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`
writeFileSync(
  join(dir, 'package.json'),
  json({
    name: `@viora/${name}`,
    private: true,
    type: 'module',
    scripts: { dev: 'bun --watch src/index.ts', typecheck: 'tsc -p .', test: 'bun test --pass-with-no-tests' },
    dependencies: { '@viora/contracts': 'workspace:*', '@viora/service-kit': 'workspace:*' },
    devDependencies: { '@viora/config': 'workspace:*' },
  }),
)
writeFileSync(join(dir, 'tsconfig.json'), json({ extends: '@viora/config/tsconfig.base.json', include: ['src'] }))
writeFileSync(
  join(dir, 'src', 'index.ts'),
  `import { createApp } from '@viora/service-kit'

const app = createApp('${name}')

export default { port: Number(process.env.PORT ?? ${port}), fetch: app.fetch }
`,
)
writeFileSync(join(dir, 'src', 'modules', '.gitkeep'), '')
console.log(`${name} dibuat di apps/${name} (port ${port}). Checklist: owners.md, consumer user.deleted, outbox:snapshot.`)
