/**
 * All sound is synthesised live with Web Audio (no samples, nothing licensed):
 * a lab drone, the core's hum, and one-shots for grabs, throws, impacts,
 * cracks, the shatter, pulses, gravity shifts, the overflow rush and the rebuild.
 */
export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private verb!: ConvolverNode
  private verbSend!: GainNode
  private hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  private noiseBuf!: AudioBuffer
  muted = false
  private lastClink = 0

  /** must be called from a user gesture */
  start() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 4
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    this.master.connect(comp).connect(ctx.destination)

    // generated hall impulse response
    const len = ctx.sampleRate * 3.2
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    this.verb = ctx.createConvolver()
    this.verb.buffer = ir
    this.verbSend = ctx.createGain()
    this.verbSend.gain.value = 0.35
    this.verbSend.connect(this.verb).connect(this.master)

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const nd = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

    this.drone()
    this.coreHum()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  private out(node: AudioNode, wet = 0.4) {
    node.connect(this.master)
    if (wet > 0) {
      const s = this.ctx!.createGain()
      s.gain.value = wet
      node.connect(s).connect(this.verbSend)
    }
  }

  private noise(dur: number) {
    const s = this.ctx!.createBufferSource()
    s.buffer = this.noiseBuf
    s.loop = dur > 2
    return s
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }

  private drone() {
    const ctx = this.ctx!
    const g = ctx.createGain()
    g.gain.value = 0.05
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 220
    for (const [freq, det] of [[41.2, 0], [41.2, 7], [61.7, -5]]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq
      o.detune.value = det
      o.connect(f)
      o.start()
    }
    const air = this.noise(10)
    const af = ctx.createBiquadFilter()
    af.type = 'bandpass'
    af.frequency.value = 900
    af.Q.value = 0.6
    const ag = ctx.createGain()
    ag.gain.value = 0.012
    air.connect(af).connect(ag)
    this.out(ag, 0.6)
    air.start()
    f.connect(g)
    this.out(g, 0.3)
  }

  private coreHum() {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 110
    const osc2 = ctx.createOscillator()
    osc2.type = 'triangle'
    osc2.frequency.value = 220.6
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 600
    const gain = ctx.createGain()
    gain.gain.value = 0.0
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain)
    this.out(gain, 0.5)
    osc.start()
    osc2.start()
    this.hum = { osc, osc2, gain, filter }
  }

  /** continuous: core energy 0..1, distance factor 0..1 (closer = louder) */
  setCore(energy: number, near: number) {
    if (!this.ctx || !this.hum) return
    const t = this.ctx.currentTime
    const h = this.hum
    h.gain.gain.setTargetAtTime(0.025 + energy * 0.09 * (0.5 + near), t, 0.1)
    h.osc.frequency.setTargetAtTime(98 + energy * 60, t, 0.15)
    h.osc2.frequency.setTargetAtTime(196.6 + energy * 130, t, 0.15)
    h.filter.frequency.setTargetAtTime(400 + energy * 2400, t, 0.1)
  }

  grab() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(320, t)
    o.frequency.exponentialRampToValueAtTime(980, t + 0.18)
    const g = ctx.createGain()
    this.env(g, t, 0.01, 0.12, 0.3)
    o.connect(g)
    this.out(g, 0.5)
    o.start(t)
    o.stop(t + 0.4)
  }

  whoosh(speed: number) {
    if (!this.ctx || speed < 4) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const n = this.noise(1)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.2
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(300 + speed * 90, t + 0.25)
    const g = ctx.createGain()
    this.env(g, t, 0.04, Math.min(0.35, speed * 0.012), 0.4)
    n.connect(f).connect(g)
    this.out(g, 0.3)
    n.start(t)
    n.stop(t + 0.6)
  }

  clink(force: number, metal = true) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    if (t - this.lastClink < 0.04) return
    this.lastClink = t
    const v = Math.min(0.25, force * 0.0015)
    if (v < 0.01) return
    const base = metal ? 500 + Math.random() * 1500 : 180 + Math.random() * 200
    for (const k of [1, 2.76, 5.4]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = base * k
      const g = ctx.createGain()
      this.env(g, t, 0.002, v / k, metal ? 0.5 / k : 0.12)
      o.connect(g)
      this.out(g, 0.35)
      o.start(t)
      o.stop(t + 0.7)
    }
  }

  /** glass under stress: a short crackle */
  crack(intensity: number) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const n = this.noise(1)
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 2500
    const g = ctx.createGain()
    g.gain.value = 0
    let tt = t
    for (let i = 0; i < 6 + intensity * 10; i++) {
      tt += 0.008 + Math.random() * 0.03
      g.gain.setValueAtTime(0.25 * intensity * Math.random(), tt)
      g.gain.setValueAtTime(0, tt + 0.004)
    }
    n.connect(f).connect(g)
    this.out(g, 0.5)
    n.start(t)
    n.stop(tt + 0.05)
  }

  glassHit(strength: number) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    for (const freq of [2100, 3300, 5200]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq * (0.95 + Math.random() * 0.1)
      const g = ctx.createGain()
      this.env(g, t, 0.002, Math.min(0.12, strength * 0.05), 0.5)
      o.connect(g)
      this.out(g, 0.6)
      o.start(t)
      o.stop(t + 0.6)
    }
    this.thump(60, Math.min(0.3, strength * 0.1), 0.25)
  }

  private thump(freq: number, amp: number, dur: number) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq * 2.2, t)
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.12)
    const g = ctx.createGain()
    this.env(g, t, 0.005, amp, dur)
    o.connect(g)
    this.out(g, 0.2)
    o.start(t)
    o.stop(t + dur + 0.1)
  }

  shatter() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    // the break: broadband burst
    const n = this.noise(2)
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 1200
    const g = ctx.createGain()
    this.env(g, t, 0.003, 0.7, 1.2)
    n.connect(f).connect(g)
    this.out(g, 0.7)
    n.start(t)
    n.stop(t + 1.5)
    this.thump(42, 0.9, 1.4)
    // and the tinkle of a hundred shards
    for (let i = 0; i < 46; i++) {
      const tt = t + 0.03 + Math.pow(Math.random(), 1.6) * 1.8
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = 2400 + Math.random() * 6000
      const gg = ctx.createGain()
      gg.gain.setValueAtTime(0.0001, tt)
      gg.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.05, tt + 0.002)
      gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.15 + Math.random() * 0.3)
      o.connect(gg)
      this.out(gg, 0.6)
      o.start(tt)
      o.stop(tt + 0.5)
    }
  }

  pulse() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    this.thump(48, 0.7, 0.9)
    const n = this.noise(1)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(4000, t)
    f.frequency.exponentialRampToValueAtTime(200, t + 0.6)
    const g = ctx.createGain()
    this.env(g, t, 0.005, 0.3, 0.7)
    n.connect(f).connect(g)
    this.out(g, 0.6)
    n.start(t)
    n.stop(t + 1)
  }

  gravity(up: boolean) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(up ? 60 : 180, t)
    o.frequency.exponentialRampToValueAtTime(up ? 220 : 40, t + 1.0)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 500
    const g = ctx.createGain()
    this.env(g, t, 0.05, 0.22, 1.2)
    o.connect(f).connect(g)
    this.out(g, 0.6)
    o.start(t)
    o.stop(t + 1.4)
  }

  rush() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const n = this.noise(4)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 0.8
    f.frequency.setValueAtTime(200, t)
    f.frequency.exponentialRampToValueAtTime(3000, t + 2.5)
    f.frequency.exponentialRampToValueAtTime(400, t + 5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.4)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5)
    n.connect(f).connect(g)
    this.out(g, 0.5)
    n.start(t)
    n.stop(t + 6)
  }

  rebuild() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    for (const [freq, delay] of [[220, 0], [277.2, 0.15], [329.6, 0.3], [440, 0.45]]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = freq
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + delay)
      g.gain.exponentialRampToValueAtTime(0.07, t + delay + 1.2)
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 3.2)
      o.connect(g)
      this.out(g, 0.8)
      o.start(t + delay)
      o.stop(t + delay + 3.4)
    }
    const n = this.noise(4)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(5000, t)
    f.frequency.exponentialRampToValueAtTime(300, t + 2.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 1.8)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
    n.connect(f).connect(g)
    this.out(g, 0.5)
    n.start(t)
    n.stop(t + 2.6)
  }

  title() {
    if (!this.ctx) return
    this.thump(36, 0.9, 2.5)
    this.glassHit(1.2)
  }
}
