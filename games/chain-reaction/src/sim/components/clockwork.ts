import { boxBounds, Component, type ParamDef } from '../component'
import type { ComponentSpec } from '../schema'
import { qAxisAngle, qMul, qRotate } from '../math'
import { RAPIER, type RigidBody } from '../physics'
import type { Rotor } from '../mechanics'

export const MOTOR_PARAMS: ParamDef[] = [
  { key: 'rpm', label: 'Speed (rpm)', type: 'number', min: 1, max: 240, step: 1, default: 40 },
  { key: 'spinup', label: 'Spin-up (s)', type: 'number', min: 0.05, max: 5, step: 0.05, default: 1.2 },
  { key: 'teeth', label: 'Pinion teeth', type: 'number', min: 6, max: 40, step: 1, default: 12 },
  { key: 'module', label: 'Tooth module', type: 'number', min: 0.02, max: 0.12, step: 0.005, default: 0.06 },
  { key: 'reverse', label: 'Reverse', type: 'boolean', default: false },
  { key: 'runOnStart', label: 'Run on START', type: 'boolean', default: false },
]

/**
 * ELECTRIC MOTOR — the only thing in the clockwork that injects energy. It does nothing until
 * its "start" input fires; then it ramps to speed with a first-order lag. Its pinion meshes with
 * any gear placed at the right centre distance. Origin = pinion centre, axle along local z.
 */
export class Motor extends Component {
  readonly drive = 'motor' as const
  rotor!: Rotor
  running = false
  speed = 0
  pinion!: RigidBody

  constructor(spec: ComponentSpec) {
    super(spec, MOTOR_PARAMS)
    this.signalInputs.push('start', 'stop', 'toggle')
    this.signalOutputs.push('running')
  }

  get target() { return (this.num('rpm') * Math.PI * 2) / 60 * (this.bool('reverse') ? -1 : 1) }

  build() {
    const teeth = Math.round(this.num('teeth'))
    this.rotor = {
      key: `${this.id}:pinion`, comp: this, center: this.origin, axis: qRotate(this.q, { x: 0, y: 0, z: 1 }),
      layers: [{ offset: 0, teeth, radius: (this.num('module') * teeth) / 2 }],
      drive: () => this.speed, omega: 0, angle: 0, phase: 0, powered: false,
    }
    // motor housing behind the pinion
    this.fixedCollider(RAPIER.ColliderDesc.cuboid(0.32, 0.32, 0.3), { x: 0, y: 0, z: -0.42 }, null, 'housing', 'iron')
    this.pinion = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.origin.x, this.origin.y, this.origin.z).setRotation(this.q))
    this.sim.physics.collider(RAPIER.ColliderDesc.cylinder(0.06, this.rotor.layers[0].radius).setRotation(qAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2)), this.pinion, this.owner('pinion', 'brass'))
    this.bodies.push(this.pinion)
    this.waitingFor = 'no start signal reached the motor'
  }

  rotors() { return [this.rotor] }

  arm() {
    super.arm()
    if (this.bool('runOnStart')) this.receive('start')
  }

  receive(input: string) {
    if (input === 'start' || (input === 'toggle' && !this.running)) {
      if (this.running) return
      this.running = true
      this.setStatus('ACTIVATED')
      this.emit('running')
    } else if (input === 'stop' || input === 'toggle') {
      this.running = false
      this.setStatus('COMPLETED')
    }
  }

  preStep(dt: number) {
    const goal = this.running ? this.target : 0
    const k = 1 - Math.exp(-dt / (this.num('spinup') / 3))
    this.speed += (goal - this.speed) * k
    if (Math.abs(this.speed - goal) < 1e-4) this.speed = goal
    if (this.status === 'ACTIVATED' && Math.abs(this.speed) > Math.abs(this.target) * 0.9) this.setStatus('RUNNING')
    this.pinion.setNextKinematicRotation(qMul(this.q, qAxisAngle({ x: 0, y: 0, z: 1 }, this.rotor.angle)))
  }

  progress() { return `${((this.speed * 60) / (Math.PI * 2)).toFixed(0)} rpm` }
  saveExtra() { return [this.running ? 1 : 0, this.speed, this.rotor.angle] }
  loadExtra(s: number[]) { this.running = s[0] === 1; this.speed = s[1]; this.rotor.angle = s[2] }
  bounds() { return boxBounds(this, 0.4, 0.4, 0.5, 0, 0, -0.3) }
}

