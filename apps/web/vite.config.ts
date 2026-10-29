import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Web dilayani lewat Kong (http://localhost:18000), satu origin dengan /v1, jadi cookie sesi Better Auth berlaku tanpa CORS.
export default defineConfig({
  // Docker Desktop meneruskan host.docker.internal ke loopback IPv4 host (default Vite hanya [::1]).
  // Di Linux (CI) host.docker.internal adalah IP bridge Docker, jadi WEB_HOST=0.0.0.0.
  server: { host: process.env.WEB_HOST ?? '127.0.0.1', port: 13000, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
