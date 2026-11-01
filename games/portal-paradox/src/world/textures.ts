import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

/**
 * Procedural surface textures, painted once on the CPU at load. RGB is albedo
 * (sRGB), A is a roughness multiplier (×2) so a triplanar lookup costs one
 * texture per projection.
 */

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tileable value noise on a `period`-cell lattice. */
function makeNoise(seed: number, period: number) {
  const r = rng(seed)
  const lat = new Float32Array(period * period)
  for (let i = 0; i < lat.length; i++) lat[i] = r()
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const fx = x - xi, fy = y - yi
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period
    const a = lat[y0 * period + x0], b = lat[y0 * period + x1]
    const c = lat[y1 * period + x0], d = lat[y1 * period + x1]
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }
}

function fbmTile(seed: number, baseCells: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, i) => makeNoise(seed + i * 101, baseCells << i))
  return (u: number, v: number) => {
    let s = 0, a = 0.5, norm = 0
    for (let i = 0; i < octaves; i++) {
      const c = baseCells << i
      s += a * layers[i](u * c, v * c)
      norm += a
      a *= 0.5
    }
    return s / norm
  }
}

function finish(canvas: HTMLCanvasElement, srgb = true): Texture {
  const t = new CanvasTexture(canvas)
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  t.minFilter = LinearMipmapLinearFilter
  if (srgb) t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x)

/**
 * Board-formed concrete. One tile = 4.8 m: 4 × 2 formwork panels of 1.2 × 2.4 m
 * with seams, tie holes, aggregate pores, mottling and vertical rain streaks.
 */
export function concreteTexture(size = 1024, seed = 7, tone = 1): Texture {
  const c = canvas(size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const mott = fbmTile(seed, 4, 5)
  const fine = fbmTile(seed + 50, 64, 2)
  const streak = makeNoise(seed + 9, 48)
  const r = rng(seed + 3)
  const pores = new Uint8Array(size * size)
  for (let i = 0; i < size * size * 0.012; i++) {
    const x = (r() * size) | 0, y = (r() * size) | 0
    const rad = r() < 0.9 ? 1 : 2
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) pores[((y + dy + size) % size) * size + ((x + dx + size) % size)] = 1
  }
  const panelW = size / 4, panelH = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const m = mott(u, v)
      const f = fine(u, v)
      // each formwork panel was poured with a slightly different mix
      const pi = Math.floor(x / panelW) + Math.floor(y / panelH) * 4
      const panelShift = (Math.sin(pi * 12.9898 + seed) * 43758.5453) % 1
      let g = 0.47 + (m - 0.5) * 0.22 + (f - 0.5) * 0.08 + panelShift * 0.025
      // vertical streaks running down from panel seams
      const st = streak(u * 48, v * 3)
      g -= Math.max(0, st - 0.62) * 0.18
      // seams
      const sx = Math.min(x % panelW, panelW - (x % panelW))
      const sy = Math.min(y % panelH, panelH - (y % panelH))
      const seam = Math.min(sx, sy)
      let rough = 0.9 + (f - 0.5) * 0.2
      if (seam < 1.5) { g *= 0.55; rough = 1 }
      else if (seam < 3) g *= 1.06
      // tie holes: 2 columns × 3 rows per panel
      const lx = x % panelW, ly = y % panelH
      for (const hx of [0.25, 0.75]) {
        for (const hy of [0.17, 0.5, 0.83]) {
          const dx = lx - hx * panelW, dy = ly - hy * panelH
          const d2 = dx * dx + dy * dy
          const rr = size / 170
          if (d2 < rr * rr) { g *= 0.32; rough = 1 }
          else if (d2 < rr * rr * 2.6) g *= 0.9
        }
      }
      if (pores[y * size + x]) { g *= 0.62; rough = 1 }
      g = clamp(g * tone)
      const i4 = (y * size + x) * 4
      img.data[i4] = g * 255 * 0.985
      img.data[i4 + 1] = g * 255
      img.data[i4 + 2] = g * 255 * 1.02
      img.data[i4 + 3] = clamp(rough * 0.5) * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c)
}