// ---------------------------------------------------------------------------------------------

export const GEAR_PARAMS: ParamDef[] = [
  { key: 'teeth', label: 'Teeth', type: 'number', min: 8, max: 120, step: 1, default: 36 },
  { key: 'module', label: 'Tooth module', type: 'number', min: 0.02, max: 0.12, step: 0.005, default: 0.06 },
  { key: 'thickness', label: 'Thickness', type: 'number', min: 0.04, max: 0.4, step: 0.01, default: 0.12 },
  { key: 'pinion', label: 'Coaxial pinion teeth (0 = none)', type: 'number', min: 0, max: 60, step: 1, default: 0 },
  { key: 'pinionOffset', label: 'Pinion offset', type: 'number', min: -0.6, max: 0.6, step: 0.01, default: 0.16 },
  { key: 'style', label: 'Style', type: 'select', options: ['spoked', 'solid', 'ring'], default: 'spoked' },
]

/**
 * GEAR — a kinematic body turned by the transmission solver. Meshing is detected from geometry
 * (centre distance = sum of pitch radii in the same plane) so the speed ratio and the reversed
 * sense follow from tooth counts, not from a script. Origin = hub, axle along local z.
 */
export class Gear extends Component {
  readonly drive = 'motor' as const
  rotor!: Rotor
  body!: RigidBody

  constructor(spec: ComponentSpec) {
    super(spec, GEAR_PARAMS)
  }

  get radius() { return (this.num('module') * this.num('teeth')) / 2 }
  get pinionRadius() { return (this.num('module') * this.num('pinion')) / 2 }

  build() {
    const teeth = Math.round(this.num('teeth'))
    const layers = [{ offset: 0, teeth, radius: this.radius }]
    const pt = Math.round(this.num('pinion'))
    if (pt > 0) layers.push({ offset: this.num('pinionOffset'), teeth: pt, radius: this.pinionRadius })
    this.rotor = { key: `${this.id}:gear`, comp: this, center: this.origin, axis: qRotate(this.q, { x: 0, y: 0, z: 1 }), layers, omega: 0, angle: 0, phase: 0, powered: false }
    this.body = this.sim.physics.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.origin.x, this.origin.y, this.origin.z).setRotation(this.q))
    const lie = qAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2)
    this.sim.physics.collider(RAPIER.ColliderDesc.cylinder(this.num('thickness') / 2, this.radius * 0.96).setRotation(lie), this.body, this.owner('gear', 'brass'))
    this.bodies.push(this.body)
    this.waitingFor = 'the gear train is not powered'
  }

  rotors() { return [this.rotor] }

  preStep() {
    this.body.setNextKinematicRotation(qMul(this.q, qAxisAngle({ x: 0, y: 0, z: 1 }, this.rotor.angle + this.rotor.phase)))
  }

  postStep() {
    if (this.status === 'ARMED' && this.rotor.powered && Math.abs(this.rotor.omega) > 0.02) this.setStatus('RUNNING')
  }

  progress() { return `${((this.rotor.omega * 60) / (Math.PI * 2)).toFixed(1)} rpm` }
  saveExtra() { return [this.rotor.angle] }
  loadExtra(s: number[]) { this.rotor.angle = s[0] }
  bounds() { const r = this.radius + 0.1; return boxBounds(this, r, r, 0.3) }
}
