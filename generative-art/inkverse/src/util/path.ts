/** 2D polyline helpers in world xz. Points are {x, z} plus optional per-point attributes. */
export interface P2 {
  x: number
  z: number
}
export interface StrokePoint extends P2 {
  /** 0..1 visual pressure (from pen pressure or from slowness) */
  p: number
  /** brush speed in world units / s */
  v: number
  /** seconds since stroke start */
  t: number
  /** stamped brush half-width in world units */
  w: number
}

export function pathLength(pts: P2[]) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return L
}

/** resample a stroke at a fixed spacing, interpolating every numeric attribute */
export function resample<T extends P2>(pts: T[], spacing: number): T[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }))
  const out: T[] = [{ ...pts[0] }]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    if (seg < 1e-6) continue
    let d = spacing - carry
    while (d <= seg) {
      const t = d / seg
      const o = { ...a } as unknown as Record<string, number>
      for (const k in a) {
        const av = (a as Record<string, unknown>)[k]
        const bv = (b as Record<string, unknown>)[k]
        if (typeof av === 'number' && typeof bv === 'number') o[k] = av + (bv - av) * t
      }
      out.push(o as unknown as T)
      d += spacing
    }
    carry = seg - (d - spacing)
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > spacing * 0.35) out.push({ ...last })
  return out
}

/** moving-average smoothing of positions (endpoints pinned), attributes untouched */
export function smooth<T extends P2>(pts: T[], radius: number, iterations = 1): T[] {
  let cur = pts.map((p) => ({ ...p }))
  for (let it = 0; it < iterations; it++) {
    const next = cur.map((p) => ({ ...p }))
    for (let i = 1; i < cur.length - 1; i++) {
      let sx = 0
      let sz = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(cur.length - 1, Math.max(0, i + k))
        const w = 1 - Math.abs(k) / (radius + 1)
        sx += cur[j].x * w
        sz += cur[j].z * w
        n += w
      }
      next[i].x = sx / n
      next[i].z = sz / n
    }
    cur = next
  }
  return cur
}

/** smooth a scalar attribute along the path */
export function smoothAttr<T extends P2>(pts: T[], key: keyof T, radius: number) {
  const src = pts.map((p) => p[key] as unknown as number)
  for (let i = 0; i < pts.length; i++) {
    let s = 0
    let n = 0
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(pts.length - 1, Math.max(0, i + k))
      s += src[j]
      n++
    }
    ;(pts[i] as Record<string, unknown>)[key as string] = s / n
  }
}

/** cumulative arc length per point */
export function arcLengths(pts: P2[]) {
  const out = new Float32Array(pts.length)
  for (let i = 1; i < pts.length; i++) out[i] = out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return out
}

export interface Nearest {
  d: number
  /** arc length position of the nearest point */
  s: number
  /** index of the segment start */
  i: number
  /** fraction along that segment */
  f: number
}

/** nearest point on a polyline (brute force over segments, fine for ≤ 300 points) */
export function nearestOnPath(pts: P2[], arcs: Float32Array, x: number, z: number, out: Nearest) {
  let best = Infinity
  let bi = 0
  let bf = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz
    let f = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0
    f = f < 0 ? 0 : f > 1 ? 1 : f
    const px = a.x + dx * f - x
    const pz = a.z + dz * f - z
    const d2 = px * px + pz * pz
    if (d2 < best) {
      best = d2
      bi = i
      bf = f
    }
  }
  out.d = Math.sqrt(best)
  out.i = bi
  out.f = bf
  out.s = arcs[bi] + (arcs[bi + 1] - arcs[bi]) * bf
  return out
}

export function bounds(pts: P2[], pad: number) {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.z < z0) z0 = p.z
    if (p.x > x1) x1 = p.x
    if (p.z > z1) z1 = p.z
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad }
}
