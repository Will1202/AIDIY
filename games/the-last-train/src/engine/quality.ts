// 性能档位：每个字段都是真实的开销旋钮。玩法、碰撞与谜题逻辑在所有档位完全一致，只有渲染开销随档位变化。
export type QualityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'
export const QUALITY_LEVELS: QualityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']
export const QUALITY_LABEL: Record<QualityLevel, string> = { LOW: '低', MEDIUM: '中', HIGH: '高', ULTRA: '极高' }

export interface QualityPreset {
  maxPixelRatio: number
  /** 场景渲染分辨率相对画布的比例 */
  renderScale: number
  msaa: number
  shadows: boolean
  shadowMapSize: number
  bloom: boolean
  bloomLevels: number
  /** 雨丝数量 */
  rain: number
  /** 漂浮粒子（沙、海雪、尘埃）数量倍率 */
  particles: number
  /** 站台积水的平面反射（额外渲染一次场景） */
  reflections: boolean
  reflectionScale: number
  /** 建筑、道具的细分倍率 */
  detail: number
  envSize: number
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  LOW: { maxPixelRatio: 1, renderScale: 0.7, msaa: 0, shadows: false, shadowMapSize: 1024, bloom: true, bloomLevels: 4, rain: 1800, particles: 0.35, reflections: false, reflectionScale: 0.25, detail: 0.6, envSize: 64 },
  MEDIUM: { maxPixelRatio: 1, renderScale: 0.85, msaa: 0, shadows: true, shadowMapSize: 1024, bloom: true, bloomLevels: 5, rain: 4000, particles: 0.6, reflections: true, reflectionScale: 0.3, detail: 0.85, envSize: 128 },
  HIGH: { maxPixelRatio: 1.25, renderScale: 1, msaa: 2, shadows: true, shadowMapSize: 2048, bloom: true, bloomLevels: 6, rain: 7000, particles: 1, reflections: true, reflectionScale: 0.5, detail: 1, envSize: 256 },
  ULTRA: { maxPixelRatio: 2, renderScale: 1, msaa: 4, shadows: true, shadowMapSize: 4096, bloom: true, bloomLevels: 6, rain: 11000, particles: 1.5, reflections: true, reflectionScale: 0.6, detail: 1.25, envSize: 256 },
}

/** 根据 GPU 名称给出初始档位（玩家可以在设置里改；核显默认“中”） */
export function guessQuality(gl: WebGL2RenderingContext | null): QualityLevel {
  if (!gl) return 'LOW'
  let name = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase()
  } catch {
    /* 隐私加固的浏览器拿不到 GPU 名称 */
  }
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'LOW'
  if (/rtx|radeon rx|geforce gtx 1[06-9]|apple m[1-9] (pro|max|ultra)|arc a7/.test(name)) return 'HIGH'
  if (/mobile|adreno|mali|powervr|apple gpu/.test(name)) return 'LOW'
  return 'MEDIUM'
}

export const isTouchDevice = () => typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches
