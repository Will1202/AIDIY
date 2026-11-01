export type Tier = 'low' | 'medium' | 'high' | 'ultra'
export type QualitySetting = 'auto' | Tier

export interface TierSpec {
  /** resolution of the black hole / universe raymarch relative to the canvas */
  worldScale: number
  minWorldScale: number
  maxDpr: number
  steps: number
  diskLayers: number
  skyRes: number
  particles: number
  /** target edge length of a torn page shard, in CSS px */
  shardCell: number
  bloomLevels: number
  dust: number
}

export const TIERS: Record<Tier, TierSpec> = {
  low: { worldScale: 0.5, minWorldScale: 0.38, maxDpr: 1, steps: 80, diskLayers: 2, skyRes: 512, particles: 9000, shardCell: 120, bloomLevels: 4, dust: 3000 },
  medium: { worldScale: 0.66, minWorldScale: 0.45, maxDpr: 1.5, steps: 110, diskLayers: 2, skyRes: 1024, particles: 18000, shardCell: 96, bloomLevels: 5, dust: 6000 },
  high: { worldScale: 0.8, minWorldScale: 0.55, maxDpr: 2, steps: 140, diskLayers: 3, skyRes: 1024, particles: 30000, shardCell: 80, bloomLevels: 6, dust: 10000 },
  ultra: { worldScale: 1.0, minWorldScale: 0.7, maxDpr: 2, steps: 210, diskLayers: 3, skyRes: 2048, particles: 44000, shardCell: 64, bloomLevels: 6, dust: 14000 },
}

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high', 'ultra']

/** Best guess from the GPU string and the device; AUTO then adapts resolution live. */
export function detectTier(gl: WebGL2RenderingContext | null): Tier {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900)
  if (!gl) return 'low'
  let gpu = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
  } catch {
    gpu = ''
  }
  if (mobile) return /Apple|Adreno \(TM\) 7[3-9]|Mali-G7[1-9]/i.test(gpu) ? 'medium' : 'low'
  if (/RTX|RX [67]\d{3}|RX 9\d{3}|Radeon Pro|Radeon\(TM\) (7[6-9]|8[0-9])0M|Apple M[2-9]|Arc/i.test(gpu)) return 'high'
  if (/GTX 1[06-9]|GTX 16|Apple M1|Radeon/i.test(gpu)) return 'medium'
  if (/Intel|UHD|Iris|Mali|Adreno|SwiftShader|llvmpipe/i.test(gpu)) return 'medium'
  return 'high'
}

/**
 * Adaptive resolution: watches the frame time and nudges the world render scale
 * between the tier's floor and ceiling, with hysteresis so it never oscillates.
 */
export class AdaptiveScaler {
  scale: number
  private acc = 0
  private frames = 0
  private cooldown = 0
  private goodStreak = 0

  constructor(private spec: TierSpec) {
    this.scale = spec.worldScale
  }

  reset(spec: TierSpec) {
    this.spec = spec
    this.scale = spec.worldScale
    this.acc = 0
    this.frames = 0
    this.cooldown = 1.5
    this.goodStreak = 0
  }

  /** returns true when the scale changed */
  sample(dt: number): boolean {
    if (document.hidden) return false
    this.cooldown -= dt
    this.acc += dt
    this.frames++
    if (this.acc < 1.2) return false
    const avg = this.acc / this.frames
    this.acc = 0
    this.frames = 0
    if (this.cooldown > 0) return false
    if (avg > 1 / 48 && this.scale > this.spec.minWorldScale + 1e-3) {
      this.scale = Math.max(this.spec.minWorldScale, this.scale - (avg > 1 / 30 ? 0.12 : 0.06))
      this.cooldown = 1.6
      this.goodStreak = 0
      return true
    }
    if (avg < 1 / 58) {
      this.goodStreak++
      if (this.goodStreak >= 3 && this.scale < this.spec.worldScale - 1e-3) {
        this.scale = Math.min(this.spec.worldScale, this.scale + 0.05)
        this.cooldown = 2.5
        this.goodStreak = 0
        return true
      }
    } else {
      this.goodStreak = 0
    }
    return false
  }
}
