import { boxBounds, Component, type ParamDef } from '../component'
import type { ComponentSpec } from '../schema'
import { qAxisAngle, qMul, qRotate, twistAngle, type Q4, type V3 } from '../math'
import { RAPIER, type RigidBody } from '../physics'

export const LEVER_PARAMS: ParamDef[] = [
  { key: 'length', label: 'Beam length', type: 'number', min: 0.8, max: 5, step: 0.05, default: 2.2 },
  { key: 'pivot', label: 'Pivot height', type: 'number', min: 0.15, max: 2, step: 0.01, default: 0.42 },
  { key: 'ratio', label: 'Pivot position', type: 'number', min: 0.2, max: 0.8, step: 0.01, default: 0.5 },
  { key: 'weight', label: 'Output weight (kg)', type: 'number', min: 0, max: 6, step: 0.05, default: 0.5 },
  { key: 'rest', label: 'Rest tilt (deg)', type: 'number', min: 2, max: 35, step: 0.5, default: 14 },
  { key: 'trip', label: 'Trip angle (deg)', type: 'number', min: 2, max: 40, step: 0.5, default: 12 },
]

/**
 * LEVER — a beam on a real revolute joint. The output end is weighted so it rests on a stop
 * with the input end raised. Pushing the input end down swings the output end up (into a button,
 * a ball, a latch...). Origin = floor point under the pivot, beam along local x, input at −x.
 */
export class Lever extends Component {
  readonly drive = 'physical' as const
  beam!: RigidBody
  rest!: Q4
  angle = 0
  maxAngle = 0

  constructor(spec: ComponentSpec) {
    super(spec, LEVER_PARAMS)
    this.signalOutputs.push('tipped')
  }

  get restRad() { return (this.num('rest') * Math.PI) / 180 }

  build() {
    const L = this.num('length')
    const h = this.num('pivot')
    const r = this.num('ratio')
    // the beam rotates about local z; positive rest tilt lifts the input (−x) end
    const tilt = qAxisAngle({ x: 0, y: 0, z: 1 }, -this.restRad)
    this.rest = qMul(this.q, tilt)
    const pivotW = this.w(0, h, 0)
    this.beam = this.sim.physics.body(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pivotW.x, pivotW.y, pivotW.z).setRotation(this.rest).setCanSleep(true).setSleeping(true).setAngularDamping(0.15),
    )
    // beam centre is offset so that `ratio` of its length lies on the input side
    const cx = L * (0.5 - r)
    this.sim.physics.collider(
      RAPIER.ColliderDesc.cuboid(L / 2, 0.04, 0.16).setTranslation(cx, 0, 0).setMass(1.2).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.beam,
      this.owner('beam', 'wood'),
    )
    // input striker plate (wide, so a falling domino can't miss it)
    this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.18, 0.05, 0.28).setTranslation(-L * r + 0.18, 0.06, 0).setMass(0.2), this.beam, this.owner('striker', 'wood'))
    // output weight / hammer head
    const w = this.num('weight')
    if (w > 0) this.sim.physics.collider(RAPIER.ColliderDesc.cuboid(0.1, 0.09, 0.14).setTranslation(L * (1 - r) - 0.1, 0.1, 0).setMass(w), this.beam, this.owner('hammer', 'iron'))
    const joint = this.sim.physics.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: h, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      this.fixedBody,
      this.beam,
      true,
    ) as RAPIER.RevoluteImpulseJoint
    joint.setLimits(-this.restRad - 0.02, 0.75)
    // pivot post + stop under the output end
    this.fixedCollider(RAPIER.ColliderDesc.cuboid(0.06, h / 2 - 0.05, 0.08), { x: 0, y: h / 2 - 0.05, z: -0.26 }, null, 'post', 'iron')
    this.bodies.push(this.beam)
    this.waitingFor = 'nothing pushed the input end down'
  }

  postStep() {
    if (this.status === 'IDLE') return
    // positive = input end pushed down from rest
    this.angle = twistAngle(this.rest, this.beam.rotation(), qRotate(this.q, { x: 0, y: 0, z: 1 }))
    this.maxAngle = Math.max(this.maxAngle, this.angle)
    if (this.status === 'ARMED' && this.angle > 0.03) this.setStatus('ACTIVATED')
    if (this.status === 'ACTIVATED' && this.angle > (this.num('trip') * Math.PI) / 180) {
      this.setStatus('COMPLETED')
      this.emit('tipped')
    }
  }

  progress() { return `${((this.angle * 180) / Math.PI).toFixed(1)}°` }
  saveExtra() { return [this.angle, this.maxAngle] }
  loadExtra(s: number[]) { this.angle = s[0]; this.maxAngle = s[1] }
  bounds() { return boxBounds(this, this.num('length') / 2 + 0.2, this.num('pivot') / 2 + 0.5, 0.35, 0, this.num('pivot') / 2 + 0.2, 0) }
}

