// Membuat keypair ES256 untuk dev lokal di infra/keys/dev. Lingkungan lain memakai kunci dari SOPS.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'

const kid = process.argv[2] ?? 'dev-2026a'
const dir = join(import.meta.dir, '..', '..', '..', 'infra', 'keys', 'dev')
mkdirSync(dir, { recursive: true })
if (existsSync(join(dir, `${kid}.key.pem`))) {
  console.error(`${kid} sudah ada`)
  process.exit(1)
}
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
writeFileSync(join(dir, `${kid}.key.pem`), await exportPKCS8(privateKey), { mode: 0o600 })
writeFileSync(join(dir, `${kid}.pub.pem`), await exportSPKI(publicKey))
console.info(`kunci ${kid} dibuat di infra/keys/dev`)
