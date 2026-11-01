import { type AudioFeatures, clamp01 } from './features'
import {
  BASS_KEYS,
  BEAT,
  BPM,
  DEMO_CLIMAX,
  DEMO_LENGTH,
  DEMO_TITLE,
  MID_KEYS,
  REVEAL_KEYS,
  TENSION_KEYS,
  TREBLE_KEYS,
  type ScoreEvent,
  buildScore,
  curve,
} from './demoScore'

/**
 * Scripted feature signal for DEMO mode. This is NOT audio analysis — it reads
 * the same score the DemoSynth plays and emits the features the score
 * describes. The UI labels it "SCRIPTED SIGNAL" so it's never mistaken for FFT.
 */
export class DemoConductor {
  private kicks: ScoreEvent[]
  private hats: ScoreEvent[]
  private hits: ScoreEvent[]
  private arps: ScoreEvent[]
  private melody: number[]
  private lastT = -1
  private hatEnv = 0
  private arpEnv = 0
  private melodyEnv = 0

  /** 0..1 emergence from darkness */
  reveal = 0
  /** True while the end title card should show */
  title = false
  /** True on the frame the scripted climax should begin */
  climaxNow = false

  constructor() {
    const ev = buildScore()
    this.kicks = ev.filter((e) => e.type === 'kick')
    this.hats = ev.filter((e) => e.type === 'hat' || e.type === 'openhat')
    this.hits = ev.filter((e) => e.type === 'clap' || e.type === 'snare' || e.type === 'impact')
    this.arps = ev.filter((e) => e.type === 'arp')
    // every lead / bell note start, so the sculpture also follows the melody
    this.melody = ev
      .filter((e) => e.type === 'lead' || e.type === 'bell')
      .flatMap((e) => (e.notes ?? []).map(([beat]) => e.t + beat * BEAT))
  }

  reset() {
    this.lastT = -1
    this.hatEnv = 0
    this.arpEnv = 0
    this.melodyEnv = 0
  }

  private crossed(a: number, b: number, t: number) {
    // (a, b] with loop wrap
    if (a <= b) return t > a && t <= b
    return t > a || t <= b
  }

  sample(t: number, dt: number, out: AudioFeatures) {
    const a = this.lastT < 0 ? t - 1e-4 : this.lastT
    const b = t
    out.beat = false
    out.drop = false
    out.kick *= Math.exp(-dt * 6.5)
    out.onset *= Math.exp(-dt * 9)
    this.hatEnv *= Math.exp(-dt * 14)
    this.arpEnv *= Math.exp(-dt * 18)
    this.melodyEnv *= Math.exp(-dt * 3)

    for (const k of this.kicks) {
      if (this.crossed(a, b, k.t)) {
        out.beat = true
        out.beatStrength = k.v
        out.beatCount++
        out.kick = Math.max(out.kick, k.v)
      }
    }
    for (const h of this.hats) if (this.crossed(a, b, h.t)) this.hatEnv = Math.max(this.hatEnv, h.v)
    for (const h of this.hits) if (this.crossed(a, b, h.t)) out.onset = Math.max(out.onset, h.v)
    for (const p of this.arps) if (this.crossed(a, b, p.t)) this.arpEnv = Math.max(this.arpEnv, p.v)
    for (const m of this.melody) if (this.crossed(a, b, m)) this.melodyEnv = 1

    this.climaxNow = this.crossed(a, b, DEMO_CLIMAX.at)
    out.drop = false
    this.lastT = t

    out.bass = clamp01(curve(BASS_KEYS, t) * 0.7 + out.kick * 0.42)
    out.mid = clamp01(curve(MID_KEYS, t) + out.onset * 0.08 + this.melodyEnv * 0.14)
    out.treble = clamp01(curve(TREBLE_KEYS, t) + this.hatEnv * 0.2 + this.arpEnv * 0.12 + out.onset * 0.12)
    out.energy = clamp01(out.bass * 0.45 + out.mid * 0.35 + out.treble * 0.2)
    out.tension = curve(TENSION_KEYS, t)
    out.bpm = BPM
    this.reveal = curve(REVEAL_KEYS, t)
    this.title = t >= DEMO_TITLE.from && t <= DEMO_TITLE.to

    // Synthetic spectrum shape for the HUD (labelled as scripted)
    const s = out.spectrum
    for (let i = 0; i < s.length; i++) {
      const x = i / (s.length - 1)
      const g = (c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (2 * w * w))
      const v =
        out.bass * g(0.08, 0.1) +
        out.mid * 0.8 * g(0.42, 0.18) +
        out.treble * 0.7 * g(0.78, 0.16) +
        0.04 * Math.sin(x * 37 + t * 5) * out.energy
      s[i] += (clamp01(v) - s[i]) * 0.35
    }
  }
}

export { DEMO_LENGTH }
