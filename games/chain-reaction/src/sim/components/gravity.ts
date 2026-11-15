import { boxBounds, Component, type ParamDef, type Port } from '../component'
import type { ComponentSpec } from '../schema'
import { qAxisAngle, qMul, qRotate, twistAngle, type Q4, type V3 } from '../math'
import { RAPIER, type RigidBody } from '../physics'
import { MARBLE_MASS } from './basic'
import { MARBLE_R, RAIL_R, SUPPORT_H, SUPPORT_W } from './rails'

const G = 9.81

export const PULLEY_PARAMS: ParamDef[] = [
  { key: 'drop', label: 'Travel', type: 'number', min: 0.3, max: 4, step: 0.05, default: 1.6 },
  { key: 'counter', label: 'Counterweight (marbles)', type: 'number', min: 0.2, max: 6, step: 0.05, default: 1.5 },
  { key: 'cup', label: 'Bucket size', type: 'number', min: 0.4, max: 1.2, step: 0.02, default: 0.62 },
  { key: 'span', label: 'Counterweight offset', type: 'number', min: 0.6, max: 4, step: 0.05, default: 1.4 },
  { key: 'wheel', label: 'Wheel height', type: 'number', min: 0.6, max: 4, step: 0.05, default: 1.5 },
  { key: 'trip', label: 'Trip at (× travel)', type: 'number', min: 0.3, max: 1, step: 0.05, default: 0.85 },
]

/**
 * PULLEY & COUNTERWEIGHT — the bucket is a dynamic body on a vertical prismatic guide; the rope is a
 * stable 1-DOF model: bucket mass carries the counterweight's inertia and the rope pulls up with
 * 2·m_cw·g, so net = (m_bucket + load − m_cw)·g. It only goes down once enough marbles weigh it.
 * The counterweight mirrors the bucket and trips "lowered" near the end of its travel.
 * Origin = bucket floor at the top stop; the counterweight hangs at local +x = span.
 */
export class Pulley extends Component {
  readonly drive = 'physical' as const
  bucket!: RigidBody
  counter!: RigidBody
  /** bucket displacement below its top stop (m, ≥ 0) */
  lowered = 0
  private mcw = 0
  private bucketRest!: V3
  private cwRest!: V3

  constructor(spec: ComponentSpec) {
    super(spec, PULLEY_PARAMS)
    this.signalOutputs.push('lowered')
  }

  get bucketMass() { return 0.6 }

