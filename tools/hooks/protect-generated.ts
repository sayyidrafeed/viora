// Hook PreToolUse agent (§13 Guardrail): tolak edit tangan ke file hasil generate. Ubah sumbernya, lalu jalankan generatornya.
const generated: [RegExp, string][] = [
  [/packages\/api-client\/src\/generated\//, 'cd packages/api-client && bun run generate'],
  [/apps\/[^/]+\/openapi\.json$/, 'bun run openapi di service itu'],
  [/infra\/kong\/kong\.yaml$/, 'bun run kong:config'],
  [/packages\/contracts\/event-schemas\.json$/, 'cd packages/contracts && bun run schemas'],
  [/apps\/web\/src\/routeTree\.gen\.ts$/, 'vite dev atau vite build di apps/web'],
]

const input = (await Bun.stdin.json()) as { tool_input?: { file_path?: string } }
const path = input.tool_input?.file_path ?? ''
const hit = generated.find(([pattern]) => pattern.test(path))
if (hit) {
  console.error(`${path} adalah file hasil generate dan tidak boleh diedit langsung. Ubah sumbernya lalu jalankan: ${hit[1]}`)
  process.exit(2)
}
