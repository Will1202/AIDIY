import { BODY_STRIDE, type SimPhase, type Simulation } from './simulation'

interface Frame {
  time: number
  steps: number
  phase: SimPhase
  bodies: Float32Array
  comps: number[][]
}

/**
 * Time rewind by recorded history (no inverse physics): every `every` fixed steps we keep the full
 * state of every non-fixed body (pose, velocities, sleep) and every component's internal state.
 * Memory is bounded by `maxSeconds`; the oldest frames are dropped first.
 */
export class Recorder {
  private frames: Frame[] = []
  private counter = 0
  readonly every: number
  readonly maxFrames: number

  constructor(private sim: Simulation, every = 2, maxSeconds = 90) {
    this.every = every
    this.maxFrames = Math.ceil((maxSeconds * 120) / every)
  }

  get length() { return this.frames.length }
  get duration() { return this.frames.length ? this.frames[this.frames.length - 1].time - this.frames[0].time : 0 }
  get firstTime() { return this.frames[0]?.time ?? 0 }
  get lastTime() { return this.frames[this.frames.length - 1]?.time ?? 0 }
  /** approximate memory use in bytes */
  get bytes() { return this.frames.reduce((a, f) => a + f.bodies.byteLength + f.comps.reduce((b, c) => b + c.length * 8, 0), 0) }

  clear() {
    this.frames = []
    this.counter = 0
  }

  /** call after every fixed step */
  afterStep(force = false) {
    if (!force && ++this.counter % this.every !== 0) return
    const s = this.sim
    const bodies = new Float32Array(s.bodies.length * BODY_STRIDE)
    s.captureBodies(bodies)
    this.frames.push({ time: s.time, steps: s.steps, phase: s.phase, bodies, comps: s.captureComponents() })
    if (this.frames.length > this.maxFrames) this.frames.shift()
  }

  /** index of the last frame at or before time t */
  indexAt(t: number) {
    let lo = 0
    let hi = this.frames.length - 1
    if (hi < 0) return -1
    if (t <= this.frames[0].time) return 0
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.frames[mid].time <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** put the whole machine back into the recorded moment at (or just before) t */
  seek(t: number): number {
    const i = this.indexAt(t)
    if (i < 0) return this.sim.time
    const f = this.frames[i]
    this.sim.restore(f.bodies, f.comps, f.time, f.phase, f.steps)
    return f.time
  }

  /** resume normal simulation from the current (seeked) moment: discard the overwritten future */
  truncateAfter(t: number) {
    const i = this.indexAt(t)
    this.frames.length = Math.max(0, i + 1)
    this.counter = 0
  }
}
