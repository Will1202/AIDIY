import type { BrushKind } from '../core/constants'
import type { InkRenderer, Stamp } from '../ink/InkRenderer'
import { clamp, lerp } from '../util/math'
import { arcLengths, type P2, type StrokePoint } from '../util/path'

/**
 * BRUSH INPUT
 * Pointer (mouse / pen / touch) or a scripted path drives a *target*; the brush tip
 * follows it with a little inertia. Speed, pressure, dwell time and remaining ink load
 * shape every stamp: fast = thin and dry (飞白), slow = heavy ink and water, dwelling =
 * a spreading bloom. Each finished stroke is handed to the world as a point list.
 */

export interface BrushProfile {
  width: number
  black: number
  indigo: number
  water: number
  dry: number
  load: number
}

const PROFILES: Record<BrushKind, BrushProfile> = {
  mountain: { width: 2.3, black: 1.25, indigo: 0, water: 1, dry: 1, load: 0.0034 },
  river: { width: 2.1, black: 0.12, indigo: 1.15, water: 1.5, dry: 0.6, load: 0.0026 },
  life: { width: 2.6, black: 1.4, indigo: 0, water: 2.6, dry: 0, load: 0 },
  bridge: { width: 0.75, black: 1.1, indigo: 0, water: 0.35, dry: 0.5, load: 0.0018 },
}

export interface ScriptedStroke {
  kind: BrushKind
  path: P2[]
  duration: number
  /** optional pressure over normalised time */
  pressure?: (u: number) => number
  /** seconds to dwell at the start (ink drop) */
  hold?: number
  t: number
  arcs: Float32Array
  length: number
  onDone?: () => void
}

export type StrokeHandler = (kind: BrushKind, points: StrokePoint[]) => void

export class BrushInputSystem {
  kind: BrushKind = 'mountain'
  enabled = false
  /** pointer state */
  down = false
  private pointerType = 'mouse'
  private penPressure = 0.5
  /** world target and tip */
  target: P2 | null = null
  readonly tip = { x: 0, z: 0 }
  speed = 0
  pressure = 0.5
  private hasTip = false
  private stroke: StrokePoint[] = []
  private load = 1
  private arc = 0
  private dwell = 0
  private t = 0
  private lastStamp = { x: 0, z: 0 }
  private lastRecord = { x: 0, z: 0 }
  private seed = 1
  private releasing = 0
  private lifeDrops: P2[] = []
  private script: ScriptedStroke | null = null
  private scriptQueue: ScriptedStroke[] = []
  /** true while any ink is being laid (for audio) */
  inking = false

  constructor(
    private ink: InkRenderer,
    private onStroke: StrokeHandler,
  ) {}

  /** pointer → world target (null if off the paper) */
  pointerDown(target: P2 | null, pointerType: string, pressure: number) {
    if (!this.enabled || !target || this.script) return
    this.pointerType = pointerType
    this.penPressure = pressure
    this.begin(target)
  }
  pointerMove(target: P2 | null, pressure: number) {
    if (!this.down || this.script) return
    this.penPressure = pressure
    if (target) this.target = target
  }
  pointerUp() {
    if (!this.down || this.script) return
    this.releasing = 0.05
  }
  cancel() {
    this.down = false
    this.stroke = []
    this.script = null
    this.scriptQueue = []
    this.inking = false
  }

  /** queue a scripted stroke (cinematic demo, tests) */
  play(kind: BrushKind, path: P2[], duration: number, opts: { pressure?: (u: number) => number; hold?: number; onDone?: () => void } = {}) {
    const arcs = arcLengths(path)
    this.scriptQueue.push({ kind, path, duration, t: 0, arcs, length: arcs[arcs.length - 1] || 0, ...opts })
  }
  get busy() {
    return this.down || !!this.script || this.scriptQueue.length > 0
  }

  private begin(target: P2) {
    this.down = true
    this.releasing = 0
    this.target = { ...target }
    this.tip.x = target.x
    this.tip.z = target.z
    this.hasTip = true
    this.stroke = []
    this.load = 1
    this.arc = 0
    this.dwell = 0
    this.t = 0
    this.speed = 0
    this.pressure = 0.55
    this.lastStamp = { ...target }
    this.lastRecord = { ...target }
    this.seed = (Math.random() * 1000) | 0
    this.lifeDrops = []
    this.record(0)
    if (this.kind === 'life') this.dropLife(target.x, target.z)
  }

  private record(w: number) {
    this.stroke.push({ x: this.tip.x, z: this.tip.z, p: this.pressure, v: this.speed, t: this.t, w })
    this.lastRecord.x = this.tip.x
    this.lastRecord.z = this.tip.z
  }

  private dropLife(x: number, z: number) {
    this.lifeDrops.push({ x, z })
    const pr = PROFILES.life
    // one heavy round drop: water-rich, it blooms out in the simulation
    this.ink.stamp({ x, z, dx: 1, dz: 0, halfLen: pr.width, halfWidth: pr.width, black: 0.55, indigo: 0, water: pr.water, dryness: 0, bleed: 0.55, arc: 0, seed: this.seed + this.lifeDrops.length, round: 1 })
    this.ink.stamp({ x, z, dx: 1, dz: 0, halfLen: pr.width * 0.55, halfWidth: pr.width * 0.55, black: 0.9, indigo: 0, water: 0.6, dryness: 0, bleed: 0.25, arc: 0, seed: this.seed + 7, round: 1 })
  }

  private end() {
    this.down = false
    this.inking = false
    const kind = this.kind
    let pts = this.stroke
    if (kind === 'life') pts = this.lifeDrops.map((d) => ({ x: d.x, z: d.z, p: 1, v: 0, t: 0, w: PROFILES.life.width }))
    this.stroke = []
    if (pts.length) this.onStroke(kind, pts)
  }

