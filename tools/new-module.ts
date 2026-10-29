import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [service, mod] = process.argv.slice(2)
if (!service || !mod || !/^[a-z]+$/.test(mod)) {
  console.error('pakai: bun run new:module <nama>-svc <modul>')
  process.exit(1)
}
const serviceDir = join(import.meta.dir, '..', 'apps', service)
const dir = join(serviceDir, 'src', 'modules', mod)
if (!existsSync(serviceDir)) {
  console.error(`service ${service} tidak ada`)
  process.exit(1)
}
if (existsSync(dir)) {
  console.error(`modul ${mod} sudah ada di ${service}`)
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
const Pascal = mod[0]!.toUpperCase() + mod.slice(1)
const write = (file: string, content: string) => writeFileSync(join(dir, `${mod}.${file}.ts`), content)

// Layout §13: schema, service, handlers, routes, errors, index. Isinya contoh GET /:id yang menunjukkan alurnya; ganti sesuai modul.
write(
  'schema',
  `import { z } from 'zod'

export const ${mod}Params = z.object({ id: z.string().min(1) })
`,
)
write(
  'errors',
  `import { DomainError } from '@viora/service-kit'

export class ${Pascal}NotFoundError extends DomainError {
  readonly status = 404
  readonly code = '${mod}_not_found'
  constructor(id: string) {
    super(\`${Pascal} \${id} tidak ditemukan\`)
  }
}
`,
)
write(
  'service',
  `import { ${Pascal}NotFoundError } from './${mod}.errors.ts'

export function ${mod}Service() {
  return {
    async get(id: string): Promise<{ id: string }> {
      throw new ${Pascal}NotFoundError(id)
    },
  }
}
`,
)
write(
  'handlers',
  `import type { Context } from 'hono'
import type { ${mod}Service } from './${mod}.service.ts'

export function ${mod}Handlers(service: ReturnType<typeof ${mod}Service>) {
  return {
    get: async (c: Context) => c.json(await service.get(c.req.param('id') ?? '')),
  }
}
`,
)
write(
  'routes',
  `import { createRouter } from '@viora/service-kit'
import { ${mod}Handlers } from './${mod}.handlers.ts'
import type { ${mod}Service } from './${mod}.service.ts'

// Urutan middleware §13: sesi → izin → validator.
export function ${mod}Routes(service: ReturnType<typeof ${mod}Service>) {
  const handlers = ${mod}Handlers(service)
  return createRouter().get('/:id', handlers.get)
}
`,
)
writeFileSync(
  join(dir, 'index.ts'),
  `export { ${Pascal}NotFoundError } from './${mod}.errors.ts'
export { ${mod}Routes } from './${mod}.routes.ts'
export { ${mod}Service } from './${mod}.service.ts'
`,
)
console.info(`modul ${mod} dibuat di apps/${service}/src/modules/${mod}. Pasang ${mod}Routes di src/app.ts, impor hanya lewat index.ts.`)
