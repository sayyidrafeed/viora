// `bun run schemas` menulis event-schemas.json. `--check` gagal kalau snapshot tidak sesuai kode.
// `--compat <snapshot-lama.json>` gagal kalau skema sekarang melanggar aturan BACKWARD terhadap snapshot itu (CI: snapshot di main).
import { join } from 'node:path'
import { z } from 'zod'
import { identityEventData, topics, transcodeEventData, uploadEventData, videoEventData } from '../src/index.ts'
import { backwardIssues, type Snapshot } from './compat.ts'

const byTopic = {
  [topics.identity]: identityEventData,
  [topics.upload]: uploadEventData,
  [topics.video]: videoEventData,
  [topics.transcode]: transcodeEventData,
}
const snapshot = Object.fromEntries(
  Object.entries(byTopic).map(([topic, events]) => [
    topic,
    Object.fromEntries(Object.entries(events).map(([type, schema]) => [type, z.toJSONSchema(schema)])),
  ]),
) as Snapshot

const file = join(import.meta.dir, '..', 'event-schemas.json')
const content = `${JSON.stringify(snapshot, null, 2)}\n`
const args = process.argv.slice(2)

if (args[0] === '--check') {
  if ((await Bun.file(file).text()) !== content) {
    console.error('event-schemas.json tidak sesuai skema di kode. Jalankan `bun run schemas`.')
    process.exit(1)
  }
  console.info('event-schemas.json sesuai')
} else if (args[0] === '--compat') {
  const base = args[1] ? ((await Bun.file(args[1]).json()) as Snapshot) : undefined
  if (!base) {
    console.info('tidak ada snapshot pembanding, cek kompatibilitas dilewati')
    process.exit(0)
  }
  const issues = backwardIssues(base, snapshot)
  if (issues.length > 0) {
    console.error(`perubahan skema event tidak kompatibel BACKWARD:\n${issues.map((i) => `- ${i}`).join('\n')}`)
    process.exit(1)
  }
  console.info('skema event kompatibel BACKWARD')
} else {
  await Bun.write(file, content)
  console.info(`event-schemas.json ditulis: ${Object.values(snapshot).reduce((n, e) => n + Object.keys(e).length, 0)} event`)
}
