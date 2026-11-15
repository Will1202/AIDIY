import { boxBounds, Component, type ParamDef, type Port } from '../component'
import type { ComponentSpec } from '../schema'
import { qRotate, type V3 } from '../math'
import { RAPIER, type RigidBody } from '../physics'
import type { Rotor } from '../mechanics'
import { buildTrough, framePath, MARBLE_R, troughGeometry, type PathSample, type TroughGeometry } from './rails'

export const MARBLE_MASS = 1.0
export const MARBLE_LIN_DAMP = 0.03
export const MARBLE_ANG_DAMP = 0.05

/** a marble rigid body: real ball collider, CCD on, gentle damping standing in for rolling resistance */
export function makeMarble(c: Component, pos: V3, part: string, material: 'steel' | 'brass' = 'steel', sleeping = true): RigidBody {
  const body = c.sim.physics.body(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setCcdEnabled(true)
      .setLinearDamping(MARBLE_LIN_DAMP)
      .setAngularDamping(MARBLE_ANG_DAMP)
      .setCanSleep(true)
      .setSleeping(sleeping),
  )
  c.sim.physics.collider(
    RAPIER.ColliderDesc.ball(MARBLE_R).setMass(MARBLE_MASS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
    c.owner(part, material === 'brass' ? 'brass' : 'steel'),
  )
  return body
}

// ---------------------------------------------------------------------------------------------

export const MARBLE_PARAMS: ParamDef[] = [
  { key: 'material', label: 'Material', type: 'select', options: ['steel', 'brass'], default: 'steel' },
  { key: 'primary', label: 'Camera hero', type: 'boolean', default: false },
]

/** a free marble placed in the scene (e.g. pre-loaded in a launcher) */
export class Marble extends Component {
  readonly drive = 'physical' as const
  marbleBodies: RigidBody[] = []
  private lost = false

  constructor(spec: ComponentSpec) {
    super(spec, MARBLE_PARAMS)
  }
  build() {
    const b = makeMarble(this, this.origin, 'marble', this.str('material') as 'steel')
    this.bodies.push(b)
    this.marbleBodies.push(b)
    this.waitingFor = 'nothing hit the marble'
  }
  postStep() {
    if (this.status === 'IDLE') return
    const b = this.marbleBodies[0]
    const v = b.linvel()
    if (this.status === 'ARMED' && v.x * v.x + v.y * v.y + v.z * v.z > 0.04) this.setStatus('RUNNING')
    if (!this.lost && b.translation().y < -6) {
      this.lost = true
      this.failure = `marble ${this.id} fell out of the machine`
    }
  }
  progress() {
    const v = this.marbleBodies[0].linvel()
    return `${Math.hypot(v.x, v.y, v.z).toFixed(1)} m/s`
  }
  saveExtra() { return [this.lost ? 1 : 0] }
  loadExtra(s: number[]) {
    this.lost = s[0] === 1
    this.failure = this.lost ? `marble ${this.id} fell out of the machine` : ''
  }
  bounds() { return boxBounds(this, MARBLE_R, MARBLE_R, MARBLE_R) }
}

// ---------------------------------------------------------------------------------------------

export const HOPPER_PARAMS: ParamDef[] = [
  { key: 'count', label: 'Marbles', type: 'number', min: 1, max: 6, step: 1, default: 1 },
  { key: 'slope', label: 'Chute slope (deg)', type: 'number', min: 3, max: 25, step: 1, default: 9 },
  { key: 'openOnStart', label: 'Open on START', type: 'boolean', default: true },
  { key: 'camAngle', label: 'Cam trip (deg)', type: 'number', min: 10, max: 720, step: 5, default: 120 },
  { key: 'material', label: 'Marble material', type: 'select', options: ['steel', 'brass'], default: 'steel' },
]

/**
 * GRAVITY DROP — an inclined magazine of marbles held by a latch gate. The gate opens on a
 * signal ("open"), on START, or mechanically when the driving cam has turned past its trip angle.
 * Origin = exit port (gate line), the chute climbs backwards along local −x.
 */
export class Hopper extends Component {
  readonly drive = 'sensor' as const
  marbleBodies: RigidBody[] = []
  gate!: RigidBody
  path: PathSample[] = []
  trough!: TroughGeometry
  rotor!: Rotor
  /** 0 closed → 1 open */
  gateOpen = 0
  opening = false
  released = 0
  private gateRest!: V3

  constructor(spec: ComponentSpec) {
    super(spec, HOPPER_PARAMS)
    this.signalInputs.push('open')
    this.signalOutputs.push('opened', 'empty')
  }

  get count() { return Math.round(this.num('count')) }
  chuteLength() { return this.count * MARBLE_R * 2 + 0.5 }

  build() {
    const sl = (this.num('slope') * Math.PI) / 180
    const L = this.chuteLength()
    const pts: V3[] = []
    const n = Math.max(2, Math.ceil(L / 0.4))
    for (let i = 0; i <= n; i++) {
      const x = -L + (L * i) / n
      pts.push({ x, y: -Math.tan(sl) * x, z: 0 })
    }
    pts.push({ x: 0.35, y: -Math.tan(sl) * 0.35, z: 0 })
    this.path = framePath(pts)
    this.trough = troughGeometry(this.path)
    buildTrough(this, this.trough)
    // back stop
    this.fixedCollider(RAPIER.ColliderDesc.cuboid(0.04, 0.22, 0.24), { x: -L - 0.05, y: Math.tan(sl) * L, z: 0 }, null, 'stop', 'iron')
    // latch gate (kinematic bar across the chute)
    this.gateRest = this.w(-0.02, 0, 0)
    this.gate = this.sim.physics.body(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.gateRest.x, this.gateRest.y, this.gateRest.z).setRotation(this.q),
    )
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.035, 0.2, 0.26), this.gate, this.owner('gate', 'iron'))
    this.bodies.push(this.gate)
    // marbles resting against the gate
    const mat = this.str('material') as 'steel'
    for (let i = 0; i < this.count; i++) {
      const x = -0.035 - MARBLE_R - 0.012 - i * (MARBLE_R * 2 + 0.004)
      const b = makeMarble(this, this.w(x, -Math.tan(sl) * x + 0.004, 0), `marble:${i}`, mat)
      this.marbleBodies.push(b)
      this.bodies.push(b)
    }
    this.rotor = { key: `${this.id}:cam`, comp: this, center: this.w(-L * 0.5, 0.5, -0.36), axis: qRotate(this.q, { x: 0, y: 0, z: 1 }), layers: [], omega: 0, angle: 0, phase: 0, powered: false }
    this.waitingFor = this.bool('openOnStart') ? 'START was not pressed' : 'the release signal / cam never arrived'
  }

  rotors() { return [this.rotor] }

  arm() {
    super.arm()
    if (this.bool('openOnStart') && !this.sim.connections.some((k) => k.to === this.id)) this.open()
  }

  receive(input: string) {
    if (input === 'open') this.open()
  }

  open() {
    if (this.opening) return
    this.opening = true
    this.setStatus('ACTIVATED')
    this.emit('opened')
    for (const b of this.marbleBodies) b.wakeUp()
  }

  preStep(dt: number) {
    if (this.status !== 'IDLE' && !this.opening && Math.abs(this.rotor.angle) > (this.num('camAngle') * Math.PI) / 180) this.open()
    if (this.opening && this.gateOpen < 1) {
      this.gateOpen = Math.min(1, this.gateOpen + dt / 0.22)
      const e = this.gateOpen * this.gateOpen * (3 - 2 * this.gateOpen)
      this.gate.setNextKinematicTranslation({ x: this.gateRest.x, y: this.gateRest.y + e * 0.48, z: this.gateRest.z })
    }
  }

  postStep() {
    if (!this.opening) return
    let gone = 0
    for (const b of this.marbleBodies) {
      const t = b.translation()
      const lx = qRotate({ x: -this.q.x, y: -this.q.y, z: -this.q.z, w: this.q.w }, { x: t.x - this.origin.x, y: t.y - this.origin.y, z: t.z - this.origin.z }).x
      if (lx > 0.2 || t.y < this.origin.y - 1) gone++
    }
    this.released = gone
    if (this.status === 'ACTIVATED' && gone > 0) this.setStatus('RUNNING')
    if (this.status === 'RUNNING' && gone === this.count) {
      this.setStatus('COMPLETED')
      this.emit('empty')
    }
    for (let i = 0; i < this.marbleBodies.length; i++) {
      if (this.marbleBodies[i].translation().y < -6) this.failure = `a marble from ${this.id} fell out of the machine`
    }
  }

  busy() { return this.opening && this.gateOpen < 1 }

  progress() { return `${this.released} / ${this.count} released` }

  saveExtra() { return [this.gateOpen, this.opening ? 1 : 0, this.released, this.rotor.angle] }
  loadExtra(s: number[]) {
    this.gateOpen = s[0]
    this.opening = s[1] === 1
    this.released = s[2]
    this.rotor.angle = s[3]
  }

  ports(): Port[] {
    return [{ name: 'out', kind: 'out', pos: this.w(0.35, -Math.tan((this.num('slope') * Math.PI) / 180) * 0.35, 0), dir: qRotate(this.q, { x: 1, y: 0, z: 0 }) }]
  }

  bounds() {
    const L = this.chuteLength()
    return boxBounds(this, L / 2 + 0.3, 0.6, 0.35, -L / 2, 0.2, 0)
  }
}

