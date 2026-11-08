import { DataTexture, FloatType, NearestFilter, RGBAFormat, ClampToEdgeWrapping } from 'three'
import { BASE_LEVEL, CELL, GRID, HALF, WATER_LEVEL } from '../core/constants'
import { noise } from '../util/noise'
import { clamp, smoothstep } from '../util/math'

/**
 * One rectangular patch of terrain contribution (a mountain, its echo range, or a river
 * channel). Mountains are combined with a bias-free smooth max; channels carve with min.
 */
export interface Patch {
  i0: number
  j0: number
  w: number
  h: number
  /** mountain: smooth base height above ground; river: channel surface (absolute height) */
  base: Float32Array
  /** mountain: rock detail added during the "cliffs & ridges" stage */
  detail: Float32Array
  /** rock (mountain) or water (river) mask 0..1 */
  mask: Float32Array
  /** paleness for echo ranges (淡墨) */
  pale: number
  grow: number
  detailGrow: number
  kind: 'mountain' | 'river'
}

const N = GRID * GRID

/** bias-free smooth max: blends only where both sides are positive */
function smaxSafe(a: number, b: number, k: number) {
  const kk = Math.min(k, a, b)
  if (kk <= 1e-4) return a > b ? a : b
  const h = clamp(0.5 + (0.5 * (a - b)) / kk)
  return b + (a - b) * h + kk * h * (1 - h)
}

export class Heightfield {
  /** final object-space height per texel */
  readonly height = new Float32Array(N)
  /** packed GPU data: height, rock, water, pale */
  readonly data = new Float32Array(N * 4)
  readonly texture: DataTexture

  /** gentle paper undulation */
  readonly base = new Float32Array(N)
  /** distance-to-edge falloff (0 at the paper edge) */
  readonly edge = new Float32Array(N)
  /** precomputed detail noise fields reused by every mountain */
  readonly ridgeNoise = new Float32Array(N)
  readonly fineNoise = new Float32Array(N)

  private mountainAcc = new Float32Array(N)
  private rockAcc = new Float32Array(N)
  private paleAcc = new Float32Array(N)
  private riverSurf = new Float32Array(N).fill(Infinity)
  private waterAcc = new Float32Array(N)
  private scratch = new Float32Array(N)

  readonly patches: Patch[] = []
  private dirty = true
  /** bumped whenever the final heights change (bridges/trees re-query) */
  version = 0

