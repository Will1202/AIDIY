import { boxBounds, Component, type ParamDef, type Port } from '../component'
import type { ComponentSpec } from '../schema'
import { qAxisAngle, qConj, qMul, qRotate, sub, type Q4, type V3 } from '../math'
import { RAPIER, type RigidBody } from '../physics'
import type { Rotor } from '../mechanics'
import { MARBLE_R } from './rails'

export const CONVEYOR_PARAMS: ParamDef[] = [
  { key: 'length', label: 'Length', type: 'number', min: 1, max: 14, step: 0.1, default: 5 },
  { key: 'incline', label: 'Incline (deg)', type: 'number', min: -20, max: 30, step: 0.5, default: 8 },
  { key: 'width', label: 'Belt width', type: 'number', min: 0.3, max: 1.2, step: 0.02, default: 0.5 },
  { key: 'drum', label: 'Drum radius', type: 'number', min: 0.1, max: 0.4, step: 0.01, default: 0.16 },
  { key: 'pitch', label: 'Slat pitch', type: 'number', min: 0.12, max: 0.4, step: 0.01, default: 0.2 },
  { key: 'cleatEvery', label: 'Cleat every N slats', type: 'number', min: 0, max: 8, step: 1, default: 3 },
  { key: 'reverse', label: 'Reverse', type: 'boolean', default: false },
  { key: 'selfRpm', label: 'Own motor rpm (0 = chain-driven)', type: 'number', min: 0, max: 120, step: 1, default: 0 },
]

interface Slat { body: RigidBody; cleat: boolean }

/**
 * CONVEYOR — a closed loop of kinematic slats travelling round two drums. Objects move because the
 * slats move under them (friction and cleats), not because a texture scrolls. The drum is a rotor:
 * it can be chain-driven from the clockwork or run on its own motor ("start" / "stop").
 * Origin = top of the belt above the tail drum; the belt runs along local +x, rising by the incline.
 */
export class Conveyor extends Component {
  readonly drive = 'motor' as const
  rotor!: Rotor
  slats: Slat[] = []
  /** belt travel (m) */
  travel = 0
  ownRunning = false
  ownSpeed = 0
  private loop = 0

  constructor(spec: ComponentSpec) {
    super(spec, CONVEYOR_PARAMS)
    this.signalInputs.push('start', 'stop')
  }

  get L() { return this.num('length') }
  get R() { return this.num('drum') }
  /** belt frame: component yaw, then the incline about local z */
  get frame(): Q4 { return qMul(this.q, qAxisAngle({ x: 0, y: 0, z: 1 }, (this.num('incline') * Math.PI) / 180)) }

