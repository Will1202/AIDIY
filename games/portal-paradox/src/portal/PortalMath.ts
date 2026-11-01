import { Matrix4, Quaternion, Vector3 } from 'three'

/**
 * Pure portal math, shared by rendering, physics and the camera rig.
 *
 * Convention: a portal's local frame has its origin at the floor centre of the
 * opening, +Y up, +Z the "front" normal. The opening spans x ∈ [-w/2, w/2],
 * y ∈ [0, h], z = 0. Portals are double-sided windows: entering P's front
 * exits Q's front, entering P's back exits Q's back. The link transform is
 *
 *     T(P→Q) = M_Q · R_y(π) · M_P⁻¹
 *
 * The 180° turn is what makes "walking into" one portal become "walking out
 * of" the other instead of walking out backwards.
 */

export interface PortalFrame {
  matrix: Matrix4
  inverse: Matrix4
  quaternion: Quaternion
  width: number
  height: number
}

const R180 = new Matrix4().makeRotationY(Math.PI)
const Q180 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)

export function framePose(frame: PortalFrame, position: Vector3, yaw: number) {
  frame.quaternion.setFromAxisAngle(_up, yaw)
  frame.matrix.compose(position, frame.quaternion, _one)
  frame.inverse.copy(frame.matrix).invert()
}

/** out = M_dst · R180 · M_src⁻¹ */
export function linkMatrix(src: PortalFrame, dst: PortalFrame, out: Matrix4) {
  return out.copy(dst.matrix).multiply(R180).multiply(src.inverse)
}

/** Rotation part of the link as a quaternion: q_dst · q180 · q_src⁻¹ */
export function linkQuaternion(src: PortalFrame, dst: PortalFrame, out: Quaternion) {
  _q.copy(src.quaternion).invert()
  return out.copy(dst.quaternion).multiply(Q180).multiply(_q)
}

/** Signed distance of a world point from the portal plane (positive = front). */
export function signedDistance(frame: PortalFrame, p: Vector3) {
  return _v.copy(p).applyMatrix4(frame.inverse).z
}

export interface CrossingHit {
  /** fraction along a→b where the plane is crossed */
  t: number
  /** side the segment started on: +1 front, -1 back */
  fromSide: number
  /** crossing point in portal-local coordinates */
  local: Vector3
}

/**
 * Does the segment a→b pass through the portal opening?
 * `margin` shrinks the accepted opening (positive) or grows it (negative).
 */
export function segmentCrossing(frame: PortalFrame, a: Vector3, b: Vector3, margin = 0, out?: CrossingHit): CrossingHit | null {
  const la = _a.copy(a).applyMatrix4(frame.inverse)
  const lb = _b.copy(b).applyMatrix4(frame.inverse)
  // z ≥ 0 is the front half-space, z < 0 the back: a crossing is a change of half-space,
  // so a point resting exactly on the plane can never trigger twice.
  const sa = la.z
  const sb = lb.z
  if (sa >= 0 === sb >= 0) return null
  const t = sa / (sa - sb)
  const cx = la.x + (lb.x - la.x) * t
  const cy = la.y + (lb.y - la.y) * t
  const hw = frame.width * 0.5 - margin
  if (cx < -hw || cx > hw) return null
  if (cy < margin || cy > frame.height - margin) return null
  const hit = out ?? { t: 0, fromSide: 0, local: new Vector3() }
  hit.t = t
  hit.fromSide = sa >= 0 ? 1 : -1
  hit.local.set(cx, cy, 0)
  return hit
}

/** Ray vs. portal opening. Returns the distance along the (normalised) ray, or -1. */
export function rayOpening(frame: PortalFrame, origin: Vector3, dir: Vector3, maxDist: number, margin = 0) {
  const lo = _a.copy(origin).applyMatrix4(frame.inverse)
  const ld = _b.copy(dir).transformDirection(frame.inverse)
  if (Math.abs(ld.z) < 1e-6) return -1
  const t = -lo.z / ld.z
  if (t <= 1e-5 || t > maxDist) return -1
  const x = lo.x + ld.x * t
  const y = lo.y + ld.y * t
  if (Math.abs(x) > frame.width * 0.5 - margin || y < margin || y > frame.height - margin) return -1
  return t
}

/** Is a world point within the slab |z| < depth in front of/behind the opening (with lateral margin)? */
export function nearOpening(frame: PortalFrame, p: Vector3, depth: number, lateral = 0) {
  const l = _a.copy(p).applyMatrix4(frame.inverse)
  return Math.abs(l.z) < depth && Math.abs(l.x) < frame.width * 0.5 + lateral && l.y > -lateral && l.y < frame.height + lateral
}

/** Rotation-only mapping that preserves magnitude (velocities, angular velocities). */
export function mapVector(link: Matrix4, v: Vector3) {
  const e = link.elements
  const x = v.x, y = v.y, z = v.z
  v.x = e[0] * x + e[4] * y + e[8] * z
  v.y = e[1] * x + e[5] * y + e[9] * z
  v.z = e[2] * x + e[6] * y + e[10] * z
  return v
}

/** Yaw delta applied to anything that goes through P→Q (portals only rotate about Y). */
export function linkYaw(srcYaw: number, dstYaw: number) {
  return dstYaw + Math.PI - srcYaw
}

const _up = new Vector3(0, 1, 0)
const _one = new Vector3(1, 1, 1)
const _q = new Quaternion()
const _v = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
