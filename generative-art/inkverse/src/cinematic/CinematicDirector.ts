import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { PAPER_SCALE_Y } from '../core/constants'
import type { Engine } from '../engine/Engine'
import { U } from '../render/uniforms'
import { useUI } from '../state/store'
import { clamp, easeInOutCubic, lerp, phase, smootherstep } from '../util/math'
import type { P2 } from '../util/path'

/**
 * PLAY CINEMATIC DEMO — a 30 s film made entirely by the live systems: the brush paints
 * preset strokes through the same input pipeline a user's mouse uses, the world grows
 * from them, the paper awakens, the character runs the generated path over the bridge
 * that was just drawn, and the camera is choreographed around all of it.
 *
 *  0–4    blank sheet · the brush arrives · first ink drop blooms
 *  4–9    ranges drawn in quick strokes, peaks lift out of the paper, camera turns
 *  9–14   the river, then ink drops that become pines
 * 14–19   a long line between the cliffs becomes a bridge; the world inflates into 3D
 * 19–24   the swordsman runs in and crosses the bridge, camera tracking
 * 24–30   camera climbs into the sky at sunset · INKVERSE / 一笔入江湖
 */

const pts = (f: (u: number) => P2, n = 40) => {
  const a: P2[] = []
  for (let i = 0; i <= n; i++) a.push(f(i / n))
  return a
}

// the composition, in world (paper) coordinates
const RIVER = pts((u) => ({ x: 6 * Math.sin(u * 3.1 + 0.4) - 4 + 14 * Math.sin(u * 7.2) * (1 - u * 0.4), z: -112 + u * 226 }), 60)
const MOUNTAINS: { path: P2[]; dur: number }[] = [
  // tall range behind the valley (the river cuts a gorge through it)
  { path: pts((u) => ({ x: -66 + u * 118, z: -86 - 10 * Math.sin(u * 3.4) + 4 * Math.sin(u * 11) })), dur: 0.95 },
  // left cliffs, coming down to the river
  { path: pts((u) => ({ x: -104 + u * 80, z: -48 + u * 30 + 6 * Math.sin(u * 7) })), dur: 0.8 },
  // right cliffs
  { path: pts((u) => ({ x: 98 - u * 70, z: -54 + u * 36 + 5 * Math.sin(u * 6) })), dur: 0.8 },
  // foreground hills framing the shot
  { path: pts((u) => ({ x: -102 + u * 38, z: 66 + u * 18 })), dur: 0.5 },
  { path: pts((u) => ({ x: 62 + u * 40, z: 82 - u * 30 })), dur: 0.5 },
]
const DROP = { x: -26, z: 14 }
const TREES: P2[] = [DROP, { x: -36, z: 30 }, { x: 24, z: 20 }, { x: 34, z: 36 }, { x: -48, z: 4 }, { x: 46, z: 4 }, { x: -12, z: 56 }, { x: 18, z: 64 }]
const BRIDGE_Z = -2

export class CinematicDirector {
  active = false
  t = 0
  readonly duration = 30
  private events: { t: number; fn: () => void; done: boolean }[] = []
  private bridgeA = new Vector3()
  private bridgeB = new Vector3()
  private bridgeOk = false
  private paperDist = 200
  private paperTarget = new Vector3()
  private followFrom = { pos: new Vector3(), target: new Vector3() }
  private riseFrom = { pos: new Vector3(), target: new Vector3() }
  private followStarted = false
  /** the brush hovers here when it is not drawing */
  hover: P2 | null = null
  showBrush = false
  private tmp = new Vector3()
  private tmp2 = new Vector3()

  constructor(private e: Engine) {}

  /** the river's x at a given z (for placing the bridge across it) */
  private riverX(z: number) {
    let best = RIVER[0]
    for (const p of RIVER) if (Math.abs(p.z - z) < Math.abs(best.z - z)) best = p
    return best.x
  }