  build() {
    const inc = (this.num('incline') * Math.PI) / 180
    const L = this.L
    const R = this.R
    this.loop = 2 * L + 2 * Math.PI * R
    const pitch = this.num('pitch')
    const n = Math.floor(this.loop / pitch)
    const ce = Math.round(this.num('cleatEvery'))
    const W = this.num('width')
    for (let i = 0; i < n; i++) {
      const cleat = ce > 0 && i % ce === 0
      const body = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased())
      this.sim.physics.collider(RAPIER.ColliderDesc.cuboid((pitch / 2) * 0.92, 0.02, W / 2).setTranslation(0, -0.02, 0), body, this.owner('slat', 'rubber'))
      if (cleat) this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.018, 0.06, W / 2 - 0.02).setTranslation(-pitch * 0.3, 0.06, 0), body, this.owner('cleat', 'rubber'))
      this.slats.push({ body, cleat })
      this.bodies.push(body)
    }
    this.placeSlats(true)
    // side guards along the top run (belt frame)
    const g = W / 2 + 0.03
    for (const side of [-1, 1]) {
      const c = qRotate(qAxisAngle({ x: 0, y: 0, z: 1 }, inc), { x: L / 2, y: 0.14, z: side * g })
      this.fixedCollider(RAPIER.ColliderDesc.cuboid(L / 2 + R, 0.14, 0.025), c, qAxisAngle({ x: 0, y: 0, z: 1 }, inc), 'guard', 'iron')
    }
    // the head drum is the driven rotor (axle along local z)
    const head = this.beltToWorld(L, -R)
    this.rotor = { key: `${this.id}:drum`, comp: this, center: head, axis: qRotate(this.q, { x: 0, y: 0, z: 1 }), layers: [], omega: 0, angle: 0, phase: 0, powered: false }
    if (this.num('selfRpm') > 0) this.rotor.drive = () => this.ownSpeed
    this.waitingFor = this.num('selfRpm') > 0 ? 'its motor never got a start signal' : 'no drive chain is turning the drum'
  }

  rotors() { return [this.rotor] }

  receive(input: string) {
    if (input === 'start') { this.ownRunning = true; if (this.status === 'ARMED') this.setStatus('ACTIVATED') }
    if (input === 'stop') this.ownRunning = false
  }

  /** belt-local (x along belt, y normal) → world */
  beltToWorld(x: number, y: number, z = 0): V3 {
    const p = qRotate(this.frame, { x, y, z })
    return { x: this.origin.x + p.x, y: this.origin.y + p.y, z: this.origin.z + p.z }
  }

  /** position + heading angle (about belt z) of arc-length s on the loop */
  loopPose(s: number): { x: number; y: number; a: number } {
    const L = this.L
    const R = this.R
    s = ((s % this.loop) + this.loop) % this.loop
    if (s < L) return { x: s, y: 0, a: 0 }
    s -= L
    if (s < Math.PI * R) {
      const t = s / R
      return { x: L + R * Math.sin(t), y: -R + R * Math.cos(t), a: -t }
    }
    s -= Math.PI * R
    if (s < L) return { x: L - s, y: -2 * R, a: -Math.PI }
    s -= L
    const t = s / R
    return { x: -R * Math.sin(t), y: -R - R * Math.cos(t), a: -Math.PI - t }
  }

  private placeSlats(teleport: boolean) {
    const pitch = this.num('pitch')
    for (let i = 0; i < this.slats.length; i++) {
      const pose = this.loopPose(i * pitch + this.travel)
      const pos = this.beltToWorld(pose.x, pose.y)
      const rot = qMul(this.frame, qAxisAngle({ x: 0, y: 0, z: 1 }, pose.a))
      const b = this.slats[i].body
      if (teleport) {
        b.setTranslation(pos, false)
        b.setRotation(rot, false)
      } else {
        b.setNextKinematicTranslation(pos)
        b.setNextKinematicRotation(rot)
      }
    }
  }

  preStep(dt: number) {
    if (this.num('selfRpm') > 0) {
      const goal = this.ownRunning ? -(this.num('selfRpm') * Math.PI * 2) / 60 : 0
      this.ownSpeed += (goal - this.ownSpeed) * (1 - Math.exp(-dt * 3))
    }
    // a drum turning clockwise seen from +z (ω < 0) drives the top run towards +x
    const v = -this.rotor.omega * this.R * (this.bool('reverse') ? -1 : 1)
    this.travel += v * dt
    this.placeSlats(false)
  }

  postStep() {
    const moving = Math.abs(this.rotor.omega) > 0.05
    if ((this.status === 'ARMED' || this.status === 'ACTIVATED') && moving) this.setStatus('RUNNING')
  }

  progress() { return `${(-this.rotor.omega * this.R).toFixed(2)} m/s` }
  saveExtra() { return [this.travel, this.ownRunning ? 1 : 0, this.ownSpeed, this.rotor.angle] }
  loadExtra(s: number[]) {
    this.travel = s[0]; this.ownRunning = s[1] === 1; this.ownSpeed = s[2]; this.rotor.angle = s[3]
  }

  ports(): Port[] {
    const d = qRotate(this.frame, { x: 1, y: 0, z: 0 })
    return [
      { name: 'in', kind: 'in', pos: this.beltToWorld(0.3, MARBLE_R), dir: d },
      { name: 'out', kind: 'out', pos: this.beltToWorld(this.L + this.R, MARBLE_R), dir: d },
    ]
  }

  bounds() {
    const inc = (this.num('incline') * Math.PI) / 180
    return boxBounds(this, this.L / 2 + this.R + 0.1, Math.abs(Math.sin(inc)) * this.L / 2 + 0.4, this.num('width') / 2 + 0.1, this.L / 2, Math.sin(inc) * this.L / 2 - 0.1, 0)
  }
}

// ---------------------------------------------------------------------------------------------