/** Polished dark concrete floor: one tile = 6 m with saw-cut joints. */
export function floorTexture(size = 1024, seed = 21): Texture {
  const c = canvas(size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const mott = fbmTile(seed, 3, 5)
  const fine = fbmTile(seed + 5, 96, 2)
  const smudge = fbmTile(seed + 77, 6, 4)
  const r = rng(seed)
  const agg = new Float32Array(size * size)
  for (let i = 0; i < size * size * 0.02; i++) {
    const x = (r() * size) | 0, y = (r() * size) | 0
    agg[y * size + x] = r() * 0.5 - 0.15
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const m = mott(u, v), f = fine(u, v), s = smudge(u, v)
      let g = 0.2 + (m - 0.5) * 0.12 + (f - 0.5) * 0.05 + agg[y * size + x] * 0.25
      let rough = 0.42 + (s - 0.5) * 0.55 + (f - 0.5) * 0.1
      const jx = Math.min(x, size - x), jy = Math.min(y, size - y)
      const j = Math.min(jx, jy)
      if (j < 1.6) { g *= 0.35; rough = 1.4 }
      const i4 = (y * size + x) * 4
      img.data[i4] = clamp(g) * 255
      img.data[i4 + 1] = clamp(g * 1.01) * 255
      img.data[i4 + 2] = clamp(g * 1.04) * 255
      img.data[i4 + 3] = clamp(rough * 0.5) * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c)
}

/** Dark brushed metal with panel seams and rivets. One tile = 2 m. */
export function metalTexture(size = 512, seed = 33): Texture {
  const c = canvas(size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const brush = makeNoise(seed, 256)
  const mott = fbmTile(seed + 1, 4, 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const b = brush(u * 4, v * 256)
      const m = mott(u, v)
      let g = 0.16 + (b - 0.5) * 0.05 + (m - 0.5) * 0.06
      let rough = 0.55 + (b - 0.5) * 0.25 + (m - 0.5) * 0.3
      const px = x % (size / 2), py = y % (size / 4)
      const seam = Math.min(px, size / 2 - px, py, size / 4 - py)
      if (seam < 1.2) { g *= 0.4; rough = 1.3 }
      const i4 = (y * size + x) * 4
      img.data[i4] = clamp(g) * 255
      img.data[i4 + 1] = clamp(g * 1.02) * 255
      img.data[i4 + 2] = clamp(g * 1.06) * 255
      img.data[i4 + 3] = clamp(rough * 0.5) * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c)
}

/** Warm layered sandstone / basalt for the floating islands. One tile = 24 m. */
export function rockTexture(size = 1024, seed = 91): Texture {
  const c = canvas(size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const mott = fbmTile(seed, 4, 6)
  const warp = fbmTile(seed + 3, 3, 4)
  const fine = fbmTile(seed + 8, 64, 2)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const w = warp(u, v)
      const band = 0.5 + 0.5 * Math.sin((v + w * 0.18) * Math.PI * 2 * 9)
      const m = mott(u, v), f = fine(u, v)
      const g = 0.5 + (m - 0.5) * 0.5 + (f - 0.5) * 0.18
      const cr = clamp((0.58 + band * 0.14) * g * 1.25)
      const cg = clamp((0.47 + band * 0.08) * g * 1.18)
      const cb = clamp((0.42 + band * 0.02) * g * 1.12)
      const i4 = (y * size + x) * 4
      img.data[i4] = cr * 255
      img.data[i4 + 1] = cg * 255
      img.data[i4 + 2] = cb * 255
      img.data[i4 + 3] = clamp((0.9 + (f - 0.5) * 0.3) * 0.5) * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c)
}

export interface SignSpec {
  w: number
  h: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

/** Stencilled wall markings, consoles and labels; transparent background. */
export function signTexture(spec: SignSpec, pxPerUnit = 128): Texture {
  const c = document.createElement('canvas')
  c.width = Math.max(16, Math.round(spec.w * pxPerUnit))
  c.height = Math.max(16, Math.round(spec.h * pxPerUnit))
  const ctx = c.getContext('2d')!
  spec.draw(ctx, c.width, c.height)
  const t = finish(c)
  t.wrapS = t.wrapT = 1001 // ClampToEdgeWrapping
  return t
}
