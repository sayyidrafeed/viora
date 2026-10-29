// Menulis openapi.json dari route Hono (tanpa server, database, atau kunci). Dipakai generator Kong, hey-api, dan oasdiff di CI.
import { SQL } from 'bun'
import { join } from 'node:path'
import { generateSpecs } from 'hono-openapi'
import { buildApp } from '../src/app.ts'
import { createDb } from '../src/db/client.ts'

const unused = () => {
  throw new Error('tidak dipanggil saat generate spec')
}
const app = buildApp({
  db: createDb(new SQL('postgres://openapi@127.0.0.1:1/none')),
  denylist: { isDenied: unused, deny: unused, startExpiry: unused, allow: unused },
  publicKeys: new Map(),
  jwtIssuer: 'https://viora.local',
  authHandler: unused,
})

const spec = await generateSpecs(app, {
  documentation: {
    info: { title: 'identity-svc', version: '0.1.0' },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    // Default sama dengan kelas route Kong: required. Route public/optional menimpa ini per operasi.
    security: [{ bearerAuth: [] }],
  },
  exclude: ['/healthz', /^\/v1\/auth\//],
})
await Bun.write(join(import.meta.dir, '..', 'openapi.json'), `${JSON.stringify(spec, null, 2)}\n`)
console.info(`openapi.json: ${Object.keys(spec.paths ?? {}).join(', ')}`)
