import type { Engine } from '../engine/Engine'
import type { Prop } from '../physics/Props'
import type { Portal, WorldId } from '../portal/Portal'

/**
 * Everything you hear is synthesised live with Web Audio — no samples, no
 * licensed music. Ambience cross-fades between the two worlds, portals hum
 * with distance, and collisions ring with a timbre per material.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private labBus!: GainNode
  private otherBus!: GainNode
  private humGain!: GainNode
  private rewindNodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null
  private noise!: AudioBuffer
  private muted = false
  private impacts = 0
  private impactWindow = 0

  resume() {
    if (!this.ctx) this.build()
    void this.ctx!.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  private build() {
    const ctx = new AudioContext()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 4
    comp.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    this.master.connect(comp)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    // lab: a cold ventilation drone with a sub hum
    this.labBus = ctx.createGain()
    this.labBus.gain.value = 0
    this.labBus.connect(this.master)
    for (const [f, g] of [[55, 0.05], [55.4, 0.05], [110.3, 0.02]] as const) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 180
      const gn = ctx.createGain()
      gn.gain.value = g
      o.connect(lp).connect(gn).connect(this.labBus)
      o.start()
    }
    this.loopNoise(this.labBus, 'bandpass', 420, 0.6, 0.05)
    // other side: an airy pad (A, E, C#, G#) breathing slowly
    this.otherBus = ctx.createGain()
    this.otherBus.gain.value = 0
    this.otherBus.connect(this.master)
    ;[110, 164.8, 277.2, 415.3, 659.3].forEach((f, i) => {
      const o = ctx.createOscillator()
      o.type = i < 2 ? 'triangle' : 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = 0
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.05 + i * 0.023
      const lg = ctx.createGain()
      lg.gain.value = 0.018
      lfo.connect(lg).connect(g.gain)
      g.gain.value = 0.022
      o.connect(g).connect(this.otherBus)
      o.start()
      lfo.start()
    })
    this.loopNoise(this.otherBus, 'highpass', 3000, 0.4, 0.025)
    // portal hum
    this.humGain = ctx.createGain()
    this.humGain.gain.value = 0
    this.humGain.connect(this.master)
    for (const [f, type] of [[82.4, 'triangle'], [164.8, 'sine'], [247.2, 'sine']] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      const am = ctx.createOscillator()
      am.frequency.value = 5.3
      const amg = ctx.createGain()
      amg.gain.value = 0.3
      const g = ctx.createGain()
      g.gain.value = 0.5
      am.connect(amg).connect(g.gain)
      o.connect(g).connect(this.humGain)
      o.start()
      am.start()
    }
  }

  private loopNoise(dst: AudioNode, type: BiquadFilterType, f: number, q: number, gain: number) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filt = ctx.createBiquadFilter()
    filt.type = type
    filt.frequency.value = f
    filt.Q.value = q
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(filt).connect(g).connect(dst)
    src.start()
  }

  private burst(opts: { f0: number; f1: number; q: number; dur: number; gain: number; type?: BiquadFilterType; delay?: number }) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + (opts.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filt = ctx.createBiquadFilter()
    filt.type = opts.type ?? 'bandpass'
    filt.Q.value = opts.q
    filt.frequency.setValueAtTime(opts.f0, t)
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + opts.dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(opts.gain, t + Math.min(0.03, opts.dur * 0.2))
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    src.connect(filt).connect(g).connect(this.master)
    src.start(t, Math.random())
    src.stop(t + opts.dur + 0.05)
  }

  private tone(opts: { f: number; f1?: number; dur: number; gain: number; type?: OscillatorType; delay?: number; attack?: number }) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + (opts.delay ?? 0)
    const o = ctx.createOscillator()
    o.type = opts.type ?? 'sine'
    o.frequency.setValueAtTime(opts.f, t)
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.005))
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + opts.dur + 0.05)
  }

  cross(world: WorldId) {
    this.burst({ f0: 260, f1: 3200, q: 1.2, dur: 0.7, gain: 0.35 })
    this.tone({ f: 70, f1: 38, dur: 0.9, gain: 0.35, type: 'sine' })
    this.tone({ f: world === 1 ? 659 : 440, dur: 1.4, gain: 0.06, delay: 0.1, attack: 0.15 })
  }

  propCross(_p: Prop, _from: Portal) {
    this.tone({ f: 1320, f1: 2640, dur: 0.25, gain: 0.05, type: 'sine' })
  }

  impact(p: Prop, force: number) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (now - this.impactWindow > 0.1) { this.impactWindow = now; this.impacts = 0 }
    if (++this.impacts > 10) return
    const v = Math.min(1, Math.sqrt(force) / 60)
    if (v < 0.04) return
    const gain = 0.02 + v * 0.3
    switch (p.kind) {
      case 'cube':
      case 'canister':
        this.tone({ f: 180 + Math.random() * 40, f1: 120, dur: 0.18, gain: gain * 0.8, type: 'triangle' })
        this.tone({ f: 1130 + Math.random() * 200, dur: 0.3, gain: gain * 0.25 })
        this.burst({ f0: 900, f1: 300, q: 2, dur: 0.08, gain: gain * 0.6 })
        break
      case 'glass':
      case 'shard':
        this.tone({ f: 2200 + Math.random() * 1400, dur: 0.35, gain: gain * 0.25 })
        this.tone({ f: 3900 + Math.random() * 900, dur: 0.22, gain: gain * 0.15 })
        this.burst({ f0: 5000, f1: 2500, q: 3, dur: 0.05, gain: gain * 0.4 })
        break
      default:
        this.tone({ f: 420 + Math.random() * 120, f1: 300, dur: 0.2, gain: gain * 0.4 })
        this.burst({ f0: 1400, f1: 500, q: 2, dur: 0.06, gain: gain * 0.4 })
    }
  }

  gravity(dir: number) {
    this.tone({ f: 90, f1: 28, dur: 1.6, gain: 0.55, type: 'sine' })
    this.tone({ f: dir < 0 ? 220 : 660, f1: dir < 0 ? 660 : 220, dur: 0.9, gain: 0.08, type: 'sawtooth' })
    this.burst({ f0: 120, f1: 3000, q: 0.8, dur: 1.1, gain: 0.25 })
  }

  rewind(on: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    if (on && !this.rewindNodes) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = 160
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 7
      const lg = ctx.createGain()
      lg.gain.value = 40
      lfo.connect(lg).connect(osc.frequency)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.2)
      osc.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 1.5)
      osc.connect(lp).connect(gain).connect(this.master)
      osc.start()
      lfo.start()
      this.rewindNodes = { osc, lfo, gain }
      this.burst({ f0: 3000, f1: 200, q: 1, dur: 0.5, gain: 0.2 })
    } else if (!on && this.rewindNodes) {
      const { osc, lfo, gain } = this.rewindNodes
      const t = ctx.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
      osc.frequency.cancelScheduledValues(t)
      osc.frequency.setValueAtTime(osc.frequency.value, t)
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.25)
      osc.stop(t + 0.3)
      lfo.stop(t + 0.3)
      this.rewindNodes = null
      this.tone({ f: 120, f1: 60, dur: 0.4, gain: 0.25 })
    }
  }

  grab(on: boolean) { this.tone({ f: on ? 520 : 380, f1: on ? 780 : 260, dur: 0.12, gain: 0.08, type: 'triangle' }) }
  throw() { this.burst({ f0: 400, f1: 2400, q: 1, dur: 0.25, gain: 0.25 }); this.tone({ f: 200, f1: 90, dur: 0.2, gain: 0.15 }) }
  pulse(hit: boolean) { this.tone({ f: hit ? 140 : 220, f1: 60, dur: 0.25, gain: 0.25 }); this.burst({ f0: 2000, f1: 200, q: 0.8, dur: 0.2, gain: 0.15 }) }
  place(ok: boolean) {
    if (ok) { this.tone({ f: 330, f1: 990, dur: 0.6, gain: 0.12 }); this.burst({ f0: 200, f1: 4000, q: 1, dur: 0.6, gain: 0.18 }) }
    else this.tone({ f: 160, dur: 0.18, gain: 0.12, type: 'square' })
  }
  step(v: number) { this.burst({ f0: 300, f1: 120, q: 1, dur: 0.08, gain: 0.05 * v }) }
  launch() { this.tone({ f: 60, f1: 420, dur: 0.35, gain: 0.3, type: 'sawtooth' }); this.burst({ f0: 600, f1: 6000, q: 0.7, dur: 0.35, gain: 0.3 }) }
  powerOn() { this.tone({ f: 50, f1: 100, dur: 2.5, gain: 0.2, attack: 0.4 }); for (let i = 0; i < 6; i++) this.burst({ f0: 3000, f1: 1500, q: 4, dur: 0.05, gain: 0.08, delay: 0.25 + i * 0.27 }) }
  portalOpen() { this.tone({ f: 110, f1: 440, dur: 1.4, gain: 0.15, attack: 0.3 }); this.burst({ f0: 200, f1: 5000, q: 1.5, dur: 1.2, gain: 0.15 }) }

  /** per-frame mix: ambience per world, hum by distance to the nearest open portal */
  update(e: Engine, _dt: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const w = e.viewWorld
    this.labBus.gain.setTargetAtTime(w === 0 ? 0.9 * Math.max(0.3, e.lab.power) : 0, t, 0.3)
    this.otherBus.gain.setTargetAtTime(w === 1 ? 1 : 0, t, 0.3)
    let near = 1e9
    for (const p of e.portals) {
      if (p.world !== w || p.open < 0.05) continue
      near = Math.min(near, p.position.distanceTo(e.camera.position))
    }
    const h = near < 1e8 ? Math.min(0.12, 0.6 / (1 + near * 0.5)) : 0
    this.humGain.gain.setTargetAtTime(h, t, 0.1)
  }
}