  start() {
    const e = this.e
    e.resetWorld(true)
    this.active = true
    this.t = 0
    this.followStarted = false
    this.bridgeOk = false
    this.showBrush = true
    useUI.setState({ title: false, panel: 'none' })
    e.weather.time = 'day'
    e.weather.rain = false
    e.weather.wind = false
    e.weather.snap()
    useUI.setState({ time: 'day', rain: false, wind: false })
    this.containFraming()
    e.rig.setMode('script', 0.0001)
    this.hover = { x: 60, z: 70 }

    const rx = this.riverX(BRIDGE_Z)
    const ev = (t: number, fn: () => void) => this.events.push({ t, fn, done: false })
    this.events = []
    ev(1.0, () => (this.hover = { ...DROP }))
    ev(4.0, () => {
      this.hover = null
      let first = true
      for (const m of MOUNTAINS) {
        e.brush.play('mountain', m.path, m.dur, { pressure: (u) => (first ? 0.9 : 0.75) * (0.75 + 0.25 * Math.sin(u * Math.PI)) })
        first = false
      }
    })
    ev(8.9, () => e.brush.play('river', RIVER, 1.5, { pressure: () => 0.7 }))
    ev(10.6, () => {
      for (const p of TREES) e.brush.play('life', [p, { x: p.x + 0.01, z: p.z }], 0.06)
    })
    ev(14.0, () => {
      e.brush.play('bridge', pts((u) => ({ x: rx - 15.5 + u * 31, z: BRIDGE_Z + Math.sin(u * Math.PI) * 0.6 }), 12), 0.9, {
        onDone: () => {
          const b = e.world.bridges[e.world.bridges.length - 1]
          this.bridgeOk = !!b
          if (b) {
            const s = b.spec
            this.bridgeA.set(s.ax, 0, s.az)
            this.bridgeB.set(s.bx, 0, s.bz)
          }
        },
      })
    })
    ev(15.1, () => {
      e.audio.awaken()
      this.showBrush = false
    })
    ev(18.4, () => this.spawnRunner())
    ev(21.5, () => {
      e.weather.time = 'sunset'
      useUI.setState({ time: 'sunset' })
    })
    ev(24.2, () => {
      this.riseFrom.pos.copy(e.rig.scriptPos)
      this.riseFrom.target.copy(e.rig.scriptTarget)
    })
    ev(26.0, () => useUI.setState({ title: true }))
  }

  /**
   * the film paints across most of the sheet, so the drawing shots *contain* the
   * composition (±104 × ±100) instead of filling the screen like the interactive view
   */
  private containFraming() {
    const cam = new PerspectiveCamera(34, this.e.rig.aspect, 0.3, 4000)
    const pitch = MathUtils.degToRad(66)
    const dir = new Vector3(0, Math.sin(pitch), Math.cos(pitch))
    const gy = 0.6 * PAPER_SCALE_Y
    const corners = [
      [-104, -100],
      [104, -100],
      [104, 96],
      [-104, 96],
    ]
    const v = new Vector3()
    let tz = 0
    const fits = (d: number) => {
      let minY = 9
      let maxY = -9
      let ok = true
      for (let k = 0; k < 3; k++) {
        cam.position.set(0, gy, tz).addScaledVector(dir, d)
        cam.lookAt(0, gy, tz)
        cam.updateMatrixWorld()
        cam.updateProjectionMatrix()
        minY = 9
        maxY = -9
        ok = true
        for (const [x, z] of corners) {
          v.set(x, gy, z).project(cam)
          if (Math.abs(v.x) > 0.97) ok = false
          minY = Math.min(minY, v.y)
          maxY = Math.max(maxY, v.y)
        }
        // nudge the target so the composition sits centred vertically
        tz -= (maxY + minY) * 0.5 * d * 0.25
      }
      return ok && maxY - minY < 1.9
    }
    let lo = 60
    let hi = 1400
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    fits(hi)
    this.paperDist = hi
    this.paperTarget.set(0, gy, tz)
  }

  private spawnRunner() {
    const e = this.e
    const c = e.ensureCharacter()
    if (!this.bridgeOk) {
      // fallback: run along the bank
      c.spawn(-40, 20, Math.PI / 2)
      c.followPath([new Vector3(-20, 0, 24), new Vector3(10, 0, 30), new Vector3(40, 0, 28)], true)
      return
    }
    const A = this.bridgeA
    const B = this.bridgeB
    const d = this.tmp.copy(B).sub(A).normalize()
    const start = A.clone().addScaledVector(d, -12)
    start.z += 3
    c.spawn(start.x, start.z, Math.atan2(d.x, d.z))
    c.followPath([A.clone().addScaledVector(d, -3), A.clone().addScaledVector(d, 0.5), B.clone().addScaledVector(d, -0.5), B.clone().addScaledVector(d, 5), B.clone().addScaledVector(d, 14)], true)
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.showBrush = false
    this.hover = null
    this.e.endCinematic()
    setTimeout(() => useUI.setState({ title: false }), 2600)
  }

