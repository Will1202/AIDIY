/**
 * The shared per-frame audio feature frame. One mutable instance lives for the
 * whole session and is overwritten in place every frame (no per-frame garbage).
 */
export type SignalSource = 'idle' | 'demo' | 'music'

export const SPECTRUM_BANDS = 48

export interface AudioFeatures {
  /** What produced this frame. 'demo' is a scripted signal, 'music' is live FFT analysis. */
  source: SignalSource
  /** Normalised, smoothed band energies 0..1 */
  bass: number
  mid: number
  treble: number
  energy: number
  /** Decaying impulse driven by low-band beat events, 0..1 */
  kick: number
  /** Decaying impulse driven by full-band transients, 0..1 */
  onset: number
  /** True only on the frame a beat fires */
  beat: boolean
  beatStrength: number
  beatCount: number
  /** Build-up indicator (rising highs / energy surge) 0..1 */
  tension: number
  /** True only on the frame a "drop" (climax) is detected */
  drop: boolean
  bpm: number
  /** Log-spaced spectrum for the HUD, 0..1 */
  spectrum: Float32Array
}

export function createFeatures(): AudioFeatures {
  return {
    source: 'idle',
    bass: 0,
    mid: 0,
    treble: 0,
    energy: 0,
    kick: 0,
    onset: 0,
    beat: false,
    beatStrength: 0,
    beatCount: 0,
    tension: 0,
    drop: false,
    bpm: 0,
    spectrum: new Float32Array(SPECTRUM_BANDS),
  }
}

/** Frame-rate independent exponential approach coefficient. */
export function approach(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
