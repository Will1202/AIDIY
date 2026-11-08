/**
 * CPU 2D simplex noise + fractal helpers used by terrain generation.
 * (Classic Gustavson simplex, seeded permutation.)
 */
const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1])

export class Noise2D {
  private perm = new Uint8Array(512)
  constructor(seed = 1) {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    let s = seed >>> 0 || 1
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      const j = s % (i + 1)
      const t = p[i]
      p[i] = p[j]
      p[j] = t
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  /** simplex noise in [-1, 1] */
  noise(xin: number, yin: number) {
    const perm = this.perm
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      const g = (perm[ii + perm[jj]] & 7) * 2
      t0 *= t0
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      const g = (perm[ii + i1 + perm[jj + j1]] & 7) * 2
      t1 *= t1
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      const g = (perm[ii + 1 + perm[jj + 1]] & 7) * 2
      t2 *= t2
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2)
    }
    return 70 * n
  }

  fbm(x: number, y: number, oct = 4, lac = 2.03, gain = 0.5) {
    let a = 1
    let f = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < oct; o++) {
      sum += a * this.noise(x * f, y * f)
      norm += a
      a *= gain
      f *= lac
    }
    return sum / norm
  }

  /** ridged multifractal in [0, 1]: sharp crests, used for ridges and gullies */
  ridged(x: number, y: number, oct = 5, lac = 2.1, gain = 0.55) {
    let a = 0.5
    let f = 1
    let sum = 0
    let prev = 1
    let norm = 0
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(this.noise(x * f, y * f))
      n *= n
      sum += n * a * prev
      norm += a
      prev = n
      a *= gain
      f *= lac
    }
    return sum / norm
  }
}

export const noise = new Noise2D(20251107)