// ---------------------------------------------------------------------------------------------

export const PLATFORM_PARAMS: ParamDef[] = [
  { key: 'width', label: 'Width', type: 'number', min: 0.5, max: 20, step: 0.1, default: 4 },
  { key: 'depth', label: 'Depth', type: 'number', min: 0.5, max: 10, step: 0.1, default: 2 },
  { key: 'thickness', label: 'Thickness', type: 'number', min: 0.05, max: 1, step: 0.01, default: 0.16 },
  { key: 'rim', label: 'Rim height', type: 'number', min: 0, max: 0.8, step: 0.02, default: 0.12 },
  { key: 'material', label: 'Finish', type: 'select', options: ['walnut', 'steel', 'copper'], default: 'walnut' },
]

/** a deck / shelf. Origin = centre of the top surface. */
export class Platform extends Component {
  readonly drive = 'passive' as const
  constructor(spec: ComponentSpec) {
    super(spec, PLATFORM_PARAMS)
  }
  build() {
    const w = this.num('width') / 2
    const d = this.num('depth') / 2
    const t = this.num('thickness') / 2
    this.fixedCollider(RAPIER.ColliderDesc.cuboid(w, t, d), { x: 0, y: -t, z: 0 }, null, 'deck', 'wood')
    const r = this.num('rim')
    if (r > 0) {
      const h = r / 2
      this.fixedCollider(RAPIER.ColliderDesc.cuboid(w, h, 0.03), { x: 0, y: h, z: d - 0.03 }, null, 'rim', 'wood')
      this.fixedCollider(RAPIER.ColliderDesc.cuboid(w, h, 0.03), { x: 0, y: h, z: -d + 0.03 }, null, 'rim', 'wood')
      this.fixedCollider(RAPIER.ColliderDesc.cuboid(0.03, h, d), { x: w - 0.03, y: h, z: 0 }, null, 'rim', 'wood')
      this.fixedCollider(RAPIER.ColliderDesc.cuboid(0.03, h, d), { x: -w + 0.03, y: h, z: 0 }, null, 'rim', 'wood')
    }
  }
  bounds() { return boxBounds(this, this.num('width') / 2, this.num('thickness') / 2 + 0.1, this.num('depth') / 2, 0, 0, 0) }
}

