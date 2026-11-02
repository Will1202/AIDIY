import { Vector3 } from 'three'
import { clamp, damp, WORLD_H } from '../core/config'

/**
 * The viewer model: where the real eye sits relative to the real screen.
 * Positions are in centimetres in screen coordinates (origin = canvas centre,
 * +x right, +y up, +z out of the screen towards the viewer).
 */
export interface ViewerSettings {
  /** physical width of the whole display, used to convert CSS px to cm */
  screenWidthCm: number
  /** eye-to-screen distance at the calibrated rest pose */
  viewDistanceCm: number
  /** 1 = geometrically exact window; >1 exaggerates, <1 softens */
  parallax: number
  /** flip x if a webcam delivers a pre-mirrored image */
  invertX: boolean
  /** turn head-coupled perspective on / off without stopping the camera */
  headEnabled: boolean
}

export const DEFAULT_VIEWER: ViewerSettings = {
  screenWidthCm: 34.5,
  viewDistanceCm: 60,
  parallax: 1,
  invertX: false,
  headEnabled: true,
}

/** world units per physical centimetre for a canvas `canvasCssH` CSS px tall */
export function worldPerCm(s: ViewerSettings, canvasCssH: number, screenCssW: number) {
  const cmPerPx = s.screenWidthCm / Math.max(1, screenCssW)
  return WORLD_H / Math.max(1e-3, canvasCssH * cmPerPx)
}

/** physical eye (cm) → world eye, applying the parallax gain about the rest pose */
export function eyeWorldFromCm(cm: Vector3, s: ViewerSettings, scale: number, out = new Vector3()) {
  const vd = s.viewDistanceCm
  const g = s.parallax
  out.x = cm.x * g * scale
  out.y = cm.y * g * scale
  out.z = clamp(vd + (cm.z - vd) * g, vd * 0.35, vd * 2.5) * scale
  return out
}

export type HeadSource = 'CAMERA' | 'SIMULATED' | 'DEMO' | 'REST'

/**
 * Blends the eye between tracked, simulated (mouse / keys), scripted (demo)
 * and rest positions without ever jumping: losing the face eases back to the
 * rest pose, re-acquiring it eases back in, and speed is capped.
 */
export class ViewerRig {
  readonly cm: Vector3
  readonly rest: Vector3
  source: HeadSource = 'REST'
  /** 0..1 how much of the tracked head is currently applied */
  trackWeight = 0
  private readonly target = new Vector3()
  private readonly vel = new Vector3()

  constructor(public settings: ViewerSettings) {
    this.rest = new Vector3(0, 0, settings.viewDistanceCm)
    this.cm = this.rest.clone()
  }

  update(dt: number, inp: { tracked: Vector3 | null; simulated: Vector3 | null; demo: Vector3 | null }) {
    const vd = this.settings.viewDistanceCm
    this.rest.set(0, 0, vd)
    let rate = 9
    if (inp.demo) {
      this.target.copy(inp.demo)
      this.source = 'DEMO'
      this.trackWeight += (0 - this.trackWeight) * damp(3, dt)
      rate = 6
    } else {
      const tracking = !!inp.tracked && this.settings.headEnabled
      this.trackWeight += ((tracking ? 1 : 0) - this.trackWeight) * damp(tracking ? 2.8 : 1.5, dt)
      if (tracking && inp.tracked) {
        this.target.lerpVectors(this.rest, inp.tracked, this.trackWeight)
        this.source = 'CAMERA'
        rate = 22 // already One-Euro filtered upstream; keep added lag tiny
      } else if (inp.simulated) {
        this.target.copy(this.rest).add(inp.simulated)
        this.source = 'SIMULATED'
      } else {
        this.target.copy(this.rest)
        this.source = 'REST'
      }
    }
    // exponential approach with a speed cap (cm/s) so glitches can never snap the view
    this.vel.copy(this.target).sub(this.cm).multiplyScalar(damp(rate, dt))
    const maxStep = 160 * dt
    if (this.vel.length() > maxStep) this.vel.setLength(maxStep)
    this.cm.add(this.vel)
  }
}
