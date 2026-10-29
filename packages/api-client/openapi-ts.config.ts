import { defineConfig } from '@hey-api/openapi-ts'

// Versi hey-api di-pin persis karena masih tahap pengembangan awal (§13). Hasil generate tidak boleh diedit tangan.
export default defineConfig({
  input: '../../apps/identity-svc/openapi.json',
  output: { path: 'src/generated', importFileExtension: '.ts' },
  plugins: ['@hey-api/client-fetch', '@tanstack/react-query'],
})
