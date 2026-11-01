import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// MediaPipe's WASM runtime is served locally so hand tracking does not depend on a CDN.
// Only the hand-landmark model itself is fetched from Google's public model bucket on demand.
export default defineConfig({
  base: './',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'mediapipe/wasm',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
});
