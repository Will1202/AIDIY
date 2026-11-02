import { Quaternion, Ray, Raycaster, Vector2, Vector3 } from 'three'
import { ROOM, WORLD_H, clamp, type CreationMode } from '../core/config'
import type { PhysObj, PhysicsEngine } from '../physics/PhysicsEngine'
import type { HeadTrackedCamera } from '../camera/HeadTrackedCamera'
import type { Pointer } from '../tracking/GestureEngine'

export type GripState = 'IDLE' | 'HOVERING' | 'PINCH_STARTED' | 'GRABBING' | 'DRAGGING' | 'RELEASING' | 'GESTURE_COOLDOWN'

export interface Grip {
  id: string
  kind: Pointer['kind']
  state: GripState
  stateT: number
  hover: PhysObj | null
  held: PhysObj | null
  /** world point the reticle sits on */
  aim: Vector3
  /** spring target for the held object */
  target: Vector3
  ray: Ray
  z0: number
  depth0: number
  zTarget: number
  offset: Vector3
  lost: number
  wasPinch: boolean
  emptyPinchT: number
  history: { t: number; p: Vector3 }[]
  /** how hard the held object is being pushed against the intact glass (world units) */
  press: number
  pointer: Pointer
}

interface TwoHand {
  obj: PhysObj
  a: Grip
  b: Grip
  dist0: number
  angle0: number
  depthDiff0: number
  scale0: number
  q0: Quaternion
  qTarget: Quaternion
  scale: number
  /** how fast the hands are moving apart (canvas px / s, smoothed) */
  spread: number
  lastDist: number
}

export interface InteractionEvents {
  onGrab?: (g: Grip, o: PhysObj) => void
  onRelease?: (g: Grip, o: PhysObj, v: Vector3) => void
  onCreate?: (mode: CreationMode, at: Vector3, scale: number) => PhysObj | null
  onBurst?: (o: PhysObj) => void
}

const SCALE_MIN = 0.35
const SCALE_MAX = 3.2

/**
 * Spatial interaction: every pointer becomes a ray from the (head-tracked) eye
 * through its point on the physical screen. Objects are picked in screen space
 * with a magnetic tolerance, grabbed through a velocity spring (so they keep
 * weight, lag and collisions), pushed / pulled in depth by the hand's distance
 * to the screen, and thrown with the hand's recent velocity.
 *
 *   camera frame → landmarks → canvas point → picking ray → grab depth → spring target
 */
export class SpatialInteraction {
  readonly grips = new Map<string, Grip>()
  two: TwoHand | null = null
  creationMode: CreationMode = 'PLANET'
  glassIntact = true
  apertureHalf = new Vector2(8, 4.4)
  canvasHalf = new Vector2(8.9, 5)
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly tmp = new Vector3()
  private readonly tmp2 = new Vector3()
  private time = 0
  /** px size of the canvas (for the magnetic pick tolerance) */
  viewport = new Vector2(1280, 720)

  constructor(
    private physics: PhysicsEngine,
    private view: HeadTrackedCamera,
    private ev: InteractionEvents,
  ) {
    physics.preStep.push((h) => this.fixedStep(h))
  }

  private grip(p: Pointer): Grip {
    let g = this.grips.get(p.id)
    if (!g) {
      g = {
        id: p.id,
        kind: p.kind,
        state: 'IDLE',
        stateT: 0,
        hover: null,
        held: null,
        aim: new Vector3(0, 0, -6),
        target: new Vector3(),
        ray: new Ray(),
        z0: 0,
        depth0: 0,
        zTarget: 0,
        offset: new Vector3(),
        lost: 0,
        wasPinch: false,
        emptyPinchT: -10,
        history: [],
        press: 0,
        pointer: p,
      }
      this.grips.set(p.id, g)
    }
    g.pointer = p
    return g
  }

  private setState(g: Grip, s: GripState) {
    if (g.state !== s) {
      g.state = s
      g.stateT = 0
    }
  }

  /** point on the pointer ray at world depth z */
  private pointAtZ(g: Grip, z: number, out: Vector3) {
    const o = g.ray.origin
    const d = g.ray.direction
    const t = (z - o.z) / Math.min(-1e-3, d.z)
    return out.copy(o).addScaledVector(d, Math.max(0, t))
  }

