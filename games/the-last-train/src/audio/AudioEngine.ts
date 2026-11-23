// 程序化声音引擎：全部声音都由 Web Audio 实时合成（没有任何录音素材），遵守自动播放限制——
// 只有在玩家点击“开始旅程 / 继续游戏”之后才创建 AudioContext。
import type { WorldId } from '../game/types'

type V3 = { x: number; y: number; z: number }

export type Surface = 'concrete' | 'metal' | 'wood' | 'wet' | 'glass' | 'sand' | 'marble' | 'carpet' | 'stone' | 'grate'

export type Sfx =
  | 'pickup' | 'objective' | 'success' | 'deny' | 'click' | 'hover' | 'open' | 'close' | 'inspect'
  | 'doorOpen' | 'doorClose' | 'horn' | 'thunder' | 'thunderNear' | 'lever' | 'servo' | 'heavy' | 'powerUp' | 'gravity'
  | 'ping' | 'bubbles' | 'timeStop' | 'timeResume' | 'tick' | 'chime' | 'locker' | 'dial' | 'punch' | 'glass' | 'whale' | 'insert' | 'paper' | 'bell' | 'clockStrike'

export interface LoopHandle {
  gain(v: number, ramp?: number): void
  freq?(f: number, ramp?: number): void
  pos?(p: V3): void
  stop(): void
}