export const TURNTABLE_PARAMS: ParamDef[] = [
  { key: 'radius', label: 'Radius', type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1.1 },
  { key: 'paddles', label: 'Paddles', type: 'number', min: 1, max: 8, step: 1, default: 4 },
  { key: 'fence', label: 'Fence height', type: 'number', min: 0.15, max: 0.6, step: 0.01, default: 0.34 },
  { key: 'gapAt', label: 'Exit gap at (deg)', type: 'number', min: -180, max: 180, step: 5, default: 0 },
  { key: 'gapWidth', label: 'Exit gap width (deg)', type: 'number', min: 18, max: 90, step: 1, default: 30 },
  { key: 'sweep', label: 'Paddle sweep (deg)', type: 'number', min: 0, max: 60, step: 1, default: 35 },
  { key: 'reverse', label: 'Reverse', type: 'boolean', default: false },
  { key: 'selfRpm', label: 'Own motor rpm (0 = chain-driven)', type: 'number', min: 0, max: 90, step: 1, default: 0 },
]

/**
 * ROTATING PLATFORM — a kinematic disc with radial paddles inside a fixed fence. A ball that drops
 * in is swept round and pressed outward against the fence until it reaches the exit gap, where it
 * leaves tangentially. Origin = centre of the disc top; axle = +y.
 */
export class Turntable extends Component {
  readonly drive = 'motor' as const
  rotor!: Rotor
  disc!: RigidBody
  ejected = 0
  private inside = new Set<number>()
  ownRunning = false
  ownSpeed = 0

  constructor(spec: ComponentSpec) {
    super(spec, TURNTABLE_PARAMS)
    this.signalInputs.push('start', 'stop')
    this.signalOutputs.push('ejected')
  }

  get R() { return this.num('radius') }

  build() {
    const R = this.R
    this.disc = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.origin.x, this.origin.y, this.origin.z).setRotation(this.q))
    this.sim.physics.collider(RAPIER.ColliderDesc.cylinder(0.05, R).setTranslation(0, -0.05, 0), this.disc, this.owner('disc', 'brass'))
    const n = Math.round(this.num('paddles'))
    // swept-back vanes (like a centrifugal impeller) push a marble outward to the fence
    const sweep = (this.num('sweep') * Math.PI) / 180 * this.sense
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      for (const [r0, r1, da] of [[0.22, R * 0.58, 0], [R * 0.56, R - 0.07, -sweep]] as const) {
        const mid = (r0 + r1) / 2
        // second half of each vane trails behind the direction of rotation
        const ang = a + da * 0.5
        const cx = Math.cos(a) * (r0 + 0.01) + Math.cos(a + da) * (mid - r0)
        const cz = -Math.sin(a) * (r0 + 0.01) - Math.sin(a + da) * (mid - r0)
        this.sim.physics.collider(
          RAPIER.ColliderDesc.cuboid((r1 - r0) / 2 + 0.02, 0.12, 0.03).setTranslation(da ? cx : Math.cos(a) * mid, 0.12, da ? cz : -Math.sin(a) * mid).setRotation(qAxisAngle({ x: 0, y: 1, z: 0 }, da ? a + da : a)),
          this.disc,
          this.owner('paddle', 'brass'),
        )
        void ang
      }
    }
    // hub
    this.sim.physics.collider(RAPIER.ColliderDesc.cylinder(0.16, 0.22).setTranslation(0, 0.16, 0), this.disc, this.owner('hub', 'brass'))
    this.bodies.push(this.disc)
    // fixed fence: segments round the rim, except the exit gap
    const fh = this.num('fence')
    const gapAt = (this.num('gapAt') * Math.PI) / 180
    const gapW = (this.num('gapWidth') * Math.PI) / 180
    const segs = 40
    const rf = R + 0.04
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const da = Math.atan2(Math.sin(a - gapAt), Math.cos(a - gapAt))
      if (Math.abs(da) < gapW / 2) continue
      const segLen = (2 * Math.PI * rf) / segs
      this.fixedCollider(
        RAPIER.ColliderDesc.cuboid(0.025, fh / 2, segLen / 2 + 0.01),
        { x: Math.cos(a) * rf, y: fh / 2 - 0.08, z: -Math.sin(a) * rf },
        qAxisAngle({ x: 0, y: 1, z: 0 }, a),
        'fence',
        'iron',
      )
    }
    this.rotor = { key: `${this.id}:table`, comp: this, center: this.origin, axis: qRotate(this.q, { x: 0, y: 1, z: 0 }), layers: [], omega: 0, angle: 0, phase: 0, powered: false }
    if (this.num('selfRpm') > 0) this.rotor.drive = () => this.ownSpeed
    this.waitingFor = 'the platform is not turning or no ball reached it'
  }

  rotors() { return [this.rotor] }

  receive(input: string) {
    if (input === 'start') this.ownRunning = true
    if (input === 'stop') this.ownRunning = false
  }

  get sense() { return this.bool('reverse') ? -1 : 1 }

  preStep(dt: number) {
    if (this.num('selfRpm') > 0) {
      const goal = this.ownRunning ? (this.num('selfRpm') * Math.PI * 2) / 60 : 0
      this.ownSpeed += (goal - this.ownSpeed) * (1 - Math.exp(-dt * 3))
    }
    this.disc.setNextKinematicRotation(qMul(this.q, qAxisAngle({ x: 0, y: 1, z: 0 }, this.rotor.angle * this.sense)))
  }

  postStep() {
    if (this.status === 'IDLE') return
    if (this.status === 'ARMED' && Math.abs(this.rotor.omega) > 0.05) this.setStatus('RUNNING')
    // count balls that pass out through the gap
    const iq = qConj(this.q)
    for (const m of this.sim.marbles()) {
      const t = m.body.translation()
      const l = qRotate(iq, sub(t, this.origin))
      const r = Math.hypot(l.x, l.z)
      const h = m.body.handle
      if (r < this.R && l.y > -0.1 && l.y < 0.6) this.inside.add(h)
      else if (this.inside.has(h) && r > this.R + 0.12) {
        this.inside.delete(h)
        this.ejected++
        this.emit('ejected')
      }
    }
  }

  progress() { return `${this.ejected} ejected · ${((this.rotor.omega * 60) / (Math.PI * 2)).toFixed(0)} rpm` }
  saveExtra() { return [this.ejected, this.rotor.angle, this.ownRunning ? 1 : 0, this.ownSpeed, ...this.inside] }
  loadExtra(s: number[]) {
    this.ejected = s[0]; this.rotor.angle = s[1]; this.ownRunning = s[2] === 1; this.ownSpeed = s[3]
    this.inside = new Set(s.slice(4))
  }

  ports(): Port[] {
    const g = (this.num('gapAt') * Math.PI) / 180
    const tangent = this.wd(-Math.sin(g) * this.sense, 0, -Math.cos(g) * this.sense)
    return [{ name: 'out', kind: 'out', pos: this.w(Math.cos(g) * (this.R + 0.2), MARBLE_R, -Math.sin(g) * (this.R + 0.2)), dir: tangent }]
  }

  bounds() { const r = this.R + 0.1; return boxBounds(this, r, 0.3, r, 0, 0.15, 0) }
}

