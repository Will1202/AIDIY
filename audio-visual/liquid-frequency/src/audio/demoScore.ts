/**
 * The 30-second DEMO choreography — an original piece of melodic electronica.
 * One score drives both the synthesized soundtrack (DemoSynth) and the scripted
 * feature signal (DemoConductor), so sound and picture share one timeline.
 *
 * 128 BPM: 30 s is exactly 16 bars and the drop at 15 s lands on bar 9's downbeat.
 *
 *  bars  0–1   0.00 – 3.75   intro: pad swell, filtered arp — the metal emerges
 *  bars  2–3   3.75 – 7.50   groove: four-on-the-floor, offbeat bass
 *  bars  4–6   7.50 – 13.1   heavier: claps, rolling hats, brighter arp
 *  bar   7    13.1 – 15.0    build: kick drops out, snare roll, riser, Gsus tension
 *  bars  8–10 15.0 – 20.6    DROP: impact, lead hook, rolling bass, sidechain pump
 *  bar  11    20.6 – 22.5    transition: drums out, the hook's last note rings
 *  bars 12–13 22.5 – 26.3    breakdown: half-time pulse, the liquid reforms
 *  bars 14–15 26.3 – 30.0    outro: bell echo of the hook, title, fade to loop
 *
 * Progression (A minor): Am9 Am9 | Fmaj7 G6 | Am9 Em7 | Fmaj7 Gsus |
 *                        Am9 Fmaj7 | Cmaj7 G6 | Fmaj7 Em7 | Am9 Am9
 */

export const DEMO_LENGTH = 30
export const BPM = 128
export const BEAT = 60 / BPM
export const BAR = BEAT * 4

export const DEMO_CLIMAX = { at: 7 * BAR, pre: BAR, scatter: 3 * BAR, gather: 4.0, reform: 1.4 }
export const DEMO_TITLE = { from: 14 * BAR, to: 29.3 }

export type ScoreEventType =
  | 'kick'
  | 'hat'
  | 'openhat'
  | 'clap'
  | 'snare'
  | 'bass'
  | 'pad'
  | 'arp'
  | 'lead'
  | 'bell'
  | 'drone'
  | 'air'
  | 'riser'
  | 'impact'
  | 'downlifter'

/** [beat offset from event start, midi note, length in beats] */
export type Note = [number, number, number]

export interface ScoreEvent {
  t: number
  type: ScoreEventType
  v: number
  /** frequency (Hz) for single-note events */
  f?: number
  /** duration (s) */
  d?: number
  /** pad chord (Hz) */
  chord?: number[]
  /** filter cutoff (Hz) for arp / pad / bass */
  cut?: number
  /** stereo position −1..1 */
  pan?: number
  /** monophonic phrases (lead / bell) */
  notes?: Note[]
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

interface Chord {
  root: number
  pad: number[]
  arp: number[]
}

// Rootless, voice-led pad voicings; arp sets are 1-5-8-9-10-12 shapes.
const CHORDS: Record<string, Chord> = {
  Am9: { root: 33, pad: [60, 64, 67, 71], arp: [57, 64, 69, 71, 72, 76] },
  Fmaj7: { root: 29, pad: [57, 60, 64, 67], arp: [53, 60, 65, 67, 69, 72] },
  G6: { root: 31, pad: [59, 62, 64, 69], arp: [55, 62, 67, 69, 71, 74] },
  Em7: { root: 28, pad: [59, 62, 64, 67], arp: [52, 59, 64, 67, 71, 74] },
  Cmaj7: { root: 36, pad: [55, 59, 62, 64], arp: [60, 64, 67, 71, 72, 76] },
  Gsus: { root: 31, pad: [60, 62, 67, 69], arp: [55, 62, 67, 72, 74, 79] },
}
const PROG = ['Am9', 'Am9', 'Fmaj7', 'G6', 'Am9', 'Em7', 'Fmaj7', 'Gsus', 'Am9', 'Fmaj7', 'Cmaj7', 'G6', 'Fmaj7', 'Em7', 'Am9', 'Am9']

export function chordAtBar(bar: number): Chord {
  return CHORDS[PROG[Math.max(0, Math.min(PROG.length - 1, bar))]]
}

// The hook (drop, bars 8–11): E D C D E | C A C D E | G E D C D | B D~
const HOOK: Note[] = [
  [0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 74, 0.5], [3.5, 76, 0.5],
  [4, 72, 1.5], [5.5, 69, 0.5], [6, 72, 1], [7, 74, 0.5], [7.5, 76, 0.5],
  [8, 79, 1.5], [9.5, 76, 0.5], [10, 74, 1], [11, 72, 0.5], [11.5, 74, 0.5],
  [12, 71, 0.5], [12.5, 74, 3.3],
]
// Outro: the hook's opening, slowed down on a bell, resolving to A.
const ECHO: Note[] = [
  [0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 2], [4, 69, 3.6],
]

// 16-step arp contour per bar: up through the chord, then a wider variation.
const ARP_STEPS = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 4, 5, 4, 2, 1]

