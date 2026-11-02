import { rng } from '../core/config'

export type Pt = [number, number]
export type Poly = Pt[]

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** keep the part of a convex polygon where nx*x + ny*y <= c (Sutherland–Hodgman, one plane) */
export function clipHalfPlane(poly: Poly, nx: number, ny: number, c: number): Poly {
  const out: Poly = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const da = nx * a[0] + ny * a[1] - c
    const db = nx * b[0] + ny * b[1] - c
    if (da <= 0) out.push(a)
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

export function polyArea(p: Poly) {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]
    const [x1, y1] = p[(i + 1) % p.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function polyCentroid(p: Poly): Pt {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]
    const [x1, y1] = p[(i + 1) % p.length]
    const f = x0 * y1 - x1 * y0
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
    a += f
  }
  if (Math.abs(a) < 1e-12) return [p[0][0], p[0][1]]
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * Voronoi cells of `seeds` clipped to `rect`, by intersecting bisector half
 * planes (O(n²) but n ≤ ~200 and it runs once per fracture). Neighbours are
 * visited nearest-first so far seeds are skipped once they can no longer cut.
 */
export function voronoiCells(seeds: Pt[], rect: Rect): Poly[] {
  const cells: Poly[] = []
  const order = seeds.map((_, i) => i)
  for (let i = 0; i < seeds.length; i++) {
    const [px, py] = seeds[i]
    let poly: Poly = [
      [rect.x0, rect.y0],
      [rect.x1, rect.y0],
      [rect.x1, rect.y1],
      [rect.x0, rect.y1],
    ]
    order.sort((a, b) => (seeds[a][0] - px) ** 2 + (seeds[a][1] - py) ** 2 - ((seeds[b][0] - px) ** 2 + (seeds[b][1] - py) ** 2))
    for (const j of order) {
      if (j === i) continue
      const [qx, qy] = seeds[j]
      const dx = qx - px
      const dy = qy - py
      const d2 = dx * dx + dy * dy
      if (d2 < 1e-12) continue
      // the cell lies within maxR of the seed; a bisector further than maxR cannot cut it
      let maxR2 = 0
      for (const v of poly) maxR2 = Math.max(maxR2, (v[0] - px) ** 2 + (v[1] - py) ** 2)
      if (d2 > 4 * maxR2) break
      poly = clipHalfPlane(poly, dx, dy, (qx * qx + qy * qy - px * px - py * py) / 2)
      if (poly.length < 3) break
    }
    cells.push(poly)
  }
  return cells
}

export interface CrackEdge {
  ax: number
  ay: number
  bx: number
  by: number
  /** distance of each end from the impact (a is the nearer end) */
  da: number
  db: number
}

export interface CrackPattern {
  impact: Pt
  seeds: Pt[]
  cells: Poly[]
  edges: CrackEdge[]
  maxDist: number
}

/**
 * A spider-web fracture: seeds sit on concentric rings around the impact with
 * aligned (jittered) spokes, so the Voronoi edges read as radial cracks crossed
 * by concentric ones, dense at the point of impact and coarse at the rim.
 */
export function crackPattern(impact: Pt, halfW: number, halfH: number, target: number, seed = 1): CrackPattern {
  const r = rng(seed)
  const rect: Rect = { x0: -halfW, y0: -halfH, x1: halfW, y1: halfH }
  const inside = (x: number, y: number) => x > rect.x0 + 0.02 && x < rect.x1 - 0.02 && y > rect.y0 + 0.02 && y < rect.y1 - 0.02
  const corners: Pt[] = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]]
  const maxDist = Math.max(...corners.map(([x, y]) => Math.hypot(x - impact[0], y - impact[1])))

  // ring growth chosen so the seed count lands near the target
  const spokes = 9 + Math.floor(r() * 4)
  const rot = r() * Math.PI * 2
  const seeds: Pt[] = []
  for (let k = 0; k < 4; k++) {
    const a = r() * Math.PI * 2
    const d = 0.05 + r() * 0.18
    seeds.push([impact[0] + Math.cos(a) * d, impact[1] + Math.sin(a) * d])
  }
  let growth = 1.42
  for (let attempt = 0; attempt < 6; attempt++) {
    const s: Pt[] = []
    let radius = 0.32
    let k = 0
    while (radius < maxDist * 1.05) {
      const n = k < 3 ? spokes : k < 6 ? spokes * 2 : spokes * 3
      for (let j = 0; j < n; j++) {
        const th = rot + ((j + (k % 2) * 0.5) / n) * Math.PI * 2 + (r() - 0.5) * (Math.PI / n) * 0.6
        const rr = radius * (1 + (r() - 0.5) * 0.24)
        const x = impact[0] + Math.cos(th) * rr
        const y = impact[1] + Math.sin(th) * rr
        if (inside(x, y)) s.push([x, y])
      }
      radius *= growth
      k++
    }
    if (s.length + seeds.length > target * 1.25) growth *= 1.12
    else if (s.length + seeds.length < target * 0.75) growth /= 1.08
    else {
      seeds.push(...s)
      break
    }
    if (attempt === 5) seeds.push(...s)
  }
  while (seeds.length > target) seeds.splice(4 + Math.floor(r() * (seeds.length - 4)), 1)

  const cells = voronoiCells(seeds, rect).filter((c) => c.length >= 3 && Math.abs(polyArea(c)) > 1e-4)

  // unique interior edges = the cracks
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`
  const seen = new Set<string>()
  const edges: CrackEdge[] = []
  const onBorder = (x: number, y: number) =>
    Math.abs(x - rect.x0) < 1e-3 || Math.abs(x - rect.x1) < 1e-3 || Math.abs(y - rect.y0) < 1e-3 || Math.abs(y - rect.y1) < 1e-3
  for (const c of cells) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i]
      const b = c[(i + 1) % c.length]
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) continue
      if (onBorder(a[0], a[1]) && onBorder(b[0], b[1]) && (Math.abs(a[0] - b[0]) < 1e-3 || Math.abs(a[1] - b[1]) < 1e-3)) continue
      const ka = key(a[0], a[1])
      const kb = key(b[0], b[1])
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka
      if (seen.has(k)) continue
      seen.add(k)
      const da = Math.hypot(a[0] - impact[0], a[1] - impact[1])
      const db = Math.hypot(b[0] - impact[0], b[1] - impact[1])
      edges.push(da <= db ? { ax: a[0], ay: a[1], bx: b[0], by: b[1], da, db } : { ax: b[0], ay: b[1], bx: a[0], by: a[1], da: db, db: da })
    }
  }
  return { impact, seeds, cells, edges, maxDist }
}
