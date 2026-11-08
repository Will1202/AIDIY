import { BASE_LEVEL, CELL, GRID, HALF } from '../core/constants'
import { clamp, smoothstep } from '../util/math'
import { arcLengths, pathLength, resample, smooth, smoothAttr, type P2, type StrokePoint } from '../util/path'
import { Rng } from '../util/rng'
import type { Heightfield, Patch } from './Heightfield'

/**
 * MOUNTAIN BRUSH → heightfield patches.
 * The smoothed stroke becomes the ridge crest: height along the crest follows the ink
 * (slow, heavy strokes raise taller peaks), stroke length scales the whole range, and
 * peaks are distributed along the drawn path. Rock detail (ridged crests, gullies,
 * cliff terraces) is stored separately so it can "grow in" after the main rise.
 */

export interface MountainSpec {
  ridge: StrokePoint[]
  length: number
  height: number
  peaks: { x: number; z: number; h: number }[]
}

interface Peak {
  s: number
  x: number
  z: number
  h: number
  r: number
}

function crestEnvelope(u: number) {
  return 0.38 + 0.62 * Math.pow(Math.sin(Math.PI * clamp(u, 0.02, 0.98)), 0.7)
}

/** segment sweep: nearest distance + (segment, fraction) for every cell of a box */
function sweep(path: P2[], i0: number, j0: number, w: number, h: number, pad: number) {
  const dist = new Float32Array(w * h).fill(Infinity)
  const seg = new Int32Array(w * h)
  const frac = new Float32Array(w * h)
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]
    const b = path[k + 1]
    const minX = Math.min(a.x, b.x) - pad
    const maxX = Math.max(a.x, b.x) + pad
    const minZ = Math.min(a.z, b.z) - pad
    const maxZ = Math.max(a.z, b.z) + pad
    const ci0 = Math.max(i0, Math.floor((minX + HALF) / CELL))
    const ci1 = Math.min(i0 + w - 1, Math.floor((maxX + HALF) / CELL))
    const cj0 = Math.max(j0, Math.floor((minZ + HALF) / CELL))
    const cj1 = Math.min(j0 + h - 1, Math.floor((maxZ + HALF) / CELL))
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz || 1e-6
    for (let j = cj0; j <= cj1; j++) {
      const z = -HALF + (j + 0.5) * CELL
      for (let i = ci0; i <= ci1; i++) {
        const x = -HALF + (i + 0.5) * CELL
        let f = ((x - a.x) * dx + (z - a.z) * dz) / l2
        f = f < 0 ? 0 : f > 1 ? 1 : f
        const px = a.x + dx * f - x
        const pz = a.z + dz * f - z
        const d = Math.sqrt(px * px + pz * pz)
        const l = (j - j0) * w + (i - i0)
        if (d < dist[l]) {
          dist[l] = d
          seg[l] = k
          frac[l] = f
        }
      }
    }
  }
  return { dist, seg, frac }
}

function box(path: P2[], pad: number) {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const p of path) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.z)
    z1 = Math.max(z1, p.z)
  }
  const i0 = Math.max(0, Math.floor((x0 - pad + HALF) / CELL))
  const i1 = Math.min(GRID - 1, Math.ceil((x1 + pad + HALF) / CELL))
  const j0 = Math.max(0, Math.floor((z0 - pad + HALF) / CELL))
  const j1 = Math.min(GRID - 1, Math.ceil((z1 + pad + HALF) / CELL))
  return { i0, j0, w: Math.max(1, i1 - i0 + 1), h: Math.max(1, j1 - j0 + 1) }
}