  /** the nearest grabbable under the pointer, with a magnetic screen-space tolerance */
  pick(g: Grip): PhysObj | null {
    const cam = this.view.camera
    const W = this.viewport.x
    const H = this.viewport.y
    const px = (g.pointer.x) * W
    const py = (g.pointer.y) * H
    const ax = this.apertureHalf.x / this.canvasHalf.x
    const ay = this.apertureHalf.y / this.canvasHalf.y
    let best: PhysObj | null = null
    let bestScore = Infinity
    const right = this.tmp2
    for (const o of this.physics.objs) {
      if (!o.grabbable || o.homing || !o.body.isEnabled() || !o.object.visible) continue
      // something another hand holds stays pickable, so a second hand can join it
      if (o.held && (this.two?.obj === o || o.heldBy === g.id)) continue
      const c = this.tmp.copy(o.object.position).project(cam)
      if (c.z > 1 || c.z < -1) continue
      // hidden behind the bezel: you can't grab what you can't see
      if (o.object.position.z < -0.3 && (Math.abs(c.x) > ax || Math.abs(c.y) > ay)) continue
      const sx = (c.x * 0.5 + 0.5) * W
      const sy = (0.5 - c.y * 0.5) * H
      right.copy(o.object.position).add(this.tmp.set(o.radius * o.scale, 0, 0)).project(cam)
      const rPx = Math.abs((right.x * 0.5 + 0.5) * W - sx)
      const d = Math.hypot(px - sx, py - sy)
      const tol = 26 + rPx * 0.25
      const score = d - rPx
      if (score < tol) {
        // prefer whatever is nearest the viewer when several overlap
        const s = score - (o.object.position.z + 50) * 0.5
        if (s < bestScore) {
          bestScore = s
          best = o
        }
      }
    }
    return best
  }

  private lastDt = 1 / 60

  update(pointers: Pointer[], dt: number) {
    this.time += dt
    this.lastDt = dt
    const seen = new Set<string>()
    for (const p of pointers) {
      seen.add(p.id)
      const g = this.grip(p)
      g.stateT += dt
      this.ndc.set(clamp(p.x, -0.1, 1.1) * 2 - 1, -(clamp(p.y, -0.1, 1.1) * 2 - 1))
      this.raycaster.setFromCamera(this.ndc, this.view.camera)
      g.ray.copy(this.raycaster.ray)
      this.stepGrip(g, p, dt)
    }
    // pointers that vanished entirely (e.g. demo ended)
    for (const [id, g] of this.grips) {
      if (!seen.has(id)) {
        if (g.held) this.release(g, true)
        this.grips.delete(id)
      }
    }
    this.updateTwoHand()
    this.maybeCreate()
  }

  private stepGrip(g: Grip, p: Pointer, dt: number) {
    const pinchEdge = p.present && p.pinch && !g.wasPinch
    const releaseEdge = g.wasPinch && (!p.pinch || !p.present)
    if (p.present) g.wasPinch = p.pinch

    if (!p.present) {
      if (g.held) {
        // keep holding through a short tracking dropout, then let go gently
        g.lost += dt
        if (g.lost > 0.45) {
          this.release(g, true)
          g.wasPinch = false
          this.setState(g, 'GESTURE_COOLDOWN')
        }
      } else {
        g.hover = null
        g.wasPinch = false
        if (g.state !== 'GESTURE_COOLDOWN') this.setState(g, 'IDLE')
      }
      return
    }
    g.lost = 0

    switch (g.state) {
      case 'IDLE':
      case 'HOVERING': {
        g.hover = this.pick(g)
        this.setState(g, g.hover ? 'HOVERING' : 'IDLE')
        if (pinchEdge) {
          if (g.hover) {
            this.setState(g, 'PINCH_STARTED')
            this.grab(g, g.hover)
          } else {
            g.emptyPinchT = this.time
          }
        }
        // reticle sits on the hovered object, or a little way into the room
        if (g.hover) g.aim.copy(g.hover.object.position)
        else this.pointAtZ(g, -4, g.aim)
        break
      }
      case 'PINCH_STARTED':
      case 'GRABBING':
      case 'DRAGGING': {
        if (!g.held) {
          this.setState(g, 'IDLE')
          break
        }
        if (releaseEdge || !p.pinch) {
          this.setState(g, 'RELEASING')
          this.release(g, false)
          break
        }
        if (g.state === 'PINCH_STARTED' && g.stateT > 0.08) this.setState(g, 'GRABBING')
        this.drive(g, p, dt)
        const speed = this.handSpeed(g)
        if (g.state === 'GRABBING' && speed > 3) this.setState(g, 'DRAGGING')
        else if (g.state === 'DRAGGING' && speed < 1.2 && g.stateT > 0.3) this.setState(g, 'GRABBING')
        break
      }
      case 'RELEASING':
        this.setState(g, 'GESTURE_COOLDOWN')
        break
      case 'GESTURE_COOLDOWN':
        this.pointAtZ(g, -4, g.aim)
        if (g.stateT > 0.25 && !p.pinch) this.setState(g, 'IDLE')
        break
    }
  }

