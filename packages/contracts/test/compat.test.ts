import { expect, test } from 'bun:test'
import { z } from 'zod'
import { backwardIssues, type Snapshot } from '../scripts/compat.ts'

const snap = (schema: z.ZodType): Snapshot => ({ 'video.v1': { 'video.x': z.toJSONSchema(schema) as Snapshot[string][string] } })
const base = z.object({ videoId: z.string(), status: z.enum(['draft', 'ready']), title: z.string().nullable() })
const issues = (next: z.ZodType) => backwardIssues(snap(base), snap(next))

test('skema yang sama dan field opsional baru tetap kompatibel', () => {
  expect(issues(base)).toEqual([])
  expect(issues(base.extend({ durationS: z.number().optional() }))).toEqual([])
  expect(issues(base.extend({ status: z.enum(['draft', 'ready', 'failed']) }))).toEqual([])
})

test('field wajib baru, enum menyempit, dan nullable dihapus melanggar BACKWARD', () => {
  expect(issues(base.extend({ durationS: z.number() }))).toEqual(['video.v1 video.x.durationS: field wajib baru'])
  expect(issues(base.extend({ status: z.enum(['ready']) }))).toEqual(['video.v1 video.x.status: nilai enum "draft" dihapus'])
  expect(issues(base.extend({ title: z.string() }))).toEqual(['video.v1 video.x.title: tipe null tidak lagi diterima'])
})

test('event yang dihapus harus pindah ke topic baru', () => {
  expect(backwardIssues(snap(base), { 'video.v1': {} })).toEqual(['video.v1 video.x: event dihapus (pakai topic *.v2)'])
})