  build() {
    const c = this.num('cup') / 2
    this.mcw = this.num('counter') * MARBLE_MASS + this.bucketMass
    this.bucketRest = this.w(0, 0, 0)
    this.bucket = this.sim.physics.body(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(this.bucketRest.x, this.bucketRest.y, this.bucketRest.z).setRotation(this.q).setAdditionalMass(this.mcw).setCanSleep(true).setLinearDamping(0.4),
    )
    const wallH = 0.36
    const parts: [number, number, number, number, number, number][] = [
      [c, 0.03, c, 0, -0.03, 0],
      [0.03, wallH / 2, c, c, wallH / 2, 0],
      [0.03, wallH / 2, c, -c, wallH / 2, 0],
      [c, wallH / 2, 0.03, 0, wallH / 2, c],
      [c, wallH / 2, 0.03, 0, wallH / 2, -c],
    ]
    for (const [hx, hy, hz, x, y, z] of parts) {
      this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setMass(this.bucketMass / 5), this.bucket, this.owner('bucket', 'felt'))
    }
    const j = this.sim.physics.world.createImpulseJoint(RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), this.fixedBody, this.bucket, true) as RAPIER.PrismaticImpulseJoint
    j.setLimits(-this.num('drop'), 0)
    // rope / axle friction: a weak velocity motor towards 0 acts as viscous damping on the rope
    j.configureMotorVelocity(0, 1.2)
    const span = this.num('span')
    this.cwRest = this.w(span, 0.25, 0)
    this.counter = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.cwRest.x, this.cwRest.y, this.cwRest.z).setRotation(this.q))
    this.sim.physics.collider(RAPIER.ColliderDesc.cylinder(0.28, 0.2), this.counter, this.owner('counterweight', 'iron'))
    this.bodies.push(this.bucket, this.counter)
    this.waitingFor = `the bucket needs more than ${this.num('counter').toFixed(1)} marbles of load`
  }

  preStep() {
    // rope tension of an ideal pulley (counterweight inertia already in the bucket mass)
    this.bucket.resetForces(false)
    this.bucket.addForce({ x: 0, y: 2 * this.mcw * G, z: 0 }, false)
    this.counter.setNextKinematicTranslation({ x: this.cwRest.x, y: this.cwRest.y + this.lowered, z: this.cwRest.z })
  }

  postStep() {
    this.lowered = Math.max(0, this.bucketRest.y - this.bucket.translation().y)
    if (this.status === 'IDLE') return
    if (this.status === 'ARMED' && this.lowered > 0.05) this.setStatus('ACTIVATED')
    if (this.status === 'ACTIVATED' && this.lowered > this.num('trip') * this.num('drop')) {
      this.setStatus('COMPLETED')
      this.emit('lowered')
    }
  }

  /** marbles in the bucket */
  load(): number {
    let n = 0
    const b = this.bucket.translation()
    const c = this.num('cup') / 2
    for (const m of this.sim.marbles()) {
      const t = m.body.translation()
      if (Math.abs(t.x - b.x) < c + 0.05 && Math.abs(t.z - b.z) < c + 0.05 && t.y > b.y - 0.1 && t.y < b.y + 0.6) n++
    }
    return n
  }

  busy() { return this.status === 'ACTIVATED' }
  progress() { return `${this.load()} in bucket · ${this.lowered.toFixed(2)} m` }
  saveExtra() { return [this.lowered] }
  loadExtra(s: number[]) { this.lowered = s[0] }
  ports(): Port[] { return [{ name: 'in', kind: 'in', pos: this.w(0, 0.5, 0), dir: this.wd(0, -1, 0) }] }
  bounds() {
    const c = this.num('cup') / 2 + 0.1
    return boxBounds(this, (this.num('span') + c * 2) / 2, (this.num('drop') + this.num('wheel')) / 2 + 0.3, c, this.num('span') / 2, (this.num('wheel') - this.num('drop')) / 2, 0)
  }
}

// ---------------------------------------------------------------------------------------------

export const PENDULUM_PARAMS: ParamDef[] = [
  { key: 'length', label: 'Arm length', type: 'number', min: 0.8, max: 6, step: 0.05, default: 3 },
  { key: 'bob', label: 'Bob radius', type: 'number', min: 0.15, max: 0.8, step: 0.01, default: 0.42 },
  { key: 'mass', label: 'Bob mass (kg)', type: 'number', min: 1, max: 60, step: 0.5, default: 16 },
  { key: 'angle', label: 'Release angle (deg)', type: 'number', min: 0, max: 100, step: 1, default: 55 },
  { key: 'latched', label: 'Held by latch', type: 'boolean', default: true },
  { key: 'friction', label: 'Pivot friction', type: 'number', min: 0, max: 2, step: 0.01, default: 0.05 },
]

/**
 * PENDULUM — a heavy bob on a revolute joint. A kinematic latch pin holds it raised; "release"
 * retracts the pin and gravity does the rest. Origin = pivot; it swings in the local x–y plane,
 * raised towards −x, striking towards +x.
 */
export class Pendulum extends Component {
  readonly drive = 'sensor' as const
  rod!: RigidBody
  pin!: RigidBody
  rest!: Q4
  released = false
  pinOut = 0
  angle = 0
  passedBottom = false
  private pinRest!: V3

  constructor(spec: ComponentSpec) {
    super(spec, PENDULUM_PARAMS)
    this.signalInputs.push('release')
    this.signalOutputs.push('released')
  }

  get a0() { return (this.num('angle') * Math.PI) / 180 }