function buildRange(hf: Heightfield, ridge: StrokePoint[], rng: Rng, Hmain: number, w0: number, detailAmt: number, pale: number): { patch: Patch; peaks: Peak[] } {
  const L = Math.max(pathLength(ridge), 1)
  const arcs = arcLengths(ridge)
  // peaks distributed along the drawn path
  const peaks: Peak[] = []
  let s = rng.range(3, 8)
  const step = () => rng.range(13, 22)
  const nrmAt = (k: number) => {
    const a = ridge[Math.max(0, k - 1)]
    const b = ridge[Math.min(ridge.length - 1, k + 1)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    return { x: -dz / l, z: dx / l }
  }
  const pointAt = (sv: number) => {
    let k = 0
    while (k < ridge.length - 2 && arcs[k + 1] < sv) k++
    const f = clamp((sv - arcs[k]) / Math.max(1e-6, arcs[k + 1] - arcs[k]))
    const a = ridge[k]
    const b = ridge[k + 1]
    return { k, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, p: a.p + (b.p - a.p) * f }
  }
  if (L < 10) s = L / 2
  while (s < L) {
    const pt = pointAt(s)
    const env = crestEnvelope(s / L)
    const n = nrmAt(pt.k)
    const lat = rng.range(-2.2, 2.2) * Math.min(1, L / 20)
    peaks.push({ s, x: pt.x + n.x * lat, z: pt.z + n.z * lat, h: Hmain * env * rng.range(0.58, 0.95) * (0.72 + 0.45 * pt.p), r: w0 * rng.range(0.42, 0.68) })
    s += step()
  }
  // the heaviest ink along the stroke carries the main peak
  let best = 0
  let bestScore = -1
  for (let i = 0; i < peaks.length; i++) {
    const pt = pointAt(peaks[i].s)
    const score = (0.6 + pt.p) * crestEnvelope(peaks[i].s / L)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  if (peaks.length) {
    peaks[best].h = Hmain * (0.95 + 0.1 * rng.next())
    peaks[best].r = w0 * 0.72
  }

  // crest height per ridge point
  const crest = new Float32Array(ridge.length)
  for (let i = 0; i < ridge.length; i++) {
    let c = 0.4 * Hmain * crestEnvelope(arcs[i] / L) * (0.75 + 0.4 * ridge[i].p)
    for (const pk of peaks) {
      const t = (arcs[i] - pk.s) / (pk.r * 0.95)
      c = Math.max(c, pk.h / (1 + t * t))
    }
    crest[i] = c
  }

  const pad = w0 * 1.65 + 2
  const bx = box(ridge, pad)
  const { dist, seg, frac } = sweep(ridge, bx.i0, bx.j0, bx.w, bx.h, pad)
  const n = bx.w * bx.h
  const base = new Float32Array(n)
  const detail = new Float32Array(n)
  const mask = new Float32Array(n)
  for (let y = 0; y < bx.h; y++) {
    const j = bx.j0 + y
    const z = -HALF + (j + 0.5) * CELL
    for (let x = 0; x < bx.w; x++) {
      const l = y * bx.w + x
      const d = dist[l]
      if (!(d < pad)) continue
      const i = bx.i0 + x
      const wx = -HALF + (i + 0.5) * CELL
      const k = seg[l]
      const c = crest[k] + (crest[Math.min(k + 1, ridge.length - 1)] - crest[k]) * frac[l]
      const ws = w0 * (0.6 + 0.4 * (c / Hmain))
      const q = d / ws
      let bh = c * Math.exp(-q * q * 2.3) * (1 - smoothstep(1.15, 1.6, q))
      for (const pk of peaks) {
        const dd = Math.hypot(wx - pk.x, z - pk.z)
        if (dd < pk.r) {
          // steep flanks, slightly rounded summit
          const qq = Math.sqrt((dd / pk.r) ** 2 + 0.004)
          const cone = pk.h * Math.pow(Math.max(0, 1 - qq), 1.35)
          // bias-free smooth union
          const kk = Math.min(2.5, bh, cone)
          if (kk > 1e-3) {
            const hh = clamp(0.5 + (0.5 * (cone - bh)) / kk)
            bh = bh + (cone - bh) * hh + kk * hh * (1 - hh)
          } else bh = Math.max(bh, cone)
        }
      }
      if (bh < 0.01) continue
      const c2 = j * GRID + i
      const hn = bh / Hmain
      const rn = hf.ridgeNoise[c2]
      const fine = hf.fineNoise[c2]
      let det = bh * (0.42 * (rn - 0.36) * smoothstep(0.03, 0.32, hn) + 0.06 * fine * smoothstep(0.3, 0.85, hn))
      // cliff bands: gentle terracing makes the vertical faces 斧劈皴 reads on
      // (warped so the bands never read as contour lines)
      const st = Hmain * 0.16
      const tw = bh + det + fine * st * 0.9 + (rn - 0.4) * st
      const fr = tw / st
      const terr = (Math.floor(fr) + smoothstep(0.25, 0.8, fr - Math.floor(fr))) * st
      det += (terr - tw) * 0.18 * smoothstep(0.12, 0.45, hn)
      base[l] = bh
      detail[l] = det * detailAmt
      mask[l] = smoothstep(0.025, 0.22, hn)
    }
  }
  return {
    patch: { ...bx, base, detail, mask, pale, grow: 0, detailGrow: 0, kind: 'mountain' },
    peaks,
  }
}

export function buildMountain(hf: Heightfield, raw: StrokePoint[], seed: number) {
  const rng = new Rng(seed)
  let ridge = smooth(resample(raw, 1.2), 3, 2)
  smoothAttr(ridge, 'p', 4)
  if (ridge.length < 2 || pathLength(ridge) < 2) {
    // a single dab: a lone peak
    const c = raw[0]
    ridge = [
      { ...c, x: c.x - 1.2 },
      { ...c, x: c.x + 1.2 },
    ]
  }
  const L = pathLength(ridge)
  let avgP = 0
  for (const p of ridge) avgP += p.p
  avgP /= ridge.length
  const Hmain = clamp(12 + L * 0.3, 14, 46) * (0.74 + 0.42 * avgP) * rng.range(0.92, 1.08)
  const w0 = 9 + Hmain * 0.42

  const main = buildRange(hf, ridge, rng, Hmain, w0, 1, 0)

  // 5th stage: a pale echo range further back (淡墨远山), on the side facing away
  let sx = 0
  let sz = 0
  for (let i = 1; i < ridge.length; i++) {
    sx += ridge[i].x - ridge[i - 1].x
    sz += ridge[i].z - ridge[i - 1].z
  }
  const dl = Math.hypot(sx, sz) || 1
  let nx = -sz / dl
  let nz = sx / dl
  if (nz > 0 || (Math.abs(nz) < 0.2 && nx * ridge[0].x < 0)) {
    nx = -nx
    nz = -nz
  }
  const off = 15 + Hmain * 0.38
  const echoRidge = ridge.map((p, i) => {
    const sway = Math.sin(i * 0.07 + rng.next() * 0.2) * 4
    return { ...p, x: p.x + nx * (off + sway) + rng.range(-0.3, 0.3), z: p.z + nz * (off + sway) }
  })
  // trim parts of the echo that leave the paper
  const echoIn = echoRidge.filter((p) => Math.abs(p.x) < HALF - 6 && Math.abs(p.z) < HALF - 6)
  let echo: Patch | null = null
  if (echoIn.length > 4 && pathLength(echoIn) > 8) {
    echo = buildRange(hf, smooth(echoIn, 4, 2), rng, Hmain * 0.56, w0 * 1.22, 0.55, 1).patch
  }

  const spec: MountainSpec = {
    ridge,
    length: L,
    height: Hmain,
    peaks: main.peaks.map((p) => ({ x: p.x, z: p.z, h: p.h + BASE_LEVEL })),
  }
  return { main: main.patch, echo, spec }
}