  constructor() {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const c = j * GRID + i
        const x = -HALF + (i + 0.5) * CELL
        const z = -HALF + (j + 0.5) * CELL
        const de = Math.min(HALF - Math.abs(x), HALF - Math.abs(z))
        const e = smoothstep(0.5, 14, de)
        this.edge[c] = e
        const und = noise.fbm(x * 0.018 + 3.1, z * 0.018 - 7.4, 3) * 0.55 + noise.fbm(x * 0.07, z * 0.07, 2) * 0.12
        this.base[c] = BASE_LEVEL + Math.max(-0.3, und) * e
        // domain-warped ridged noise → crest networks and gullies (erosion-like)
        const wx = x + noise.noise(x * 0.02, z * 0.02) * 9
        const wz = z + noise.noise(x * 0.02 + 11, z * 0.02 - 5) * 9
        this.ridgeNoise[c] = noise.ridged(wx * 0.042, wz * 0.042, 5)
        this.fineNoise[c] = noise.fbm(x * 0.16 + 40, z * 0.16 - 12, 3)
      }
    }
    this.texture = new DataTexture(this.data, GRID, GRID, RGBAFormat, FloatType)
    this.texture.magFilter = NearestFilter
    this.texture.minFilter = NearestFilter
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping
    this.texture.generateMipmaps = false
    this.rebuild()
  }

  markDirty() {
    this.dirty = true
  }

  add(p: Patch) {
    this.patches.push(p)
    this.dirty = true
  }

  /** fold finished patches into the accumulators and free them */
  private bake() {
    for (let k = this.patches.length - 1; k >= 0; k--) {
      const p = this.patches[k]
      if (p.kind === 'mountain' && (p.grow < 1 || p.detailGrow < 1)) continue
      if (p.kind === 'river' && p.grow < 1) continue
      for (let y = 0; y < p.h; y++) {
        for (let x = 0; x < p.w; x++) {
          const c = (p.j0 + y) * GRID + p.i0 + x
          const l = y * p.w + x
          if (p.kind === 'mountain') {
            const v = p.base[l] + p.detail[l]
            if (v > 0) this.mountainAcc[c] = smaxSafe(this.mountainAcc[c], v, 3)
            const m = p.mask[l]
            if (p.pale > 0) {
              if (m * p.pale > this.paleAcc[c]) this.paleAcc[c] = m * p.pale
              if (m * 0.8 > this.rockAcc[c]) this.rockAcc[c] = m * 0.8
            } else if (m > this.rockAcc[c]) this.rockAcc[c] = m
          } else {
            if (p.base[l] < this.riverSurf[c]) this.riverSurf[c] = p.base[l]
            if (p.mask[l] > this.waterAcc[c]) this.waterAcc[c] = p.mask[l]
          }
        }
      }
      this.patches.splice(k, 1)
    }
  }

  /** recompute final heights if anything changed; returns true when the texture was updated */
  rebuild() {
    if (!this.dirty) return false
    this.dirty = false
    this.bake()
    const H = this.height
    const D = this.data
    const ma = this.mountainAcc
    const M = this.scratch
    // baked state
    for (let c = 0; c < N; c++) {
      const e = this.edge[c]
      M[c] = ma[c] * e
      D[c * 4 + 1] = this.rockAcc[c] * e
      D[c * 4 + 2] = this.waterAcc[c] * e
      D[c * 4 + 3] = this.paleAcc[c]
    }
    // growing mountains, combined before any river carves (order: mountains → rivers)
    for (const p of this.patches) {
      if (p.kind !== 'mountain') continue
      const g = p.grow
      const gd = p.detailGrow
      for (let y = 0; y < p.h; y++) {
        for (let x = 0; x < p.w; x++) {
          const c = (p.j0 + y) * GRID + p.i0 + x
          const l = y * p.w + x
          const e = this.edge[c]
          const v = (p.base[l] * g + p.detail[l] * gd) * e
          if (v <= 0) continue
          M[c] = smaxSafe(M[c], v, 3)
          const mk = p.mask[l] * Math.min(1, g * 1.4) * e
          if (p.pale > 0) {
            D[c * 4 + 3] = Math.max(D[c * 4 + 3], mk * p.pale)
            D[c * 4 + 1] = Math.max(D[c * 4 + 1], mk * 0.8)
          } else D[c * 4 + 1] = Math.max(D[c * 4 + 1], mk)
        }
      }
    }
    for (let c = 0; c < N; c++) {
      let h = this.base[c] + M[c]
      const rs = this.riverSurf[c]
      if (rs < h) h = h + (rs - h) * this.edge[c]
      H[c] = h
    }
    // growing river channels
    for (const p of this.patches) {
      if (p.kind !== 'river') continue
      const g = p.grow
      for (let y = 0; y < p.h; y++) {
        for (let x = 0; x < p.w; x++) {
          const c = (p.j0 + y) * GRID + p.i0 + x
          const l = y * p.w + x
          const s = p.base[l]
          const e = this.edge[c]
          // the channel opens progressively from source to mouth (detail = arc position)
          const gc = clamp((g * 1.3 - p.detail[l]) / 0.3)
          if (s < H[c]) H[c] = H[c] + (s - H[c]) * gc * e
          const mk = p.mask[l] * gc * e
          if (mk > D[c * 4 + 2]) D[c * 4 + 2] = mk
        }
      }
    }
    for (let c = 0; c < N; c++) D[c * 4] = H[c]
    this.texture.needsUpdate = true
    this.version++
    return true
  }

  /** bilinear object-space height */
  sample(x: number, z: number) {
    const fx = (x + HALF) / CELL - 0.5
    const fz = (z + HALF) / CELL - 0.5
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const tx = fx - i
    const tz = fz - j
    const i0 = Math.min(GRID - 1, Math.max(0, i))
    const i1 = Math.min(GRID - 1, Math.max(0, i + 1))
    const j0 = Math.min(GRID - 1, Math.max(0, j))
    const j1 = Math.min(GRID - 1, Math.max(0, j + 1))
    const H = this.height
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return BASE_LEVEL
    const a = H[j0 * GRID + i0]
    const b = H[j0 * GRID + i1]
    const c = H[j1 * GRID + i0]
    const d = H[j1 * GRID + i1]
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
  }

  /** water mask 0..1 (bilinear) */
  waterMask(x: number, z: number) {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return 0
    const fx = (x + HALF) / CELL - 0.5
    const fz = (z + HALF) / CELL - 0.5
    const i = Math.min(GRID - 2, Math.max(0, Math.floor(fx)))
    const j = Math.min(GRID - 2, Math.max(0, Math.floor(fz)))
    const tx = clamp(fx - i)
    const tz = clamp(fz - j)
    const D = this.data
    const a = D[(j * GRID + i) * 4 + 2]
    const b = D[(j * GRID + i + 1) * 4 + 2]
    const c = D[((j + 1) * GRID + i) * 4 + 2]
    const d = D[((j + 1) * GRID + i + 1) * 4 + 2]
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
  }

  /** object-space water depth (0 on land) */
  waterDepth(x: number, z: number) {
    if (this.waterMask(x, z) < 0.2) return 0
    return Math.max(0, WATER_LEVEL - this.sample(x, z))
  }

  /** object-space gradient (dh/dx, dh/dz) */
  gradient(x: number, z: number, out: { x: number; z: number }) {
    const e = CELL
    out.x = (this.sample(x + e, z) - this.sample(x - e, z)) / (2 * e)
    out.z = (this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e)
    return out
  }

  rockAt(x: number, z: number) {
    const i = Math.min(GRID - 1, Math.max(0, Math.floor((x + HALF) / CELL)))
    const j = Math.min(GRID - 1, Math.max(0, Math.floor((z + HALF) / CELL)))
    return this.data[(j * GRID + i) * 4 + 1]
  }

  get animating() {
    return this.patches.length > 0
  }

  reset() {
    this.mountainAcc.fill(0)
    this.rockAcc.fill(0)
    this.paleAcc.fill(0)
    this.riverSurf.fill(Infinity)
    this.waterAcc.fill(0)
    this.patches.length = 0
    this.dirty = true
    this.rebuild()
  }

  dispose() {
    this.texture.dispose()
  }
}

/** helpers to convert between world coordinates and texel indices */
export const toCell = (x: number) => Math.floor((x + HALF) / CELL)
export const cellCenter = (i: number) => -HALF + (i + 0.5) * CELL
