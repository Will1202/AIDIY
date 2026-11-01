import type { Params } from './params'

/**
 * All sound is synthesised live with the Web Audio API — no samples, no score.
 * The context is created on the first user gesture (autoplay policy).
 */
type Cue = 'shock' | 'activate' | 'boom' | 'tear' | 'silence' | 'approach' | 'cross' | 'arrive' | 'reveal' | 'rebuild' | 'implode' | 'land' | 'hover'

const D_LYDIAN = [73.42, 110.0, 164.81, 207.65, 277.18, 369.99]

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private bus!: GainNode
  private reverbSend!: GainNode
  private white!: AudioBuffer
  private brown!: AudioBuffer
  private obsBed!: GainNode
  private uniBed!: GainNode
  private tremor!: GainNode
  private roar!: GainNode
  private roarFilter!: BiquadFilterNode
  private tunnel!: GainNode
  private tunnelFilter!: BiquadFilterNode
  private enabled = true
  private lastTear = 0

  get running() {
    return !!this.ctx && this.ctx.state === 'running'
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    try {
      this.ctx = new AC({ latencyHint: 'interactive' })
    } catch {
      return
    }
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? 0.9 : 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    comp.attack.value = 0.006
    comp.release.value = 0.25
    this.master.connect(comp).connect(ctx.destination)
    this.bus = ctx.createGain()
    this.bus.connect(this.master)
    const reverb = ctx.createConvolver()
    reverb.buffer = this.impulse(4.2, 2.6)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.55
    this.reverbSend.connect(reverb).connect(this.master)

    this.white = this.noise('white')
    this.brown = this.noise('brown')
    this.buildObservatoryBed()
    this.buildUniverseBed()
    this.buildLayers()
    this.scene('observatory', 2.5)
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.08)
  }

  // ------------------------------------------------------------ building blocks

  private noise(kind: 'white' | 'brown') {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        if (kind === 'white') d[i] = w
        else {
          last = (last + 0.02 * w) / 1.02
          d[i] = last * 3.5
        }
      }
    }
    return buf
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return buf
  }

  private loop(buf: AudioBuffer, rate = 1) {
    const s = this.ctx!.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.playbackRate.value = rate
    s.loopStart = Math.random() * 2
    s.start(0, Math.random() * 3)
    return s
  }

  private osc(type: OscillatorType, freq: number, detune = 0) {
    const o = this.ctx!.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.detune.value = detune
    o.start()
    return o
  }

  private lfo(freq: number, depth: number, target: AudioParam) {
    const o = this.osc('sine', freq)
    const g = this.ctx!.createGain()
    g.gain.value = depth
    o.connect(g).connect(target)
  }

  private buildObservatoryBed() {
    const ctx = this.ctx!
    this.obsBed = ctx.createGain()
    this.obsBed.gain.value = 0
    this.obsBed.connect(this.bus)
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 220
    low.connect(this.obsBed)
    const tones: [OscillatorType, number, number][] = [
      ['sine', 41.2, 0.32],
      ['sine', 55.21, 0.2],
      ['triangle', 82.4, 0.05],
      ['sine', 61.7, 0.06],
    ]
    for (const [t, f, g] of tones) {
      const gn = ctx.createGain()
      gn.gain.value = g
      this.osc(t, f).connect(gn).connect(low)
      this.lfo(0.05 + Math.random() * 0.08, g * 0.35, gn.gain)
    }
    const rumble = ctx.createBiquadFilter()
    rumble.type = 'lowpass'
    rumble.frequency.value = 170
    rumble.Q.value = 0.8
    const rg = ctx.createGain()
    rg.gain.value = 0.16
    this.loop(this.brown).connect(rumble).connect(rg).connect(this.obsBed)
    this.lfo(0.06, 70, rumble.frequency)
    const air = ctx.createBiquadFilter()
    air.type = 'bandpass'
    air.frequency.value = 3400
    air.Q.value = 0.6
    const ag = ctx.createGain()
    ag.gain.value = 0.006
    this.loop(this.white).connect(air).connect(ag).connect(this.obsBed)
    ag.connect(this.reverbSend)
  }

  private buildUniverseBed() {
    const ctx = this.ctx!
    this.uniBed = ctx.createGain()
    this.uniBed.gain.value = 0
    this.uniBed.connect(this.bus)
    const send = ctx.createGain()
    send.gain.value = 0.9
    this.uniBed.connect(send).connect(this.reverbSend)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 950
    lp.Q.value = 0.5
    lp.connect(this.uniBed)
    this.lfo(0.04, 420, lp.frequency)
    D_LYDIAN.forEach((f, i) => {
      const g = ctx.createGain()
      g.gain.value = 0.028 / (1 + i * 0.25)
      this.osc('sawtooth', f, -7).connect(g)
      this.osc('sawtooth', f, 7).connect(g)
      this.lfo(0.07 + i * 0.013, g.gain.value * 0.5, g.gain)
      g.connect(lp)
    })
    ;[1479.98, 1661.22, 2217.46].forEach((f, i) => {
      const g = ctx.createGain()
      g.gain.value = 0.004
      this.osc('sine', f).connect(g).connect(this.uniBed)
      this.lfo(0.21 + i * 0.07, 0.004, g.gain)
    })
    const sub = ctx.createGain()
    sub.gain.value = 0.12
    this.osc('sine', 36.71).connect(sub).connect(this.uniBed)
  }

  private buildLayers() {
    const ctx = this.ctx!
    // tremor: amplitude-modulated low rumble
    this.tremor = ctx.createGain()
    this.tremor.gain.value = 0
    const tf = ctx.createBiquadFilter()
    tf.type = 'lowpass'
    tf.frequency.value = 140
    const am = ctx.createGain()
    am.gain.value = 0.6
    this.lfo(7.3, 0.4, am.gain)
    this.loop(this.brown, 0.8).connect(tf).connect(am).connect(this.tremor).connect(this.bus)
    // roar: the accretion storm
    this.roar = ctx.createGain()
    this.roar.gain.value = 0
    this.roarFilter = ctx.createBiquadFilter()
    this.roarFilter.type = 'bandpass'
    this.roarFilter.frequency.value = 300
    this.roarFilter.Q.value = 0.7
    const rsh = ctx.createWaveShaper()
    rsh.curve = this.curve(2.2)
    this.loop(this.white).connect(this.roarFilter).connect(rsh).connect(this.roar).connect(this.bus)
    this.roar.connect(this.reverbSend)
    // tunnel: rushing, resonant wind
    this.tunnel = ctx.createGain()
    this.tunnel.gain.value = 0
    this.tunnelFilter = ctx.createBiquadFilter()
    this.tunnelFilter.type = 'bandpass'
    this.tunnelFilter.frequency.value = 900
    this.tunnelFilter.Q.value = 4
    this.lfo(5.5, 380, this.tunnelFilter.frequency)
    this.loop(this.white).connect(this.tunnelFilter).connect(this.tunnel).connect(this.bus)
    this.tunnel.connect(this.reverbSend)
  }

  private curve(k: number) {
    const n = 1024
    const c = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      c[i] = Math.tanh(x * k) / Math.tanh(k)
    }
    return c
  }

  private env(g: AudioParam, t: number, peak: number, attack: number, release: number) {
    g.cancelScheduledValues(t)
    g.setValueAtTime(0.0001, t)
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack)
    g.exponentialRampToValueAtTime(0.0001, t + attack + release)
  }

  private boom(t: number, f0: number, f1: number, peak: number, len: number) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.8)
    const g = ctx.createGain()
    this.env(g.gain, t, peak, 0.012, len)
    const sh = ctx.createWaveShaper()
    sh.curve = this.curve(1.6)
    o.connect(sh).connect(g).connect(this.bus)
    o.start(t)
    o.stop(t + len + 0.1)
  }

  private burst(t: number, len: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q = 1, wet = 0.4, pan = 0) {
    const ctx = this.ctx!
    const s = ctx.createBufferSource()
    s.buffer = this.white
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + len)
    const g = ctx.createGain()
    this.env(g.gain, t, peak, Math.min(0.02, len * 0.2), len)
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    s.connect(f).connect(g).connect(p)
    p.connect(this.bus)
    if (wet > 0) {
      const w = ctx.createGain()
      w.gain.value = wet
      p.connect(w).connect(this.reverbSend)
    }
    s.start(t, Math.random() * 3)
    s.stop(t + len + 0.1)
  }

  private swell(t: number, len: number, peak: number, f0: number, f1: number) {
    const ctx = this.ctx!
    const s = ctx.createBufferSource()
    s.buffer = this.white
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(f1, t + len)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + len)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08)
    s.connect(f).connect(g).connect(this.bus)
    g.connect(this.reverbSend)
    s.start(t, Math.random() * 3)
    s.stop(t + len + 0.2)
  }

  private tone(t: number, freq: number, peak: number, len: number, type: OscillatorType = 'sine', wet = 0.8) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = ctx.createGain()
    this.env(g.gain, t, peak, 0.02, len)
    o.connect(g).connect(this.bus)
    if (wet > 0) {
      const w = ctx.createGain()
      w.gain.value = wet
      g.connect(w).connect(this.reverbSend)
    }
    o.start(t)
    o.stop(t + len + 0.1)
  }

  scene(which: 'observatory' | 'universe' | 'none', fade = 1.5) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const set = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t)
      g.gain.setTargetAtTime(v, t, fade / 3)
    }
    set(this.obsBed, which === 'observatory' ? 1 : 0)
    set(this.uniBed, which === 'universe' ? 1 : 0)
  }

  cue(name: Cue) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime + 0.01
    switch (name) {
      case 'shock':
        this.boom(t, 95, 28, 0.9, 1.6)
        this.burst(t, 0.9, 0.22, 'highpass', 900, 300, 0.7, 0.8)
        break
      case 'activate': {
        this.boom(t, 170, 26, 0.55, 3.2)
        const s = ctx.createBufferSource()
        s.buffer = this.white
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.Q.value = 3
        f.frequency.setValueAtTime(260, t)
        f.frequency.exponentialRampToValueAtTime(2800, t + 2.6)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.16, t + 2.5)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0)
        s.connect(f).connect(g).connect(this.bus)
        g.connect(this.reverbSend)
        s.start(t)
        s.stop(t + 3.1)
        break
      }
      case 'boom':
        this.boom(t, 72, 34, 0.75, 1.0)
        this.burst(t, 0.05, 0.25, 'highpass', 2500, 1500, 0.5, 0.2)
        break
      case 'tear': {
        const now = performance.now()
        if (now - this.lastTear < 70) return
        this.lastTear = now
        const f0 = 700 + Math.random() * 2600
        this.burst(t, 0.18 + Math.random() * 0.3, 0.08 + Math.random() * 0.06, 'bandpass', f0, f0 * 0.25, 2.2, 0.5, Math.random() * 1.6 - 0.8)
        break
      }
      case 'silence': {
        const rel = (g: GainNode) => {
          g.gain.cancelScheduledValues(t)
          g.gain.setTargetAtTime(0, t, 0.07)
        }
        ;[this.obsBed, this.tremor, this.roar].forEach(rel)
        this.tone(t + 0.15, 5800, 0.006, 1.6, 'sine', 0)
        break
      }
      case 'approach': {
        this.swell(t, 3.2, 0.2, 140, 1600)
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.setValueAtTime(41, t)
        o.frequency.exponentialRampToValueAtTime(98, t + 4.4)
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 260
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.14, t + 4.2)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.6)
        o.connect(lp).connect(g).connect(this.bus)
        o.start(t)
        o.stop(t + 4.7)
        break
      }
      case 'cross':
        this.swell(t, 1.05, 0.5, 300, 9000)
        this.boom(t + 1.08, 120, 22, 1.0, 2.6)
        this.burst(t + 1.08, 3.2, 0.32, 'lowpass', 8000, 200, 0.5, 1.2)
        break
      case 'arrive':
        this.burst(t, 2.6, 0.22, 'highpass', 6000, 1200, 0.6, 1.4)
        this.boom(t, 60, 30, 0.45, 2.4)
        D_LYDIAN.forEach((f, i) => this.tone(t + i * 0.04, f * 2, 0.05, 4.5, 'triangle', 1.2))
        this.scene('universe', 3)
        break
      case 'reveal':
        ;[1174.66, 1760, 2349.32].forEach((f, i) => this.tone(t + i * 0.22, f, 0.035, 2.8, 'sine', 1.2))
        break
      case 'rebuild':
        this.swell(t, 1.6, 0.32, 4000, 180)
        this.scene('none', 1.2)
        break
      case 'implode':
        this.boom(t, 46, 140, 0.8, 1.3)
        this.burst(t, 1.8, 0.24, 'bandpass', 300, 4200, 1.2, 1.2)
        this.scene('observatory', 3)
        break
      case 'land':
        ;[587.33, 880, 1174.66, 1318.51].forEach((f, i) => this.tone(t + i * 0.12, f, 0.025, 1.4, 'sine', 1))
        break
      case 'hover':
        this.tone(t, 2400, 0.02, 0.04, 'sine', 0)
        break
    }
  }

  update(P: Params, tunnelSpeed: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    this.tremor.gain.setTargetAtTime(P.tremor * 0.22 + P.pull * 0.05, t, 0.1)
    this.roar.gain.setTargetAtTime(P.roar * 0.1, t, 0.12)
    this.roarFilter.frequency.setTargetAtTime(180 + P.roar * 1500 + P.consume * 600, t, 0.2)
    this.tunnel.gain.setTargetAtTime(P.tunnel * 0.12, t, 0.1)
    this.tunnelFilter.Q.setTargetAtTime(3 + Math.min(tunnelSpeed, 20) * 0.3, t, 0.2)
  }

  dispose() {
    void this.ctx?.close()
    this.ctx = null
  }
}
