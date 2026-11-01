import { type AudioFeatures, SPECTRUM_BANDS, approach, clamp01 } from './features'

/**
 * Real-time music feature extraction from an AnalyserNode.
 *
 *  - Band energies (RMS of linear magnitude per band, in dB) with an adaptive
 *    floor/ceiling so quiet and loud tracks both use the full 0..1 range.
 *  - Spectral flux (half-wave rectified log-magnitude difference) for the low
 *    band (kick) and the full band (transients), compared against an adaptive
 *    threshold (rolling mean + k * std) with a refractory period.
 *  - Short / long energy envelopes for build-up ("tension") and drop detection.
 */

class AdaptiveBand {
  floor = -80
  ceil = -45
  value = 0
  raw = 0

  reset() {
    this.floor = -80
    this.ceil = -45
    this.value = 0
    this.raw = 0
  }

  update(db: number, dt: number, attack: number, release: number) {
    // Ceiling jumps up instantly, then slowly forgets (3 dB/s) so a quiet
    // passage after a loud one regains visual range within a few seconds.
    if (db > this.ceil) this.ceil = db
    else this.ceil -= 3 * dt
    // Floor drops instantly, rises slowly.
    if (db < this.floor) this.floor = db
    else this.floor += 2.2 * dt
    if (this.floor > this.ceil - 6) this.floor = this.ceil - 6
    // a silent breakdown must not stretch the range so far that the drop looks quiet
    if (this.floor < this.ceil - 42) this.floor = this.ceil - 42

    const range = Math.max(this.ceil - this.floor, 20)
    let n = (db - (this.ceil - range)) / range
    if (db < -88) n = 0 // silence gate
    n = clamp01(n)
    n = n * n * (1.6 - 0.6 * n) // gentle expansion, keeps peaks punchy
    this.raw = n
    const k = n > this.value ? approach(attack, dt) : approach(release, dt)
    this.value += (n - this.value) * k
    return this.value
  }
}

class FluxDetector {
  private hist: Float32Array
  private idx = 0
  private filled = 0
  mean = 0
  std = 0

  constructor(size: number) {
    this.hist = new Float32Array(size)
  }

  reset() {
    this.hist.fill(0)
    this.idx = 0
    this.filled = 0
    this.mean = 0
    this.std = 0
  }

  /** Returns the threshold computed from history *before* pushing the new value. */
  push(v: number, k: number, minAbs: number): number {
    const n = this.filled
    let thr = Infinity
    if (n >= 8) {
      let s = 0
      for (let i = 0; i < n; i++) s += this.hist[i]
      const m = s / n
      let q = 0
      for (let i = 0; i < n; i++) {
        const d = this.hist[i] - m
        q += d * d
      }
      this.mean = m
      this.std = Math.sqrt(q / n)
      thr = m + k * this.std + minAbs
    }
    this.hist[this.idx] = v
    this.idx = (this.idx + 1) % this.hist.length
    if (this.filled < this.hist.length) this.filled++
    return thr
  }
}

export class FeatureExtractor {
  private freqDb: Float32Array<ArrayBuffer> = new Float32Array(0)
  private prevLog = new Float32Array(0)
  private binHz = 23.4
  private bins = 0

  private bass = new AdaptiveBand()
  private mid = new AdaptiveBand()
  private treble = new AdaptiveBand()

  private lowFlux = new FluxDetector(48)
  private fullFlux = new FluxDetector(48)

  private lastBeat = -10
  private lastOnset = -10
  private beatTimes: number[] = []

  private shortE = 0
  private longE = 0
  private shortT = 0
  private longT = 0
  private shortB = 0
  private longB = 0
  private surgeHold = 0
  private tensionPeakAt = -100
  private lastDrop = -100
  private startedAt = 0
  private warm = 0 // frames since reset (flux needs a previous frame)

  private specCeil = -30
  private bandEdges: Int32Array = new Int32Array(SPECTRUM_BANDS + 1)

