/** Tiny allocation-light vector / quaternion helpers for the simulation core (no three.js here,
 *  so the whole machine can be simulated headless in Node). Shapes match Rapier's {x,y,z(,w)}. */

export interface V3 { x: number; y: number; z: number }
export interface Q4 { x: number; y: number; z: number; w: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z)
export const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
export const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const qIdentity = (): Q4 => ({ x: 0, y: 0, z: 0, w: 1 })
export function qAxisAngle(axis: V3, angle: number): Q4 {
  const h = angle * 0.5
  const s = Math.sin(h)
  const n = norm(axis)
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(h) }
}
export function qMul(a: Q4, b: Q4): Q4 {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}
export function qRotate(q: Q4, v: V3): V3 {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y
  const iy = q.w * v.y + q.z * v.x - q.x * v.z
  const iz = q.w * v.z + q.x * v.y - q.y * v.x
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  }
}
export const qConj = (q: Q4): Q4 => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })
/** rotation that takes unit vector a onto unit vector b */
export function qFromTo(a: V3, b: V3): Q4 {
  const d = dot(a, b)
  if (d < -0.999999) {
    let axis = cross({ x: 1, y: 0, z: 0 }, a)
    if (len(axis) < 1e-6) axis = cross({ x: 0, y: 1, z: 0 }, a)
    return qAxisAngle(axis, Math.PI)
  }
  const c = cross(a, b)
  const q = { x: c.x, y: c.y, z: c.z, w: 1 + d }
  const l = Math.hypot(q.x, q.y, q.z, q.w)
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }
}
/** rotation whose local axes map to the given orthonormal world axes */
export function qFromBasis(x: V3, y: V3, z: V3): Q4 {
  const m00 = x.x, m01 = y.x, m02 = z.x
  const m10 = x.y, m11 = y.y, m12 = z.y
  const m20 = x.z, m21 = y.z, m22 = z.z
  const tr = m00 + m11 + m22
  let qx: number, qy: number, qz: number, qw: number
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    qw = 0.25 / s; qx = (m21 - m12) * s; qy = (m02 - m20) * s; qz = (m10 - m01) * s
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s
  }
  const l = Math.hypot(qx, qy, qz, qw)
  return { x: qx / l, y: qy / l, z: qz / l, w: qw / l }
}
export const qYaw = (yaw: number): Q4 => qAxisAngle({ x: 0, y: 1, z: 0 }, yaw)

/** Deterministic small PRNG (mulberry32) for seeded jitter in robustness trials. */
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

/** angle of a body's rotation about a given world axis, measured from its rest rotation */
export function twistAngle(rest: Q4, now: Q4, axis: V3): number {
  // relative rotation r = now * rest^-1, then project onto axis (swing-twist)
  const r = qMul(now, qConj(rest))
  const p = dot({ x: r.x, y: r.y, z: r.z }, axis)
  return 2 * Math.atan2(p, r.w)
}
