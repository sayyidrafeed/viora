// Aturan BACKWARD (§6 Evolusi skema, ADR 027): consumer dengan skema baru harus tetap bisa membaca event yang ditulis dengan skema lama.
type Schema = {
  type?: string | string[]
  anyOf?: Schema[]
  enum?: unknown[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
}
export type Snapshot = Record<string, Record<string, Schema>>

const branches = (s: Schema): Schema[] => {
  if (s.anyOf) return s.anyOf.flatMap(branches)
  if (Array.isArray(s.type)) return s.type.map((type) => ({ ...s, type }))
  return [s]
}
const accepts = (newType: string | undefined, oldType: string | undefined) =>
  newType === undefined || newType === oldType || (newType === 'number' && oldType === 'integer')

function compareNode(old: Schema, next: Schema, path: string): string[] {
  return branches(old).flatMap((o) => {
    const match = branches(next).find((n) => accepts(n.type as string | undefined, o.type as string | undefined))
    if (!match) return [`${path}: tipe ${String(o.type)} tidak lagi diterima`]
    const issues: string[] = []
    if (match.enum) {
      if (!o.enum) issues.push(`${path}: nilai dibatasi enum baru`)
      else for (const v of o.enum) if (!match.enum.includes(v)) issues.push(`${path}: nilai enum ${JSON.stringify(v)} dihapus`)
    }
    if (o.type === 'object' || match.type === 'object') {
      for (const field of match.required ?? [])
        if (!(o.required ?? []).includes(field)) issues.push(`${path}.${field}: field wajib baru`)
      for (const [field, schema] of Object.entries(o.properties ?? {})) {
        const nextField = match.properties?.[field]
        if (nextField) issues.push(...compareNode(schema, nextField, `${path}.${field}`))
      }
    }
    if (o.items && match.items) issues.push(...compareNode(o.items, match.items, `${path}[]`))
    return issues
  })
}

export function backwardIssues(old: Snapshot, next: Snapshot): string[] {
  return Object.entries(old).flatMap(([topic, events]) =>
    Object.entries(events).flatMap(([type, schema]) => {
      const nextSchema = next[topic]?.[type]
      if (!nextSchema) return [`${topic} ${type}: event dihapus (pakai topic *.v2)`]
      return compareNode(schema, nextSchema, `${topic} ${type}`)
    }),
  )
}
