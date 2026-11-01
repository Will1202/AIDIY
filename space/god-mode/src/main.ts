import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import './ui/style.css';
import { App } from './app/App';
import { startLiteMode } from './fallback/LiteMode';

const canvas = document.getElementById('gl') as HTMLCanvasElement;

function webgl2Support(): string | null {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (!gl) return 'WEBGL2 UNAVAILABLE';
  const ok = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return ok ? null : 'FLOAT TARGETS UNAVAILABLE';
}

const forceLite = new URLSearchParams(location.search).has('lite');
const problem = forceLite ? 'FORCED' : webgl2Support();

if (problem) {
  startLiteMode(canvas, problem);
} else {
  try {
    const app = new App(canvas);
    app.start();
    (window as unknown as { godMode: App }).godMode = app;
  } catch (err) {
    console.error('[god-mode] falling back to lite mode', err);
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    startLiteMode(fresh, 'GPU INIT FAILED');
  }
}
