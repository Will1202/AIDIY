import type { ComponentSpec, ComponentType, Params } from './schema'
import { add, qMul, qRotate, qYaw, type Q4, type V3 } from './math'
import { RAPIER, type Collider, type ColliderOwner, type MaterialName, type RigidBody } from './physics'
import type { Simulation } from './simulation'
import type { Rotor } from './mechanics'

export type Status = 'IDLE' | 'ARMED' | 'ACTIVATED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
export const STATUSES: Status[] = ['IDLE', 'ARMED', 'ACTIVATED', 'RUNNING', 'COMPLETED', 'FAILED']

/** How a component starts moving — shown in the HUD and checked by the validator. */
export type DriveKind = 'physical' | 'motor' | 'sensor' | 'passive'

/** A connection point for the editor's snap system (world space). */
export interface Port {
  name: string
  kind: 'in' | 'out'
  pos: V3
  /** direction the marble travels through the port (unit, horizontal-ish) */
  dir: V3
}

export interface ParamDef {
  key: string
  label: string
  type: 'number' | 'boolean' | 'select'
  min?: number
  max?: number
  step?: number
  options?: string[]
  default: number | boolean | string
  /** only relevant for some configurations (editor hides it otherwise) */
  when?: (p: Params) => boolean
}

/** Everything a machine part needs: physical build, state machine, ports, save / restore. */
export abstract class Component {
  readonly id: string
  readonly type: ComponentType
  readonly spec: ComponentSpec
  readonly p: Params
  readonly origin: V3
  readonly yaw: number
  readonly q: Q4
  status: Status = 'IDLE'
  statusTime = 0
  /** non-fixed bodies, recorded for rewind and restored on reset */
  readonly bodies: RigidBody[] = []
  /** the static body holding this component's fixed colliders */
  fixedBody!: RigidBody
  readonly signalInputs: string[] = []
  readonly signalOutputs: string[] = []
  abstract readonly drive: DriveKind
  /** short human sentence of what the component is waiting for (failure reasons) */
  waitingFor = ''
  failure = ''
  sim!: Simulation

  constructor(spec: ComponentSpec, defs: ParamDef[]) {
    this.id = spec.id
    this.type = spec.type
    this.spec = spec
    const p: Params = {}
    for (const d of defs) p[d.key] = d.default
    Object.assign(p, spec.params)
    this.p = p
    this.origin = { x: spec.pos[0], y: spec.pos[1], z: spec.pos[2] }
    this.yaw = spec.rot
    this.q = qYaw(spec.rot)
  }

  num(k: string): number { return Number(this.p[k]) }
  bool(k: string): boolean { return this.p[k] === true || this.p[k] === 'true' }
  str(k: string): string { return String(this.p[k]) }

  /** local (component) point → world */
  w(x: number, y: number, z: number): V3 {
    return add(this.origin, qRotate(this.q, { x, y, z }))
  }
  /** local direction → world */
  wd(x: number, y: number, z: number): V3 {
    return qRotate(this.q, { x, y, z })
  }

  // ---- building helpers -------------------------------------------------
  owner(part: string, material: MaterialName): ColliderOwner {
    return { comp: this.id, part, material }
  }
  /** attach a collider to this component's fixed body (which sits at the component origin, rotated by yaw) */
  fixedCollider(desc: RAPIER.ColliderDesc, local: V3, localRot: Q4 | null, part: string, material: MaterialName): Collider {
    desc.setTranslation(local.x, local.y, local.z)
    if (localRot) desc.setRotation(localRot)
    return this.sim.physics.collider(desc, this.fixedBody, this.owner(part, material))
  }
  /** world rotation of a local rotation */
  wq(local: Q4): Q4 {
    return qMul(this.q, local)
  }

  setStatus(s: Status) {
    if (this.status === s) return
    this.status = s
    this.statusTime = this.sim.time
    this.sim.onStatus(this, s)
  }
  emit(output: string) {
    this.sim.emit(this, output)
  }

  abstract build(): void
  /** called when the simulation starts */
  arm() { this.setStatus('ARMED') }
  /** signal input from the trigger graph */
  receive(_input: string) {}
  /** before the physics step: kinematic targets, forces */
  preStep(_dt: number) {}
  /** after the physics step: sensors and state transitions */
  postStep(_dt: number) {}
  /** extra numeric state for rewind (besides bodies) */
  saveExtra(): number[] { return [] }
  loadExtra(_s: number[]) {}
  ports(): Port[] { return [] }
  rotors(): Rotor[] { return [] }
  /** progress text shown in the trace, e.g. "23 / 40 fallen" */
  progress(): string { return '' }
  /** true when this component is still moving / working (used by the stall watchdog) */
  busy(): boolean { return false }
  /** rough world AABB for validation and camera framing */
  abstract bounds(): { min: V3; max: V3 }

  saveState(): number[] {
    return [STATUSES.indexOf(this.status), this.statusTime, ...this.saveExtra()]
  }
  loadState(s: number[]) {
    this.status = STATUSES[s[0]] ?? 'IDLE'
    this.statusTime = s[1]
    this.loadExtra(s.slice(2))
  }
}

export function boxBounds(c: Component, hx: number, hy: number, hz: number, cx = 0, cy = 0, cz = 0) {
  const pts: V3[] = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(c.w(cx + sx * hx, cy + sy * hy, cz + sz * hz))
  return aabb(pts)
}
export function aabb(pts: V3[]) {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of pts) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z)
  }
  return { min, max }
}

export type ComponentCtor = new (spec: ComponentSpec) => Component
