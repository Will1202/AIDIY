import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, ExtrudeGeometry, LatheGeometry, Path, Shape, TubeGeometry, Vector2, Vector3,
} from 'three'
import type { TroughGeometry, PathSample } from '../sim/components/rails'
import { TROUGH_COLS, TROUGH_R, MARBLE_R } from '../sim/components/rails'

const gearCache = new Map<string, BufferGeometry>()

/**
 * Gear with real tooth geometry: involute-like flanks approximated per tooth, root fillet,
 * and either spokes, a solid web with lightening holes, or a thin ring. Extruded with a bevel.
 * Tooth 0 is centred on local +x, matching the transmission solver's phase convention.
 */
export function gearGeometry(teeth: number, module: number, thickness: number, style: string, detail = 1): BufferGeometry {
  const key = `${teeth}|${module}|${thickness}|${style}|${detail}`
  const hit = gearCache.get(key)
  if (hit) return hit
  const rp = (module * teeth) / 2
  const ra = rp + module
  const rf = rp - 1.25 * module
  const shape = new Shape()
  const per = Math.max(4, Math.round(6 * detail))
  const pitch = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const c = i * pitch
    // angular half-widths: tooth ~ 0.5 pitch at the pitch circle, narrower at the tip
    const hwRoot = pitch * 0.3
    const hwPitch = pitch * 0.25
    const hwTip = pitch * 0.15
    const pts: [number, number][] = []
    for (let k = 0; k <= per; k++) {
      const u = k / per
      const r = rf + (ra - rf) * u
      const hw = u < 0.55 ? hwRoot + (hwPitch - hwRoot) * (u / 0.55) : hwPitch + (hwTip - hwPitch) * ((u - 0.55) / 0.45)
      pts.push([r, c - hw])
    }
    const right = pts.map(([r, a]): [number, number] => [r, 2 * c - a]).reverse()
    const seq: [number, number][] = [...pts, ...right]
    // root gap to the next tooth
    seq.push([rf, c + pitch * 0.5])
    for (const [j, [r, a]] of seq.entries()) {
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0 && j === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    }
  }
  shape.closePath()
  const hub = Math.max(0.06, rp * 0.16)
  const axle = new Path()
  axle.absarc(0, 0, hub * 0.45, 0, Math.PI * 2, true)
  shape.holes.push(axle)
  const rim = rf - Math.max(0.05, rp * 0.12)
  if (style === 'spoked' && rp > 0.35) {
    const n = rp > 1.2 ? 6 : 5
    for (let s = 0; s < n; s++) {
      const a0 = (s / n) * Math.PI * 2 + 0.16
      const a1 = ((s + 1) / n) * Math.PI * 2 - 0.16
      const h = new Path()
      const r0 = hub * 1.5
      h.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0)
      h.absarc(0, 0, rim, a0 + 0.06, a1 - 0.06, false)
      h.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0)
      h.absarc(0, 0, r0, a1, a0, true)
      shape.holes.push(h)
    }
  } else if (style === 'solid' && rp > 0.3) {
    const n = 6
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2 + Math.PI / n
      const rr = (hub + rim) / 2
      const h = new Path()
      h.absarc(Math.cos(a) * rr, Math.sin(a) * rr, (rim - hub) * 0.3, 0, Math.PI * 2, true)
      shape.holes.push(h)
    }
  } else if (style === 'ring' && rp > 0.35) {
    const h = new Path()
    h.absarc(0, 0, rim, 0, Math.PI * 2, true)
    shape.holes.push(h)
  }
  const bevel = Math.min(thickness * 0.18, module * 0.25)
  const g = new ExtrudeGeometry(shape, { depth: thickness - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 2, curveSegments: Math.round(28 * detail) })
  g.translate(0, 0, -(thickness - bevel * 2) / 2)
  g.computeVertexNormals()
  gearCache.set(key, g)
  return g
}

/**
 * Visible trough: the same profile rows the collider uses (inner surface), plus an outer skin
 * offset outward and rolled lips, so what you see is exactly what the marble rolls on.
 */
