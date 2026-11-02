import RAPIER from '@dimforge/rapier3d-compat'
import { Object3D, Quaternion, Vector3 } from 'three'
import { FRONT, GRAVITY, REVEAL_DEPTH, ROOM, clamp, type CreationMode, type GravityMode } from '../core/config'

export { RAPIER }

/** collision group bits */
export const CG = { ROOM: 1, FRONT: 2, BEZEL: 4, GLASS: 8, OBJ: 16, SHARD: 32, CORE: 64, GHOST: 128 }
const grp = (m: number, f: number) => ((m & 0xffff) << 16) | (f & 0xffff)
export const GROUPS = {
  room: grp(CG.ROOM, CG.OBJ | CG.SHARD | CG.CORE),
  front: grp(CG.FRONT, CG.OBJ | CG.SHARD | CG.CORE),
  bezel: grp(CG.BEZEL, CG.OBJ | CG.SHARD | CG.CORE),
  glass: grp(CG.GLASS, CG.OBJ | CG.CORE),
  obj: grp(CG.OBJ, CG.ROOM | CG.FRONT | CG.BEZEL | CG.GLASS | CG.OBJ | CG.SHARD | CG.CORE),
  shard: grp(CG.SHARD, CG.ROOM | CG.FRONT | CG.BEZEL | CG.OBJ | CG.SHARD | CG.CORE),
  core: grp(CG.CORE, CG.ROOM | CG.FRONT | CG.BEZEL | CG.GLASS | CG.OBJ | CG.SHARD),
  ghost: grp(CG.GHOST, 0),
}

export type ObjKind =
  | 'sphere' | 'cube' | 'poly' | 'mech' | 'core' | 'shard' | 'hero' | 'monolith'
  | 'planet' | 'liquid' | 'galaxy' | 'mechcube'

export interface Homing {
  from: Vector3
  fromQ: Quaternion
  via: Vector3 | null
  to: Vector3
  toQ: Quaternion
  delay: number
  duration: number
  t: number
  /** what to become when it lands */
  after: 'dynamic' | 'fixed' | 'remove'
  done: boolean
}

export interface PhysObj {
  id: number
  kind: ObjKind
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  object: Object3D
  /** unscaled bounding radius, for picking */
  radius: number
  scale: number
  grabbable: boolean
  /** > 1 feels heavier in the hand */
  heavy: number
  held: boolean
  heldBy: string | null
  gravityScale: number
  home: { p: Vector3; q: Quaternion } | null
  readonly prevP: Vector3
  readonly prevQ: Quaternion
  readonly currP: Vector3
  readonly currQ: Quaternion
  homing: Homing | null
  /** ignore the demo vortex / special forces */
  noForces?: boolean
  setScale?: (s: number) => void
  onFrame?: (dt: number, time: number) => void
  dispose?: () => void
  /** seconds this object has existed */
  age: number
  tag?: string
  creation?: CreationInfo
}

export interface CreationInfo {
  mode: CreationMode
  /** scale it was created at (compressing far below this bursts a planet) */
  baseScale: number
  disturb?: (worldPoint: Vector3, strength: number) => void
  disperse?: () => void
  dead?: boolean
}

let NEXT_ID = 1

export interface ApertureRect {
  halfW: number
  halfH: number
}

/**
 * Rapier world for the whole installation: the lab interior, the frame bezel
 * with its opening, the glass pane, and an invisible catch volume in front of
 * the screen. Fixed 120 Hz steps with render interpolation.
 */
export class PhysicsEngine {
  readonly world: RAPIER.World
  readonly events: RAPIER.EventQueue
  readonly h = 1 / 120
  readonly objs: PhysObj[] = []
  private readonly byCollider = new Map<number, PhysObj>()
  private acc = 0
  /** render interpolation factor of the last step() */
  alpha = 0
  time = 0
  steps = 0
  stepMs = 0
  gravityMode: GravityMode = 'NORMAL'
  sideways = 1
  readonly gravity = new Vector3(0, -GRAVITY, 0)
  maxSubsteps = 4
  /** called before every fixed step (grab springs, vortex, homing, hover...) */
  readonly preStep: ((h: number) => void)[] = []
  onContact: ((a: PhysObj | null, b: PhysObj | null, ca: RAPIER.Collider, cb: RAPIER.Collider, force: number) => void) | null = null