  private grab(g: Grip, o: PhysObj) {
    // a second hand on an object already held → two-handed control
    const other = [...this.grips.values()].find((x) => x !== g && x.held === o)
    g.held = o
    g.history = []
    if (other) {
      this.beginTwoHand(other, g, o)
      return
    }
    o.held = true
    o.heldBy = g.id
    o.body.setGravityScale(0, true)
    o.body.wakeUp()
    g.z0 = o.object.position.z
    g.zTarget = g.z0
    g.depth0 = g.pointer.depth
    this.pointAtZ(g, g.z0, this.tmp)
    g.offset.copy(o.object.position).sub(this.tmp)
    g.target.copy(o.object.position)
    this.ev.onGrab?.(g, o)
  }

  private release(g: Grip, gentle: boolean) {
    const o = g.held
    g.held = null
    g.press = 0
    if (!o) return
    if (this.two && this.two.obj === o) {
      // flinging both hands apart and letting go scatters a galaxy
      if (!gentle && o.creation?.disperse && this.two.spread > this.viewport.x * 0.9) o.creation.disperse()
      // the other hand keeps the object, re-anchored so nothing jumps
      const keep = this.two.a === g ? this.two.b : this.two.a
      this.two = null
      keep.z0 = o.object.position.z
      keep.zTarget = keep.z0
      keep.depth0 = keep.pointer.depth
      this.pointAtZ(keep, keep.z0, this.tmp)
      keep.offset.copy(o.object.position).sub(this.tmp)
      keep.history = []
      o.heldBy = keep.id
      return
    }
    o.held = false
    o.heldBy = null
    o.body.setGravityScale(o.gravityScale, true)
    const v = new Vector3()
    const bv = o.body.linvel()
    v.set(bv.x, bv.y, bv.z)
    if (!gentle) {
      const hv = this.handVelocity(g)
      v.lerp(hv.multiplyScalar(1.1), 0.6)
      if (v.length() > 42) v.setLength(42)
      o.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
      // a flick also spins it
      const w = o.body.angvel()
      const spin = new Vector3(-v.y, v.x, 0).multiplyScalar(0.18 / o.heavy)
      o.body.setAngvel({ x: w.x + spin.x, y: w.y + spin.y, z: w.z + spin.z }, true)
      // a galaxy released fast scatters into its stars
      if (o.creation?.disperse && hv.length() > 9) o.creation.disperse()
    }
    this.ev.onRelease?.(g, o, v)
  }

  private handVelocity(g: Grip) {
    const h = g.history
    const out = new Vector3()
    if (h.length < 2) return out
    const last = h[h.length - 1]
    let first = h[0]
    for (const s of h) if (last.t - s.t <= 0.11) {
      first = s
      break
    }
    const dt = last.t - first.t
    if (dt < 1e-3) return out
    return out.copy(last.p).sub(first.p).divideScalar(dt)
  }

  private handSpeed(g: Grip) {
    return this.handVelocity(g).length()
  }

