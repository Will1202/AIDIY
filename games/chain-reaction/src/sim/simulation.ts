import { DT, initRapier, Physics, RAPIER, type ImpactEvent, type RigidBody } from './physics'
import type { Component, Status } from './component'
import { MechanicalSystem } from './mechanics'
import type { ConnectionSpec, SceneSpec } from './schema'
import { createComponent } from './components'
import type { V3 } from './math'

export type SimPhase = 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface SimEvent {
  t: number
  type: 'status' | 'signal' | 'start' | 'complete' | 'fail'
  id?: string
  status?: Status
  output?: string
  to?: string
  input?: string
  text?: string
}

export interface SimOptions {
  /** seconds without any status change while every body rests before the run is declared failed */
  stallRest?: number
  /** hard limit without any status change, even if something keeps moving */
  stallHard?: number
}

/**
 * The whole machine: Rapier world, components, transmission and the trigger graph.
 * Pure TypeScript — rendering, audio and the camera only read from it.
 */
export class Simulation {
  readonly physics: Physics
  readonly components: Component[] = []
  readonly byId = new Map<string, Component>()
  readonly connections: ConnectionSpec[]
  readonly mech = new MechanicalSystem()
  readonly scene: SceneSpec
  readonly finalId?: string
  time = 0
  steps = 0
  phase: SimPhase = 'READY'
  readonly log: SimEvent[] = []
  /** impacts of the latest step (audio, camera shake, sparks) */
  impacts: ImpactEvent[] = []
  failReason = ''
  failedId = ''
  completeTime = -1
  private lastChange = 0
  private listeners: ((e: SimEvent) => void)[] = []
  private readonly opts: Required<SimOptions>
  /** every non-fixed body, in a stable order (recorder) */
  readonly bodies: RigidBody[] = []

  static async create(scene: SceneSpec, opts: SimOptions = {}) {
    await initRapier()
    return new Simulation(scene, opts)
  }

  /** call only after initRapier() resolved */
  constructor(scene: SceneSpec, opts: SimOptions = {}) {
    this.scene = scene
    this.opts = { stallRest: 5, stallHard: 30, ...opts }
    this.physics = new Physics()
    this.connections = scene.connections
    this.finalId = scene.finalId
    for (const spec of scene.components) {
      const c = createComponent(spec)
      if (!c) continue
      c.sim = this
      this.components.push(c)
      this.byId.set(c.id, c)
    }
    for (const c of this.components) {
      c.fixedBody = this.physics.body(RAPIER.RigidBodyDesc.fixed().setTranslation(c.origin.x, c.origin.y, c.origin.z).setRotation(c.q))
      c.build()
      this.bodies.push(...c.bodies)
    }
    this.mech.build(this.components.flatMap((c) => c.rotors()), this.connections, this.byId)
  }

  on(fn: (e: SimEvent) => void) {
    this.listeners.push(fn)
    return () => { this.listeners = this.listeners.filter((f) => f !== fn) }
  }
  private push(e: SimEvent) {
    this.log.push(e)
    for (const l of this.listeners) l(e)
  }

  get final(): Component | undefined {
    return this.finalId ? this.byId.get(this.finalId) : this.components.find((c) => c.type === 'final')
  }

  start() {
    if (this.phase !== 'READY') return
    this.phase = 'RUNNING'
    this.lastChange = this.time
    this.push({ t: this.time, type: 'start' })
    for (const c of this.components) c.arm()
    // virtual START source: wires from "@start" fire immediately
    for (const k of this.connections) {
      if (k.kind === 'signal' && k.from === '@start') this.deliver(k)
    }
  }

  /** one fixed physics step */
  step() {
    const dt = DT
    this.mech.update(dt)
    for (const c of this.components) c.preStep(dt)
    this.physics.beforeStep()
    this.physics.step()
    this.impacts = []
    this.physics.drainImpacts(0.35, this.impacts)
    this.time += dt
    this.steps++
    for (const c of this.components) c.postStep(dt)
    if (this.phase === 'RUNNING') this.watchdog()
  }

  emit(from: Component, output: string) {
    this.push({ t: this.time, type: 'signal', id: from.id, output })
    for (const k of this.connections) {
      if (k.kind === 'signal' && k.from === from.id && k.output === output) this.deliver(k)
    }
  }

  private deliver(k: ConnectionSpec) {
    const to = this.byId.get(k.to)
    if (!to) return
    this.push({ t: this.time, type: 'signal', id: k.from, output: k.output, to: k.to, input: k.input })
    to.receive(k.input)
  }

  onStatus(c: Component, s: Status) {
    this.lastChange = this.time
    this.push({ t: this.time, type: 'status', id: c.id, status: s })
    const fin = this.final
    if (fin && c === fin && (s === 'ACTIVATED' || s === 'RUNNING') && this.phase === 'RUNNING') {
      this.phase = 'COMPLETED'
      this.completeTime = this.time
      this.push({ t: this.time, type: 'complete', id: c.id, text: 'FINAL MACHINE ACTIVATED' })
    }
  }

