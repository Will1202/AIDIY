import { clamp } from '../util/math'

/**
 * Original, fully procedural sound — no samples:
 *  beds:   wind (filtered noise), river (band-passed noise with slow swells), rain
 *          (high noise + random drops), night crickets
 *  brush:  scratchy hair-on-paper noise driven by brush speed and pressure
 *  events: guqin-like plucks (Karplus–Strong on a pentatonic scale) when mountains rise
 *          and pines sprout, wood knocks as bridge planks appear, a bronze bell and a
 *          swell for AWAKEN, a muted thud when a stroke is rejected.
 */

// 宫商角徵羽 on D: D E F# A B across three octaves
const PENTA = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25]

export interface AudioParams {
  wind: number
  rain: number
  water: number
  night: number
  brush: number
  awaken: number
}

export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private noise!: AudioBuffer
  private beds: Record<string, { g: GainNode; f: BiquadFilterNode }> = {}
  private plucks = new Map<number, AudioBuffer>()
  enabled = true
  private crickets = 0
  private dropTimer = 0

  /** must be called from a user gesture */
  init() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? 0.8 : 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    this.master.connect(comp).connect(ctx.destination)
    // shared noise buffer
    const len = ctx.sampleRate * 3
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let b0 = 0
    let b1 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      // gently pinked
      b0 = 0.997 * b0 + w * 0.05
      b1 = 0.6 * b1 + w * 0.4
      d[i] = (b0 + b1) * 0.6
    }
    const bed = (name: string, type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      src.playbackRate.value = 0.7 + Math.random() * 0.6
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.value = 0
      src.connect(f).connect(g).connect(this.master)
      src.start(ctx.currentTime + Math.random())
      this.beds[name] = { g, f }
    }
    bed('wind', 'lowpass', 380, 0.7)
    bed('water', 'bandpass', 900, 0.8)
    bed('rain', 'highpass', 2600, 0.5)
    bed('brush', 'bandpass', 3200, 1.4)
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!this.ctx) return
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.2)
  }

  update(dt: number, p: AudioParams) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const t = ctx.currentTime
    const set = (name: string, v: number, tc = 0.3) => this.beds[name]?.g.gain.setTargetAtTime(v, t, tc)
    const sw = Math.sin(t * 0.13) * 0.5 + 0.5
    set('wind', (0.05 + p.wind * 0.22) * (0.6 + sw * 0.4) * (0.4 + p.awaken * 0.6))
    this.beds.wind?.f.frequency.setTargetAtTime(260 + p.wind * 420 + sw * 120, t, 0.5)
    set('water', p.water * (0.1 + Math.sin(t * 0.31) * 0.025))
    set('rain', p.rain * 0.26)
    set('brush', clamp(p.brush) * 0.22, 0.04)
    this.beds.brush?.f.frequency.setTargetAtTime(2200 + clamp(p.brush) * 2600, t, 0.05)
    // rain drops on leaves and water
    if (p.rain > 0.1) {
      this.dropTimer -= dt
      if (this.dropTimer < 0) {
        this.dropTimer = 0.03 + Math.random() * 0.12 / p.rain
        this.tick(1800 + Math.random() * 2500, 0.02 * p.rain, 0.03)
      }
    }
    // crickets at night
    if (p.night > 0.5 && p.rain < 0.5) {
      this.crickets -= dt
      if (this.crickets < 0) {
        this.crickets = 0.5 + Math.random() * 1.6
        const f = 4200 + Math.random() * 600
        for (let k = 0; k < 3; k++) this.tone(f, 0.012 * p.night, 0.05, t + k * 0.07)
      }
    }
  }

  private pluckBuffer(freq: number) {
    const cached = this.plucks.get(freq)
    if (cached) return cached
    const ctx = this.ctx!
    const sr = ctx.sampleRate
    const len = Math.floor(sr * 3.2)
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    const N = Math.max(2, Math.round(sr / freq))
    const ring = new Float32Array(N)
    for (let i = 0; i < N; i++) ring[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin((i / N) * Math.PI))
    let idx = 0
    let prev = 0
    for (let i = 0; i < len; i++) {
      const cur = ring[idx]
      const next = 0.996 * 0.5 * (cur + prev)
      prev = cur
      ring[idx] = next
      d[i] = cur
      idx = (idx + 1) % N
    }
    // soft attack, slight slide down (the left hand on a guqin)
    for (let i = 0; i < 64; i++) d[i] *= i / 64
    this.plucks.set(freq, buf)
    return buf
  }

  pluck(note: number, vol = 0.3, when = 0, rate = 1) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const freq = PENTA[Math.max(0, Math.min(PENTA.length - 1, note))]
    const src = ctx.createBufferSource()
    src.buffer = this.pluckBuffer(freq)
    src.playbackRate.value = rate
    src.playbackRate.setTargetAtTime(rate * 0.985, ctx.currentTime + when + 0.15, 0.6)
    const g = ctx.createGain()
    g.gain.value = vol
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 2400
    src.connect(f).connect(g).connect(this.master)
    src.start(ctx.currentTime + when)
  }

  private tone(freq: number, vol: number, dur: number, at?: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = at ?? ctx.currentTime
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private tick(freq: number, vol: number, dur: number, when = 0) {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const t = ctx.currentTime + when
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = 6
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random() * 2)
    src.stop(t + dur + 0.02)
  }

  /** a low string and a soft rumble as a range lifts out of the paper */
  mountain(height: number) {
    if (!this.ctx) return
    const n = height > 34 ? 0 : height > 24 ? 1 : 3
    this.pluck(n, 0.42)
    this.pluck(n + 5, 0.16, 0.12)
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(90, t)
    f.frequency.linearRampToValueAtTime(260, t + 2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.35, t + 0.8)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + 3.1)
  }

  tree(i: number) {
    const base = 6 + (i % 4)
    this.pluck(base, 0.2, 0.55)
    this.pluck(base + 2, 0.14, 0.85)
  }

  river() {
    for (let k = 0; k < 5; k++) this.pluck(7 + k, 0.08, 0.3 + k * 0.12, 1)
  }

  /** wood knocks while a bridge is assembled */
  bridge(span: number) {
    const n = Math.min(14, Math.round(span / 3))
    for (let k = 0; k < n; k++) this.tick(900 + Math.random() * 300, 0.22, 0.07, 0.3 + (k / n) * 3.2)
    this.pluck(4, 0.18, 3.6)
    this.pluck(8, 0.14, 3.75)
  }

  awaken() {
    const ctx = this.ctx
    if (!ctx || !this.enabled) return
    const t = ctx.currentTime
    // bronze bell: inharmonic partials
    const partials = [1, 2.76, 5.4, 8.93, 13.34]
    partials.forEach((r, i) => {
      const o = ctx.createOscillator()
      o.frequency.value = 98 * r
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.22 / (i + 1), t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 7 / (i * 0.6 + 1))
      o.connect(g).connect(this.master)
      o.start(t)
      o.stop(t + 8)
    })
    // rising swell
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.2
    f.frequency.setValueAtTime(200, t)
    f.frequency.exponentialRampToValueAtTime(1600, t + 6)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.18, t + 4.5)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 9)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + 9.2)
    ;[0, 2, 4, 5, 7].forEach((n, k) => this.pluck(n, 0.2, 3 + k * 0.35))
  }

  reject() {
    this.tone(70, 0.3, 0.35)
    this.tick(300, 0.12, 0.2)
  }

  step(onWood: boolean) {
    if (onWood) this.tick(700 + Math.random() * 200, 0.07, 0.05)
    else this.tick(220 + Math.random() * 120, 0.05, 0.06)
  }

  dispose() {
    void this.ctx?.close()
  }
}