const SCORES: Record<WorldId | 'transit' | 'menu' | 'none', { notes: number[]; cutoff: number; shimmer?: number; bells?: number[] }> = {
  menu: { notes: [45, 52, 59, 60], cutoff: 520 },
  station: { notes: [45, 52, 59, 60], cutoff: 560 },
  city: { notes: [53, 57, 60, 64, 69], cutoff: 1400, shimmer: 88 },
  abyss: { notes: [26, 33, 38, 45], cutoff: 260 },
  desert: { notes: [38, 45, 50, 57], cutoff: 700, shimmer: 93 },
  museum: { notes: [48, 55, 64], cutoff: 500, bells: [72, 74, 76, 79, 81, 84, 86, 88] },
  terminus: { notes: [48, 55, 62, 64, 71], cutoff: 1200, shimmer: 84 },
  transit: { notes: [40, 47, 54, 59], cutoff: 900 },
  none: { notes: [], cutoff: 400 },
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private musicBus!: GainNode
  private ambBus!: GainNode
  private sfxBus!: GainNode
  private reverb!: ConvolverNode
  private reverbSend!: GainNode
  private white!: AudioBuffer
  private pink!: AudioBuffer
  private brown!: AudioBuffer
  private vol = { master: 0.85, music: 0.7, ambience: 0.8, sfx: 0.85, muted: false }

  // 环境
  private rain: { hiss: GainNode; body: GainNode; filter: BiquadFilterNode; level: number; drops: number } | null = null
  private wind: { gain: GainNode; filter: BiquadFilterNode; level: number } | null = null
  private sea: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private dropTimer = 0
  // 列车
  private train: { rumble: GainNode; rumbleF: BiquadFilterNode; motor: OscillatorNode; motorG: GainNode; squeal: OscillatorNode; squealG: GainNode; bus: GainNode; muffle: BiquadFilterNode } | null = null
  private trainSpeed = 0
  private clackPhase = 0
  // 配乐
  private score: { voices: { o: OscillatorNode; g: GainNode }[]; filter: BiquadFilterNode; out: GainNode; shimmer: OscillatorNode | null } | null = null
  private scoreId: string = 'none'
  private bellTimer = 0
  private bells: number[] | null = null
  // 世界整体滤波（列车里、深海里会变闷）
  private worldFilter!: BiquadFilterNode
  time = 0

  get ready() {
    return !!this.ctx
  }

  /** 必须在用户手势里调用 */
  async start() {
    if (this.ctx) {
      // 不等待 resume：没有用户手势时 Promise 会一直挂起
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 3
    comp.attack.value = 0.01
    this.master.connect(comp).connect(ctx.destination)
    this.worldFilter = ctx.createBiquadFilter()
    this.worldFilter.type = 'lowpass'
    this.worldFilter.frequency.value = 20000
    this.worldFilter.connect(this.master)
    this.musicBus = ctx.createGain()
    this.ambBus = ctx.createGain()
    this.sfxBus = ctx.createGain()
    this.musicBus.connect(this.master)
    this.ambBus.connect(this.worldFilter)
    this.sfxBus.connect(this.master)
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.impulse(3.2, 2.6)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.35
    this.reverbSend.connect(this.reverb).connect(this.master)
    this.musicBus.connect(this.reverbSend)
    const sr = ctx.sampleRate
    this.white = ctx.createBuffer(1, sr * 3, sr)
    this.pink = ctx.createBuffer(1, sr * 3, sr)
    this.brown = ctx.createBuffer(1, sr * 3, sr)
    const w = this.white.getChannelData(0), p = this.pink.getChannelData(0), b = this.brown.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, br = 0
    for (let i = 0; i < w.length; i++) {
      const x = Math.random() * 2 - 1
      w[i] = x
      b0 = 0.99765 * b0 + x * 0.099046
      b1 = 0.963 * b1 + x * 0.2965164
      b2 = 0.57 * b2 + x * 1.0526913
      p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.18
      br = (br + 0.02 * x) / 1.02
      b[i] = br * 3.5
    }
    this.applyVolumes()
    if (ctx.state === 'suspended') void ctx.resume()
  }

  setVolumes(v: { master: number; music: number; ambience: number; sfx: number; muted: boolean }) {
    this.vol = { ...v }
    this.applyVolumes()
  }

  private applyVolumes() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : this.vol.master, t, 0.05)
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05)
    this.ambBus.gain.setTargetAtTime(this.vol.ambience, t, 0.05)
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05)
  }

  private impulse(sec: number, decay: number) {
    const ctx = this.ctx!
    const n = Math.floor(ctx.sampleRate * sec)
    const buf = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay)
    }
    return buf
  }

  setListener(pos: V3, fwd: V3, up: V3) {
    const ctx = this.ctx
    if (!ctx) return
    const l = ctx.listener
    if (l.positionX) {
      const t = ctx.currentTime
      l.positionX.setTargetAtTime(pos.x, t, 0.02)
      l.positionY.setTargetAtTime(pos.y, t, 0.02)
      l.positionZ.setTargetAtTime(pos.z, t, 0.02)
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02)
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02)
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02)
      l.upX.setTargetAtTime(up.x, t, 0.02)
      l.upY.setTargetAtTime(up.y, t, 0.02)
      l.upZ.setTargetAtTime(up.z, t, 0.02)
    } else {
      ;(l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z)
    }
  }

  /** 世界整体的“闷”程度：1 = 通透，0 = 隔着车厢 / 海水 */
  setOpenness(v: number) {
    if (!this.ctx) return
    this.worldFilter.frequency.setTargetAtTime(300 + Math.pow(v, 2) * 19700, this.ctx.currentTime, 0.3)
  }

  // ---------------- 基础构件 ----------------

  private noiseSrc(buf: AudioBuffer, loop = true) {
    const s = this.ctx!.createBufferSource()
    s.buffer = buf
    s.loop = loop
    if (loop) s.loopStart = Math.random() * 2
    return s
  }

  private panner(p: V3, ref = 2, roll = 1.2) {
    const pn = this.ctx!.createPanner()
    pn.panningModel = 'HRTF'
    pn.distanceModel = 'inverse'
    pn.refDistance = ref
    pn.rolloffFactor = roll
    pn.maxDistance = 400
    if (pn.positionX) {
      pn.positionX.value = p.x
      pn.positionY.value = p.y
      pn.positionZ.value = p.z
    } else (pn as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(p.x, p.y, p.z)
    return pn
  }

  /** 输出节点：可选空间定位 + 混响发送 */
  private out(at?: V3, bus?: GainNode, wet = 0.15, ref = 2) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    let tail: AudioNode = g
    if (at) {
      const pn = this.panner(at, ref)
      g.connect(pn)
      tail = pn
    }
    tail.connect(bus ?? this.sfxBus)
    if (wet > 0) {
      const s = ctx.createGain()
      s.gain.value = wet
      tail.connect(s).connect(this.reverbSend)
    }
    return g
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }

  private tone(f: number, t: number, dur: number, peak: number, dst: AudioNode, type: OscillatorType = 'sine', a = 0.005) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f
    const g = ctx.createGain()
    this.env(g, t, a, peak, dur)
    o.connect(g).connect(dst)
    o.start(t)
    o.stop(t + a + dur + 0.05)
    return o
  }

  private burst(buf: AudioBuffer, t: number, dur: number, peak: number, dst: AudioNode, type: BiquadFilterType, freq: number, q = 1, a = 0.003) {
    const ctx = this.ctx!
    const s = this.noiseSrc(buf, false)
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    this.env(g, t, a, peak, dur)
    s.connect(f).connect(g).connect(dst)
    s.start(t, Math.random() * 1.5)
    s.stop(t + a + dur + 0.05)
    return { s, f, g }
  }

  private bellTone(f: number, t: number, peak: number, dst: AudioNode, decay = 1.6) {
    const parts = [1, 2.76, 5.4, 8.93]
    const amp = [1, 0.45, 0.2, 0.08]
    parts.forEach((p, i) => this.tone(f * p, t, decay / (1 + i * 0.6), peak * amp[i], dst))
  }

  // ---------------- 一次性音效 ----------------

  play(name: Sfx, at?: V3, gain = 1) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + 0.005
    const W = this.white, B = this.brown, P = this.pink
    switch (name) {
      case 'hover': {
        const o = this.out(undefined, this.sfxBus, 0)
        this.tone(2200, t, 0.03, 0.025 * gain, o)
        break
      }
      case 'click': {
        const o = this.out(undefined, this.sfxBus, 0.05)
        this.tone(980, t, 0.05, 0.08 * gain, o, 'triangle')
        this.tone(1470, t + 0.02, 0.06, 0.05 * gain, o)
        break
      }
      case 'open':
      case 'close': {
        const o = this.out(undefined, this.sfxBus, 0.1)
        const { f } = this.burst(W, t, 0.35, 0.06 * gain, o, 'bandpass', name === 'open' ? 600 : 2400, 2, 0.08)
        f.frequency.exponentialRampToValueAtTime(name === 'open' ? 2400 : 500, t + 0.4)
        break
      }
      case 'inspect':
      case 'paper': {
        const o = this.out(at, this.sfxBus, 0.1)
        for (let i = 0; i < 3; i++) this.burst(W, t + i * 0.06 + Math.random() * 0.03, 0.08, 0.05 * gain, o, 'highpass', 3000 + Math.random() * 2000, 0.7)
        break
      }
      case 'pickup': {
        const o = this.out(undefined, this.sfxBus, 0.4)
        this.bellTone(660, t, 0.1 * gain, o, 1.4)
        this.bellTone(990, t + 0.09, 0.06 * gain, o, 1.6)
        break
      }
      case 'objective': {
        const o = this.out(undefined, this.sfxBus, 0.6)
        this.bellTone(220, t, 0.09 * gain, o, 3)
        this.bellTone(330, t + 0.25, 0.06 * gain, o, 3)
        break
      }
      case 'success': {
        const o = this.out(undefined, this.sfxBus, 0.6)
        ;[523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.bellTone(f, t + i * 0.11, 0.07 * gain, o, 2.2))
        break
      }
      case 'bell': {
        const o = this.out(at, this.sfxBus, 0.6, 4)
        this.bellTone(392, t, 0.12 * gain, o, 3.5)
        break
      }
      case 'clockStrike': {
        const o = this.out(at, this.sfxBus, 0.8, 8)
        ;[0, 1.6, 3.2].forEach((d) => this.bellTone(196, t + d, 0.16 * gain, o, 4))
        break
      }
      case 'deny': {
        const o = this.out(at, this.sfxBus, 0.1)
        const osc = this.tone(150, t, 0.18, 0.12 * gain, o, 'triangle')
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.18)
        this.burst(B, t, 0.08, 0.1 * gain, o, 'lowpass', 400)
        break
      }
      case 'doorOpen':
      case 'doorClose': {
        const o = this.out(at, this.sfxBus, 0.25, 3)
        this.burst(W, t, 0.7, 0.12 * gain, o, 'bandpass', 3200, 0.9, 0.02)
        const sl = this.burst(B, t + 0.1, 0.9, 0.25 * gain, o, 'lowpass', 300, 0.7, 0.2)
        sl.f.frequency.linearRampToValueAtTime(140, t + 1)
        const end = t + (name === 'doorClose' ? 1.05 : 1.0)
        const k = this.tone(70, end, 0.25, 0.4 * gain, o)
        k.frequency.exponentialRampToValueAtTime(40, end + 0.25)
        this.burst(W, end, 0.04, 0.12 * gain, o, 'highpass', 1500)
        break
      }
      case 'horn': {
        const o = this.out(at, this.sfxBus, 0.8, 30)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = 1600
        f.connect(o)
        for (const fr of [311.1, 370, 466.2]) {
          for (const det of [-4, 4]) {
            const osc = ctx.createOscillator()
            osc.type = 'sawtooth'
            osc.frequency.value = fr
            osc.detune.value = det
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.0001, t)
            g.gain.exponentialRampToValueAtTime(0.06 * gain, t + 0.15)
            g.gain.setValueAtTime(0.06 * gain, t + 2.0)
            g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8)
            osc.frequency.setValueAtTime(fr * 0.985, t)
            osc.frequency.linearRampToValueAtTime(fr, t + 0.2)
            osc.connect(g).connect(f)
            osc.start(t)
            osc.stop(t + 3)
          }
        }
        break
      }
      case 'thunder':
      case 'thunderNear': {
        const near = name === 'thunderNear'
        const o = this.out(undefined, this.ambBus, 0.6)
        const dur = near ? 5 : 6.5
        const { f, g } = this.burst(B, t, dur, (near ? 0.9 : 0.45) * gain, o, 'lowpass', near ? 2200 : 900, 0.5, near ? 0.01 : 0.4)
        f.frequency.exponentialRampToValueAtTime(120, t + dur)
        if (near) {
          this.burst(W, t, 0.25, 0.4 * gain, o, 'lowpass', 5000, 0.5, 0.002)
          for (let i = 0; i < 4; i++) this.burst(B, t + 0.3 + i * (0.35 + Math.random() * 0.5), 1.4, 0.35 * gain, o, 'lowpass', 600, 0.6, 0.02)
        }
        void g
        break
      }
      case 'lever': {
        const o = this.out(at, this.sfxBus, 0.3)
        this.burst(W, t, 0.05, 0.2 * gain, o, 'bandpass', 1800, 2)
        const k = this.tone(110, t + 0.12, 0.3, 0.35 * gain, o)
        k.frequency.exponentialRampToValueAtTime(55, t + 0.4)
        this.tone(1250, t + 0.12, 0.25, 0.03 * gain, o)
        break
      }
      case 'servo':
      case 'dial': {
        const o = this.out(at, this.sfxBus, 0.25)
        const dur = name === 'servo' ? 1.4 : 0.18
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = name === 'servo' ? 90 : 300
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.Q.value = 3
        bp.frequency.setValueAtTime(400, t)
        bp.frequency.linearRampToValueAtTime(1300, t + dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.08 * gain, t + 0.05)
        g.gain.setValueAtTime(0.08 * gain, t + dur - 0.1)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(bp).connect(g).connect(o)
        osc.start(t)
        osc.stop(t + dur + 0.05)
        const n = name === 'servo' ? 10 : 2
        for (let i = 0; i < n; i++) this.burst(W, t + (i / n) * dur, 0.02, 0.06 * gain, o, 'highpass', 2500)
        break
      }
      case 'heavy': {
        const o = this.out(at, this.sfxBus, 0.5, 8)
        const { f } = this.burst(B, t, 3.5, 0.6 * gain, o, 'lowpass', 220, 0.8, 0.4)
        f.frequency.linearRampToValueAtTime(90, t + 3.5)
        const sub = this.tone(38, t, 3.2, 0.3 * gain, o, 'sine', 0.5)
        sub.frequency.linearRampToValueAtTime(30, t + 3.2)
        for (let i = 0; i < 7; i++) this.burst(W, t + 0.2 + i * 0.42, 0.06, 0.05 * gain, o, 'bandpass', 900 + Math.random() * 600, 4)
        break
      }
      case 'powerUp': {
        const o = this.out(at, this.sfxBus, 0.4)
        const osc = this.tone(55, t, 2.6, 0.3 * gain, o, 'sawtooth', 0.6)
        osc.frequency.exponentialRampToValueAtTime(220, t + 2.2)
        this.tone(100, t + 1, 2.5, 0.08 * gain, o, 'square', 0.5)
        this.burst(W, t + 2.1, 0.3, 0.12 * gain, o, 'bandpass', 4000, 1)
        break
      }
      case 'gravity': {
        const o = this.out(undefined, this.sfxBus, 0.6)
        const { f } = this.burst(P, t, 1.6, 0.5 * gain, o, 'bandpass', 200, 1.2, 1.2)
        f.frequency.exponentialRampToValueAtTime(3000, t + 1.4)
        ;[146.8, 220, 293.7].forEach((fr) => this.tone(fr, t + 1.1, 2.2, 0.06 * gain, o, 'triangle', 0.05))
        break
      }
      case 'ping': {
        const o = this.out(at, this.sfxBus, 0.9)
        this.tone(1180, t, 2.4, 0.12 * gain, o)
        this.tone(1180, t + 0.62, 1.6, 0.04 * gain, o)
        this.tone(1180, t + 1.24, 1.2, 0.015 * gain, o)
        break
      }
      case 'bubbles': {
        const o = this.out(at, this.sfxBus, 0.4)
        for (let i = 0; i < 8; i++) {
          const tt = t + Math.random() * 0.8
          const osc = this.tone(300 + Math.random() * 300, tt, 0.06, 0.05 * gain, o)
          osc.frequency.exponentialRampToValueAtTime(900 + Math.random() * 500, tt + 0.06)
        }
        break
      }
      case 'timeStop': {
        const o = this.out(undefined, this.sfxBus, 0.8)
        const osc = this.tone(880, t, 0.9, 0.08 * gain, o, 'triangle', 0.01)
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.9)
        const { f } = this.burst(P, t, 0.9, 0.25 * gain, o, 'lowpass', 6000, 0.7)
        f.frequency.exponentialRampToValueAtTime(150, t + 0.9)
        this.bellTone(1760, t + 0.85, 0.03 * gain, o, 3)
        break
      }
      case 'timeResume': {
        const o = this.out(undefined, this.sfxBus, 0.5)
        const osc = this.tone(55, t, 0.7, 0.08 * gain, o, 'triangle', 0.4)
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.7)
        const { f } = this.burst(P, t, 0.7, 0.2 * gain, o, 'lowpass', 200, 0.7, 0.5)
        f.frequency.exponentialRampToValueAtTime(5000, t + 0.7)
        break
      }
      case 'tick': {
        const o = this.out(at, this.sfxBus, 0.2)
        this.burst(W, t, 0.015, 0.1 * gain, o, 'bandpass', 4200, 6)
        this.tone(2100, t, 0.03, 0.02 * gain, o)
        break
      }
      case 'chime': {
        // 车站广播提示音
        const o = this.out(at, this.sfxBus, 0.9, 10)
        ;[783.99, 659.25, 523.25, 392].forEach((f, i) => this.bellTone(f, t + i * 0.42, 0.08 * gain, o, 2.4))
        break
      }
      case 'locker': {
        const o = this.out(at, this.sfxBus, 0.2)
        this.burst(W, t, 0.03, 0.2 * gain, o, 'bandpass', 2600, 3)
        const k = this.tone(220, t + 0.05, 0.4, 0.15 * gain, o, 'triangle')
        k.frequency.exponentialRampToValueAtTime(180, t + 0.45)
        this.burst(B, t + 0.1, 0.6, 0.2 * gain, o, 'lowpass', 500, 1, 0.1)
        break
      }
      case 'punch': {
        const o = this.out(undefined, this.sfxBus, 0.15)
        this.burst(W, t, 0.03, 0.3 * gain, o, 'highpass', 2500)
        this.tone(1800, t, 0.12, 0.05 * gain, o)
        break
      }
      case 'insert': {
        const o = this.out(at, this.sfxBus, 0.3)
        this.burst(W, t, 0.06, 0.15 * gain, o, 'bandpass', 1500, 2)
        this.tone(440, t + 0.08, 0.6, 0.08 * gain, o)
        this.tone(660, t + 0.14, 0.8, 0.05 * gain, o)
        break
      }
      case 'glass': {
        const o = this.out(at, this.sfxBus, 0.4)
        ;[2300, 3400, 4700].forEach((f) => this.tone(f * (0.97 + Math.random() * 0.06), t, 0.8, 0.03 * gain, o))
        break
      }
      case 'whale': {
        const o = this.out(at, this.ambBus, 1.2, 60)
        const car = ctx.createOscillator()
        const mod = ctx.createOscillator()
        const mg = ctx.createGain()
        car.type = 'sine'
        mod.type = 'sine'
        const dur = 5.5
        car.frequency.setValueAtTime(110, t)
        car.frequency.exponentialRampToValueAtTime(260, t + dur * 0.4)
        car.frequency.exponentialRampToValueAtTime(85, t + dur)
        mod.frequency.value = 55
        mg.gain.value = 60
        mod.connect(mg).connect(car.frequency)
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 500
        bp.Q.value = 0.8
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.5 * gain, t + 1.2)
        g.gain.setValueAtTime(0.5 * gain, t + dur - 1.5)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        car.connect(bp).connect(g).connect(o)
        car.start(t); mod.start(t)
        car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1)
        break
      }
    }
  }

  /** 脚步：不同地面不同音色 */
  step(surface: Surface, intensity = 1) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + 0.005
    const o = this.out(undefined, this.sfxBus, surface === 'marble' ? 0.5 : 0.12)
    const k = intensity * (0.8 + Math.random() * 0.4)
    switch (surface) {
      case 'metal':
      case 'grate':
        this.burst(this.white, t, 0.05, 0.07 * k, o, 'bandpass', 1800 + Math.random() * 400, 3)
        this.tone(320 + Math.random() * 60, t, 0.12, 0.03 * k, o, 'triangle')
        break
      case 'wet':
        this.burst(this.brown, t, 0.08, 0.15 * k, o, 'lowpass', 500)
        this.burst(this.white, t + 0.01, 0.12, 0.05 * k, o, 'highpass', 2500, 0.7)
        break
      case 'sand':
        this.burst(this.pink, t, 0.16, 0.07 * k, o, 'bandpass', 1400, 0.7, 0.02)
        break
      case 'carpet':
        this.burst(this.brown, t, 0.07, 0.08 * k, o, 'lowpass', 300)
        break
      case 'wood':
        this.burst(this.brown, t, 0.06, 0.16 * k, o, 'lowpass', 700)
        this.tone(180, t, 0.07, 0.05 * k, o)
        break
      case 'glass':
        this.burst(this.brown, t, 0.05, 0.1 * k, o, 'lowpass', 600)
        this.tone(1900, t, 0.08, 0.008 * k, o)
        break
      case 'marble':
        this.burst(this.white, t, 0.03, 0.06 * k, o, 'bandpass', 2400, 1.5)
        this.burst(this.brown, t, 0.05, 0.12 * k, o, 'lowpass', 700)
        break
      default:
        this.burst(this.brown, t, 0.06, 0.15 * k, o, 'lowpass', 600)
        this.burst(this.white, t, 0.03, 0.03 * k, o, 'bandpass', 2000, 1.2)
    }
  }

  // ---------------- 持续音 ----------------

  /** 纯音（声碑、声呐、怀表的嗡鸣） */
  toneLoop(freq: number, at?: V3, type: OscillatorType = 'sine', vol = 0.1, bus: 'sfx' | 'amb' = 'sfx'): LoopHandle | null {
    const ctx = this.ctx
    if (!ctx) return null
    const o = this.out(at, bus === 'amb' ? this.ambBus : this.sfxBus, 0.3, 4)
    o.gain.value = 0
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    osc.connect(o)
    osc.start()
    o.gain.setTargetAtTime(vol, ctx.currentTime, 0.2)
    return {
      gain: (v, r = 0.2) => o.gain.setTargetAtTime(v, ctx.currentTime, r),
      freq: (f, r = 0.05) => osc.frequency.setTargetAtTime(f, ctx.currentTime, r),
      stop: () => {
        o.gain.setTargetAtTime(0, ctx.currentTime, 0.15)
        osc.stop(ctx.currentTime + 1)
      },
    }
  }

  /** 噪声持续音（收音机静电、时间倒转的呼啸、深海水流） */
  noiseLoop(kind: 'white' | 'pink' | 'brown', filter: BiquadFilterType, freq: number, q = 1, vol = 0.1, at?: V3): LoopHandle | null {
    const ctx = this.ctx
    if (!ctx) return null
    const o = this.out(at, this.sfxBus, 0.3, 3)
    o.gain.value = 0
    const s = this.noiseSrc(kind === 'white' ? this.white : kind === 'pink' ? this.pink : this.brown)
    const f = ctx.createBiquadFilter()
    f.type = filter
    f.frequency.value = freq
    f.Q.value = q
    s.connect(f).connect(o)
    s.start()
    o.gain.setTargetAtTime(vol, ctx.currentTime, 0.2)
    return {
      gain: (v, r = 0.2) => o.gain.setTargetAtTime(v, ctx.currentTime, r),
      freq: (fr, r = 0.1) => f.frequency.setTargetAtTime(fr, ctx.currentTime, r),
      stop: () => {
        o.gain.setTargetAtTime(0, ctx.currentTime, 0.15)
        s.stop(ctx.currentTime + 1)
      },
    }
  }

  /** 广播里含混的人声：共振峰噪声 + 音节包络（只是“像人在说话”，内容由字幕给出） */
  murmur(seconds: number, at?: V3, vol = 0.12) {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime + 0.05
    const o = this.out(at, this.sfxBus, 0.8, 10)
    const pa = ctx.createBiquadFilter()
    pa.type = 'bandpass'
    pa.frequency.value = 1200
    pa.Q.value = 0.6
    pa.connect(o)
    const src = ctx.createOscillator()
    src.type = 'sawtooth'
    src.frequency.value = 150
    const formants = [ctx.createBiquadFilter(), ctx.createBiquadFilter()]
    const g = ctx.createGain()
    g.gain.value = 0
    formants.forEach((f) => { f.type = 'bandpass'; f.Q.value = 8; src.connect(f); f.connect(g) })
    g.connect(pa)
    const vowels = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [660, 1720], [440, 1020]]
    let t = t0
    while (t < t0 + seconds) {
      const v = vowels[Math.floor(Math.random() * vowels.length)]
      const d = 0.09 + Math.random() * 0.14
      formants[0].frequency.setValueAtTime(v[0], t)
      formants[1].frequency.setValueAtTime(v[1], t)
      src.frequency.setValueAtTime(140 + Math.random() * 40, t)
      g.gain.setTargetAtTime(vol * (0.6 + Math.random() * 0.4), t, 0.015)
      g.gain.setTargetAtTime(0.0001, t + d * 0.75, 0.02)
      t += d + (Math.random() < 0.15 ? 0.25 : 0.02)
    }
    src.start(t0)
    src.stop(t + 0.3)
  }

  // ---------------- 环境（每帧由世界设置强度） ----------------

  setRain(level: number, muffled = 0) {
    const ctx = this.ctx
    if (!ctx) return
    if (!this.rain && level > 0) {
      const hiss = ctx.createGain(), body = ctx.createGain()
      hiss.gain.value = 0
      body.gain.value = 0
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 8000
      const a = this.noiseSrc(this.white), b = this.noiseSrc(this.pink)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 1200
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1400
      a.connect(hp).connect(hiss).connect(f)
      b.connect(lp).connect(body).connect(f)
      f.connect(this.ambBus)
      a.start(); b.start()
      this.rain = { hiss, body, filter: f, level: 0, drops: 0 }
    }
    if (!this.rain) return
    const t = ctx.currentTime
    this.rain.level = level
    this.rain.hiss.gain.setTargetAtTime(level * 0.09, t, 0.4)
    this.rain.body.gain.setTargetAtTime(level * 0.55, t, 0.4)
    this.rain.filter.frequency.setTargetAtTime(8000 - muffled * 7400, t, 0.3)
    this.rain.drops = muffled
  }

  setWind(level: number, bright = 0.5) {
    const ctx = this.ctx
    if (!ctx) return
    if (!this.wind && level > 0) {
      const g = ctx.createGain()
      g.gain.value = 0
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.Q.value = 0.8
      f.frequency.value = 500
      const s = this.noiseSrc(this.pink)
      s.connect(f).connect(g).connect(this.ambBus)
      s.start()
      this.wind = { gain: g, filter: f, level: 0 }
    }
    if (!this.wind) return
    this.wind.level = level
    this.wind.filter.frequency.setTargetAtTime(250 + bright * 900 + Math.sin(this.time * 0.37) * 120, ctx.currentTime, 0.5)
    this.wind.gain.gain.setTargetAtTime(level * (0.35 + 0.15 * Math.sin(this.time * 0.23) + 0.1 * Math.sin(this.time * 0.71)), ctx.currentTime, 0.6)
  }

  setSea(level: number) {
    const ctx = this.ctx
    if (!ctx) return
    if (!this.sea && level > 0) {
      const g = ctx.createGain()
      g.gain.value = 0
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 180
      const s = this.noiseSrc(this.brown)
      s.connect(f).connect(g).connect(this.ambBus)
      s.start()
      this.sea = { gain: g, filter: f }
    }
    if (!this.sea) return
    this.sea.gain.gain.setTargetAtTime(level * (0.5 + 0.2 * Math.sin(this.time * 0.15)), ctx.currentTime, 0.8)
  }

  // ---------------- 列车 ----------------

  /** speed: m/s；inside: 玩家是否在车厢里；at: 车头位置 */
  setTrain(speed: number, inside: boolean, braking: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    if (!this.train) {
      const bus = ctx.createGain()
      const muffle = ctx.createBiquadFilter()
      muffle.type = 'lowpass'
      muffle.frequency.value = 5000
      bus.connect(muffle).connect(this.sfxBus)
      const rumble = ctx.createGain()
      rumble.gain.value = 0
      const rumbleF = ctx.createBiquadFilter()
      rumbleF.type = 'lowpass'
      rumbleF.frequency.value = 120
      const s = this.noiseSrc(this.brown)
      s.connect(rumbleF).connect(rumble).connect(bus)
      s.start()
      const motor = ctx.createOscillator()
      motor.type = 'sawtooth'
      const mf = ctx.createBiquadFilter()
      mf.type = 'lowpass'
      mf.frequency.value = 500
      const motorG = ctx.createGain()
      motorG.gain.value = 0
      motor.connect(mf).connect(motorG).connect(bus)
      motor.start()
      const squeal = ctx.createOscillator()
      squeal.frequency.value = 2700
      const squealG = ctx.createGain()
      squealG.gain.value = 0
      squeal.connect(squealG).connect(bus)
      squeal.start()
      this.train = { rumble, rumbleF, motor, motorG, squeal, squealG, bus, muffle }
    }
    const tr = this.train
    const t = ctx.currentTime
    const v = Math.abs(speed)
    this.trainSpeed = v
    tr.rumble.gain.setTargetAtTime(Math.min(0.7, v * 0.022) + (v > 0.05 ? 0.04 : 0), t, 0.2)
    tr.rumbleF.frequency.setTargetAtTime(90 + v * 9, t, 0.2)
    tr.motor.frequency.setTargetAtTime(38 + v * 5.5, t, 0.1)
    tr.motorG.gain.setTargetAtTime(v > 0.05 ? 0.012 + Math.min(0.03, v * 0.0012) : 0.006, t, 0.3)
    const sq = braking && v < 12 && v > 0.3 ? (1 - v / 12) * 0.018 : 0
    tr.squealG.gain.setTargetAtTime(sq, t, 0.15)
    tr.squeal.frequency.setTargetAtTime(2600 + Math.sin(this.time * 9) * 60, t, 0.05)
    tr.muffle.frequency.setTargetAtTime(inside ? 1400 : 6000, t, 0.3)
  }

  // ---------------- 配乐 ----------------

  setScore(id: WorldId | 'transit' | 'menu' | 'none') {
    const ctx = this.ctx
    if (!ctx || id === this.scoreId) return
    this.scoreId = id
    const t = ctx.currentTime
    if (this.score) {
      const old = this.score
      old.out.gain.setTargetAtTime(0, t, 1.2)
      setTimeout(() => {
        old.voices.forEach((v) => v.o.stop())
        old.shimmer?.stop()
      }, 5000)
      this.score = null
    }
    const def = SCORES[id]
    this.bells = def.bells ?? null
    if (!def.notes.length) return
    const out = ctx.createGain()
    out.gain.value = 0
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = def.cutoff
    filter.Q.value = 0.4
    filter.connect(out).connect(this.musicBus)
    const voices = def.notes.flatMap((m, i) =>
      [-7, 7].map((det) => {
        const o = ctx.createOscillator()
        o.type = i === 0 ? 'triangle' : 'sawtooth'
        o.frequency.value = mtof(m)
        o.detune.value = det + (Math.random() - 0.5) * 4
        const g = ctx.createGain()
        g.gain.value = (i === 0 ? 0.05 : 0.022) / Math.sqrt(def.notes.length)
        o.connect(g).connect(filter)
        o.start()
        return { o, g }
      }),
    )
    let shimmer: OscillatorNode | null = null
    if (def.shimmer) {
      shimmer = ctx.createOscillator()
      shimmer.frequency.value = mtof(def.shimmer)
      const sg = ctx.createGain()
      sg.gain.value = 0.006
      shimmer.connect(sg).connect(out)
      shimmer.start()
    }
    out.gain.setTargetAtTime(1, t + 0.5, 2.5)
    this.score = { voices, filter, out, shimmer }
  }

  /** 每帧调用：慢速调制、雨滴、轮轨节奏、博物馆的钢琴音 */
  update(dt: number) {
    const ctx = this.ctx
    if (!ctx) return
    this.time += dt
    const t = ctx.currentTime
    if (this.score) {
      const def = SCORES[this.scoreId as keyof typeof SCORES]
      this.score.filter.frequency.setTargetAtTime(def.cutoff * (0.75 + 0.25 * Math.sin(this.time * 0.11)), t, 1)
      this.score.voices.forEach((v, i) => v.g.gain.setTargetAtTime(((i < 2 ? 0.05 : 0.022) / Math.sqrt(def.notes.length)) * (0.7 + 0.3 * Math.sin(this.time * (0.07 + i * 0.013) + i)), t, 1))
    }
    if (this.bells && this.score) {
      this.bellTimer -= dt
      if (this.bellTimer <= 0) {
        this.bellTimer = 2.2 + Math.random() * 3.5
        const m = this.bells[Math.floor(Math.random() * this.bells.length)]
        const g = ctx.createGain()
        g.connect(this.musicBus)
        const s = ctx.createGain()
        s.gain.value = 0.9
        g.connect(s).connect(this.reverbSend)
        this.bellTone(mtof(m), t + 0.01, 0.05, g, 2.6)
        if (Math.random() < 0.4) this.bellTone(mtof(m - 5), t + 0.4, 0.03, g, 2.6)
      }
    }
    // 雨滴颗粒
    if (this.rain && this.rain.level > 0.05) {
      this.dropTimer -= dt
      while (this.dropTimer <= 0) {
        this.dropTimer += 1 / (12 + this.rain.level * 30)
        const o = ctx.createGain()
        const pan = ctx.createStereoPanner()
        pan.pan.value = Math.random() * 2 - 1
        o.connect(pan).connect(this.rain.filter)
        this.burst(this.white, t + Math.random() * 0.03, 0.02 + Math.random() * 0.03, (0.02 + Math.random() * 0.05) * this.rain.level * (1 - this.rain.drops * 0.6), o, 'bandpass', 1800 + Math.random() * 4000, 2)
      }
    }
    // 轮轨：每 25 m 一处钢轨接缝，两个转向架 → 两两一组的“咔哒”
    if (this.train && this.trainSpeed > 0.4) {
      this.clackPhase += (this.trainSpeed * dt) / 25
      if (this.clackPhase >= 1) {
        this.clackPhase -= 1
        const v = Math.min(1, this.trainSpeed / 30)
        const gap = 2.6 / Math.max(1, this.trainSpeed)
        for (const d of [0, gap, 17 / Math.max(1, this.trainSpeed), 17 / Math.max(1, this.trainSpeed) + gap]) {
          if (d > 2) continue
          const k = this.tone(62, t + d, 0.09, 0.22 * v + 0.03, this.train.bus)
          k.frequency.exponentialRampToValueAtTime(40, t + d + 0.09)
          this.burst(this.white, t + d, 0.02, 0.04 * v, this.train.bus, 'bandpass', 2400, 2)
        }
      }
    }
  }

  suspend() {
    void this.ctx?.suspend()
  }
  resume() {
    void this.ctx?.resume()
  }
}

export const audio = new AudioEngine()
