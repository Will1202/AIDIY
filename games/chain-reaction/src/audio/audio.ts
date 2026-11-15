import type { ImpactEvent, MaterialName } from '../sim/physics'

type Vec = { x: number; y: number; z: number }

/**
 * Procedural sound: nothing is a recording and nothing plays on a timer. Impacts come from Rapier
 * contact starts (loudness ∝ measured approach speed), rolling from each marble's speed while in
 * contact, hum from the motor's actual angular velocity, ticks from real tooth passes.
 */
export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private sfx!: GainNode
  private musicBus!: GainNode
  private reverb!: ConvolverNode
  private noise!: AudioBuffer
  private rolling: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }[] = []
  private hum: { o1: OscillatorNode; o2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  private winch: { o: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  private listener: Vec = { x: 0, y: 10, z: 30 }
  private lastTick = 0
  private impactBudget = 0
  muted = false
  musicOn = true
  private musicTimer = 0
  private musicStep = 0

  /** must be called from a user gesture */
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.8
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.master.connect(comp).connect(ctx.destination)
    this.sfx = ctx.createGain()
    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = 0.22
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.impulse(2.8)
    const wet = ctx.createGain()
    wet.gain.value = 0.32
    this.sfx.connect(this.master)
    this.sfx.connect(this.reverb)
    this.musicBus.connect(this.master)
    this.musicBus.connect(this.reverb)
    this.reverb.connect(wet).connect(this.master)
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    for (let i = 0; i < 6; i++) this.rolling.push(this.rollingVoice())
    if (ctx.state === 'suspended') await ctx.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  setListener(p: Vec) {
    this.listener = p
  }

  private impulse(sec: number) {
    const ctx = this.ctx!
    const n = Math.floor(ctx.sampleRate * sec)
    const b = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2)
    }
    return b
  }

  private rollingVoice() {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.4
    filter.frequency.value = 400
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter).connect(gain).connect(this.sfx)
    src.start()
    return { src, filter, gain }
  }

  private att(p: Vec) {
    const d = Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z)
    return 1 / (1 + d * 0.09)
  }

  /** inharmonic modal "clink" of a struck metal part */
  private modal(freq: number, amp: number, decay: number, partials = [1, 2.76, 5.4, 8.93]) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.value = 0
    g.connect(this.sfx)
    partials.forEach((r, i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq * r * (1 + (Math.random() - 0.5) * 0.01)
      const og = ctx.createGain()
      const a = amp / (1 + i * 1.6)
      og.gain.setValueAtTime(a, t)
      og.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + i * 0.7))
      o.connect(og).connect(g)
      o.start(t)
      o.stop(t + decay + 0.05)
    })
    g.gain.setValueAtTime(1, t)
  }

  private noiseBurst(freq: number, q: number, amp: number, dur: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const s = ctx.createBufferSource()
    s.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(amp, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(this.sfx)
    s.start(t, Math.random() * 1.5)
    s.stop(t + dur + 0.02)
  }

  private tone(freq: number, amp: number, dur: number, type: OscillatorType = 'sine', glideTo?: number) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(amp, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.sfx)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  impacts(list: ImpactEvent[]) {
    if (!this.ctx || this.muted) return
    this.impactBudget = Math.min(this.impactBudget + 4, 12)
    for (const e of list) {
      if (this.impactBudget <= 0) break
      const v = Math.min(8, e.speed)
      if (v < 0.4) continue
      this.impactBudget--
      const a = Math.min(1, (v / 5) ** 1.3) * this.att(e.pos)
      const m = pair(e.a.material, e.b.material)
      if (m.has('wood') && !m.has('steel') && !m.has('iron')) {
        // domino on domino / deck: woody clack
        this.noiseBurst(1700 + Math.random() * 600, 3, a * 0.6, 0.06)
        this.tone(420 + Math.random() * 120, a * 0.25, 0.05, 'triangle')
      } else if (m.has('felt')) {
        this.noiseBurst(260, 0.8, a * 0.5, 0.12, 'lowpass')
      } else if (m.has('iron') && v > 2) {
        this.modal(130 + Math.random() * 20, a * 0.55, 2.4)
        this.noiseBurst(500, 1, a * 0.4, 0.08, 'lowpass')
      } else if (m.has('wood')) {
        this.noiseBurst(1200, 2, a * 0.5, 0.05)
        this.modal(900 + Math.random() * 300, a * 0.12, 0.4)
      } else {
        // marble on brass / steel
        this.modal(1300 + Math.random() * 500, a * 0.22, 0.6 + v * 0.05)
      }
    }
  }

  /** continuous layers, called every frame with real machine state */
  frame(dt: number, marbles: { pos: Vec; speed: number; contact: boolean }[], motorOmega: number, gearTeethPassed: number, lift: { v: number; pos: Vec } | null) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.impactBudget = Math.max(0, this.impactBudget - dt * 30)
    for (let i = 0; i < this.rolling.length; i++) {
      const r = this.rolling[i]
      const m = marbles[i]
      const g = m && m.contact ? Math.min(0.35, m.speed * 0.07) * this.att(m.pos) : 0
      r.gain.gain.setTargetAtTime(this.muted ? 0 : g, t, 0.04)
      if (m) r.filter.frequency.setTargetAtTime(240 + m.speed * 170, t, 0.05)
    }
    // electric motor hum, pitched by the real rotor speed
    const w = Math.abs(motorOmega)
    if (w > 0.05 && !this.hum) {
      const o1 = this.ctx.createOscillator()
      const o2 = this.ctx.createOscillator()
      o1.type = 'sawtooth'
      o2.type = 'square'
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 400
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      o1.connect(filter)
      o2.connect(filter)
      filter.connect(gain).connect(this.sfx)
      o1.start()
      o2.start()
      this.hum = { o1, o2, gain, filter }
    }
    if (this.hum) {
      this.hum.o1.frequency.setTargetAtTime(38 + w * 7, t, 0.1)
      this.hum.o2.frequency.setTargetAtTime(76 + w * 14, t, 0.1)
      this.hum.gain.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.06, w * 0.01), t, 0.15)
    }
    // tooth passes of the great wheel: soft clockwork ticks (rate-limited)
    if (gearTeethPassed > this.lastTick) {
      if (gearTeethPassed - this.lastTick < 4 && !this.muted) this.noiseBurst(4200, 6, 0.05, 0.02)
      this.lastTick = gearTeethPassed
    } else if (gearTeethPassed < this.lastTick) this.lastTick = gearTeethPassed
    // lift winch
    if (lift && lift.v > 0.05 && !this.winch) {
      const o = this.ctx.createOscillator()
      o.type = 'sawtooth'
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 3
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      o.connect(filter).connect(gain).connect(this.sfx)
      o.start()
      this.winch = { o, gain, filter }
    }
    if (this.winch) {
      const v = lift?.v ?? 0
      this.winch.o.frequency.setTargetAtTime(60 + v * 30, t, 0.1)
      this.winch.filter.frequency.setTargetAtTime(300 + v * 160, t, 0.1)
      this.winch.gain.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.08, v * 0.02), t, 0.12)
    }
    this.music(dt)
  }

  /** discrete mechanical events */
  event(kind: 'latch' | 'button' | 'spring' | 'gate' | 'motor' | 'lift' | 'final' | 'fail' | 'rewind' | 'start', pos?: Vec) {
    if (!this.ctx || this.muted) return
    const a = pos ? this.att(pos) * 1.6 : 0.6
    switch (kind) {
      case 'latch':
        this.noiseBurst(3200, 4, a * 0.5, 0.04)
        this.modal(2100, a * 0.12, 0.25)
        break
      case 'button':
        this.noiseBurst(2600, 5, a * 0.4, 0.03)
        this.tone(1760, a * 0.12, 0.12, 'sine')
        break
      case 'spring':
        this.noiseBurst(900, 0.7, a * 0.5, 0.25, 'lowpass')
        this.tone(320, a * 0.35, 0.45, 'triangle', 90)
        this.modal(620, a * 0.2, 0.9, [1, 1.5, 2.7])
        break
      case 'gate':
        this.noiseBurst(1800, 3, a * 0.4, 0.05)
        this.modal(980, a * 0.12, 0.5)
        break
      case 'motor':
        this.tone(60, a * 0.3, 0.8, 'sawtooth', 120)
        break
      case 'lift':
        this.modal(220, a * 0.2, 1.5, [1, 2.01, 3.03])
        break
      case 'start':
        this.modal(523, 0.12, 2.5, [1, 2, 3, 4.2])
        break
      case 'fail':
        this.tone(220, 0.25, 1.2, 'sawtooth', 110)
        break
      case 'rewind':
        this.tone(900, 0.08, 0.6, 'sine', 300)
        break
      case 'final': this.finale(); break
    }
  }

  /** the Final Machine: sub boom, rising brass chord, shimmer — aligned with the show's own clock */
  private finale() {
    const ctx = this.ctx!
    const t = ctx.currentTime
    this.tone(48, 0.9, 3.5, 'sine', 30)
    this.noiseBurst(180, 0.7, 0.6, 1.4, 'lowpass')
    const chord = [110, 164.8, 220, 277.2, 329.6, 440]
    const pad = ctx.createGain()
    pad.gain.setValueAtTime(0.0001, t)
    pad.gain.exponentialRampToValueAtTime(0.18, t + 4.5)
    pad.gain.exponentialRampToValueAtTime(0.0001, t + 14)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(5200, t + 6)
    pad.connect(f).connect(this.sfx)
    for (const fr of chord) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = fr
        o.detune.value = det
        o.connect(pad)
        o.start(t)
        o.stop(t + 14.2)
      }
    }
  }

  /** cues that follow the Final Machine's own show clock (so pause / slow motion stay in sync) */
  finaleClock(prev: number, now: number) {
    if (!this.ctx || this.muted || now <= prev) return
    const cross = (t: number) => prev < t && now >= t
    // petals unfolding: metallic creaks
    for (let i = 0; i < 8; i++) if (cross(1.5 + i * 0.3)) this.modal(180 + i * 40, 0.08, 1.4, [1, 1.41, 2.3])
    // arms extending: servo whine
    if (cross(3.2)) this.tone(300, 0.05, 2.6, 'sawtooth', 900)
    // particle bloom: glass shimmer arpeggio
    for (let i = 0; i < 24; i++) if (cross(5 + i * 0.14)) this.tone(1320 * Math.pow(2, ((i * 7) % 12) / 12), 0.05, 1.4, 'sine')
  }

  /** quiet original underscore: a low drone and a clock-like pulse */
  private music(dt: number) {
    if (!this.ctx || !this.musicOn || this.muted) return
    this.musicTimer += dt
    if (this.musicTimer < 0.5) return
    this.musicTimer = 0
    this.musicStep++
    const ctx = this.ctx
    const t = ctx.currentTime
    const tick = (f: number, a: number) => {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(a, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      o.connect(g).connect(this.musicBus)
      o.start(t)
      o.stop(t + 0.12)
    }
    tick(this.musicStep % 2 ? 1760 : 1318, 0.05)
    if (this.musicStep % 8 === 0) {
      const notes = [55, 65.4, 49, 58.3]
      const f = notes[(this.musicStep / 8) % 4]
      for (const m of [1, 1.5, 2]) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = f * m
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.12 / m, t + 1.2)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4)
        o.connect(g).connect(this.musicBus)
        o.start(t)
        o.stop(t + 4.1)
      }
    }
  }

  stopLoops() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (const r of this.rolling) r.gain.gain.setTargetAtTime(0, t, 0.03)
    if (this.hum) {
      this.hum.gain.gain.setTargetAtTime(0, t, 0.05)
      const h = this.hum
      setTimeout(() => { h.o1.stop(); h.o2.stop() }, 400)
      this.hum = null
    }
    if (this.winch) {
      this.winch.gain.gain.setTargetAtTime(0, t, 0.05)
      const w = this.winch
      setTimeout(() => w.o.stop(), 400)
      this.winch = null
    }
  }
}

function pair(a: MaterialName, b: MaterialName) {
  return new Set([a, b])
}
