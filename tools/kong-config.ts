// Membuat konfigurasi deklaratif Kong dari spec OpenAPI setiap service (§6 Gateway).
// `bun run kong:config` menulis infra/kong/kong.yaml; `--check` gagal kalau file berbeda dari hasil generate (dipakai CI).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type AuthClass = 'public' | 'optional' | 'required'
type Operation = { operationId?: string; 'x-auth'?: AuthClass }
type Spec = { paths?: Record<string, Record<string, Operation>> }
type Route = { name: string; methods?: string[]; paths: string[]; strip_path: false; plugins?: unknown[]; regex_priority?: number }

const root = join(import.meta.dir, '..')
const env = 'dev'

// Upstream per environment. Prod diisi saat manifest k3s dibuat (M1).
const upstreams: Record<string, { spec: string; url: string }> = {
  'identity-svc': { spec: 'apps/identity-svc/openapi.json', url: 'http://host.docker.internal:13001' },
}
const webUrl = 'http://host.docker.internal:13000'
const otlpEndpoint = 'http://tempo:4318/v1/traces'

// Route Better Auth tidak ada di spec OpenAPI; hanya daftar ini yang dibuka (public, sesi cookie dicek Better Auth sendiri).
// Route lain di /v1/auth, termasuk /admin/* dan /delete-user, jatuh ke route penolak /v1/.
const betterAuthRoutes: [string, string][] = [
  ['POST', '/sign-up/email'],
  ['POST', '/sign-in/email'],
  ['POST', '/sign-in/social'],
  ['GET', '/callback/[^/]+'],
  ['POST', '/callback/[^/]+'],
  ['POST', '/sign-out'],
  ['GET', '/get-session'],
  ['GET', '/token'],
  ['GET', '/jwks'],
  ['GET', '/verify-email'],
  ['POST', '/send-verification-email'],
  ['POST', '/request-password-reset'],
  ['GET', '/reset-password/[^/]+'],
  ['POST', '/reset-password'],
  ['POST', '/update-user'],
  ['POST', '/change-password'],
  ['GET', '/list-sessions'],
  ['POST', '/revoke-session'],
  ['POST', '/revoke-other-sessions'],
  ['GET', '/expo-authorization-proxy'],
]

const jwtPlugin = (anonymous: boolean) => ({
  name: 'jwt',
  config: {
    key_claim_name: 'kid',
    // Plugin jwt tidak memeriksa exp kalau tidak diminta.
    claims_to_verify: ['exp'],
    header_names: ['authorization'],
    uri_param_names: [],
    cookie_names: [],
    ...(anonymous ? { anonymous: 'anonymous' } : {}),
  },
})

const pluginsFor = (auth: AuthClass) => (auth === 'public' ? [] : [jwtPlugin(auth === 'optional')])

// OpenAPI `/v1/videos/{id}` menjadi regex; Kong meng-anchor awal path, `$` meng-anchor akhir supaya /v1/me tidak ikut menangkap /v1/me/videos.
const toRegex = (path: string) => `~${path.replace(/\{[^}]+\}/g, '[^/]+')}$`

function routesFromSpec(service: string, spec: Spec): Route[] {
  return Object.entries(spec.paths ?? {}).flatMap(([path, ops]) =>
    Object.entries(ops).map(([method, op]) => {
      if (!op.operationId) throw new Error(`${service} ${method.toUpperCase()} ${path} tanpa operationId`)
      return {
        name: `${service}.${op.operationId}`,
        methods: [method.toUpperCase()],
        paths: [toRegex(path)],
        strip_path: false,
        plugins: pluginsFor(op['x-auth'] ?? 'required'),
      }
    }),
  )
}

function publicKeys() {
  const dir = join(root, 'infra', 'keys', env)
  const keys = readdirSync(dir)
    .filter((f) => f.endsWith('.pub.pem'))
    .map((f) => ({ key: f.slice(0, -'.pub.pem'.length), algorithm: 'ES256', rsa_public_key: readFileSync(join(dir, f), 'utf8') }))
  // Schema plugin jwt tidak mewajibkan rsa_public_key untuk ES256; tanpa kunci, semua token gagal 401 saat runtime.
  if (keys.length === 0) throw new Error(`tidak ada public key di ${dir}`)
  return keys
}

export function buildConfig() {
  const services = Object.entries(upstreams).map(([name, { spec, url }]) => {
    const routes = routesFromSpec(name, JSON.parse(readFileSync(join(root, spec), 'utf8')) as Spec)
    if (name === 'identity-svc') {
      routes.push(
        ...betterAuthRoutes.map(([method, path]) => ({
          name: `identity-svc.auth.${method.toLowerCase()}${path.replace(/\[\^\/\]\+/g, 'param').replace(/\//g, '.')}`,
          methods: [method],
          paths: [`~/v1/auth${path}$`],
          strip_path: false as const,
        })),
      )
    }
    return { name, url, routes }
  })

  return {
    _format_version: '3.0',
    services: [
      ...services,
      {
        name: 'web',
        url: webUrl,
        routes: [{ name: 'web.ssr', paths: ['/'], strip_path: false, preserve_host: true }],
      },
    ],
    routes: [
      {
        name: 'unknown-api',
        paths: ['/v1/'],
        strip_path: false,
        plugins: [{ name: 'request-termination', config: { status_code: 404, message: 'Route tidak ada' } }],
      },
    ],
    consumers: [{ username: 'anonymous' }, { username: 'identity-svc', jwt_secrets: publicKeys() }],
    plugins: [
      { name: 'rate-limiting', config: { minute: 600, limit_by: 'ip', policy: 'local' } },
      { name: 'request-size-limiting', config: { allowed_payload_size: 1, size_unit: 'megabytes' } },
      { name: 'prometheus', config: { per_consumer: false, status_code_metrics: true, latency_metrics: true } },
      { name: 'opentelemetry', config: { traces_endpoint: otlpEndpoint, resource_attributes: { 'service.name': 'kong' } } },
    ],
  }
}

if (import.meta.main) {
  const out = join(root, 'infra', 'kong', 'kong.yaml')
  const content = `# Dibuat oleh tools/kong-config.ts dari spec OpenAPI. Jangan diedit langsung.\n${Bun.YAML.stringify(buildConfig(), null, 2)}\n`
  if (process.argv.includes('--check')) {
    if (readFileSync(out, 'utf8') !== content) {
      console.error('infra/kong/kong.yaml tidak sesuai hasil generate. Jalankan `bun run kong:config`.')
      process.exit(1)
    }
    console.info('kong.yaml sesuai')
  } else {
    await Bun.write(out, content)
    console.info(`kong.yaml ditulis: ${buildConfig().services.flatMap((s) => s.routes).length} route`)
  }
}