  glassBody!: RAPIER.RigidBody
  glassCollider!: RAPIER.Collider
  private bezelBody: RAPIER.RigidBody | null = null
  private bezelColliders: RAPIER.Collider[] = []
  private zeroGKick = 0

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 })
    this.world.timestep = this.h
    this.world.integrationParameters.numSolverIterations = 6
    this.events = new RAPIER.EventQueue(true)
    this.buildRoom()
  }

  static async create() {
    await RAPIER.init()
    return new PhysicsEngine()
  }

  private fixedBox(hx: number, hy: number, hz: number, x: number, y: number, z: number, groups: number, friction = 0.6, restitution = 0.25) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(restitution).setCollisionGroups(groups),
      body,
    )
    return body
  }

  private buildRoom() {
    const R = ROOM
    const T = 2
    const depth = -R.back
    const midZ = R.back / 2
    const midY = (R.floor + R.ceil) / 2
    const hy = (R.ceil - R.floor) / 2
    const g = GROUPS.room
    // floor stops at the window sill (z = -REVEAL_DEPTH): nothing to land on in front of the screen
    const fz0 = R.back - T
    const fz1 = -REVEAL_DEPTH
    this.fixedBox(R.halfX + T, T, (fz1 - fz0) / 2, 0, R.floor - T, (fz0 + fz1) / 2, g, 0.7, 0.2) // floor
    this.fixedBox(R.halfX + T, T, depth / 2 + T, 0, R.ceil + T, midZ, g) // ceiling
    this.fixedBox(T, hy + T, depth / 2 + T, -R.halfX - T, midY, midZ, g) // left
    this.fixedBox(T, hy + T, depth / 2 + T, R.halfX + T, midY, midZ, g) // right
    this.fixedBox(R.halfX + T, hy + T, T, 0, midY, R.back - T, g) // back

    // the catch volume in front of the screen: everything that leaves the window lands here, out of view
    const F = FRONT
    const f = GROUPS.front
    const fz = F.far / 2
    const fhy = (F.ceil - F.floor) / 2
    const fmy = (F.ceil + F.floor) / 2
    this.fixedBox(F.halfX + T, T, fz + T, 0, F.floor - T, fz, f, 0.8, 0.15)
    this.fixedBox(F.halfX + T, T, fz + T, 0, F.ceil + T, fz, f, 0.8, 0.15)
    this.fixedBox(T, fhy + T, fz + T, -F.halfX - T, fmy, fz, f, 0.8, 0.15)
    this.fixedBox(T, fhy + T, fz + T, F.halfX + T, fmy, fz, f, 0.8, 0.15)
    this.fixedBox(F.halfX + T, fhy + T, T, 0, fmy, F.far + T, f, 0.8, 0)

    // glass pane: a fixed body whose collider is toggled when the screen breaks
    this.glassBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  }

  /** (re)build the wall-with-a-hole at z = 0 for the current window opening */
  setAperture(a: ApertureRect) {
    if (this.bezelBody) this.world.removeRigidBody(this.bezelBody)
    this.bezelColliders = []
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.bezelBody = body
    const W = 32
    const H = 18
    const zc = (-REVEAL_DEPTH + 0.4) / 2
    const hz = (REVEAL_DEPTH + 0.4) / 2
    const add = (x0: number, x1: number, y0: number, y1: number) => {
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, hz)
          .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, zc)
          .setFriction(0.5)
          .setRestitution(0.3)
          .setCollisionGroups(GROUPS.bezel),
        body,
      )
      this.bezelColliders.push(c)
    }
    add(-W, W, a.halfH, H) // top
    add(-W, W, -H, -a.halfH) // bottom
    add(-W, -a.halfW, -a.halfH, a.halfH) // left
    add(a.halfW, W, -a.halfH, a.halfH) // right

    const enabled = this.glassCollider ? this.glassCollider.isEnabled() : true
    if (this.glassCollider) this.world.removeCollider(this.glassCollider, false)
    this.glassCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(a.halfW, a.halfH, 0.06)
        .setTranslation(0, 0, -0.06)
        .setFriction(0.3)
        .setRestitution(0.35)
        .setCollisionGroups(GROUPS.glass)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(40),
      this.glassBody,
    )
    this.glassCollider.setEnabled(enabled)
  }

  setGlassSolid(on: boolean) {
    this.glassCollider.setEnabled(on)
  }

  register(o: Omit<PhysObj, 'id' | 'prevP' | 'prevQ' | 'currP' | 'currQ' | 'homing' | 'held' | 'heldBy' | 'age'> & Partial<PhysObj>) {
    const t = o.body.translation()
    const r = o.body.rotation()
    const obj: PhysObj = {
      held: false,
      heldBy: null,
      homing: null,
      age: 0,
      ...o,
      id: NEXT_ID++,
      prevP: new Vector3(t.x, t.y, t.z),
      currP: new Vector3(t.x, t.y, t.z),
      prevQ: new Quaternion(r.x, r.y, r.z, r.w),
      currQ: new Quaternion(r.x, r.y, r.z, r.w),
    }
    this.objs.push(obj)
    for (let i = 0; i < obj.body.numColliders(); i++) this.byCollider.set(obj.body.collider(i).handle, obj)
    obj.body.setGravityScale(obj.gravityScale, true)
    return obj
  }

  /** replace all of an object's colliders (used when scaling); the first becomes the primary */
  replaceColliders(o: PhysObj, descs: RAPIER.ColliderDesc[]) {
    const old: RAPIER.Collider[] = []
    for (let i = 0; i < o.body.numColliders(); i++) old.push(o.body.collider(i))
    for (const c of old) {
      this.byCollider.delete(c.handle)
      this.world.removeCollider(c, false)
    }
    descs.forEach((d, i) => {
      const c = this.world.createCollider(d, o.body)
      this.byCollider.set(c.handle, o)
      if (i === 0) o.collider = c
    })
  }

  remove(o: PhysObj) {
    const i = this.objs.indexOf(o)
    if (i >= 0) this.objs.splice(i, 1)
    for (let k = 0; k < o.body.numColliders(); k++) this.byCollider.delete(o.body.collider(k).handle)
    this.world.removeRigidBody(o.body)
    o.object.removeFromParent()
    o.dispose?.()
  }

  objFor(c: RAPIER.Collider) {
    return this.byCollider.get(c.handle) ?? null
  }

  setGravity(mode: GravityMode, sideways = this.sideways) {
    this.gravityMode = mode
    this.sideways = sideways
    const g = this.gravity
    if (mode === 'NORMAL') g.set(0, -GRAVITY, 0)
    else if (mode === 'ZERO') g.set(0, 0, 0)
    else if (mode === 'REVERSE') g.set(0, GRAVITY, 0)
    else g.set(GRAVITY * sideways, 0, 0)
    this.world.gravity = { x: g.x, y: g.y, z: g.z }
    // wake everything; give a tiny random tumble so the change reads as physical
    for (const o of this.objs) {
      if (o.body.isDynamic()) {
        o.body.wakeUp()
        const m = o.body.mass()
        o.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.4, y: (Math.random() - 0.5) * m * 0.4, z: (Math.random() - 0.5) * m * 0.4 }, true)
      }
    }
    if (mode === 'ZERO') this.zeroGKick = 0.6
  }

  /** radial impulse: falls off with distance, never through the intact glass to the far side */
  explode(center: Vector3, radius: number, strength: number, upBias = 0.25, filter?: (o: PhysObj) => boolean) {
    let hit = 0
    const d = new Vector3()
    for (const o of this.objs) {
      if (!o.body.isDynamic() || o.held) continue
      if (filter && !filter(o)) continue
      d.copy(o.currP).sub(center)
      const dist = d.length()
      if (dist > radius) continue
      const f = Math.pow(1 - dist / radius, 1.5)
      d.normalize()
      d.y += upBias
      d.normalize()
      const m = o.body.mass()
      const j = strength * f * m
      o.body.applyImpulse({ x: d.x * j, y: d.y * j, z: d.z * j }, true)
      o.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * j * 0.2, y: (Math.random() - 0.5) * j * 0.2, z: (Math.random() - 0.5) * j * 0.2 }, true)
      hit++
    }
    return hit
  }

  step(dt: number) {
    const t0 = performance.now()
    this.acc += Math.min(dt, 0.1)
    let n = 0
    while (this.acc >= this.h && n < this.maxSubsteps) {
      this.fixedStep()
      this.acc -= this.h
      n++
    }
    if (n === this.maxSubsteps) this.acc = Math.min(this.acc, this.h)
    this.alpha = this.acc / this.h
    this.stepMs += (performance.now() - t0 - this.stepMs) * 0.1
  }

  private fixedStep() {
    const h = this.h
    for (const fn of this.preStep) fn(h)
    if (this.zeroGKick > 0) {
      // zero-g: things resting on a surface drift off it instead of sitting still
      this.zeroGKick -= h
      for (const o of this.objs) {
        if (!o.body.isDynamic() || o.held || o.kind === 'core') continue
        const m = o.body.mass()
        o.body.applyImpulse({ x: (Math.random() - 0.5) * m * 0.02, y: m * 0.035 * Math.random(), z: (Math.random() - 0.5) * m * 0.02 }, true)
      }
    }
    for (const o of this.objs) {
      o.prevP.copy(o.currP)
      o.prevQ.copy(o.currQ)
    }
    this.world.step(this.events)
    this.steps++
    this.time += h
    this.events.drainContactForceEvents((e) => {
      const c1 = this.world.getCollider(e.collider1())
      const c2 = this.world.getCollider(e.collider2())
      if (!c1 || !c2) return
      this.onContact?.(this.objFor(c1), this.objFor(c2), c1, c2, e.totalForceMagnitude())
    })
    this.events.drainCollisionEvents(() => {})
    const MAX_V = 70
    for (const o of this.objs) {
      const b = o.body
      if (b.isDynamic()) {
        const v = b.linvel()
        const s = Math.hypot(v.x, v.y, v.z)
        if (s > MAX_V) {
          const k = MAX_V / s
          b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true)
        }
      }
      const t = b.translation()
      const r = b.rotation()
      if (!Number.isFinite(t.x + t.y + t.z)) {
        // never let a numerical blow-up escape: send it home
        const hp = o.home?.p ?? new Vector3(0, 0, -10)
        b.setTranslation({ x: hp.x, y: hp.y, z: hp.z }, true)
        b.setLinvel({ x: 0, y: 0, z: 0 }, true)
        continue
      }
      o.currP.set(t.x, t.y, t.z)
      o.currQ.set(r.x, r.y, r.z, r.w)
      // out of every bound (should not happen, but a tunnelling object must come back)
      if (Math.abs(t.x) > 60 || Math.abs(t.y) > 40 || t.z > 60 || t.z < -80) {
        const hp = o.home?.p ?? new Vector3(0, 2, -10)
        b.setTranslation({ x: hp.x, y: hp.y, z: hp.z }, true)
        b.setLinvel({ x: 0, y: 0, z: 0 }, true)
        o.currP.copy(hp)
        o.prevP.copy(hp)
      }
    }
  }

  /** copy interpolated transforms to the visuals */
  sync(dt: number) {
    const a = clamp(this.alpha, 0, 1)
    for (const o of this.objs) {
      o.object.position.lerpVectors(o.prevP, o.currP, a)
      o.object.quaternion.slerpQuaternions(o.prevQ, o.currQ, a)
      o.age += dt
      o.onFrame?.(dt, this.time)
    }
  }

  dynamicCount() {
    let n = 0
    for (const o of this.objs) if (o.body.isDynamic()) n++
    return n
  }
}