// ---------------------------------------------------------------------------------------------

export const BUTTON_PARAMS: ParamDef[] = [
  { key: 'facing', label: 'Facing', type: 'select', options: ['up', 'down'], default: 'down' },
  { key: 'travel', label: 'Travel', type: 'number', min: 0.02, max: 0.2, step: 0.005, default: 0.07 },
  { key: 'threshold', label: 'Trip at (× travel)', type: 'number', min: 0.2, max: 0.95, step: 0.05, default: 0.5 },
  { key: 'size', label: 'Cap size', type: 'number', min: 0.08, max: 0.6, step: 0.01, default: 0.26 },
]

/**
 * PUSH BUTTON — a sprung cap on a prismatic joint. It only fires when something physically
 * pushes the cap past its trip depth. Origin = centre of the housing face.
 */
export class Button extends Component {
  readonly drive = 'sensor' as const
  cap!: RigidBody
  depth = 0
  private dir = 1
  private restPos!: V3

  constructor(spec: ComponentSpec) {
    super(spec, BUTTON_PARAMS)
    this.signalOutputs.push('pressed')
  }

  build() {
    const s = this.num('size') / 2
    const travel = this.num('travel')
    // facing down: cap hangs below the housing and is pushed upward (+y)
    this.dir = this.str('facing') === 'down' ? 1 : -1
    const capLocal = { x: 0, y: -this.dir * (0.05 + travel * 0.5), z: 0 }
    this.restPos = this.w(capLocal.x, capLocal.y, capLocal.z)
    this.cap = this.sim.physics.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(this.restPos.x, this.restPos.y, this.restPos.z).setRotation(this.q).setCanSleep(true))
    this.sim.physics.collider(RAPIER.ColliderDesc.cylinder(0.05, s).setMass(0.12), this.cap, this.owner('cap', 'brass'))
    const j = this.sim.physics.world.createImpulseJoint(
      RAPIER.JointData.prismatic(capLocal, { x: 0, y: 0, z: 0 }, { x: 0, y: this.dir, z: 0 }),
      this.fixedBody,
      this.cap,
      true,
    ) as RAPIER.PrismaticImpulseJoint
    j.setLimits(0, travel)
    j.configureMotorPosition(0, 60, 2)
    // housing
    this.fixedCollider(RAPIER.ColliderDesc.cuboid(s + 0.06, 0.05, s + 0.06), { x: 0, y: this.dir * 0.05, z: 0 }, null, 'housing', 'iron')
    this.bodies.push(this.cap)
    this.waitingFor = 'nothing pressed the button'
  }

  postStep() {
    if (this.status === 'IDLE') return
    const t = this.cap.translation()
    const d = { x: t.x - this.restPos.x, y: t.y - this.restPos.y, z: t.z - this.restPos.z }
    this.depth = Math.max(0, this.dir * (d.y))
    if (this.status === 'ARMED' && this.depth > this.num('threshold') * this.num('travel')) {
      this.setStatus('ACTIVATED')
      this.emit('pressed')
    } else if (this.status === 'ACTIVATED' && this.sim.time - this.statusTime > 0.4) this.setStatus('COMPLETED')
  }

  progress() { return `${(this.depth * 1000).toFixed(0)} mm` }
  saveExtra() { return [this.depth] }
  loadExtra(s: number[]) { this.depth = s[0] }
  bounds() { const s = this.num('size') / 2 + 0.1; return boxBounds(this, s, 0.2, s) }
}
