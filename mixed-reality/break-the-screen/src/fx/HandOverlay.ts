import type { Pointer } from '../tracking/GestureEngine'

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

// a canonical right hand, palm to camera, mirrored as the user sees it; units = palm length, y up negative
const OPEN: [number, number][] = [
  [0, 0], [0.35, -0.2], [0.6, -0.45], [0.8, -0.65], [0.95, -0.85],
  [0.3, -0.95], [0.35, -1.35], [0.38, -1.6], [0.4, -1.82],
  [0.05, -1.0], [0.05, -1.45], [0.05, -1.72], [0.05, -1.95],
  [-0.2, -0.95], [-0.25, -1.35], [-0.28, -1.58], [-0.3, -1.78],
  [-0.42, -0.85], [-0.52, -1.15], [-0.58, -1.33], [-0.62, -1.5],
]
const PINCH: [number, number][] = [
  [0, 0], [0.35, -0.2], [0.55, -0.5], [0.62, -0.8], [0.64, -1.07],
  [0.3, -0.95], [0.45, -1.2], [0.58, -1.24], [0.64, -1.13],
  [0.05, -1.0], [0.1, -1.38], [0.12, -1.55], [0.1, -1.66],
  [-0.2, -0.95], [-0.2, -1.28], [-0.2, -1.45], [-0.2, -1.55],
  [-0.42, -0.85], [-0.48, -1.1], [-0.5, -1.24], [-0.5, -1.34],
]

/** a procedural hand pose for the cinematic demo, positioned so its pinch point sits on (cx, cy) */
export function syntheticHand(cx: number, cy: number, pinch: number, aspect: number, size = 0.13, out: Float32Array<ArrayBufferLike> = new Float32Array(42)) {
  const k = Math.min(1, Math.max(0, pinch))
  const tip = [(OPEN[4][0] + OPEN[8][0]) * 0.5 * (1 - k) + PINCH[4][0] * k, (OPEN[4][1] + OPEN[8][1]) * 0.5 * (1 - k) + PINCH[4][1] * k]
  for (let i = 0; i < 21; i++) {
    const x = OPEN[i][0] + (PINCH[i][0] - OPEN[i][0]) * k - tip[0]
    const y = OPEN[i][1] + (PINCH[i][1] - OPEN[i][1]) * k - tip[1]
    out[i * 2] = cx + (x * size) / aspect
    out[i * 2 + 1] = cy - y * size * -1
  }
  return out
}

/**
 * 2-D overlay: a faint holographic outline of each tracked hand where it maps
 * onto the screen (so the user can see where their hand "is"), plus the
 * simulated hand of the cinematic demo, which is labelled as such.
 */
export class HandOverlay {
  readonly canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  visible = true

  constructor() {
    this.canvas.className = 'hand-overlay'
  }

  resize(w: number, h: number, dpr: number) {
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
  }

  draw(pointers: Pointer[]) {
    const c = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    c.clearRect(0, 0, W, H)
    if (!this.visible) return
    for (const p of pointers) {
      if (!p.present || !p.ghost || p.kind === 'mouse') continue
      const g = p.ghost
      const demo = p.kind === 'demo'
      const col = p.pinch ? 'rgba(255,214,160,' : demo ? 'rgba(255,226,190,' : 'rgba(180,222,255,'
      c.lineWidth = Math.max(1, W / 1400)
      c.strokeStyle = col + '0.42)'
      c.beginPath()
      for (const [a, b] of BONES) {
        c.moveTo(g[a * 2] * W, g[a * 2 + 1] * H)
        c.lineTo(g[b * 2] * W, g[b * 2 + 1] * H)
      }
      c.stroke()
      c.fillStyle = col + '0.75)'
      for (let i = 0; i < 21; i++) {
        c.beginPath()
        c.arc(g[i * 2] * W, g[i * 2 + 1] * H, (i % 4 === 0 ? 2.6 : 1.6) * (W / 1400), 0, Math.PI * 2)
        c.fill()
      }
      if (demo) {
        c.font = `${Math.round(W / 130)}px "Martian Mono Variable", ui-monospace, monospace`
        c.fillStyle = 'rgba(255,226,190,0.7)'
        c.fillText('SIMULATED HAND · DEMO INPUT', g[0] * W - W * 0.04, g[1] * H + H * 0.035)
      }
    }
  }
}
