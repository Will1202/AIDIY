export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'
export const QUALITY_LEVELS: QualityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']

/** Every field here feeds a real cost knob in the renderer / world. */
export interface QualityPreset {
  /** main HDR target resolution relative to CSS pixels × devicePixelRatio (capped) */
  renderScale: number
  maxPixelRatio: number
  /** MSAA samples of the main HDR target */
  msaa: number
  /** portal render-target resolution relative to the main target */
  portalScale: number
  /** recursion levels through a portal that sees itself */
  recursion: number
  /** smallest portal rectangle (pixels) worth recursing into */
  minPortalPixels: number
  shadowMapSize: number
  /** update shadow maps every N frames */
  shadowInterval: number
  bloom: boolean
  bloomLevels: number
  /** number of RectAreaLights used for the ceiling light strips (portals always get one) */
  areaLights: number
  dustCount: number
  moteCount: number
  volumetric: boolean
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  LOW: {
    renderScale: 0.7, maxPixelRatio: 1, msaa: 0, portalScale: 0.5, recursion: 2, minPortalPixels: 24,
    shadowMapSize: 1024, shadowInterval: 3, bloom: true, bloomLevels: 4, areaLights: 0,
    dustCount: 800, moteCount: 900, volumetric: false,
  },
  MEDIUM: {
    renderScale: 0.85, maxPixelRatio: 1.25, msaa: 2, portalScale: 0.7, recursion: 4, minPortalPixels: 14,
    shadowMapSize: 2048, shadowInterval: 2, bloom: true, bloomLevels: 5, areaLights: 1,
    dustCount: 1800, moteCount: 2200, volumetric: true,
  },
  HIGH: {
    renderScale: 1, maxPixelRatio: 1.5, msaa: 4, portalScale: 0.85, recursion: 7, minPortalPixels: 8,
    shadowMapSize: 2048, shadowInterval: 1, bloom: true, bloomLevels: 6, areaLights: 2,
    dustCount: 3000, moteCount: 4000, volumetric: true,
  },
  ULTRA: {
    renderScale: 1, maxPixelRatio: 2, msaa: 4, portalScale: 1, recursion: 11, minPortalPixels: 4,
    shadowMapSize: 4096, shadowInterval: 1, bloom: true, bloomLevels: 7, areaLights: 2,
    dustCount: 5000, moteCount: 6500, volumetric: true,
  },
}

/** Rough first guess from the GPU string; the user can always override. */
export function guessQuality(gl: WebGL2RenderingContext): QualityLevel {
  let name = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase()
  } catch {
    /* privacy-hardened browsers */
  }
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent)
  if (mobile) return 'LOW'
  if (/rtx|radeon rx|rx \d{4}|arc a|geforce gtx 1[0-9]{3}|m[1-4] (pro|max|ultra)/.test(name)) return 'HIGH'
  if (/apple m|radeon|iris xe|arc/.test(name)) return 'MEDIUM'
  if (/intel|uhd|hd graphics|mali|adreno|swiftshader|llvmpipe/.test(name)) return 'LOW'
  return 'MEDIUM'
}