  build() {
    const L = this.num('length')
    const r = this.num('bob')
    // hanging straight down = identity; raised to −x by rotating −a0 about local z
    const raise = qAxisAngle({ x: 0, y: 0, z: 1 }, -this.a0)
    this.rest = this.q
    const start = qMul(this.q, raise)
    this.rod = this.sim.physics.body(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(this.origin.x, this.origin.y, this.origin.z).setRotation(start).setAngularDamping(0.03).setCanSleep(true).setSleeping(true),
    )
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.05, L / 2, 0.05).setTranslation(0, -L / 2, 0).setMass(1.2), this.rod, this.owner('rod', 'steel'))
    // hammer head: a short drum across the swing plane
    this.sim.physics.collider(
      RAPIER.ColliderDesc.cylinder(r * 0.55, r).setTranslation(0, -L, 0).setRotation(qAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2)).setMass(this.num('mass')).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.rod,
      this.owner('bob', 'iron'),
    )
    const j = this.sim.physics.world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), this.fixedBody, this.rod, true) as RAPIER.RevoluteImpulseJoint
    if (this.num('friction') > 0) j.configureMotorVelocity(0, this.num('friction'))
    // latch pin just on the swing side of the raised bob
    const bobPos = { x: -L * Math.sin(this.a0), y: -L * Math.cos(this.a0) }
    // tangent direction of the swing at the raised position (towards +x)
    const tx = Math.cos(this.a0)
    const ty = -Math.sin(this.a0)
    const pl = { x: bobPos.x + tx * (r + 0.09), y: bobPos.y + ty * (r + 0.09), z: 0 }
    this.pinRest = this.w(pl.x, pl.y, pl.z)
    this.pin = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pinRest.x, this.pinRest.y, this.pinRest.z).setRotation(this.q))
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.08, 0.08, r * 0.7), this.pin, this.owner('latch', 'steel'))
    if (!this.bool('latched')) this.pinOut = 1
    this.bodies.push(this.rod, this.pin)
    this.placePin()
    this.waitingFor = 'the latch never received its release signal'
  }

  receive(input: string) {
    if (input === 'release') this.release()
  }

  release() {
    if (this.released) return
    this.released = true
    this.rod.wakeUp()
    this.setStatus('ACTIVATED')
    this.emit('released')
  }

  arm() {
    super.arm()
    if (!this.bool('latched')) this.release()
  }

  private placePin() {
    const e = this.pinOut * this.pinOut * (3 - 2 * this.pinOut)
    const off = qRotate(this.q, { x: 0, y: 0, z: e * (this.num('bob') * 2 + 0.4) })
    this.pin.setNextKinematicTranslation({ x: this.pinRest.x + off.x, y: this.pinRest.y + off.y, z: this.pinRest.z + off.z })
  }

  preStep(dt: number) {
    if (this.released && this.pinOut < 1) {
      this.pinOut = Math.min(1, this.pinOut + dt / 0.12)
      this.placePin()
    }
  }

  postStep() {
    this.angle = twistAngle(this.rest, this.rod.rotation(), qRotate(this.q, { x: 0, y: 0, z: 1 }))
    if (this.status === 'IDLE') return
    if (this.status === 'ACTIVATED' && Math.abs(this.angle) < this.a0 - 0.08) this.setStatus('RUNNING')
    if (this.status === 'RUNNING' && !this.passedBottom && this.angle > -0.02) {
      this.passedBottom = true
      this.setStatus('COMPLETED')
    }
  }

  busy() { return this.released && !this.passedBottom }
  progress() { return `${((this.angle * 180) / Math.PI).toFixed(0)}°` }
  saveExtra() { return [this.released ? 1 : 0, this.pinOut, this.angle, this.passedBottom ? 1 : 0] }
  loadExtra(s: number[]) {
    this.released = s[0] === 1; this.pinOut = s[1]; this.angle = s[2]; this.passedBottom = s[3] === 1
  }
  bounds() {
    const L = this.num('length') + this.num('bob')
    return boxBounds(this, L, L / 2 + 0.2, this.num('bob') + 0.1, 0, -L / 2, 0)
  }
}

// ---------------------------------------------------------------------------------------------

export const LAUNCHER_PARAMS: ParamDef[] = [
  { key: 'angle', label: 'Elevation (deg)', type: 'number', min: 0, max: 80, step: 0.5, default: 45 },
  { key: 'stiffness', label: 'Spring stiffness', type: 'number', min: 50, max: 4000, step: 10, default: 900 },
  { key: 'compression', label: 'Compression', type: 'number', min: 0.05, max: 0.5, step: 0.01, default: 0.3 },
  { key: 'barrel', label: 'Barrel length', type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1.1 },
  { key: 'trigger', label: 'Trigger', type: 'select', options: ['paddle', 'signal', 'auto'], default: 'paddle' },
  { key: 'paddleX', label: 'Paddle x', type: 'number', min: -2, max: 2, step: 0.01, default: -0.55 },
  { key: 'paddleY', label: 'Paddle height', type: 'number', min: 0, max: 2.5, step: 0.01, default: 0.7 },
  { key: 'preload', label: 'Pre-loaded marble', type: 'boolean', default: true },
]