export function troughMesh(g: TroughGeometry, thickness = 0.025): BufferGeometry {
  const rows = g.rows
  const cols = g.cols
  const v = g.verts
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  // per-row centre: approximate the arc centre as mean of first+last col and mid col geometry
  const center = (r: number) => {
    // centre of the circle through col 0, mid, last
    const a = r * cols * 3
    const mid = Math.floor(cols / 2)
    const p0 = new Vector3(v[a], v[a + 1], v[a + 2])
    const pm = new Vector3(v[a + mid * 3], v[a + mid * 3 + 1], v[a + mid * 3 + 2])
    const p1 = new Vector3(v[a + (cols - 1) * 3], v[a + (cols - 1) * 3 + 1], v[a + (cols - 1) * 3 + 2])
    // the bottom point is TROUGH_R below the centre along (p0+p1)/2 → pm direction
    const top = p0.clone().add(p1).multiplyScalar(0.5)
    const dir = pm.clone().sub(top).normalize()
    return pm.clone().addScaledVector(dir, -TROUGH_R)
  }
  const centers: Vector3[] = []
  for (let r = 0; r < rows; r++) centers.push(center(r))
  // inner (0) and outer (1) skins
  for (let skin = 0; skin < 2; skin++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 3
        const p = new Vector3(v[i], v[i + 1], v[i + 2])
        const n = centers[r].clone().sub(p).normalize() // inward
        const q = skin === 0 ? p : p.clone().addScaledVector(n, -thickness)
        pos.push(q.x, q.y, q.z)
        const nn = skin === 0 ? n : n.clone().negate()
        nrm.push(nn.x, nn.y, nn.z)
        uv.push(c / (cols - 1), r * 0.25)
      }
    }
  }
  const off = rows * cols
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      const b = a + 1
      const d = a + cols
      const e = d + 1
      idx.push(a, d, b, b, d, e) // inner faces the marble
      idx.push(off + a, off + b, off + d, off + b, off + e, off + d)
    }
  }
  // close the long edges (lips) between skins
  for (let r = 0; r < rows - 1; r++) {
    for (const c of [0, cols - 1]) {
      const a = r * cols + c
      const d = a + cols
      if (c === 0) idx.push(a, off + a, d, d, off + a, off + d)
      else idx.push(a, d, off + a, d, off + d, off + a)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.setIndex(idx)
  return geo
}

/** rolled edge tubes along both trough lips */
export function lipCurves(g: TroughGeometry): Vector3[][] {
  const out: Vector3[][] = [[], []]
  for (let r = 0; r < g.rows; r++) {
    for (const [k, c] of [[0, 0], [1, TROUGH_COLS - 1]] as const) {
      const i = (r * g.cols + c) * 3
      out[k].push(new Vector3(g.verts[i], g.verts[i + 1], g.verts[i + 2]))
    }
  }
  return out
}

export function tubeAlong(points: Vector3[], radius: number, detail = 1): BufferGeometry {
  if (points.length < 2) return new BufferGeometry()
  const curve = new CatmullRomCurve3(points, false, 'centripetal')
  const len = curve.getLength()
  return new TubeGeometry(curve, Math.max(4, Math.round(len * 10 * detail)), radius, Math.max(5, Math.round(8 * detail)), false)
}

/** funnel surface of revolution */
export function funnelGeometry(rt: number, rb: number, h: number, neck: number, detail = 1): BufferGeometry {
  const pts: Vector2[] = []
  if (neck > 0) pts.push(new Vector2(rb + 0.02, -neck))
  pts.push(new Vector2(rb + 0.02, 0), new Vector2(rt + 0.02, h), new Vector2(rt + 0.05, h + 0.18))
  return new LatheGeometry(pts, Math.round(48 * detail))
}

/** points every `step` metres along a sampled path (for sleepers / supports) */
export function everyAlong(path: PathSample[], step: number): PathSample[] {
  const out: PathSample[] = []
  let next = step * 0.5
  for (let i = 1; i < path.length; i++) {
    while (path[i].s >= next) {
      const a = path[i - 1]
      const b = path[i]
      const t = (next - a.s) / Math.max(1e-6, b.s - a.s)
      out.push({
        p: { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t, z: a.p.z + (b.p.z - a.p.z) * t },
        t: b.t, l: b.l, u: b.u, s: next, bank: b.bank,
      })
      next += step
    }
  }
  return out
}

export const BALL_R = MARBLE_R
