/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

/** 仅开发环境：测试脚本把画布截图 POST 到 /__shot，写入 .shots/ 供人工检查画面 */
function shots(): Plugin {
  return {
    name: 'lt-shots',
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
  // 相对路径，构建产物可以直接放在 GitHub Pages 的子目录下运行
  base: './',
  plugins: [react(), shots()],
  server: { port: 5196 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
  test: { include: ['src/**/*.test.ts'], testTimeout: 120000, environment: 'node' },
})