/**
 * SPRING LAUNCHER — a plunger on a prismatic joint whose spring is a joint motor (F = k·x − c·v).
 * A catch (joint limits) holds it compressed; the trigger releases the catch and the stored spring
 * energy drives the plunger into the marble. Launch speed follows from stiffness and compression.
 * Trigger: a sprung paddle that must be physically struck, a signal, or "auto" (ball in cradle).
 * Origin = breech; the barrel points along local +x raised by the elevation.
 */
export class Launcher extends Component {
  readonly drive = 'sensor' as const
  plunger!: RigidBody
  paddle?: RigidBody
  joint!: RAPIER.PrismaticImpulseJoint
  fired = false
  paddleRest!: Q4
  paddleAngle = 0
  marbleBodies: RigidBody[] = []
  private loadedFor = 0
  private plungerRest!: V3

  constructor(spec: ComponentSpec) {
    super(spec, LAUNCHER_PARAMS)
    this.signalInputs.push('fire')
    this.signalOutputs.push('fired')
  }

  get elev() { return (this.num('angle') * Math.PI) / 180 }
  get frame(): Q4 { return qMul(this.q, qAxisAngle({ x: 0, y: 0, z: 1 }, this.elev)) }
  /** barrel-local (x along barrel) → world */
  b(x: number, y: number, z = 0): V3 {
    const p = qRotate(this.frame, { x, y, z })
    return { x: this.origin.x + p.x, y: this.origin.y + p.y, z: this.origin.z + p.z }
  }