export function buildScore(): ScoreEvent[] {
  const ev: ScoreEvent[] = []
  const bt = (b: number) => b * BEAT

  // ---- harmony -------------------------------------------------------------
  for (let bar = 0; bar < 16; bar++) {
    const c = chordAtBar(bar)
    const t = bar * BAR
    const v = bar < 2 ? 0.6 : bar === 7 ? 1.15 : bar >= 8 && bar <= 10 ? 0.9 : bar >= 14 ? 0.7 : 0.75
    const cut = bar < 2 ? 1100 : bar < 4 ? 2000 : bar < 7 ? 2500 : bar === 7 ? 3600 : bar <= 10 ? 3400 : 2200
    const d = bar === 15 ? BAR * 0.92 : BAR
    ev.push({ t, type: 'pad', v, d, cut, chord: c.pad.map(midiHz) })
    if (bar === 14) ev.push({ t, type: 'pad', v: 0.6, d: BAR * 1.95, cut: 1200, chord: c.pad.map(midiHz) })
  }
  ev.push({ t: 0, type: 'drone', v: 0.7, d: 2 * BAR + 0.3, f: midiHz(33) })
  ev.push({ t: 0, type: 'air', v: 0.8, d: 2 * BAR + 0.4 })
  ev.push({ t: 11 * BAR, type: 'air', v: 0.9, d: 3 * BAR + 0.4 })

  // ---- arpeggio --------------------------------------------------------------
  for (let bar = 0; bar < 16; bar++) {
    const c = chordAtBar(bar)
    for (let s = 0; s < 16; s++) {
      const t = bar * BAR + s * (BEAT / 4)
      const k = s / 16
      let v = 0.4
      let cut = 1400
      if (bar < 2) {
        v = 0.22 + 0.12 * ((bar * 16 + s) / 32)
        cut = 700 + 500 * ((bar * 16 + s) / 32)
      } else if (bar < 4) {
        v = 0.5
        cut = 2300
      } else if (bar < 7) {
        v = 0.52
        cut = 2900
      } else if (bar === 7) {
        v = 0.45 + 0.35 * k
        cut = 2200 + 4200 * k
      } else if (bar <= 10) {
        v = 0.36
        cut = 3200
      } else if (bar <= 13) {
        v = 0.52
        cut = 2800
      } else {
        v = 0.4 * (1 - ((bar - 14) * 16 + s) / 32) + 0.05
        cut = 1600
      }
      if (s % 4 === 0) v *= 1.15
      ev.push({ t, type: 'arp', v, cut, f: midiHz(c.arp[ARP_STEPS[s]]), pan: s % 2 ? 0.18 : -0.18 })
    }
  }

  // ---- drums -----------------------------------------------------------------
  for (let b = 8; b <= 27; b++) ev.push({ t: bt(b), type: 'kick', v: b < 16 ? 0.68 : 0.95 })
  ev.push({ t: 15, type: 'impact', v: 1 })
  for (let b = 32; b <= 43; b++) ev.push({ t: bt(b), type: 'kick', v: 1 })
  ;[48, 50, 52, 54].forEach((b, i) => ev.push({ t: bt(b), type: 'kick', v: 0.62 - i * 0.04 }))
  ev.push({ t: bt(56), type: 'kick', v: 0.45 })
  ev.push({ t: bt(60), type: 'kick', v: 0.3 })

  // hats: offbeat 8ths in the groove, soft 16ths in the heavy section, full 16ths + open hats in the drop
  for (let b = 8; b < 28; b++) {
    ev.push({ t: bt(b) + BEAT / 2, type: 'hat', v: b < 16 ? 0.4 : 0.55, pan: 0.12 })
    if (b >= 16) {
      ev.push({ t: bt(b) + BEAT / 4, type: 'hat', v: 0.18, pan: -0.2 })
      ev.push({ t: bt(b) + (BEAT * 3) / 4, type: 'hat', v: 0.22, pan: 0.25 })
    }
  }
  for (let b = 32; b < 44; b++) {
    ev.push({ t: bt(b) + BEAT / 4, type: 'hat', v: 0.26, pan: -0.22 })
    ev.push({ t: bt(b) + BEAT / 2, type: 'openhat', v: 0.5, pan: 0.15 })
    ev.push({ t: bt(b) + (BEAT * 3) / 4, type: 'hat', v: 0.3, pan: 0.25 })
  }

  // claps on 2 & 4
  for (let b = 17; b <= 27; b += 2) ev.push({ t: bt(b), type: 'clap', v: 0.75 })
  for (let b = 33; b <= 43; b += 2) ev.push({ t: bt(b), type: 'clap', v: 0.85 })

  // snare roll through the build bar, leaving a breath of silence before the drop
  const roll = (from: number, to: number, step: number) => {
    for (let t = from; t < to - 1e-6; t += step) {
      const k = (t - 7 * BAR) / BAR
      ev.push({ t, type: 'snare', v: 0.22 + 0.6 * k, pan: (Math.random() - 0.5) * 0.3 })
    }
  }
  roll(7 * BAR, 7 * BAR + 2 * BEAT, BEAT / 2)
  roll(7 * BAR + 2 * BEAT, 7 * BAR + 3 * BEAT, BEAT / 4)
  roll(7 * BAR + 3 * BEAT, 15 - BEAT / 4, BEAT / 8)

  ev.push({ t: 6 * BAR, type: 'riser', v: 1, d: 2 * BAR - 0.08 })
  ev.push({ t: 11 * BAR, type: 'downlifter', v: 0.8, d: BAR * 1.2 })

  // ---- bass --------------------------------------------------------------------
  for (let b = 8; b < 28; b++) {
    const r = chordAtBar(Math.floor(b / 4)).root
    ev.push({ t: bt(b) + BEAT / 2, type: 'bass', v: b < 16 ? 0.7 : 0.8, f: midiHz(r), d: BEAT * 0.42, cut: b < 16 ? 420 : 560 })
    if (b >= 16) ev.push({ t: bt(b) + (BEAT * 3) / 4, type: 'bass', v: 0.5, f: midiHz(r + 12), d: BEAT * 0.2, cut: 700 })
  }
  // drop: rolling 16ths between the kicks
  for (let b = 32; b < 44; b++) {
    const r = chordAtBar(Math.floor(b / 4)).root
    ev.push({ t: bt(b) + BEAT / 4, type: 'bass', v: 0.62, f: midiHz(r), d: BEAT * 0.2, cut: 650 })
    ev.push({ t: bt(b) + BEAT / 2, type: 'bass', v: 0.95, f: midiHz(r), d: BEAT * 0.22, cut: 900 })
    ev.push({ t: bt(b) + (BEAT * 3) / 4, type: 'bass', v: 0.7, f: midiHz(r + 12), d: BEAT * 0.2, cut: 800 })
  }
  // transition + breakdown + outro: long, warm roots
  for (let bar = 11; bar < 16; bar++) {
    ev.push({ t: bar * BAR, type: 'bass', v: bar >= 14 ? 0.4 : 0.55, f: midiHz(chordAtBar(bar).root), d: BAR * 0.95, cut: 300 })
  }

  // ---- melody --------------------------------------------------------------------
  ev.push({ t: 15, type: 'lead', v: 1, notes: HOOK })
  ev.push({ t: 14 * BAR, type: 'bell', v: 0.8, notes: ECHO })
  ev.push({ t: 0.75 * BAR, type: 'bell', v: 0.32, notes: [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 6]] })

  ev.sort((a, b) => a.t - b.t)
  return ev
}

