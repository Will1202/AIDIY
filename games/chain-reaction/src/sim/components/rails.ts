import { add, clamp, cross, norm, scale, smoothstep, sub, type V3 } from '../math'
import { RAPIER } from '../physics'
import type { Component } from '../component'

/** Standard marble radius every track profile is designed around. */
export const MARBLE_R = 0.15
/** rail tube radius */
export const RAIL_R = 0.028
/** launcher barrel: lateral offset of its support rails from the ball line */
export const SUPPORT_W = 0.105
/** support rails sit this far below the ball centre so the ball rests on both */
export const SUPPORT_H = Math.sqrt((MARBLE_R + RAIL_R) ** 2 - SUPPORT_W ** 2)

export interface PathSample {
  /** ball-centre position (local) */
  p: V3
  /** unit tangent (includes slope) */
  t: V3
  /** horizontal left vector, already banked */
  l: V3
  /** banked up vector */
  u: V3
  /** arc length from start */
  s: number
  bank: number
}

const Y: V3 = { x: 0, y: 1, z: 0 }

/** frames along a polyline of ball-centre points; bank in radians per point */
export function framePath(points: V3[], banks?: number[]): PathSample[] {
  const out: PathSample[] = []
  let s = 0
  const n = points.length
  // central differences inside; at the ends the chord bisects the end tangents of an arc,
  // so t_end = 2·chord − t_neighbour is exact for circles and helices
  const tangents: V3[] = points.map((_, i) => norm(sub(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)])))
  if (n >= 3) {
    const c0 = norm(sub(points[1], points[0]))
    tangents[0] = norm(sub(scale(c0, 2), tangents[1]))
    const c1 = norm(sub(points[n - 1], points[n - 2]))
    tangents[n - 1] = norm(sub(scale(c1, 2), tangents[n - 2]))
  }
  for (let i = 0; i < points.length; i++) {
    const t = tangents[i]
    const th = norm({ x: t.x, y: 0, z: t.z })
    let l = norm(cross(Y, th))
    let u = Y
    const bank = banks ? banks[i] : 0
    if (bank) {
      const c = Math.cos(bank)
      const sn = Math.sin(bank)
      // tilt toward the inside of the turn: up leans to the left for positive bank
      const l2 = add(scale(l, c), scale(Y, -sn))
      u = add(scale(Y, c), scale(l, sn))
      l = l2
    }
    if (i > 0) s += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z)
    out.push({ p: points[i], t, l, u, s, bank })
  }
  return out
}

/** sample a planar arc / helix in local coordinates (start at origin heading +x) */
export function arcPoints(radius: number, angle: number, drop: number, seg = 0.1): V3[] {
  const k = Math.sign(angle) / radius
  const arc = Math.abs(angle) * radius
  const n = Math.max(2, Math.ceil(arc / seg))
  const pts: V3[] = []
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const psi = angle * u
    pts.push({ x: Math.sin(psi) / k, y: -drop * u, z: (Math.cos(psi) - 1) / k })
  }
  return pts
}

/** bank profile that eases in and out so pieces meet flat */
export function bankRamp(n: number, bank: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1)
    const e = Math.min(smoothstep(0, 0.22, u), smoothstep(1, 0.78, u))
    out.push(bank * clamp(e, 0, 1))
  }
  return out
}

/** half-pipe trough: the ball rolls in a concave channel and self-banks in curves */
export const TROUGH_R = 0.22
export const TROUGH_WALL_DEG = 100
export const TROUGH_COLS = 14

export interface TroughGeometry {
  /** local vertices, row-major: one row of TROUGH_COLS profile points per path sample */
  verts: Float32Array
  idx: Uint32Array
  rows: number
  cols: number
}

export function troughGeometry(path: PathSample[], extendEnds = 0.015): TroughGeometry {
  const M = TROUGH_COLS
  const verts: number[] = []
  const idx: number[] = []
  const n = path.length
  for (let i = 0; i < n; i++) {
    const f = path[i]
    // overlap neighbours a touch so the seam between two pieces has no gap
    const ext = i === 0 ? -extendEnds : i === n - 1 ? extendEnds : 0
    const p = add(f.p, scale(f.t, ext))
    const c = add(p, scale(f.u, TROUGH_R - MARBLE_R))
    for (let j = 0; j < M; j++) {
      const phi = ((-TROUGH_WALL_DEG + (2 * TROUGH_WALL_DEG * j) / (M - 1)) * Math.PI) / 180
      const q = add(c, add(scale(f.l, Math.sin(phi) * TROUGH_R), scale(f.u, -Math.cos(phi) * TROUGH_R)))
      verts.push(q.x, q.y, q.z)
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j
      const b = a + 1
      const c = a + M
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx), rows: n, cols: M }
}

/** trimesh collider with internal-edge fixing (no ghost bumps between triangles) */
export function buildTrough(c: Component, g: TroughGeometry, part = 'trough') {
  const desc = RAPIER.ColliderDesc.trimesh(g.verts, g.idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
  return c.fixedCollider(desc, { x: 0, y: 0, z: 0 }, null, part, 'brass')
}
