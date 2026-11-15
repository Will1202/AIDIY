export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'
export const QUALITY_LEVELS: QualityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']

/**
 * Every field is a real cost knob. Physics never changes with quality: the fixed step, solver
 * iterations and colliders are identical on every tier, only rendering cost scales.
 */
export interface QualityPreset {
  maxPixelRatio: number
  renderScale: number
  msaa: number
  shadows: boolean
  shadowMapSize: number
  bloom: boolean
  bloomLevels: number
  /** gold particles in the finale */
  particles: number
  /** impact sparks pool */
  sparks: number
  /** dust motes drifting in the light */
  dust: number
  /** rivets / bolts instanced on the tower */
  rivets: boolean
  /** tube / gear tessellation multiplier */
  detail: number
  envSize: number
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  LOW: { maxPixelRatio: 1, renderScale: 0.75, msaa: 0, shadows: false, shadowMapSize: 1024, bloom: true, bloomLevels: 4, particles: 2500, sparks: 120, dust: 300, rivets: false, detail: 0.6, envSize: 128 },
  MEDIUM: { maxPixelRatio: 1.25, renderScale: 0.9, msaa: 2, shadows: true, shadowMapSize: 2048, bloom: true, bloomLevels: 5, particles: 6000, sparks: 220, dust: 700, rivets: true, detail: 0.85, envSize: 256 },
  HIGH: { maxPixelRatio: 1.5, renderScale: 1, msaa: 4, shadows: true, shadowMapSize: 2048, bloom: true, bloomLevels: 6, particles: 12000, sparks: 320, dust: 1200, rivets: true, detail: 1, envSize: 256 },
  ULTRA: { maxPixelRatio: 2, renderScale: 1, msaa: 4, shadows: true, shadowMapSize: 4096, bloom: true, bloomLevels: 7, particles: 24000, sparks: 480, dust: 2000, rivets: true, detail: 1.25, envSize: 512 },
}

/** First guess from the GPU string (the user can override; integrated GPUs start on MEDIUM). */
export function guessQuality(gl: WebGL2RenderingContext): QualityLevel {
  let name = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase()
  } catch {
    /* privacy-hardened browsers */
  }
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'LOW'
  if (/rtx|radeon rx|geforce gtx 1[06-9]|apple m[1-9] (pro|max|ultra)|arc a7/.test(name)) return 'HIGH'
  if (/mobile|adreno|mali|powervr|apple gpu/.test(name)) return 'LOW'
  return 'MEDIUM'
}
