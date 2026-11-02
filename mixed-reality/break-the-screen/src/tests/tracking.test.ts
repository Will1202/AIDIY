import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { OneEuro } from '../core/OneEuro'
import { HeadTracker, measureFace, type FaceLandmarks } from '../tracking/HeadTracker'
import { GestureEngine, HandGesture, type GestureEvent } from '../tracking/GestureEngine'
import { DEFAULT_VIEWER, ViewerRig } from '../camera/Viewer'
import { rng } from '../core/config'

function face(u: number, v: number, ipd: number): FaceLandmarks {
  const lm = new Float32Array(478 * 3)
  for (let i = 0; i < 478; i++) {
    lm[i * 3] = u
    lm[i * 3 + 1] = v
  }
  for (const i of [33, 133, 159, 145]) lm[i * 3] = u - ipd / 2
  for (const i of [362, 263, 386, 374]) lm[i * 3] = u + ipd / 2
  return { lm, count: 478 }
}

/** a hand in raw camera coordinates: wrist at (wx, wy), palm length `s`, pinch 0..1, openness 0..1 */
function hand(wx: number, wy: number, s: number, pinch: number, open = 1) {
  const lm = new Float32Array(63)
  const set = (i: number, x: number, y: number) => {
    lm[i * 3] = wx + x * s
    lm[i * 3 + 1] = wy - y * s
  }
  set(0, 0, 0)
  // fingers (index..pinky): mcp, pip, dip, tip; a closed hand curls tips back towards the palm
  const xs = [-0.3, -0.05, 0.2, 0.42]
  ;[5, 9, 13, 17].forEach((m, k) => {
    set(m, xs[k], 1)
    set(m + 1, xs[k], 1.4)
    const reach = 1.4 + 0.6 * open
    set(m + 2, xs[k], 1.4 + (reach - 1.4) * 0.5)
    set(m + 3, xs[k], open > 0.5 ? reach : 0.95)
  })
  // thumb: tip meets the index tip when pinching
  const idx = [lm[8 * 3], lm[8 * 3 + 1]]
  const thumbOpen = [wx - 0.8 * s, wy - 0.7 * s]
  set(1, -0.3, 0.2)
  set(2, -0.55, 0.4)
  set(3, -0.7, 0.55)
  lm[12] = thumbOpen[0] + (idx[0] + 0.01 * s - thumbOpen[0]) * pinch
  lm[13] = thumbOpen[1] + (idx[1] - thumbOpen[1]) * pinch
  return lm
}

describe('One Euro filter', () => {
  it('removes most jitter at rest and still converges on a step', () => {
    const f = new OneEuro(0.85, 0.045, 1.2)
    const r = rng(4)
    let varIn = 0
    let varOut = 0
    for (let i = 0; i < 300; i++) {
      const n = (r() - 0.5) * 2
      const y = f.filter(10 + n, i / 30)
      if (i > 30) {
        varIn += n * n
        varOut += (y - 10) ** 2
      }
    }
    // tuned for low lag on fast head moves, so it keeps a little high-frequency energy
    expect(varOut).toBeLessThan(varIn * 0.2)
    let y = 0
    for (let i = 300; i < 360; i++) y = f.filter(30, i / 30)
    expect(y).toBeCloseTo(30, 1)
  })
})

describe('head measurement', () => {
  it('a user moving to their left (face moves right in the un-mirrored camera image) gives a negative screen x', () => {
    const a = measureFace(face(0.5, 0.45, 0.1), 640, 480)!
    const b = measureFace(face(0.6, 0.45, 0.1), 640, 480)!
    expect(b.x - a.x).toBeLessThan(0)
    // the face itself is the ruler: 0.1 of the frame = 64 px = one IPD (6.3 cm); 0.1 → 6.3 cm
    expect(b.x - a.x).toBeCloseTo(-6.3, 3)
  })

  it('a pre-mirrored webcam can be corrected', () => {
    const a = measureFace(face(0.5, 0.45, 0.1), 640, 480, true)!
    const b = measureFace(face(0.6, 0.45, 0.1), 640, 480, true)!
    expect(b.x - a.x).toBeGreaterThan(0)
  })

  it('a bigger face (closer) means a shorter eye distance after calibration', () => {
    const t = new HeadTracker({ ...DEFAULT_VIEWER, viewDistanceCm: 60 })
    let time = 0
    for (let i = 0; i < 60; i++) t.update([face(0.5, 0.45, 0.1)], 640, 480, (time += 1 / 30))
    expect(t.state.calibrated).toBe(true)
    for (let i = 0; i < 90; i++) t.update([face(0.5, 0.45, 0.15)], 640, 480, (time += 1 / 30))
    expect(t.state.cm.z).toBeCloseTo(40, 0)
  })

  it('stays locked on the primary viewer when a second face appears', () => {
    const t = new HeadTracker({ ...DEFAULT_VIEWER })
    let time = 0
    for (let i = 0; i < 60; i++) t.update([face(0.4, 0.45, 0.1)], 640, 480, (time += 1 / 30))
    const x = t.state.cm.x
    for (let i = 0; i < 30; i++) t.update([face(0.85, 0.5, 0.14), face(0.4, 0.45, 0.1)], 640, 480, (time += 1 / 30))
    expect(t.state.cm.x).toBeCloseTo(x, 1)
  })
})

