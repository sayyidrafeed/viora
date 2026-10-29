import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportJWK, importPKCS8, importSPKI } from 'jose'
import type { Jwk } from 'better-auth/plugins/jwt'

// Kunci dari SOPS di-mount sebagai <kid>.key.pem (private) dan <kid>.pub.pem (public).
// Kunci aktif dipilih eksplisit lewat activeKid; plugin memilih key dengan createdAt terbaru,
// jadi kunci aktif diberi createdAt paling baru.
export async function loadKeyring(dir: string, activeKid: string): Promise<Jwk[]> {
  const kids = readdirSync(dir)
    .filter((f) => f.endsWith('.key.pem'))
    .map((f) => f.slice(0, -'.key.pem'.length))
  if (!kids.includes(activeKid)) throw new Error(`keyring: kid aktif "${activeKid}" tidak ada di ${dir}`)

  return Promise.all(
    kids.map(async (kid) => {
      const priv = await importPKCS8(readFileSync(join(dir, `${kid}.key.pem`), 'utf8'), 'ES256', { extractable: true })
      const pub = await importSPKI(readFileSync(join(dir, `${kid}.pub.pem`), 'utf8'), 'ES256', { extractable: true })
      return {
        id: kid,
        alg: 'ES256' as const,
        crv: 'P-256' as const,
        publicKey: JSON.stringify(await exportJWK(pub)),
        privateKey: JSON.stringify(await exportJWK(priv)),
        createdAt: new Date(kid === activeKid ? 1 : 0),
      }
    }),
  )
}

export function refuseKeyMinting(): never {
  throw new Error('keyring: plugin JWT mencoba membuat kunci sendiri; kunci hanya boleh dari SOPS')
}
