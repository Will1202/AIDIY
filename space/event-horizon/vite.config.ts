import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative asset URLs so the build also runs under a sub-path (GitHub Pages)
  base: './',
  plugins: [react()],
  server: { port: 5181 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
