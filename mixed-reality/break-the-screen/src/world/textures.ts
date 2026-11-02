import { CanvasTexture, RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture } from 'three'
import { rng } from '../core/config'

/** tileable value noise, octaves summed, returned as 0..1 floats */
export function noiseField(size: number, seed: number, octaves = 5, base = 4) {
  const out = new Float32Array(size * size)
  const r = rng(seed)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const cells = base << o
    const grid = new Float32Array(cells * cells)
    for (let i = 0; i < grid.length; i++) grid[i] = r()
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const y0 = Math.floor(fy)
      const ty = fy - y0
      const sy = ty * ty * (3 - 2 * ty)
      const y1 = (y0 + 1) % cells
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const x0 = Math.floor(fx)
        const tx = fx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const x1 = (x0 + 1) % cells
        const a = grid[y0 * cells + x0]
        const b = grid[y0 * cells + x1]
        const c = grid[y1 * cells + x0]
        const d = grid[y1 * cells + x1]
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy)
      }
    }
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function canvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function tex(c: HTMLCanvasElement, color: boolean, repeat = 1): Texture {
  const t = new CanvasTexture(c)
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  return t
}

/** board-formed concrete with panel seams and tie holes (albedo in rgb) */
export function concreteTexture(seed = 7) {
  const S = 512
  const c = canvas(S)
  const g = c.getContext('2d')!
  const n = noiseField(S, seed, 6, 4)
  const fine = noiseField(S, seed + 3, 3, 64)
  const img = g.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const y = Math.floor(i / S)
    const plank = Math.sin((y / S) * Math.PI * 16) * 0.5 + 0.5
    const v = 0.36 + n[i] * 0.34 + fine[i] * 0.16 + plank * 0.03
    const k = Math.max(0, Math.min(255, v * 255))
    img.data[i * 4] = k * 0.97
    img.data[i * 4 + 1] = k
    img.data[i * 4 + 2] = k * 1.03
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 2
  g.strokeRect(1, 1, S - 2, S - 2)
  g.fillStyle = 'rgba(0,0,0,0.45)'
  for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
    g.beginPath()
    g.arc(x * S, y * S, 5, 0, Math.PI * 2)
    g.fill()
  }
  return tex(c, true)
}

/** micro-roughness variation for metal and floors (grey, linear) */
export function roughnessTexture(seed = 11) {
  const S = 256
  const c = canvas(S)
  const g = c.getContext('2d')!
  const n = noiseField(S, seed, 5, 8)
  const img = g.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const k = 150 + (n[i] - 0.5) * 140
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return tex(c, false)
}

/** brushed metal streaks */
export function brushedTexture(seed = 5) {
  const S = 256
  const c = canvas(S)
  const g = c.getContext('2d')!
  const r = rng(seed)
  g.fillStyle = '#8a8a8a'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < 900; i++) {
    const y = r() * S
    const a = 0.03 + r() * 0.08
    g.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`
    g.lineWidth = 0.5 + r()
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(S, y + (r() - 0.5) * 3)
    g.stroke()
  }
  return tex(c, false)
}

/** a holographic label: thin mono type with a hairline rule */
export function labelTexture(lines: string[], w = 1024, h = 256, accent = '#bfe3ff') {
  const c = canvas(w, h)
  const g = c.getContext('2d')!
  g.clearRect(0, 0, w, h)
  g.fillStyle = accent
  g.strokeStyle = accent
  g.lineWidth = 2
  g.globalAlpha = 0.9
  g.beginPath()
  g.moveTo(8, 10)
  g.lineTo(w * 0.35, 10)
  g.stroke()
  g.fillRect(8, 6, 26, 9)
  lines.forEach((l, i) => {
    g.globalAlpha = i === 0 ? 0.95 : 0.55
    g.font = `${i === 0 ? 600 : 400} ${i === 0 ? 64 : 34}px "Martian Mono Variable", ui-monospace, monospace`
    g.fillText(l, 8, 86 + i * 58)
  })
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}