export const WALL_PARAMS: ParamDef[] = [
  { key: 'width', label: 'Width', type: 'number', min: 0.1, max: 12, step: 0.05, default: 1 },
  { key: 'height', label: 'Height', type: 'number', min: 0.1, max: 6, step: 0.05, default: 0.6 },
  { key: 'thickness', label: 'Thickness', type: 'number', min: 0.03, max: 1, step: 0.01, default: 0.08 },
  { key: 'tilt', label: 'Tilt (deg)', type: 'number', min: -80, max: 80, step: 1, default: 0 },
  { key: 'material', label: 'Finish', type: 'select', options: ['felt', 'iron', 'wood', 'acrylic'], default: 'iron' },
]

/** a backstop / deflector plate. Origin = bottom centre; width along local z, thickness along x. */
export class Wall extends Component {
  readonly drive = 'passive' as const
  constructor(spec: ComponentSpec) {
    super(spec, WALL_PARAMS)
  }
  build() {
    const h = this.num('height') / 2
    const tilt = (this.num('tilt') * Math.PI) / 180
    const rot = { x: 0, y: 0, z: Math.sin(-tilt / 2), w: Math.cos(-tilt / 2) }
    const c = qRotate(rot, { x: 0, y: h, z: 0 })
    // acrylic shields are lined with felt on the inside: clear to look through, dead to bounce off
    const m = this.str('material')
    const mat = (m === 'acrylic' ? 'felt' : m) as 'felt'
    this.fixedCollider(RAPIER.ColliderDesc.cuboid(this.num('thickness') / 2, h, this.num('width') / 2), c, rot, 'wall', mat)
  }
  bounds() { return boxBounds(this, this.num('thickness') / 2 + 0.1, this.num('height') / 2, this.num('width') / 2, 0, this.num('height') / 2, 0) }
}
