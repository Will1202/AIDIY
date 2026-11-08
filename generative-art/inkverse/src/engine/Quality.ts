export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'
export const QUALITY_LEVELS: QualityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']

export interface QualitySettings {
  level: QualityLevel
  /** render scale relative to the device pixel ratio */
  pixelRatio: number
  /** absolute cap on the final pixel ratio */
  pixelCap: number
  /** terrain mesh samples every `terrainStride` heightfield texels */
  terrainStride: number
  /** crisp brush layer resolution */
  inkRes: number
  /** wet ink simulation resolution */
  simRes: number
  /** simulation sub-steps per frame */
  simSteps: number
  /** planar water reflection scale (0 = off, fake sky reflection) */
  reflection: number
  /** heightfield shadow march steps in the terrain shader (0 = off) */
  shadowSteps: number
  /** brush-line samples in the outline pass */
  edgeTaps: number
  /** stacked cloud/mist sheets in the composite */
  mistLayers: number
  /** rain streak count */
  rain: number
  /** pine needle-pad subdivision */
  padDetail: number
  /** trunk radial segments */
  trunkSides: number
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  LOW: { level: 'LOW', pixelRatio: 0.65, pixelCap: 1, terrainStride: 2, inkRes: 1024, simRes: 512, simSteps: 1, reflection: 0, shadowSteps: 0, edgeTaps: 4, mistLayers: 1, rain: 1500, padDetail: 0, trunkSides: 5 },
  MEDIUM: { level: 'MEDIUM', pixelRatio: 0.85, pixelCap: 1.25, terrainStride: 2, inkRes: 1536, simRes: 768, simSteps: 1, reflection: 0.25, shadowSteps: 8, edgeTaps: 6, mistLayers: 2, rain: 3000, padDetail: 1, trunkSides: 6 },
  HIGH: { level: 'HIGH', pixelRatio: 1, pixelCap: 1.5, terrainStride: 1, inkRes: 2048, simRes: 1024, simSteps: 2, reflection: 0.4, shadowSteps: 14, edgeTaps: 8, mistLayers: 3, rain: 5000, padDetail: 1, trunkSides: 7 },
  ULTRA: { level: 'ULTRA', pixelRatio: 1.5, pixelCap: 2, terrainStride: 1, inkRes: 2048, simRes: 1024, simSteps: 2, reflection: 0.6, shadowSteps: 22, edgeTaps: 8, mistLayers: 3, rain: 8000, padDetail: 2, trunkSides: 8 },
}

export function defaultQuality(): QualityLevel {
  const params = new URLSearchParams(location.search)
  const q = params.get('q')?.toUpperCase()
  if (q && (QUALITY_LEVELS as string[]).includes(q)) return q as QualityLevel
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  if (mobile) return 'LOW'
  return 'HIGH'
}
