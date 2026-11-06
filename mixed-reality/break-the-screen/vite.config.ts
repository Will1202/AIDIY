import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const WASM_DIR = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm')

/**
 * MediaPipe's WASM runtime is served from this origin (dev middleware + copied
 * into dist at build) so tracking never depends on a CDN. The .task models ship
 * in public/mediapipe/models for the same reason.
 */
function mediapipeWasm(): Plugin {
  return {
    name: 'bts-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!/^[\w.-]+$/.test(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.setHeader('Cache-Control', 'max-age=3600')
        createReadStream(resolve(WASM_DIR, file)).on('error', () => next()).pipe(res)
      })
    },
    generateBundle() {
      for (const f of readdirSync(WASM_DIR)) {
        this.emitFile({ type: 'asset', fileName: `mediapipe/wasm/${f}`, source: readFileSync(resolve(WASM_DIR, f)) })
      }
    },
  }
}

/** dev only: the test harness POSTs canvas captures here; they land in .shots/ for visual review */
function shots(): Plugin {
  return {
    name: 'bts-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w.-]/g, '_')
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString()
          const dir = resolve(root, '.shots')
          mkdirSync(dir, { recursive: true })
          writeFileSync(resolve(dir, name), Buffer.from(body.slice(body.indexOf(',') + 1), 'base64'))
          res.end('ok')
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), mediapipeWasm(), shots()],
  server: { port: 5187 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4500, // rapier3d-compat inlines its WASM
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@dimforge')) return 'rapier'
          if (id.includes('node_modules/@mediapipe')) return 'mediapipe'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
