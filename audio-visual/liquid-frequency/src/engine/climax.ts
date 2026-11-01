/**
 * Climax / "explode & rebirth" state machine.
 *
 *  pre      twist → inner energy charge → anticipation squeeze (or collapse)
 *  BURST    one frame: shards get their impulse, flash, shock ring
 *  scatter  liquid is gone, fragments fly free
 *  gather   central gravity pulls fragments home in a spiral
 *  reform   liquid regrows from the centre with an elastic overshoot
 */
export type ClimaxPhase = 'idle' | 'pre' | 'scatter' | 'gather' | 'reform'

export interface ClimaxTimings {
  pre: number
  scatter: number
  gather: number
  reform: number
}

/** Triggered by a detected drop in real music — burst almost immediately. */
export const DROP_TIMINGS: ClimaxTimings = { pre: 0.16, scatter: 2.4, gather: 2.7, reform: 1.2 }
/** Manual trigger (button / X key): full cinematic sequence. */
export const MANUAL_TIMINGS: ClimaxTimings = { pre: 2.1, scatter: 2.9, gather: 2.9, reform: 1.25 }

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const elastic = (x: number) => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return Math.pow(2, -9 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

export class Climax {
  phase: ClimaxPhase = 'idle'
  t = 0
  timings: ClimaxTimings = MANUAL_TIMINGS
  burst = false
  reseed = false
  count = 0

  twist = 0
  charge = 0
  explode = 0
  liquid = 1
  flash = 0
  shock = -1
  gather = 0
  heat = 0
  collapse = 0
  private burstDone = false
  private reseedDone = false

  get active() {
    return this.phase !== 'idle'
  }

  /** Normalised progress through the whole sequence (for HUD). */
  get progress() {
    const T = this.timings
    return this.phase === 'idle' ? 0 : Math.min(1, this.t / (T.pre + T.scatter + T.gather + T.reform))
  }

  trigger(timings: ClimaxTimings) {
    if (this.phase !== 'idle') return false
    this.timings = timings
    this.phase = 'pre'
    this.t = 0
    this.burstDone = false
    this.reseedDone = false
    this.count++
    return true
  }

  update(dt: number) {
    this.burst = false
    this.reseed = false
    this.flash *= Math.exp(-dt * 3.4)
    if (this.shock >= 0) {
      this.shock += dt / 1.5
      if (this.shock > 1) this.shock = -1
    }

    if (this.phase === 'idle') {
      const k = 1 - Math.exp(-dt * 3)
      this.twist -= this.twist * k
      this.charge -= this.charge * k
      this.explode -= this.explode * k
      this.gather -= this.gather * k
      this.heat -= this.heat * k
      this.collapse -= this.collapse * k
      this.liquid += (1 - this.liquid) * k
      return
    }

    this.t += dt
    const { pre, scatter, gather, reform } = this.timings
    const B = pre
    const S = B + scatter
    const G = S + gather
    const R = G + reform
    const t = this.t

    if (t < B) {
      this.phase = 'pre'
      const k = t / B
      this.twist = Math.pow(sstep(0, 1, k), 1.4)
      this.charge = sstep(0.2, 1, k)
      this.collapse = k * k
      this.heat = this.charge * 0.6
      this.liquid = 1 + 0.08 * this.charge - 0.2 * sstep(0.82, 1, k)
      this.explode = 0
      this.gather = 0
      return
    }

    if (!this.burstDone) {
      this.burstDone = true
      this.burst = true
      this.flash = 1
      this.shock = 0
    }

    if (t < S) {
      this.phase = 'scatter'
      const lt = t - B
      this.liquid = Math.exp(-lt * 20)
      this.explode = 1
      this.gather = 0
      this.twist *= Math.exp(-dt * 2)
      this.charge *= Math.exp(-dt * 5)
      this.collapse *= Math.exp(-dt * 10)
      this.heat = Math.exp(-lt * 2.4)
      return
    }

    if (t < G) {
      this.phase = 'gather'
      if (!this.reseedDone) {
        this.reseedDone = true
        this.reseed = true
      }
      const k = (t - S) / gather
      this.gather = k
      this.explode = 1
      this.liquid = sstep(0.5, 1, k) * 0.5
      this.heat = Math.max(this.heat * Math.exp(-dt * 1.5), 0.18 * Math.sin(k * Math.PI))
      this.twist *= Math.exp(-dt * 2)
      this.charge *= Math.exp(-dt * 4)
      return
    }

    if (t < R) {
      this.phase = 'reform'
      const k = (t - G) / reform
      this.gather = 1
      this.explode = 1 - sstep(0, 0.8, k)
      this.liquid = 0.5 + 0.5 * elastic(k)
      this.heat *= Math.exp(-dt * 3)
      return
    }

    this.phase = 'idle'
    this.liquid = 1
  }
}