/** Piecewise-linear keyframe curve. */
export type Keys = [number, number][]
export function curve(keys: Keys, t: number): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      const k = (t - t0) / Math.max(1e-6, t1 - t0)
      return v0 + (v1 - v0) * k
    }
  }
  return keys[keys.length - 1][1]
}

const B = BAR
export const BASS_KEYS: Keys = [
  [0, 0], [2 * B - 0.3, 0.1], [2 * B, 0.32], [4 * B, 0.42], [4 * B + 0.05, 0.6], [7 * B, 0.55], [7 * B + 0.1, 0.2],
  [14.95, 0.12], [15, 1], [11 * B, 0.85], [11 * B + 0.1, 0.4], [12 * B, 0.35], [14 * B, 0.22], [29, 0.04], [30, 0],
]
export const MID_KEYS: Keys = [
  [0, 0.08], [2 * B, 0.35], [4 * B, 0.5], [7 * B, 0.62], [14.9, 0.82], [15, 0.9], [11 * B, 0.75], [12 * B, 0.6], [14 * B, 0.45], [30, 0.06],
]
export const TREBLE_KEYS: Keys = [
  [0, 0.03], [2 * B, 0.12], [4 * B, 0.26], [7 * B, 0.34], [14.9, 1], [15.4, 0.78], [11 * B, 0.68], [11 * B + 0.6, 0.25], [14 * B, 0.12], [30, 0.02],
]
export const TENSION_KEYS: Keys = [[0, 0], [6 * B, 0.1], [14.9, 1], [15.05, 0], [30, 0]]
export const REVEAL_KEYS: Keys = [[0, 0], [0.3, 0], [4.2, 1], [29, 1], [30, 0]]