  /** update the spring target from the pointer: ray + depth from the hand's distance to the screen */
  private drive(g: Grip, p: Pointer, dt: number) {
    const o = g.held!
    if (this.two && this.two.obj === o) return
    const eyeZ = this.view.eye.z
    const front = Math.min(15, eyeZ - 5)
    g.zTarget = clamp(g.z0 - (p.depth - g.depth0) * p.depthGain, ROOM.back + 3, front)
    g.offset.multiplyScalar(Math.exp(-dt * 2.2))
    this.pointAtZ(g, g.zTarget, g.target).add(g.offset)
    g.aim.copy(o.object.position)
    g.history.push({ t: this.time, p: g.target.clone() })
    while (g.history.length > 2 && this.time - g.history[0].t > 0.2) g.history.shift()
    o.creation?.disturb?.(g.target, Math.min(1.5, this.handSpeed(g) * 0.15 + 0.2))
    // how far the hand is trying to pull it through the intact glass
    const r = o.radius * o.scale * 0.6
    g.press = this.glassIntact && o.object.position.z + r > -0.25 ? Math.max(0, g.target.z - o.object.position.z) : 0
  }

  private beginTwoHand(a: Grip, b: Grip, o: PhysObj) {
    const dx = (b.pointer.x - a.pointer.x) * this.viewport.x
    const dy = (b.pointer.y - a.pointer.y) * this.viewport.y
    this.two = {
      obj: o,
      a,
      b,
      dist0: Math.max(30, Math.hypot(dx, dy)),
      angle0: Math.atan2(dy, dx),
      depthDiff0: b.pointer.depth - a.pointer.depth,
      scale0: o.scale,
      q0: o.object.quaternion.clone(),
      qTarget: o.object.quaternion.clone(),
      scale: o.scale,
      spread: 0,
      lastDist: Math.hypot(dx, dy),
    }
    o.held = true
    o.heldBy = a.id
    for (const g of [a, b]) {
      g.z0 = o.object.position.z
      g.depth0 = g.pointer.depth
    }
  }

