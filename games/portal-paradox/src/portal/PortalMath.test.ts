import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { framePose, linkMatrix, linkQuaternion, linkYaw, mapVector, rayOpening, segmentCrossing, signedDistance, type PortalFrame } from './PortalMath'

function frame(pos: Vector3, yaw: number, w = 2.6, h = 4.2): PortalFrame {
  const f: PortalFrame = { matrix: new Matrix4(), inverse: new Matrix4(), quaternion: new Quaternion(), width: w, height: h }
  framePose(f, pos, yaw)
  return f
}

const close = (a: Vector3, b: Vector3, eps = 1e-6) => expect(a.distanceTo(b)).toBeLessThan(eps)

describe('portal link transform', () => {
  // A in the lab facing +Z, B far away in another world facing +X
  const A = frame(new Vector3(0, 0, -6), 0)
  const B = frame(new Vector3(40, 3, 3000), Math.PI / 2)
  const AB = linkMatrix(A, B, new Matrix4())
  const BA = linkMatrix(B, A, new Matrix4())

  it('maps the opening centre of A onto the opening centre of B', () => {
    close(new Vector3(0, 2, -6).applyMatrix4(AB), new Vector3(40, 5, 3000))
  })

  it('is an exact inverse pair', () => {
    const m = AB.clone().multiply(BA)
    const id = new Matrix4()
    for (let i = 0; i < 16; i++) expect(m.elements[i]).toBeCloseTo(id.elements[i], 9)
  })

  it('walking into A’s front comes out of B’s front, moving away from B', () => {
    // player in front of A (local z>0) moving towards -Z through it
    const before = new Vector3(0.3, 1.6, -5.9)
    const after = new Vector3(0.3, 1.6, -6.1)
    const vel = new Vector3(0, 0, -4)
    const hit = segmentCrossing(A, before, after)
    expect(hit).not.toBeNull()
    expect(hit!.fromSide).toBe(1)
    const p = after.clone().applyMatrix4(AB)
    const v = mapVector(AB, vel.clone())
    // B faces +X: after crossing the player must be on B's front side…
    expect(signedDistance(B, p)).toBeGreaterThan(0)
    // …and moving along B's front normal, with unchanged speed
    expect(v.x).toBeCloseTo(4, 9)
    expect(v.length()).toBeCloseTo(4, 9)
  })

  it('entering from A’s back exits B’s back (both sides are live)', () => {
    const before = new Vector3(0, 1, -6.1)
    const after = new Vector3(0, 1, -5.9)
    const hit = segmentCrossing(A, before, after)
    expect(hit!.fromSide).toBe(-1)
    const p = after.clone().applyMatrix4(AB)
    expect(signedDistance(B, p)).toBeLessThan(0)
  })

  it('does not trigger again right after a teleport (no ping-pong)', () => {
    const after = new Vector3(0.3, 1.6, -6.1).applyMatrix4(AB)
    const next = after.clone().add(mapVector(AB, new Vector3(0, 0, -4)).multiplyScalar(1 / 60))
    expect(segmentCrossing(B, after, next)).toBeNull()
    expect(segmentCrossing(A, after, next)).toBeNull()
  })

  it('a point resting on the plane cannot cross twice', () => {
    const on = new Vector3(0, 1, -6)
    expect(segmentCrossing(A, on, on.clone())).toBeNull()
    expect(segmentCrossing(A, new Vector3(0, 1, -5.9), on)).toBeNull() // reaching the plane is not crossing
    expect(segmentCrossing(A, on, new Vector3(0, 1, -6.1))).not.toBeNull()
  })

  it('rejects crossings outside the opening', () => {
    expect(segmentCrossing(A, new Vector3(1.4, 1, -5.9), new Vector3(1.4, 1, -6.1))).toBeNull()
    expect(segmentCrossing(A, new Vector3(0, 4.3, -5.9), new Vector3(0, 4.3, -6.1))).toBeNull()
    expect(segmentCrossing(A, new Vector3(1.2, 1, -5.9), new Vector3(1.2, 1, -6.1))).not.toBeNull()
  })

  it('keeps the camera orientation continuous (no 180° flip)', () => {
    // camera looking straight through A along -Z
    const qCam = new Quaternion() // three.js cameras look down -Z
    const qLink = linkQuaternion(A, B, new Quaternion())
    const fwd = new Vector3(0, 0, -1).applyQuaternion(qLink.clone().multiply(qCam))
    // B's front normal is +X: we must keep looking out of B, i.e. along +X
    close(fwd, new Vector3(1, 0, 0))
    expect(linkYaw(0, Math.PI / 2)).toBeCloseTo(Math.PI * 1.5, 9)
  })

  it('maps the full rigid pose of a thrown cube consistently', () => {
    const pos = new Vector3(0.5, 1.2, -6.05)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 0).normalize(), 0.7)
    const lin = new Vector3(0.4, 2, -9)
    const ang = new Vector3(3, -1, 2)
    const m = new Matrix4().compose(pos, q, new Vector3(1, 1, 1))
    const mapped = AB.clone().multiply(m)
    const p2 = new Vector3(), q2 = new Quaternion(), s2 = new Vector3()
    mapped.decompose(p2, q2, s2)
    close(p2, pos.clone().applyMatrix4(AB))
    const qq = linkQuaternion(A, B, new Quaternion()).multiply(q)
    expect(Math.abs(qq.dot(q2))).toBeCloseTo(1, 9)
    // speed and spin magnitudes preserved; vertical component untouched (yaw-only portals)
    const lin2 = mapVector(AB, lin.clone())
    expect(lin2.length()).toBeCloseTo(lin.length(), 9)
    expect(lin2.y).toBeCloseTo(lin.y, 9)
    expect(mapVector(AB, ang.clone()).length()).toBeCloseTo(ang.length(), 9)
  })

  it('face-to-face portals form a loop: crossing A n times walks along B→A repeatedly', () => {
    const P = frame(new Vector3(0, 0, -6), 0)
    const Q = frame(new Vector3(0, 0, 6), Math.PI)
    const PQ = linkMatrix(P, Q, new Matrix4())
    // a camera 3 m in front of P maps to 3 m behind Q, i.e. 9 m behind P
    const c = new Vector3(0, 1.7, -3).applyMatrix4(PQ)
    close(c, new Vector3(0, 1.7, 9))
  })
})

describe('ray vs opening', () => {
  const A = frame(new Vector3(0, 0, 0), 0)
  it('hits the opening from either side', () => {
    expect(rayOpening(A, new Vector3(0, 2, 5), new Vector3(0, 0, -1), 10)).toBeCloseTo(5, 9)
    expect(rayOpening(A, new Vector3(0, 2, -5), new Vector3(0, 0, 1), 10)).toBeCloseTo(5, 9)
  })
  it('misses outside or beyond range', () => {
    expect(rayOpening(A, new Vector3(3, 2, 5), new Vector3(0, 0, -1), 10)).toBe(-1)
    expect(rayOpening(A, new Vector3(0, 2, 5), new Vector3(0, 0, -1), 4)).toBe(-1)
    expect(rayOpening(A, new Vector3(0, 2, 5), new Vector3(1, 0, 0), 10)).toBe(-1)
  })
})
