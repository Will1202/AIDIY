export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'
export const QUALITY_LEVELS: QualityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']

export interface QualityPreset {
  /** cap on devicePixelRatio */
  pixelRatio: number
  msaa: number
  bloom: boolean
  bloomScale: number
  shadows: number // 0 = off, else shadow map size
  dust: number
  labObjects: number
  shards: number
  streaks: number
  debris: number
  heroes: number
  galaxy: number
  halo: number
  liquidDetail: number
  blurSamples: number
}

/** every field changes real work: pixels shaded, samples taken, bodies simulated, particles drawn */
export const QUALITY: Record<QualityLevel, QualityPreset> = {
  LOW: { pixelRatio: 0.85, msaa: 0, bloom: false, bloomScale: 0.35, shadows: 0, dust: 1500, labObjects: 18, shards: 40, streaks: 900, debris: 60, heroes: 8, galaxy: 12000, halo: 700, liquidDetail: 4, blurSamples: 5 },
  MEDIUM: { pixelRatio: 1, msaa: 0, bloom: true, bloomScale: 0.4, shadows: 1024, dust: 3500, labObjects: 28, shards: 70, streaks: 2200, debris: 120, heroes: 14, galaxy: 26000, halo: 1300, liquidDetail: 5, blurSamples: 8 },
  HIGH: { pixelRatio: 1, msaa: 4, bloom: true, bloomScale: 0.5, shadows: 2048, dust: 6500, labObjects: 36, shards: 110, streaks: 4200, debris: 200, heroes: 20, galaxy: 46000, halo: 2000, liquidDetail: 6, blurSamples: 10 },
  ULTRA: { pixelRatio: 1.5, msaa: 4, bloom: true, bloomScale: 0.6, shadows: 4096, dust: 11000, labObjects: 48, shards: 150, streaks: 7000, debris: 300, heroes: 28, galaxy: 80000, halo: 3000, liquidDetail: 7, blurSamples: 14 },
}

/**
 * Watches frame time and trims the render resolution (0.6–1.0 of the preset)
 * before the frame rate visibly drops; recovers slowly when there is headroom.
 */
export class PerformanceManager {
  fps = 60
  frameMs = 16.7
  scale = 1
  enabled = true
  private slow = 0
  private fast = 0
  private acc = 0
  private frames = 0

  /** returns true when the render scale changed */
  tick(dt: number) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05
    this.acc += dt
    this.frames++
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc
      this.acc = 0
      this.frames = 0
    }
    if (!this.enabled || document.hidden) return false
    if (this.frameMs > 21) {
      this.slow += dt
      this.fast = 0
    } else if (this.frameMs < 14.5) {
      this.fast += dt
      this.slow = 0
    } else {
      this.slow = Math.max(0, this.slow - dt)
      this.fast = Math.max(0, this.fast - dt)
    }
    if (this.slow > 1.2 && this.scale > 0.6) {
      this.scale = Math.max(0.6, this.scale - 0.1)
      this.slow = 0
      return true
    }
    if (this.fast > 4 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05)
      this.fast = 0
      return true
    }
    return false
  }

  reset() {
    this.scale = 1
    this.slow = this.fast = 0
  }
}
