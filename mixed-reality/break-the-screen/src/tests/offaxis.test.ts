import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3, Vector4 } from 'three'
import { offAxisMatrix } from '../camera/HeadTrackedCamera'
import { DEFAULT_VIEWER, eyeWorldFromCm, worldPerCm } from '../camera/Viewer'

const W = 17.78
const H = 10

/** project a world point for an eye at `eye` (camera looks down -z, no rotation) */
function ndc(eye: Vector3, p: Vector3) {
  const P = offAxisMatrix(eye, W, H, 0.1, 1000, new Matrix4())
  const v = new Vector4(p.x - eye.x, p.y - eye.y, p.z - eye.z, 1).applyMatrix4(P)
  return new Vector3(v.x / v.w, v.y / v.w, v.z / v.w)
}

describe('off-axis (head-coupled) projection', () => {
  const eyes = [new Vector3(0, 0, 30), new Vector3(-6, 2, 25), new Vector3(7, -3, 40), new Vector3(3, 4, 12)]

  it('always maps the physical screen rectangle exactly onto the viewport', () => {
    for (const e of eyes) {
      const c = ndc(e, new Vector3(W / 2, H / 2, 0))
      expect(c.x).toBeCloseTo(1, 6)
      expect(c.y).toBeCloseTo(1, 6)
      const d = ndc(e, new Vector3(-W / 2, -H / 2, 0))
      expect(d.x).toBeCloseTo(-1, 6)
      expect(d.y).toBeCloseTo(-1, 6)
    }
  })

  it('has zero parallax on the screen plane', () => {
    const p = new Vector3(3.1, -1.7, 0)
    const a = ndc(eyes[0], p)
    for (const e of eyes) {
      const b = ndc(e, p)
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.y).toBeCloseTo(a.y, 6)
    }
  })

  it('moving the head left shifts the world behind the screen left (revealing its right side)', () => {
    const far = new Vector3(0, 0, -40)
    const near = new Vector3(0, 0, -9)
    const rest = new Vector3(0, 0, 30)
    const left = new Vector3(-5, 0, 30)
    expect(ndc(left, far).x).toBeLessThan(ndc(rest, far).x)
    // deeper things move more: true motion parallax, not a uniform pan
    expect(Math.abs(ndc(left, far).x)).toBeGreaterThan(Math.abs(ndc(left, near).x))
  })

  it('things in front of the screen move against the head', () => {
    const front = new Vector3(0, 0, 8)
    expect(ndc(new Vector3(-5, 0, 30), front).x).toBeGreaterThan(0)
    expect(ndc(new Vector3(5, 0, 30), front).x).toBeLessThan(0)
  })

  it('leaning in widens the field of view (the window shows more)', () => {
    const p = new Vector3(14, 0, -30)
    expect(Math.abs(ndc(new Vector3(0, 0, 15), p).x)).toBeLessThan(Math.abs(ndc(new Vector3(0, 0, 40), p).x))
  })
})

describe('viewer scale', () => {
  it('maps a 60 cm viewing distance to world units through the canvas height', () => {
    // 34.5 cm wide 1536-px display, 720-px canvas → 16.17 cm tall canvas = 10 world units
    const s = worldPerCm(DEFAULT_VIEWER, 720, 1536)
    expect(s).toBeCloseTo(10 / ((720 * 34.5) / 1536), 6)
    const eye = eyeWorldFromCm(new Vector3(0, 0, 60), { ...DEFAULT_VIEWER, viewDistanceCm: 60 }, s)
    expect(eye.z).toBeCloseTo(60 * s, 6)
  })

  it('parallax gain scales head offsets about the rest pose only', () => {
    const s = 0.5
    const v = { ...DEFAULT_VIEWER, viewDistanceCm: 60, parallax: 1.5 }
    const e = eyeWorldFromCm(new Vector3(10, -4, 50), v, s)
    expect(e.x).toBeCloseTo(10 * 1.5 * s)
    expect(e.y).toBeCloseTo(-4 * 1.5 * s)
    expect(e.z).toBeCloseTo((60 - 10 * 1.5) * s)
  })
})