describe('viewer rig', () => {
  it('eases back to rest when tracking is lost instead of jumping', () => {
    const rig = new ViewerRig({ ...DEFAULT_VIEWER })
    const tracked = new Vector3(20, 5, 50)
    for (let i = 0; i < 240; i++) rig.update(1 / 60, { tracked, simulated: null, demo: null })
    expect(rig.cm.x).toBeGreaterThan(19)
    let maxStep = 0
    let prev = rig.cm.x
    for (let i = 0; i < 300; i++) {
      rig.update(1 / 60, { tracked: null, simulated: null, demo: null })
      maxStep = Math.max(maxStep, Math.abs(rig.cm.x - prev))
      prev = rig.cm.x
    }
    expect(rig.cm.x).toBeLessThan(1)
    expect(maxStep).toBeLessThan(160 / 60 + 1e-6)
  })
})

describe('hand gestures', () => {
  it('pinch uses hysteresis: noise around the threshold does not flicker', () => {
    const g = new HandGesture('h')
    const ev: GestureEvent[] = []
    let t = 0
    for (let i = 0; i < 10; i++) g.update({ lm: hand(0.5, 0.7, 0.12, 0), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
    expect(g.pointer.pinch).toBe(false)
    for (let i = 0; i < 6; i++) g.update({ lm: hand(0.5, 0.7, 0.12, 1), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
    expect(g.pointer.pinch).toBe(true)
    // hover around the "on" threshold — still pinched (needs to open past the "off" threshold)
    let flips = 0
    let last = g.pointer.pinch
    const r = rng(9)
    for (let i = 0; i < 60; i++) {
      g.update({ lm: hand(0.5, 0.7, 0.12, 0.72 + (r() - 0.5) * 0.12), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
      if (g.pointer.pinch !== last) flips++
      last = g.pointer.pinch
    }
    expect(flips).toBe(0)
    for (let i = 0; i < 6; i++) g.update({ lm: hand(0.5, 0.7, 0.12, 0), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
    expect(g.pointer.pinch).toBe(false)
  })

  it('maps the camera image mirrored: a hand on the image right is on the screen left', () => {
    const g = new HandGesture('h')
    g.update({ lm: hand(0.7, 0.7, 0.12, 0), score: 0.9 }, 4 / 3, 0.1, [])
    expect(g.pointer.x).toBeLessThan(0.5)
  })

  it('pulling the hand back (smaller in the image) lowers the depth signal', () => {
    const g = new HandGesture('h')
    let t = 0
    for (let i = 0; i < 20; i++) g.update({ lm: hand(0.5, 0.7, 0.14, 0), score: 0.9 }, 4 / 3, (t += 1 / 30), [])
    const d0 = g.pointer.depth
    for (let i = 0; i < 40; i++) g.update({ lm: hand(0.5, 0.7, 0.09, 0), score: 0.9 }, 4 / 3, (t += 1 / 30), [])
    expect(g.pointer.depth).toBeLessThan(d0 - 0.3)
  })

  it('a held open palm fires one pulse and must close before firing again', () => {
    const g = new HandGesture('h')
    const ev: GestureEvent[] = []
    let t = 0
    for (let i = 0; i < 90; i++) g.update({ lm: hand(0.5, 0.7, 0.12, 0, 1), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
    expect(ev.filter((e) => e.type === 'pulse').length).toBe(1)
    for (let i = 0; i < 10; i++) g.update({ lm: hand(0.5, 0.7, 0.12, 0, 0), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
    for (let i = 0; i < 30; i++) g.update({ lm: hand(0.5, 0.7, 0.12, 0, 1), score: 0.9 }, 4 / 3, (t += 1 / 30), ev)
    expect(ev.filter((e) => e.type === 'pulse').length).toBe(2)
  })

  it('two hands keep their own slots when they swap sides of the frame slowly', () => {
    const ge = new GestureEngine()
    let t = 0
    for (let i = 0; i < 30; i++) {
      const k = i / 30
      ge.update([{ lm: hand(0.3 + 0.1 * k, 0.7, 0.12, 0), score: 0.9 }, { lm: hand(0.75 - 0.1 * k, 0.7, 0.12, 1), score: 0.9 }], 4 / 3, (t += 1 / 30))
    }
    const [a, b] = ge.pointers
    expect(a.present && b.present).toBe(true)
    // the pinching hand (image right → screen left) stayed in slot 1
    expect(b.pinch).toBe(true)
    expect(a.pinch).toBe(false)
  })
})