  private updateTwoHand() {
    const t = this.two
    if (!t) return
    const { a, b, obj } = t
    if (a.held !== obj || b.held !== obj) {
      this.two = null
      return
    }
    const dx = (b.pointer.x - a.pointer.x) * this.viewport.x
    const dy = (b.pointer.y - a.pointer.y) * this.viewport.y
    const dist = Math.max(10, Math.hypot(dx, dy))
    t.spread += ((dist - t.lastDist) / Math.max(1e-3, this.lastDt) - t.spread) * 0.35
    t.lastDist = dist
    // scale: hand spread, smoothed and clamped so detection jitter can't explode it
    const want = clamp(t.scale0 * (dist / t.dist0), SCALE_MIN, SCALE_MAX)
    t.scale += (want - t.scale) * 0.25
    if (Math.abs(t.scale - obj.scale) / obj.scale > 0.02) obj.setScale?.(t.scale)
    // rotation: roll from the line between the hands; yaw from one hand reaching further than the other
    const roll = -(Math.atan2(dy, dx) - t.angle0)
    const yaw = clamp(((b.pointer.depth - a.pointer.depth) - t.depthDiff0) * 2.2, -1.6, 1.6)
    const qr = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll)
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    t.qTarget.copy(qr).multiply(qy).multiply(t.q0)
    // position: the midpoint ray, depth from the average push / pull
    const z = clamp(a.z0 - ((a.pointer.depth - a.depth0 + (b.pointer.depth - b.depth0)) / 2) * a.pointer.depthGain, ROOM.back + 3, Math.min(15, this.view.eye.z - 5))
    const pa = this.pointAtZ(a, z, new Vector3())
    const pb = this.pointAtZ(b, z, new Vector3())
    a.target.copy(pa).add(pb).multiplyScalar(0.5)
    b.target.copy(a.target)
    a.aim.copy(obj.object.position)
    b.aim.copy(obj.object.position)
    a.history.push({ t: this.time, p: a.target.clone() })
    while (a.history.length > 2 && this.time - a.history[0].t > 0.2) a.history.shift()
    b.history = a.history
    // squeezing a planet far below its birth size makes it burst
    if (obj.creation?.mode === 'PLANET' && obj.scale < obj.creation.baseScale * 0.5 && !obj.creation.dead) {
      obj.creation.dead = true
      this.ev.onBurst?.(obj)
    }
  }

  /** two hands pinching empty space at about the same time conjure the current creation between them */
  private maybeCreate() {
    if (this.two) return
    const hands = [...this.grips.values()].filter((g) => g.kind !== 'mouse' && g.pointer.present)
    if (hands.length < 2) return
    const [a, b] = hands
    if (a.held || b.held || !a.pointer.pinch || !b.pointer.pinch) return
    if (Math.abs(a.emptyPinchT - b.emptyPinchT) > 0.6 || this.time - Math.max(a.emptyPinchT, b.emptyPinchT) > 0.5) return
    a.emptyPinchT = b.emptyPinchT = -10
    const z = this.glassIntact ? -5 : 2
    const pa = this.pointAtZ(a, z, new Vector3())
    const pb = this.pointAtZ(b, z, new Vector3())
    const mid = pa.clone().add(pb).multiplyScalar(0.5)
    const s = clamp(pa.distanceTo(pb) / 3.2, 0.5, 2.2)
    const o = this.ev.onCreate?.(this.creationMode, mid, s)
    if (!o) return
    a.held = o
    b.held = o
    this.setState(a, 'GRABBING')
    this.setState(b, 'GRABBING')
    o.body.setGravityScale(0, true)
    this.beginTwoHand(a, b, o)
  }

  /** 120 Hz: spring every held object towards its target; two-handed objects also turn */
  private fixedStep(h: number) {
    const done = new Set<PhysObj>()
    for (const g of this.grips.values()) {
      const o = g.held
      if (!o || done.has(o) || !o.body.isDynamic()) continue
      done.add(o)
      const p = o.body.translation()
      const v = o.body.linvel()
      const k = 10 / o.heavy
      const resp = Math.min(1, h * (18 / o.heavy))
      let dx = (g.target.x - p.x) * k
      let dy = (g.target.y - p.y) * k
      let dz = (g.target.z - p.z) * k
      const s = Math.hypot(dx, dy, dz)
      if (s > 45) {
        dx *= 45 / s
        dy *= 45 / s
        dz *= 45 / s
      }
      o.body.setLinvel({ x: v.x + (dx - v.x) * resp, y: v.y + (dy - v.y) * resp, z: v.z + (dz - v.z) * resp }, true)
      const w = o.body.angvel()
      if (this.two && this.two.obj === o) {
        const r = o.body.rotation()
        const cur = new Quaternion(r.x, r.y, r.z, r.w)
        const err = this.two.qTarget.clone().multiply(cur.invert())
        if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w)
        const angle = 2 * Math.acos(clamp(err.w, -1, 1))
        const sn = Math.sqrt(Math.max(1e-9, 1 - err.w * err.w))
        const gain = 9
        const tx = (err.x / sn) * angle * gain
        const ty = (err.y / sn) * angle * gain
        const tz = (err.z / sn) * angle * gain
        o.body.setAngvel({ x: w.x + (tx - w.x) * 0.3, y: w.y + (ty - w.y) * 0.3, z: w.z + (tz - w.z) * 0.3 }, true)
      } else {
        const d = Math.exp(-h * 2.5)
        o.body.setAngvel({ x: w.x * d, y: w.y * d, z: w.z * d }, true)
      }
    }
  }

  /** drop everything (e.g. when the world is rebuilt) */
  releaseAll() {
    for (const g of this.grips.values()) {
      if (g.held) this.release(g, true)
      this.setState(g, 'IDLE')
    }
    this.two = null
  }

  /** the most pressure any hand is putting on the glass right now */
  get maxPress() {
    let m = 0
    for (const g of this.grips.values()) m = Math.max(m, g.press)
    return m
  }

  /** canvas → screen-plane world point (z = 0) for HUD anchoring */
  screenPoint(x: number, y: number, canvasW: number) {
    return new Vector3((x - 0.5) * canvasW, (0.5 - y) * WORLD_H, 0)
  }
}