// ---------------------------------------------------------------------------------------------

export const LIFT_PARAMS: ParamDef[] = [
  { key: 'height', label: 'Rise', type: 'number', min: 0.5, max: 30, step: 0.1, default: 6 },
  { key: 'speed', label: 'Top speed (m/s)', type: 'number', min: 0.3, max: 8, step: 0.1, default: 3 },
  { key: 'size', label: 'Car size', type: 'number', min: 0.5, max: 1.6, step: 0.02, default: 0.8 },
  { key: 'tilt', label: 'Floor tilt (deg)', type: 'number', min: 0, max: 12, step: 0.5, default: 4 },
  { key: 'auto', label: 'Start when loaded', type: 'boolean', default: true },
]

/**
 * MECHANICAL LIFT — a kinematic car on a guided shaft, driven by its own winch motor. With "auto"
 * it starts only after a marble has settled on the car floor (load sensor). At the top the exit
 * gate lifts and the tilted floor rolls the marble out along local +x. Origin = car floor centre at
 * the bottom stop.
 */
export class Lift extends Component {
  readonly drive = 'sensor' as const
  car!: RigidBody
  gate!: RigidBody
  /** 0..height */
  y = 0
  v = 0
  /** 0 closed → 1 open */
  gateOpen = 0
  state = 0 // 0 waiting, 1 rising, 2 at top (gate opening), 3 done
  private loadedFor = 0

  constructor(spec: ComponentSpec) {
    super(spec, LIFT_PARAMS)
    this.signalInputs.push('start')
    this.signalOutputs.push('arrived')
  }

  get H() { return this.num('height') }