  /** a body counts as moving when it is visibly travelling or spinning */
  anyMoving(): boolean {
    for (const b of this.bodies) {
      if (!b.isDynamic() || b.isSleeping()) continue
      const v = b.linvel()
      const w = b.angvel()
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.08 * 0.08 || w.x * w.x + w.y * w.y + w.z * w.z > 0.6 * 0.6) return true
    }
    return this.components.some((c) => c.busy())
  }

  private watchdog() {
    const idle = this.time - this.lastChange
    if ((idle > this.opts.stallRest && !this.anyMoving()) || idle > this.opts.stallHard) this.fail()
  }

  /** chain order = scene order: the first armed component after the last one that fired is blamed */
  private fail() {
    const fired = this.components.filter((c) => c.status !== 'ARMED' && c.status !== 'IDLE')
    const lastIdx = Math.max(-1, ...fired.map((c) => this.components.indexOf(c)))
    const last = lastIdx >= 0 ? this.components[lastIdx] : undefined
    const next = this.components.slice(lastIdx + 1).find((c) => c.status === 'ARMED' && c.drive !== 'passive')
      ?? this.components.find((c) => c.status === 'ARMED' && c.drive !== 'passive')
    const lost = this.components.filter((c) => c.type === 'marble' || c.type === 'hopper').map((c) => c.failure).filter(Boolean)
    const name = (c?: Component) => (c ? c.spec.label ?? `${c.type} ${c.id}` : '')
    let text = next
      ? `${name(next)} was never activated${next.waitingFor ? ` — ${next.waitingFor}` : ''}`
      : 'the machine stopped moving'
    if (last) text = `${name(last)} fired, but ${text}`
    if (lost.length) text += ` (${lost.join('; ')})`
    this.failReason = text
    this.failedId = next?.id ?? ''
    this.phase = 'FAILED'
    if (next) next.setStatus('FAILED')
    this.push({ t: this.time, type: 'fail', id: next?.id, text })
  }

  /** world-space position of tracked marbles (camera, HUD) */
  marbles(): { id: string; body: RigidBody }[] {
    const out: { id: string; body: RigidBody }[] = []
    for (const c of this.components) {
      const m = (c as unknown as { marbleBodies?: RigidBody[] }).marbleBodies
      if (m) m.forEach((b, i) => out.push({ id: `${c.id}:${i}`, body: b }))
    }
    return out
  }

  /** restore a recorded moment (rewind resume / reset). bodies & components in stable order. */
  restore(bodyState: Float32Array, compState: number[][], time: number, phase: SimPhase, steps: number) {
    let o = 0
    for (const b of this.bodies) {
      const kin = b.isKinematic()
      const t = { x: bodyState[o], y: bodyState[o + 1], z: bodyState[o + 2] }
      const r = { x: bodyState[o + 3], y: bodyState[o + 4], z: bodyState[o + 5], w: bodyState[o + 6] }
      b.setTranslation(t, false)
      b.setRotation(r, false)
      if (kin) {
        b.setNextKinematicTranslation(t)
        b.setNextKinematicRotation(r)
      } else {
        b.setLinvel({ x: bodyState[o + 7], y: bodyState[o + 8], z: bodyState[o + 9] }, false)
        b.setAngvel({ x: bodyState[o + 10], y: bodyState[o + 11], z: bodyState[o + 12] }, false)
        if (bodyState[o + 13] > 0.5) b.sleep()
        else b.wakeUp()
      }
      o += BODY_STRIDE
    }
    this.components.forEach((c, i) => c.loadState(compState[i]))
    // the event log is history: drop what has not happened yet at the restored moment
    let n = this.log.length
    while (n > 0 && this.log[n - 1].t > time + 1e-9) n--
    this.log.length = n
    this.time = time
    this.steps = steps
    this.phase = phase
    this.lastChange = time
    if (phase !== 'FAILED') { this.failReason = ''; this.failedId = '' }
    if (phase !== 'COMPLETED') this.completeTime = -1
  }

  captureBodies(out: Float32Array) {
    let o = 0
    for (const b of this.bodies) {
      const t = b.translation()
      const r = b.rotation()
      const v = b.linvel()
      const w = b.angvel()
      out[o] = t.x; out[o + 1] = t.y; out[o + 2] = t.z
      out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = r.w
      out[o + 7] = v.x; out[o + 8] = v.y; out[o + 9] = v.z
      out[o + 10] = w.x; out[o + 11] = w.y; out[o + 12] = w.z
      out[o + 13] = b.isSleeping() ? 1 : 0
      o += BODY_STRIDE
    }
    return out
  }
  captureComponents(): number[][] {
    return this.components.map((c) => c.saveState())
  }

  bounds(): { min: V3; max: V3 } {
    const min = { x: Infinity, y: Infinity, z: Infinity }
    const max = { x: -Infinity, y: -Infinity, z: -Infinity }
    for (const c of this.components) {
      const b = c.bounds()
      min.x = Math.min(min.x, b.min.x); min.y = Math.min(min.y, b.min.y); min.z = Math.min(min.z, b.min.z)
      max.x = Math.max(max.x, b.max.x); max.y = Math.max(max.y, b.max.y); max.z = Math.max(max.z, b.max.z)
    }
    if (!isFinite(min.x)) return { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 5, z: 5 } }
    return { min, max }
  }

  free() {
    this.physics.free()
  }
}

export const BODY_STRIDE = 14
