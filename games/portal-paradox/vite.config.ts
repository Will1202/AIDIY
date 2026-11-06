import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

/** dev only: lets the test harness save canvas captures to .shots/ for visual review */
function shots(): Plugin {
  return {
    name: 'pp-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w.-]/g, '_')
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString()
          const b64 = body.slice(body.indexOf(',') + 1)
          const dir = resolve(root, '.shots')
          mkdirSync(dir, { recursive: true })
          writeFileSync(resolve(dir, name), Buffer.from(b64, 'base64'))
          res.end('ok')
        })
      })
    },
  }
}

export default defineConfig({
  // relative asset URLs so the build also runs under a sub-path (GitHub Pages)
  base: './',
  plugins: [react(), shots()],
  server: { port: 5184 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4500, // rapier3d-compat inlines its WASM (≈1.7 MB gzipped)
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@dimforge')) return 'rapier'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
