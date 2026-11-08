import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping } from 'three'
import { Rng } from '../util/rng'

/**
 * Procedural, tileable xuan-paper texture.
 *   R  brightness (fibre shading + mottling), 0.5 = neutral
 *   G  fibre density: how strongly fibres wick water in the ink simulation
 *   B  fine grain / sizing noise
 */
export function createPaperTexture(size = 1024, seed = 7) {
  const rng = new Rng(seed)
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = 'rgb(128,128,128)'
  ctx.fillRect(0, 0, size, size)

  // fibres: thin, slightly curved strands; drawn with wrap-around copies so the tile repeats
  const drawFibre = (dark: boolean) => {
    const x = rng.next() * size
    const y = rng.next() * size
    const len = rng.range(10, 70) * (size / 1024)
    const a = rng.next() * Math.PI * 2
    const bend = rng.range(-0.8, 0.8)
    const w = rng.range(0.35, 1.3) * (size / 1024)
    const alpha = dark ? rng.range(0.05, 0.2) : rng.range(0.06, 0.24)
    const c = dark ? rng.int(40, 80) : rng.int(185, 225)
    ctx.strokeStyle = `rgba(${c},${c},${c},${alpha})`
    ctx.lineWidth = w
    const ex = x + Math.cos(a) * len
    const ey = y + Math.sin(a) * len
    const mx = (x + ex) / 2 + Math.cos(a + Math.PI / 2) * len * bend * 0.3
    const my = (y + ey) / 2 + Math.sin(a + Math.PI / 2) * len * bend * 0.3
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox < -len || x + ox > size + len || y + oy < -len || y + oy > size + len) continue
        ctx.beginPath()
        ctx.moveTo(x + ox, y + oy)
        ctx.quadraticCurveTo(mx + ox, my + oy, ex + ox, ey + oy)
        ctx.stroke()
      }
    }
  }
  const count = Math.round(5200 * (size / 1024) ** 2)
  for (let i = 0; i < count; i++) drawFibre(rng.next() < 0.55)

  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data

  // periodic value noise for soft mottling (sizing unevenness)
  const lattice = (period: number) => {
    const g = new Float32Array(period * period)
    for (let i = 0; i < g.length; i++) g[i] = rng.next()
    return (u: number, v: number) => {
      const x = u * period
      const y = v * period
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const fx = x - xi
      const fy = y - yi
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)
      const i0 = ((xi % period) + period) % period
      const j0 = ((yi % period) + period) % period
      const i1 = (i0 + 1) % period
      const j1 = (j0 + 1) % period
      const a = g[j0 * period + i0]
      const b = g[j0 * period + i1]
      const c = g[j1 * period + i0]
      const e = g[j1 * period + i1]
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy
    }
  }
  const n1 = lattice(6)
  const n2 = lattice(17)
  const n3 = lattice(53)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const lum = d[i] / 255
      const fibre = Math.abs(lum - 0.502) * 2.4
      const mottle = n1(u, v) * 0.55 + n2(u, v) * 0.3 + n3(u, v) * 0.15
      const grain = rng.next()
      const bright = 0.5 + (lum - 0.502) * 0.9 + (mottle - 0.5) * 0.16 + (grain - 0.5) * 0.035
      d[i] = Math.max(0, Math.min(255, bright * 255))
      d[i + 1] = Math.max(0, Math.min(255, (0.35 + fibre * 0.9 + (mottle - 0.5) * 0.4) * 255))
      d[i + 2] = grain * 255
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const tex = new CanvasTexture(cv)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.colorSpace = NoColorSpace
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}