  update(dt: number) {
    // scripted strokes take over the brush
    if (!this.script && !this.down && this.scriptQueue.length) {
      this.script = this.scriptQueue.shift()!
      this.kind = this.script.kind
      this.pointerType = 'script'
      this.begin(this.script.path[0])
    }
    const sc = this.script
    if (sc) {
      sc.t += dt
      const hold = sc.hold ?? 0
      const u = clamp((sc.t - hold) / sc.duration)
      const s = u * sc.length
      let k = 0
      while (k < sc.path.length - 2 && sc.arcs[k + 1] < s) k++
      const f = clamp((s - sc.arcs[k]) / Math.max(1e-6, sc.arcs[k + 1] - sc.arcs[k]))
      const a = sc.path[k]
      const b = sc.path[Math.min(k + 1, sc.path.length - 1)]
      this.target = { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) }
      if (sc.pressure) this.penPressure = sc.pressure(u)
      if (u >= 1 && this.releasing === 0) this.releasing = 0.04
    }

    if (!this.down || !this.target) return
    this.t += dt
    const px = this.tip.x
    const pz = this.tip.z
    // inertia: first-order lag toward the target
    const k = 1 - Math.exp(-dt / (this.pointerType === 'script' ? 0.02 : 0.035))
    this.tip.x += (this.target.x - this.tip.x) * k
    this.tip.z += (this.target.z - this.tip.z) * k
    const moved = Math.hypot(this.tip.x - px, this.tip.z - pz)
    const inst = moved / Math.max(dt, 1e-4)
    this.speed = lerp(this.speed, inst, 1 - Math.exp(-dt / 0.05))

    // pressure: real pen pressure if present, otherwise slowness reads as pressing harder
    const usePen = (this.pointerType === 'pen' && this.penPressure > 0) || (this.pointerType === 'script' && !!sc?.pressure)
    const pTarget = usePen ? clamp(this.penPressure, 0.08, 1) : clamp(1.05 - this.speed / 150, 0.18, 1)
    this.pressure = lerp(this.pressure, pTarget, 1 - Math.exp(-dt / 0.08))

    const pr = PROFILES[this.kind]
    const speedN = clamp(this.speed / 130)
    if (this.kind === 'life') {
      // dragging the life brush plants a grove: a drop every ~7 units
      const last = this.lifeDrops[this.lifeDrops.length - 1]
      if (last && Math.hypot(this.tip.x - last.x, this.tip.z - last.z) > 7 && this.lifeDrops.length < 8) this.dropLife(this.tip.x, this.tip.z)
    } else {
      const halfW = pr.width * (0.42 + 0.78 * this.pressure) * (1 - speedN * 0.35)
      const spacing = Math.max(0.1, halfW * 0.3)
      const dry = clamp((speedN - 0.25) * 1.1 * pr.dry + (1 - this.load) * 0.75 * pr.dry, 0, 0.92)
      const wet = (0.3 + 0.7 * (1 - speedN)) * this.load * pr.water
      const dens = (0.55 + 0.45 * this.pressure) * (0.5 + 0.5 * this.load)
      let dx = this.tip.x - this.lastStamp.x
      let dz = this.tip.z - this.lastStamp.z
      let dist = Math.hypot(dx, dz)
      if (dist > 1e-5) {
        dx /= dist
        dz /= dist
      } else {
        dx = 1
        dz = 0
      }
      const amt = (spacing / (1.5 * halfW))
      while (dist >= spacing) {
        this.lastStamp.x += dx * spacing
        this.lastStamp.z += dz * spacing
        this.arc += spacing
        dist -= spacing
        this.load = Math.max(0.12, this.load - spacing * pr.load * (0.6 + this.pressure))
        const st: Stamp = {
          x: this.lastStamp.x,
          z: this.lastStamp.z,
          dx,
          dz,
          halfLen: halfW * 1.05,
          halfWidth: halfW,
          black: pr.black * dens * amt,
          indigo: pr.indigo * dens * amt,
          water: wet * amt * 1.6,
          dryness: dry,
          bleed: clamp(0.14 + 0.4 * (1 - speedN) * this.load, 0, 0.6),
          arc: this.arc,
          seed: this.seed,
          round: 0,
        }
        this.ink.stamp(st)
      }
      // dwelling: the brush rests and the ink keeps flowing into the paper
      if (this.speed < 3) {
        this.dwell += dt
        const grow = Math.min(1, this.dwell)
        this.ink.stamp({ x: this.tip.x, z: this.tip.z, dx, dz, halfLen: halfW * (1 + grow * 0.4), halfWidth: halfW * (1 + grow * 0.4), black: pr.black * 0.9 * dt, indigo: pr.indigo * 0.9 * dt, water: pr.water * 2.2 * dt * this.load, dryness: 0, bleed: 0.6, arc: this.arc, seed: this.seed, round: 1 })
        this.pressure = Math.min(1, this.pressure + dt * 0.5)
      } else this.dwell = Math.max(0, this.dwell - dt * 2)
      if (Math.hypot(this.tip.x - this.lastRecord.x, this.tip.z - this.lastRecord.z) > 0.5) this.record(halfW)
    }
    this.inking = this.speed > 2 || this.dwell > 0

    if (this.releasing > 0) {
      this.releasing -= dt
      const caught = Math.hypot(this.target.x - this.tip.x, this.target.z - this.tip.z) < 0.3
      if (this.releasing <= 0 || caught) {
        this.record(0)
        const done = this.script?.onDone
        this.script = null
        this.end()
        done?.()
      }
    }
  }

  get hasTipPosition() {
    return this.hasTip
  }
}
