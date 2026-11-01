import { BEAT, DEMO_LENGTH, type Note, type ScoreEvent, buildScore, chordAtBar, midiHz } from './demoScore'

/**
 * Original melodic-electronica soundtrack for DEMO mode, synthesized entirely
 * with the Web Audio API. A look-ahead scheduler places every score event on
 * the AudioContext clock, so it stays locked to the DemoConductor.
 *
 * Signal flow
 *   drums / lead / arp / bell ───────────────┐
 *   pads / bass ─► duck (kick sidechain) ─────┤
 *   sends ─► ping-pong delay ─► reverb ───────┼─► bus ─► glue comp ─► soft clip ─► out
 */
export class DemoSynth {
  private ctx: BaseAudioContext
  private bus: GainNode
  private duck: GainNode
  private reverbIn: GainNode
  private delayIn: GainNode
  private noise: AudioBuffer
  private soft: PeriodicWave
  private events: ScoreEvent[] = buildScore()
  private timer: number | null = null
  private t0 = 0
  private scheduledUntil = 0
  private live = new Set<AudioScheduledSourceNode>()
  running = false

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx

    // master: glue compression + gentle tanh saturation
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 10
    comp.ratio.value = 3
    comp.attack.value = 0.006
    comp.release.value = 0.22
    const clip = ctx.createWaveShaper()
    const n = 2048
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = Math.tanh(1.4 * x) / Math.tanh(1.4)
    }
    clip.curve = curve
    clip.oversample = '2x'
    comp.connect(clip).connect(destination)

    this.bus = ctx.createGain()
    this.bus.gain.value = 0
    this.bus.connect(comp)

    this.duck = ctx.createGain()
    this.duck.connect(this.bus)

    // reverb: decorrelated stereo tail that darkens as it decays
    const verb = ctx.createConvolver()
    verb.buffer = this.makeImpulse(3.4)
    const verbHp = ctx.createBiquadFilter()
    verbHp.type = 'highpass'
    verbHp.frequency.value = 180
    const verbRet = ctx.createGain()
    verbRet.gain.value = 0.55
    this.reverbIn = ctx.createGain()
    this.reverbIn.connect(verbHp).connect(verb).connect(verbRet).connect(this.bus)

    // dotted-eighth ping-pong delay with damped feedback
    this.delayIn = ctx.createGain()
    const dl = ctx.createDelay(2)
    const dr = ctx.createDelay(2)
    dl.delayTime.value = dr.delayTime.value = BEAT * 0.75
    const fb = ctx.createGain()
    fb.gain.value = 0.42
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 3000
    const panL = ctx.createStereoPanner()
    const panR = ctx.createStereoPanner()
    panL.pan.value = -0.75
    panR.pan.value = 0.75
    const delOut = ctx.createGain()
    delOut.gain.value = 0.5
    this.delayIn.connect(dl)
    dl.connect(panL).connect(delOut)
    dl.connect(dr)
    dr.connect(panR).connect(delOut)
    dr.connect(damp).connect(fb).connect(dl)
    delOut.connect(this.bus)
    delOut.connect(this.reverbIn)

    const len = Math.floor(ctx.sampleRate * 2)
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    // a softened saw: harmonics fall off faster than 1/n, so it's warm rather than buzzy
    const H = 40
    const real = new Float32Array(H)
    const imag = new Float32Array(H)
    for (let k = 1; k < H; k++) imag[k] = (k % 2 ? 1 : -1) * Math.pow(k, -1.35) * (k > 18 ? Math.exp(-(k - 18) / 8) : 1)
    this.soft = ctx.createPeriodicWave(real, imag)
  }

  private makeImpulse(seconds: number) {
    const rate = this.ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const pre = Math.floor(0.02 * rate)
    const buf = this.ctx.createBuffer(2, len, rate)
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c)
      let lp = 0
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre)
        const a = 0.6 * Math.pow(1 - t, 1.6) + 0.035
        lp += a * (Math.random() * 2 - 1 - lp)
        ch[i] = lp * Math.pow(1 - t, 1.6) * Math.exp(-t * 3.4)
      }
      for (let k = 0; k < 7; k++) {
        const idx = pre + Math.floor((0.006 + k * 0.012 + Math.random() * 0.006) * rate)
        if (idx < len) ch[idx] += (Math.random() - 0.5) * 0.6 * (1 - k / 7)
      }
    }
    return buf
  }

  /** Loop-local time of the score for a given AudioContext time. */
  loopTime(now: number) {
    const t = now - this.t0
    return ((t % DEMO_LENGTH) + DEMO_LENGTH) % DEMO_LENGTH
  }

  start(at: number, offset = 0) {
    this.stop(true)
    this.t0 = at - offset
    this.scheduledUntil = at
    this.running = true
    const now = this.ctx.currentTime
    const g = this.bus.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(0, now)
    g.linearRampToValueAtTime(0.85, at + 0.05)
    this.duck.gain.cancelScheduledValues(now)
    this.duck.gain.setValueAtTime(1, now)
    this.tick()
    this.timer = window.setInterval(() => this.tick(), 25)
  }

  /** Schedule one whole loop at once (offline rendering / export). */
  scheduleLoop(at: number) {
    this.t0 = at
    this.bus.gain.setValueAtTime(0.85, at)
    for (const e of this.events) this.play(e, at + e.t)
  }

  stop(immediate = false) {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.running = false
    const now = this.ctx.currentTime
    const g = this.bus.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + (immediate ? 0.01 : 0.12))
    const stopAt = now + (immediate ? 0.02 : 0.14)
    this.live.forEach((n) => {
      try {
        n.stop(stopAt)
      } catch {
        /* already stopped */
      }
    })
    this.live.clear()
  }

  dispose() {
    this.stop(true)
    try {
      this.bus.disconnect()
      this.duck.disconnect()
      this.reverbIn.disconnect()
      this.delayIn.disconnect()
    } catch {
      /* ignore */
    }
  }

  private tick() {
    const now = this.ctx.currentTime
    const horizon = now + 0.2
    const from = Math.max(this.scheduledUntil, now)
    if (from >= horizon) return
    const L0 = Math.floor((from - this.t0) / DEMO_LENGTH)
    const L1 = Math.floor((horizon - this.t0) / DEMO_LENGTH)
    for (let L = L0; L <= L1; L++) {
      const base = this.t0 + L * DEMO_LENGTH
      for (const e of this.events) {
        const at = base + e.t
        if (at >= from && at < horizon) this.play(e, at)
      }
    }
    this.scheduledUntil = horizon
  }

  // ---- building blocks ------------------------------------------------------------

  private track<T extends AudioScheduledSourceNode>(n: T): T {
    this.live.add(n)
    n.onended = () => this.live.delete(n)
    return n
  }

  private osc(type: OscillatorType | 'soft', f: number, at: number, until: number) {
    const o = this.track(this.ctx.createOscillator())
    if (type === 'soft') o.setPeriodicWave(this.soft)
    else o.type = type
    o.frequency.value = f
    o.start(at)
    o.stop(until)
    return o
  }

  private noiseSrc(at: number, dur: number) {
    const s = this.track(this.ctx.createBufferSource())
    s.buffer = this.noise
    s.loop = true
    s.start(at, Math.random() * 1.5)
    s.stop(at + dur)
    return s
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    return b
  }

  private gain(v = 1) {
    const g = this.ctx.createGain()
    g.gain.value = v
    return g
  }

  private pan(p: number) {
    const s = this.ctx.createStereoPanner()
    s.pan.value = p
    return s
  }

  /** Exponential AD envelope. */
  private env(g: GainNode, at: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  }

  private sends(node: AudioNode, reverb: number, delay = 0) {
    if (reverb > 0) node.connect(this.gain(reverb)).connect(this.reverbIn)
    if (delay > 0) node.connect(this.gain(delay)).connect(this.delayIn)
  }

  private play(e: ScoreEvent, at: number) {
    switch (e.type) {
      case 'kick':
        return this.kick(at, e.v)
      case 'hat':
        return this.hat(at, e.v, e.pan ?? 0, false)
      case 'openhat':
        return this.hat(at, e.v, e.pan ?? 0, true)
      case 'clap':
        return this.clap(at, e.v)
      case 'snare':
        return this.snare(at, e.v, e.pan ?? 0)
      case 'bass':
        return this.bass(at, e.f ?? 55, e.d ?? 0.2, e.v, e.cut ?? 500)
      case 'pad':
        return this.pad(at, e.chord ?? [], e.d ?? 2, e.v, e.cut ?? 1500)
      case 'arp':
        return this.arp(at, e.f ?? 440, e.v, e.cut ?? 1500, e.pan ?? 0)
      case 'lead':
        return this.lead(at, e.notes ?? [], e.v)
      case 'bell':
        return this.bell(at, e.notes ?? [], e.v)
      case 'drone':
        return this.drone(at, e.f ?? 55, e.d ?? 4, e.v)
      case 'air':
        return this.air(at, e.d ?? 4, e.v)
      case 'riser':
        return this.riser(at, e.d ?? 2, e.v)
      case 'impact':
        return this.impact(at, e.v)
      case 'downlifter':
        return this.downlifter(at, e.d ?? 2, e.v)
    }
  }

  // ---- drums -------------------------------------------------------------------------

  private kick(at: number, v: number) {
    const o = this.osc('sine', 125, at, at + 0.42)
    o.frequency.setValueAtTime(125, at)
    o.frequency.exponentialRampToValueAtTime(52, at + 0.045)
    o.frequency.exponentialRampToValueAtTime(44, at + 0.32)
    const g = this.gain(0)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(v * 0.8, at + 0.003)
    g.gain.exponentialRampToValueAtTime(v * 0.36, at + 0.09)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.38)
    o.connect(g).connect(this.bus)

    const n = this.noiseSrc(at, 0.02)
    const ng = this.gain(0)
    this.env(ng, at, v * 0.07, 0.001, 0.008)
    n.connect(this.filter('highpass', 3500)).connect(ng).connect(this.bus)

    // sidechain: pads and bass breathe around every kick
    if (v > 0.4) {
      const dg = this.duck.gain
      dg.setValueAtTime(1 - 0.62 * v, at)
      dg.linearRampToValueAtTime(1, at + 0.32)
    }
  }

  private hat(at: number, v: number, p: number, open: boolean) {
    const dur = open ? 0.2 : 0.045
    const n = this.noiseSrc(at, dur + 0.02)
    const g = this.gain(0)
    this.env(g, at, v * (open ? 0.12 : 0.18), 0.001, dur)
    n.connect(this.filter('highpass', open ? 6500 : 7000))
      .connect(this.filter('bandpass', 10000, 0.7))
      .connect(g)
      .connect(this.pan(p))
      .connect(this.bus)
    if (open) this.sends(g, 0.15)
  }

  private clap(at: number, v: number) {
    const n = this.noiseSrc(at, 0.35)
    const g = this.gain(0)
    const p = v * 0.24
    g.gain.setValueAtTime(0.0001, at)
    for (let i = 0; i < 3; i++) {
      const t = at + i * 0.011
      g.gain.exponentialRampToValueAtTime(p, t + 0.001)
      g.gain.exponentialRampToValueAtTime(p * 0.2, t + 0.009)
    }
    g.gain.exponentialRampToValueAtTime(p * 0.7, at + 0.035)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
    n.connect(this.filter('highpass', 800)).connect(this.filter('bandpass', 1650, 0.9)).connect(g).connect(this.bus)
    this.sends(g, 0.5)
  }

  private snare(at: number, v: number, p: number) {
    const n = this.noiseSrc(at, 0.14)
    const g = this.gain(0)
    this.env(g, at, v * 0.24, 0.001, 0.1)
    const out = this.pan(p)
    n.connect(this.filter('bandpass', 1500 + 2500 * v, 0.7)).connect(g).connect(out)
    const o = this.osc('triangle', 210, at, at + 0.09)
    o.frequency.exponentialRampToValueAtTime(160, at + 0.05)
    const og = this.gain(0)
    this.env(og, at, v * 0.08, 0.001, 0.06)
    o.connect(og).connect(out)
    out.connect(this.bus)
    this.sends(out, 0.35)
  }

  // ---- tonal --------------------------------------------------------------------------

  private bass(at: number, f: number, d: number, v: number, cut: number) {
    const end = at + d + 0.08
    const o = this.osc('soft', f, at, end)
    const sub = this.osc('sine', f, at, end)
    const lp = this.filter('lowpass', cut, 1.1)
    lp.frequency.setValueAtTime(cut * 0.55, at)
    lp.frequency.exponentialRampToValueAtTime(cut, at + 0.012)
    lp.frequency.exponentialRampToValueAtTime(cut * 0.45, at + d)
    const g = this.gain(0)
    this.env(g, at, v * 0.14, 0.005, d)
    const sg = this.gain(0)
    this.env(sg, at, v * 0.26, 0.005, d)
    o.connect(lp).connect(g).connect(this.duck)
    sub.connect(sg).connect(this.duck)
  }

  private pad(at: number, chord: number[], d: number, v: number, cut: number) {
    const end = at + d + 1.2
    const lp = this.filter('lowpass', cut, 0.4)
    lp.frequency.setValueAtTime(cut * 0.7, at)
    lp.frequency.linearRampToValueAtTime(cut, at + d * 0.6)
    const g = this.gain(0)
    const peak = v * 0.036
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(peak, at + 0.45)
    g.gain.setValueAtTime(peak, at + d)
    g.gain.linearRampToValueAtTime(0.0001, at + d + 1.1)
    lp.connect(g).connect(this.duck)
    this.sends(g, 0.55)
    const spread = [-0.55, 0, 0.55]
    for (const f of chord) {
      ;[-12, 0, 12].forEach((det, i) => {
        const o = this.osc('soft', f, at, end)
        o.detune.value = det + (Math.random() - 0.5) * 4
        o.connect(this.pan(spread[i])).connect(lp)
      })
    }
  }

  private arp(at: number, f: number, v: number, cut: number, p: number) {
    const end = at + 0.4
    const o = this.osc('soft', f, at, end)
    const body = this.osc('sine', f, at, end)
    const lp = this.filter('lowpass', cut * 2.4, 2)
    lp.frequency.setValueAtTime(cut * 2.4, at)
    lp.frequency.exponentialRampToValueAtTime(Math.max(260, cut * 0.45), at + 0.24)
    const g = this.gain(0)
    this.env(g, at, v * 0.16, 0.003, 0.32)
    const bg = this.gain(0)
    this.env(bg, at, v * 0.1, 0.003, 0.22)
    const out = this.pan(p)
    o.connect(lp).connect(g).connect(out)
    body.connect(bg).connect(out)
    out.connect(this.bus)
    this.sends(out, 0.22, 0.34)
  }

  /** Monophonic legato lead: glides between notes, vibrato blooms on held notes. */
  private lead(at: number, notes: Note[], v: number) {
    if (!notes.length) return
    const last = notes[notes.length - 1]
    const end = at + (last[0] + last[2]) * BEAT
    const stopAt = end + 1.5
    const lp = this.filter('lowpass', 3800, 0.6)
    const g = this.gain(0)
    g.gain.setValueAtTime(0, at)
    const out = this.gain(1)
    lp.connect(g).connect(out)
    out.connect(this.bus)
    this.sends(out, 0.35, 0.3)

    const vib = this.osc('sine', 5.2, at, stopAt)
    const vibDepth = this.gain(0)
    vib.connect(vibDepth)
    const voices = [-7, 7].map((det) => {
      const o = this.osc('soft', midiHz(notes[0][1]), at, stopAt)
      o.detune.value = det
      vibDepth.connect(o.detune)
      o.connect(lp)
      return o
    })
    const sub = this.osc('sine', midiHz(notes[0][1]) / 2, at, stopAt)
    const subG = this.gain(0.35)
    sub.connect(subG).connect(lp)

    const peak = v * 0.075
    notes.forEach(([b, m, l], i) => {
      const t = at + b * BEAT
      const f = midiHz(m)
      for (const o of voices) {
        if (i === 0) o.frequency.setValueAtTime(f, t)
        else o.frequency.setTargetAtTime(f, t, 0.022)
      }
      if (i === 0) sub.frequency.setValueAtTime(f / 2, t)
      else sub.frequency.setTargetAtTime(f / 2, t, 0.022)
      g.gain.setTargetAtTime(peak, t, 0.012)
      const noteEnd = t + l * BEAT
      if (i < notes.length - 1) g.gain.setTargetAtTime(peak * 0.62, noteEnd - 0.05, 0.02)
      vibDepth.gain.setTargetAtTime(0, t, 0.02)
      if (l >= 1) vibDepth.gain.setTargetAtTime(l >= 2 ? 11 : 6, t + 0.22, 0.2)
    })
    g.gain.setTargetAtTime(0, end, 0.3)
  }

  /** FM bell: a harmonic modulator whose index decays — glassy, then pure. */
  private bell(at: number, notes: Note[], v: number) {
    for (const [b, m, l] of notes) {
      const t = at + b * BEAT
      const f = midiHz(m)
      const dur = Math.max(1.4, l * BEAT + 1.2)
      const car = this.osc('sine', f, t, t + dur + 0.1)
      const mod = this.osc('sine', f * 3, t, t + dur + 0.1)
      const idx = this.gain(0)
      idx.gain.setValueAtTime(f * 2.4, t)
      idx.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.9)
      mod.connect(idx).connect(car.frequency)
      const g = this.gain(0)
      this.env(g, t, v * 0.16, 0.004, dur)
      const shimmer = this.osc('sine', f * 2, t, t + 0.8)
      const sg = this.gain(0)
      this.env(sg, t, v * 0.04, 0.004, 0.7)
      car.connect(g)
      shimmer.connect(sg).connect(g)
      g.connect(this.bus)
      this.sends(g, 0.55, 0.4)
    }
  }

  private drone(at: number, f: number, d: number, v: number) {
    const g = this.gain(0)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(v * 0.1, at + d * 0.7)
    g.gain.linearRampToValueAtTime(0.0001, at + d)
    g.connect(this.duck)
    this.sends(g, 0.4)
    for (const [mul, a] of [
      [1, 1],
      [2, 0.35],
      [3, 0.12],
    ]) {
      const o = this.osc('sine', f * mul, at, at + d + 0.1)
      o.connect(this.gain(a)).connect(g)
    }
  }

  /** Airy shimmer: high band-passed noise drifting slowly, mostly reverb. */
  private air(at: number, d: number, v: number) {
    const n = this.noiseSrc(at, d + 0.1)
    const bp = this.filter('bandpass', 6000, 0.9)
    bp.frequency.setValueAtTime(5000, at)
    bp.frequency.linearRampToValueAtTime(9000, at + d * 0.6)
    bp.frequency.linearRampToValueAtTime(6500, at + d)
    const g = this.gain(0)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(v * 0.022, at + d * 0.45)
    g.gain.linearRampToValueAtTime(0.0001, at + d)
    const out = this.pan(0)
    out.pan.setValueAtTime(-0.4, at)
    out.pan.linearRampToValueAtTime(0.4, at + d)
    n.connect(bp).connect(g).connect(out).connect(this.bus)
    this.sends(out, 0.7)
  }

  // ---- transitions -------------------------------------------------------------------

  private riser(at: number, d: number, v: number) {
    const n = this.noiseSrc(at, d + 0.05)
    const bp = this.filter('bandpass', 400, 1.4)
    bp.frequency.setValueAtTime(400, at)
    bp.frequency.exponentialRampToValueAtTime(7000, at + d)
    const g = this.gain(0)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(v * 0.17, at + d)
    g.gain.linearRampToValueAtTime(0.0001, at + d + 0.03)
    n.connect(bp).connect(g).connect(this.bus)
    this.sends(g, 0.6)
    // a soft pitched sweep under the noise, plus a sub swell that pulls toward the drop
    const o = this.osc('soft', 110, at, at + d + 0.05)
    o.frequency.exponentialRampToValueAtTime(880, at + d)
    const olp = this.filter('lowpass', 600, 0.8)
    olp.frequency.exponentialRampToValueAtTime(5000, at + d)
    const og = this.gain(0)
    og.gain.setValueAtTime(0.0001, at)
    og.gain.exponentialRampToValueAtTime(v * 0.035, at + d)
    og.gain.linearRampToValueAtTime(0.0001, at + d + 0.03)
    o.connect(olp).connect(og).connect(this.bus)
    this.sends(og, 0.5)
    const sub = this.osc('sine', 55, at + d * 0.5, at + d + 0.05)
    sub.frequency.exponentialRampToValueAtTime(110, at + d)
    const sg = this.gain(0)
    sg.gain.setValueAtTime(0.0001, at + d * 0.5)
    sg.gain.exponentialRampToValueAtTime(v * 0.12, at + d - 0.05)
    sg.gain.linearRampToValueAtTime(0.0001, at + d)
    sub.connect(sg).connect(this.bus)
  }

  private impact(at: number, v: number) {
    const o = this.osc('sine', 65, at, at + 2.4)
    o.frequency.exponentialRampToValueAtTime(32, at + 1.4)
    const g = this.gain(0)
    this.env(g, at, v * 0.7, 0.004, 2.2)
    o.connect(g).connect(this.bus)

    const n = this.noiseSrc(at, 1.8)
    const lp = this.filter('lowpass', 2500)
    lp.frequency.exponentialRampToValueAtTime(140, at + 1.5)
    const ng = this.gain(0)
    this.env(ng, at, v * 0.16, 0.003, 1.6)
    n.connect(lp).connect(ng).connect(this.bus)
    this.sends(ng, 0.8)

    // a bright chord stab announcing the drop
    const chord = chordAtBar(8).pad
    const sg = this.gain(0)
    this.env(sg, at, v * 0.035, 0.006, 1.4)
    const slp = this.filter('lowpass', 3200, 0.5)
    slp.frequency.exponentialRampToValueAtTime(900, at + 1.2)
    slp.connect(sg).connect(this.bus)
    this.sends(sg, 0.7, 0.25)
    for (const m of [...chord, chord[0] + 12, chord[2] + 12]) {
      ;[-9, 9].forEach((det, i) => {
        const s = this.osc('soft', midiHz(m), at, at + 1.6)
        s.detune.value = det
        s.connect(this.pan(i ? 0.45 : -0.45)).connect(slp)
      })
    }
  }

  private downlifter(at: number, d: number, v: number) {
    const n = this.noiseSrc(at, d)
    const bp = this.filter('bandpass', 6000, 2)
    bp.frequency.setValueAtTime(6000, at)
    bp.frequency.exponentialRampToValueAtTime(250, at + d)
    const g = this.gain(0)
    g.gain.setValueAtTime(v * 0.07, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + d)
    n.connect(bp).connect(g).connect(this.bus)
    this.sends(g, 0.5)
  }
}