  build() {
    const s = this.num('size') / 2
    const tilt = (this.num('tilt') * Math.PI) / 180
    this.car = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.origin.x, this.origin.y, this.origin.z).setRotation(this.q))
    // V-shaped floor: tilted towards the exit (+x) and towards the centre line, so the marble
    // always leaves the car centred on the exit track
    const vee = (9 * Math.PI) / 180
    for (const side of [-1, 1]) {
      const rot = qMul(qAxisAngle({ x: 0, y: 0, z: 1 }, -tilt), qAxisAngle({ x: 1, y: 0, z: 0 }, -side * vee))
      const c = qRotate(rot, { x: 0, y: -0.04, z: (side * s) / 2 })
      this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(s, 0.04, s / 2).setTranslation(c.x, c.y, c.z).setRotation(rot), this.car, this.owner('car', 'iron'))
    }
    // back and side walls; marbles are loaded from above, over the closed exit gate
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.03, 0.24, s).setTranslation(-s, 0.22, 0), this.car, this.owner('back', 'felt'))
    for (const z of [-1, 1]) this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(s, 0.22, 0.03).setTranslation(0, 0.2, z * s), this.car, this.owner('wall', 'iron'))
    this.gate = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...xyz(this.w(s, 0.2, 0))).setRotation(this.q))
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.03, 0.2, s), this.gate, this.owner('gate', 'felt'))
    this.bodies.push(this.car, this.gate)
    this.waitingFor = this.bool('auto') ? 'no marble arrived on the lift car' : 'no start signal reached the lift'
  }

  receive(input: string) {
    if (input === 'start' && this.state === 0) this.go()
  }

  private go() {
    this.state = 1
    this.setStatus('RUNNING')
  }

  /** marbles currently resting on the car */
  loaded(): boolean {
    const s = this.num('size') / 2
    const iq = qConj(this.q)
    const base = { x: this.origin.x, y: this.origin.y + this.y, z: this.origin.z }
    for (const m of this.sim.marbles()) {
      const l = qRotate(iq, sub(m.body.translation(), base))
      const v = m.body.linvel()
      if (Math.abs(l.x) < s && Math.abs(l.z) < s && l.y > 0 && l.y < 0.4 && Math.hypot(v.x, v.y - this.v, v.z) < 0.25) return true
    }
    return false
  }

  preStep(dt: number) {
    if (this.status === 'IDLE') return
    if (this.state === 0 && this.bool('auto')) {
      this.loadedFor = this.loaded() ? this.loadedFor + dt : 0
      if (this.loadedFor > 0.3) {
        this.setStatus('ACTIVATED')
        this.go()
      }
    }
    if (this.state === 1) {
      // trapezoidal winch profile: accelerate, cruise, brake into the top stop
      const vmax = this.num('speed')
      const a = 3.2
      const remaining = this.H - this.y
      const vBrake = Math.sqrt(2 * a * Math.max(0, remaining))
      const target = Math.min(vmax, vBrake)
      this.v = this.v < target ? Math.min(target, this.v + a * dt) : target
      this.y = Math.min(this.H, this.y + this.v * dt)
      if (this.H - this.y < 1e-3) {
        this.y = this.H
        this.v = 0
        this.state = 2
      }
    }
    if (this.state === 2) {
      this.gateOpen = Math.min(1, this.gateOpen + dt / 0.35)
      if (this.gateOpen >= 1) {
        this.state = 3
        this.setStatus('COMPLETED')
        this.emit('arrived')
      }
    }
    const s = this.num('size') / 2
    this.car.setNextKinematicTranslation(this.w(0, this.y, 0))
    const g = this.gateOpen * this.gateOpen * (3 - 2 * this.gateOpen)
    this.gate.setNextKinematicTranslation(this.w(s, this.y + 0.2 + g * 0.45, 0))
  }

  busy() { return this.state === 1 || this.state === 2 }
  progress() { return `${this.y.toFixed(1)} / ${this.H.toFixed(1)} m` }
  saveExtra() { return [this.y, this.v, this.gateOpen, this.state, this.loadedFor] }
  loadExtra(s: number[]) { [this.y, this.v, this.gateOpen, this.state, this.loadedFor] = s }

  ports(): Port[] {
    const s = this.num('size') / 2
    return [
      { name: 'in', kind: 'in', pos: this.w(-s - 0.1, MARBLE_R + 0.05, 0), dir: this.wd(1, 0, 0) },
      { name: 'out', kind: 'out', pos: this.w(s + 0.02, this.H + MARBLE_R - Math.tan((this.num('tilt') * Math.PI) / 180) * s, 0), dir: this.wd(1, 0, 0) },
    ]
  }

  bounds() { const s = this.num('size') / 2 + 0.15; return boxBounds(this, s, this.H / 2 + 0.5, s, 0, this.H / 2, 0) }
}

const xyz = (v: V3): [number, number, number] => [v.x, v.y, v.z]