  build() {
    const local = qAxisAngle({ x: 0, y: 0, z: 1 }, this.elev)
    const comp = this.num('compression')
    const len = this.num('barrel')
    // barrel rails (two support rails + two guards), fixed, in the barrel frame
    const rails: [number, number][] = [[SUPPORT_W, -SUPPORT_H], [-SUPPORT_W, -SUPPORT_H], [MARBLE_R + RAIL_R + 0.02, 0.02], [-(MARBLE_R + RAIL_R + 0.02), 0.02]]
    for (const [lat, vert] of rails) {
      const x0 = -comp - 0.3
      const x1 = len
      const mid = qRotate(local, { x: (x0 + x1) / 2, y: vert, z: lat })
      this.fixedCollider(RAPIER.ColliderDesc.capsule((x1 - x0) / 2, RAIL_R), mid, qMul(local, qAxisAngle({ x: 0, y: 0, z: 1 }, -Math.PI / 2)), 'barrel', 'steel')
    }
    // plunger: rides the barrel axis, face at local x = 0 when extended
    this.plungerRest = this.b(-0.12, 0)
    // body keeps the component's yaw frame (so the joint axis is the same vector in both bodies);
    // the collider itself is tilted to the barrel
    this.plunger = this.sim.physics.body(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(...xyz(this.b(-0.12 - comp, 0))).setRotation(this.q).setCcdEnabled(true).setCanSleep(false),
    )
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.12, 0.1, 0.1).setRotation(local).setMass(1.4), this.plunger, this.owner('plunger', 'steel'))
    this.joint = this.sim.physics.world.createImpulseJoint(
      RAPIER.JointData.prismatic(qRotate(local, { x: -0.12, y: 0, z: 0 }), { x: 0, y: 0, z: 0 }, qRotate(local, { x: 1, y: 0, z: 0 })),
      this.fixedBody,
      this.plunger,
      true,
    ) as RAPIER.PrismaticImpulseJoint
    // the catch: limits pinned at full compression
    this.joint.setLimits(-comp, -comp + 1e-4)
    this.joint.configureMotorPosition(0, this.num('stiffness'), 4)
    this.bodies.push(this.plunger)
    if (this.bool('preload')) {
      const p = this.b(-comp + MARBLE_R + 0.005, 0.004)
      const m = this.makeMarble(p)
      this.marbleBodies.push(m)
      this.bodies.push(m)
    }
    if (this.str('trigger') === 'paddle') {
      // a sprung flap hanging from a hinge; it must be knocked past 14° to trip the catch
      const hinge = { x: this.num('paddleX'), y: this.num('paddleY'), z: 0 }
      const hw = this.w(hinge.x, hinge.y, hinge.z)
      this.paddleRest = this.q
      this.paddle = this.sim.physics.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(hw.x, hw.y, hw.z).setRotation(this.q).setCanSleep(true).setSleeping(true).setAngularDamping(0.4))
      this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.05, 0.32, 0.26).setTranslation(0, -0.32, 0).setMass(0.5), this.paddle, this.owner('paddle', 'brass'))
      const pj = this.sim.physics.world.createImpulseJoint(RAPIER.JointData.revolute(hinge, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), this.fixedBody, this.paddle, true) as RAPIER.RevoluteImpulseJoint
      pj.configureMotorPosition(0, 30, 2)
      pj.setLimits(-1.3, 1.3)
      this.bodies.push(this.paddle)
    }
    this.waitingFor = this.str('trigger') === 'paddle' ? 'nothing struck the trigger paddle' : this.str('trigger') === 'auto' ? 'no marble settled in the cradle' : 'no fire signal arrived'
  }

  private makeMarble(p: V3) {
    const body = this.sim.physics.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.2).setSleeping(true))
    this.sim.physics.collider(RAPIER.ColliderDesc.ball(MARBLE_R).setMass(MARBLE_MASS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body, this.owner('marble', 'steel'))
    return body
  }

  receive(input: string) {
    if (input === 'fire') this.fire()
  }

  fire() {
    if (this.fired) return
    this.fired = true
    this.joint.setLimits(-this.num('compression'), 0)
    this.plunger.wakeUp()
    for (const m of this.marbleBodies) m.wakeUp()
    this.setStatus('ACTIVATED')
    this.emit('fired')
  }

  postStep(dt: number) {
    if (this.status === 'IDLE') return
    if (this.paddle) this.paddleAngle = twistAngle(this.paddleRest, this.paddle.rotation(), qRotate(this.q, { x: 0, y: 0, z: 1 }))
    if (!this.fired) {
      if (this.paddle && Math.abs(this.paddleAngle) > 0.25) this.fire()
      if (this.str('trigger') === 'auto') {
        const p = this.b(-this.num('compression') + MARBLE_R, 0)
        const near = this.sim.marbles().some((m) => {
          const t = m.body.translation()
          const v = m.body.linvel()
          return Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) < MARBLE_R * 1.6 && Math.hypot(v.x, v.y, v.z) < 0.2
        })
        this.loadedFor = near ? this.loadedFor + dt : 0
        if (this.loadedFor > 0.35) this.fire()
      }
    } else if (this.status === 'ACTIVATED') {
      const t = this.plunger.translation()
      const d = Math.hypot(t.x - this.plungerRest.x, t.y - this.plungerRest.y, t.z - this.plungerRest.z)
      if (d < 0.02) this.setStatus('COMPLETED')
    }
  }

  busy() { return this.status === 'ACTIVATED' }
  progress() { return this.fired ? 'fired' : this.paddle ? `paddle ${((this.paddleAngle * 180) / Math.PI).toFixed(0)}°` : 'cocked' }
  saveExtra() { return [this.fired ? 1 : 0, this.paddleAngle, this.loadedFor] }
  loadExtra(s: number[]) {
    const was = this.fired
    this.fired = s[0] === 1
    this.paddleAngle = s[1]
    this.loadedFor = s[2]
    if (was !== this.fired) this.joint.setLimits(-this.num('compression'), this.fired ? 0 : -this.num('compression') + 1e-4)
  }

  /** muzzle position + direction (for the editor's trajectory preview) */
  muzzle(): Port {
    return { name: 'out', kind: 'out', pos: this.b(this.num('barrel'), 0), dir: qRotate(this.frame, { x: 1, y: 0, z: 0 }) }
  }
  ports(): Port[] { return [this.muzzle()] }
  bounds() {
    const l = this.num('barrel') + this.num('compression') + 0.4
    return boxBounds(this, l / 2 + 0.6, l / 2 + 0.6, 0.35, l / 4, l / 4, 0)
  }
}

const xyz = (v: V3): [number, number, number] => [v.x, v.y, v.z]