  private sphere(yaw: number, pitch: number, dist: number, target: Vector3, outPos: Vector3) {
    const cp = Math.cos(pitch)
    return outPos.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).multiplyScalar(dist).add(target)
  }

  private camera(t: number) {
    const e = this.e
    const rig = e.rig
    const D = this.paperDist
    const T0 = this.paperTarget
    const deg = MathUtils.degToRad
    // paper phase keys: time, yaw, pitch, distance, target offset z
    const keys = [
      [0, 0, 66, 1.0, 0],
      [4, 0.03, 64, 0.93, 0],
      [9, -0.16, 57, 0.95, -6],
      [14, -0.3, 47, 0.84, -10],
    ]
    const bridgeC = this.tmp2.set(this.riverX(BRIDGE_Z), 3, BRIDGE_Z)
    if (t < 14) {
      let i = 0
      while (i < keys.length - 2 && t > keys[i + 1][0]) i++
      const a = keys[i]
      const b = keys[i + 1]
      const k = easeInOutCubic((t - a[0]) / (b[0] - a[0]))
      const tgt = this.tmp.copy(T0)
      tgt.z += lerp(a[4], b[4], k)
      tgt.y = lerp(T0.y, 2, smootherstep(t / 14))
      rig.scriptTarget.copy(tgt)
      this.sphere(lerp(a[1], b[1], k), deg(lerp(a[2], b[2], k)), D * lerp(a[3], b[3], k), tgt, rig.scriptPos)
      rig.scriptFov = this.fov(34)
      return
    }
    if (t < 18.6) {
      // push from the drawing view down to the bridge as the world inflates
      const k = easeInOutCubic(phase(t, 14, 4.6))
      const a = keys[3]
      const tA = this.tmp.copy(T0)
      tA.z += a[4]
      tA.y = 2
      const yaw = lerp(a[1], -0.42, k)
      const pitch = lerp(deg(a[2]), deg(17), k)
      const dist = Math.exp(lerp(Math.log(D * a[3]), Math.log(44), k))
      rig.scriptTarget.lerpVectors(tA, bridgeC, k)
      this.sphere(yaw, pitch, dist, rig.scriptTarget, rig.scriptPos)
      rig.scriptFov = this.fov(lerp(34, 44, k))
      return
    }
    const c = e.character
    if (t < 24.2 && c) {
      if (!this.followStarted) {
        this.followStarted = true
        this.followFrom.pos.copy(rig.scriptPos)
        this.followFrom.target.copy(rig.scriptTarget)
      }
      // tracking shot: beside and slightly behind the runner, bridge in profile
      const d = this.tmp.copy(this.bridgeB).sub(this.bridgeA)
      if (d.lengthSq() < 1e-4) d.set(1, 0, 0)
      d.normalize()
      let nx = -d.z
      let nz = d.x
      if (nz < 0) {
        nx = -nx
        nz = -nz
      }
      const pos = new Vector3(c.pos.x + nx * 9.5 - d.x * 3.5, c.pos.y + 2.6, c.pos.z + nz * 9.5 - d.z * 3.5)
      const tgt = new Vector3(c.pos.x + d.x * 2.2, c.pos.y + 1.1, c.pos.z + d.z * 2.2)
      const g = e.world.heightAt(pos.x, pos.z) + 1
      if (pos.y < g) pos.y = g
      const k = smootherstep(phase(t, 18.6, 1.4))
      rig.scriptPos.lerpVectors(this.followFrom.pos, pos, k)
      rig.scriptTarget.lerpVectors(this.followFrom.target, tgt, k)
      rig.scriptFov = this.fov(46)
      return
    }
    // climb into the sky for the final wide shot
    const k = easeInOutCubic(phase(t, 24.2, 4.8))
    const endTarget = new Vector3(0, 22, -50)
    const endPos = this.sphere(-0.12 + (t - 24.2) * 0.012, deg(12.5), 252, endTarget, new Vector3())
    rig.scriptPos.lerpVectors(this.riseFrom.pos, endPos, k)
    rig.scriptTarget.lerpVectors(this.riseFrom.target, endTarget, k)
    rig.scriptFov = this.fov(lerp(46, 50, k))
  }

  /** keep the horizontal field of view on portrait screens */
  private fov(base: number) {
    const a = this.e.rig.aspect
    if (a >= 1) return base
    const h = 2 * Math.atan(Math.tan(MathUtils.degToRad(base) / 2) * (16 / 9) * 0.62)
    return Math.min(82, MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / a)))
  }

  update(dt: number) {
    if (!this.active) return
    this.t += dt
    const t = this.t
    for (const ev of this.events) {
      if (!ev.done && t >= ev.t) {
        ev.done = true
        ev.fn()
      }
    }
    const e = this.e
    // the first drop of ink: the brush rests and the drop blooms (a pine grows here later)
    if (t > 1.6 && t < 3.6) {
      const g = phase(t, 1.6, 2)
      e.ink.stamp({ x: DROP.x, z: DROP.z, dx: 1, dz: 0, halfLen: 0.8 + g * 1.4, halfWidth: 0.8 + g * 1.4, black: 0.9 * dt, indigo: 0, water: 2.6 * dt, dryness: 0, bleed: 0.65, arc: 0, seed: 11, round: 1 })
      e.brushPressure = 0.9
    }
    // the awakening, timed to the push-in
    U.uTremble.value = phase(t, 15.1, 0.5) * (1 - phase(t, 16.4, 1.2))
    if (t > 15.5) e.world.setScaleY(lerp(PAPER_SCALE_Y, 1, easeInOutCubic(phase(t, 15.5, 2.9))))
    U.uAwaken.value = smootherstep(phase(t, 16.2, 3.2))
    e.world.backdrop.setRise(smootherstep(phase(t, 16.4, 4)))
    this.camera(t)
    if (t >= this.duration) this.stop()
  }

  get progress() {
    return clamp(this.t / this.duration)
  }
}
