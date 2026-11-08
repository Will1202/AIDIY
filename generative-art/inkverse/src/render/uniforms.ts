import { Color, Texture, Vector3 } from 'three'
import { PAPER_SCALE_Y } from '../core/constants'

/**
 * Uniforms shared by reference between every world material. The weather system and
 * the world transition write these once per frame; all shaders see the same values.
 */
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(-0.5, 0.75, 0.42).normalize() },
  uPaper: { value: new Color(0.937, 0.905, 0.84) },
  uInk: { value: new Color(0.075, 0.07, 0.068) },
  uMist: { value: new Color(0.93, 0.91, 0.86) },
  uLightTint: { value: new Color(1, 0.98, 0.94) },
  uNight: { value: 0 },
  uSunset: { value: 0 },
  uRain: { value: 0 },
  uWind: { value: 0.15 },
  uAwaken: { value: 0 },
  uTremble: { value: 0 },
  uScaleY: { value: PAPER_SCALE_Y },
  uPaperTex: { value: null as Texture | null },
}

export type WorldUniforms = typeof U