  configure(analyser: AnalyserNode) {
    const bins = analyser.frequencyBinCount
    if (bins !== this.bins) {
      this.bins = bins
      this.freqDb = new Float32Array(bins)
      this.prevLog = new Float32Array(bins)
    }
    this.binHz = analyser.context.sampleRate / analyser.fftSize
    // log-spaced spectrum edges 40 Hz .. 16 kHz
    const f0 = 40
    const f1 = Math.min(16000, analyser.context.sampleRate / 2 - 100)
    for (let i = 0; i <= SPECTRUM_BANDS; i++) {
      const f = f0 * Math.pow(f1 / f0, i / SPECTRUM_BANDS)
      this.bandEdges[i] = Math.max(1, Math.min(bins - 1, Math.round(f / this.binHz)))
    }
  }

  /** Call on new track / seek / resume so stale history can't fire false beats. */
  reset(now: number, full = true) {
    this.lowFlux.reset()
    this.fullFlux.reset()
    this.prevLog.fill(0)
    this.warm = 0
    this.lastBeat = now
    this.surgeHold = 0
    if (full) {
      this.bass.reset()
      this.mid.reset()
      this.treble.reset()
      this.beatTimes.length = 0
      this.shortE = this.longE = 0
      this.shortT = this.longT = 0
      this.shortB = this.longB = 0
      this.startedAt = now
      this.lastDrop = now - 100
      this.tensionPeakAt = -100
    }
  }

  private bandDb(lo: number, hi: number): number {
    const a = Math.max(1, Math.floor(lo / this.binHz))
    const b = Math.min(this.bins - 1, Math.ceil(hi / this.binHz))
    let s = 0
    for (let i = a; i <= b; i++) {
      const lin = Math.pow(10, this.freqDb[i] / 20)
      s += lin * lin
    }
    const rms = Math.sqrt(s / Math.max(1, b - a + 1))
    return 20 * Math.log10(rms + 1e-9)
  }

  analyze(analyser: AnalyserNode, out: AudioFeatures, dt: number, now: number) {
    if (analyser.frequencyBinCount !== this.bins) this.configure(analyser)
    analyser.getFloatFrequencyData(this.freqDb)
    const db = this.freqDb
    const n = this.bins

    // ---- band energies ------------------------------------------------------
    const bass = this.bass.update(this.bandDb(30, 160), dt, 28, 7)
    const mid = this.mid.update(this.bandDb(400, 2600), dt, 9, 3.2)
    const treble = this.treble.update(this.bandDb(2600, 12000), dt, 22, 5)
    out.bass = bass
    out.mid = mid
    out.treble = treble
    out.energy = clamp01(bass * 0.45 + mid * 0.35 + treble * 0.2)

    // ---- spectral flux --------------------------------------------------------
    const lowEnd = Math.min(n - 1, Math.ceil(180 / this.binHz))
    const fullEnd = Math.min(n - 1, Math.ceil(10000 / this.binHz))
    let fLow = 0
    let fFull = 0
    for (let i = 1; i <= fullEnd; i++) {
      const v = db[i]
      const lin = v > -160 ? Math.pow(10, v / 20) : 0
      const lg = Math.log1p(lin * 200)
      const d = lg - this.prevLog[i]
      this.prevLog[i] = lg
      if (d > 0) {
        if (i <= lowEnd) fLow += d
        fFull += d
      }
    }
    this.warm++
    out.beat = false
    out.drop = false

    const thrLow = this.lowFlux.push(fLow, 1.55, 0.05)
    const thrFull = this.fullFlux.push(fFull, 1.7, 0.35)

    if (this.warm > 3) {
      // Kick / bass beat
      if (fLow > thrLow && now - this.lastBeat > 0.2 && this.bass.raw > 0.12) {
        const over = (fLow - thrLow) / (thrLow + 1e-4)
        const strength = clamp01(0.4 + over * 0.6) * (0.55 + 0.45 * this.bass.raw)
        this.lastBeat = now
        out.beat = true
        out.beatStrength = strength
        out.beatCount++
        out.kick = Math.max(out.kick, strength)
        this.beatTimes.push(now)
        if (this.beatTimes.length > 24) this.beatTimes.shift()
      }
      // Full-band transient (snares, claps, hats)
      if (fFull > thrFull && now - this.lastOnset > 0.09) {
        const over = (fFull - thrFull) / (thrFull + 1e-4)
        this.lastOnset = now
        out.onset = Math.max(out.onset, clamp01(0.35 + over * 0.65))
      }
    }
    out.kick *= Math.exp(-dt * 6.5)
    out.onset *= Math.exp(-dt * 9)

    // ---- tempo estimate (median IOI, folded into 70..180 BPM) -----------------
    if (out.beat && this.beatTimes.length >= 6) {
      const iois: number[] = []
      for (let i = 1; i < this.beatTimes.length; i++) {
        let d = this.beatTimes[i] - this.beatTimes[i - 1]
        if (d < 0.2 || d > 2) continue
        while (60 / d > 180) d *= 2
        while (60 / d < 70) d /= 2
        iois.push(d)
      }
      if (iois.length >= 4) {
        iois.sort((a, b) => a - b)
        const bpm = 60 / iois[iois.length >> 1]
        out.bpm = out.bpm ? out.bpm + (bpm - out.bpm) * 0.25 : bpm
      }
    }

    // ---- tension & drop detection ------------------------------------------------
    // Long-term averages warm up quickly at track start so the intro isn't read as a "surge".
    const sinceStart = now - this.startedAt
    const warmK = Math.min(1, 0.15 + sinceStart / 6)
    const E = out.energy
    this.shortE += (E - this.shortE) * approach(1 / 0.8, dt)
    this.longE += (E - this.longE) * approach(1 / (9 * warmK), dt)
    this.shortT += (treble - this.shortT) * approach(1 / 0.7, dt)
    this.longT += (treble - this.longT) * approach(1 / (7 * warmK), dt)
    this.shortB += (bass - this.shortB) * approach(1 / 0.6, dt)
    this.longB += (bass - this.longB) * approach(1 / (8 * warmK), dt)

    // Build-up: highs rising while the low end thins out, or a general energy rise.
    const build = Math.max(0, this.shortT - this.longT) * 2.2 + Math.max(0, this.longB - this.shortB) * 1.2
    const rise = Math.max(0, this.shortE - this.longE) * 1.6
    const tensionTarget = sinceStart < 3 ? 0 : clamp01(build + rise * 0.5)
    out.tension += (tensionTarget - out.tension) * approach(tensionTarget > out.tension ? 2.5 : 1.2, dt)
    if (out.tension > 0.5) this.tensionPeakAt = now

    const surge = this.shortE - this.longE
    const cooled = now - this.lastDrop > 20
    if (sinceStart > 4 && surge > 0.13 && this.shortE > 0.5 && this.shortB > 0.42) this.surgeHold += dt
    else this.surgeHold = Math.max(0, this.surgeHold - dt * 2)

    // The classic drop: a real build-up, then the first heavy low-end hit.
    const afterBuild = now - this.tensionPeakAt < 3 && out.beat && out.beatStrength > 0.6 && this.bass.raw > 0.55
    if (sinceStart > 4 && cooled && (this.surgeHold > 0.3 || afterBuild)) {
      out.tension = 0
      out.drop = true
      this.lastDrop = now
      this.surgeHold = 0
    }

    // ---- HUD spectrum -------------------------------------------------------------
    let maxDb = -160
    for (let i = 1; i < fullEnd; i++) if (db[i] > maxDb) maxDb = db[i]
    if (maxDb > this.specCeil) this.specCeil = maxDb
    else this.specCeil -= 4 * dt
    const lo = this.specCeil - 60
    const spec = out.spectrum
    const ks = approach(14, dt)
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const a = this.bandEdges[b]
      const e = Math.max(a, this.bandEdges[b + 1] - 1)
      let m = -160
      for (let i = a; i <= e; i++) if (db[i] > m) m = db[i]
      const v = clamp01((m - lo) / (this.specCeil - lo))
      spec[b] += (v - spec[b]) * ks
    }
  }

  /** Let everything fall back to rest (paused / ended). */
  decay(out: AudioFeatures, dt: number) {
    const k = approach(2.5, dt)
    out.bass -= out.bass * k
    out.mid -= out.mid * k
    out.treble -= out.treble * k
    out.energy -= out.energy * k
    out.kick *= Math.exp(-dt * 6.5)
    out.onset *= Math.exp(-dt * 9)
    out.tension -= out.tension * k
    out.beat = false
    out.drop = false
    for (let i = 0; i < out.spectrum.length; i++) out.spectrum[i] -= out.spectrum[i] * k
  }
}
