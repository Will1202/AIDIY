/**
 * Every animatable quantity of the film lives in one flat object. The Director's
 * GSAP timeline tweens it; the renderer, gravity engine and audio only read it.
 */
export interface Params {
  // black hole
  diskSpeed: number
  diskBright: number
  beaming: number
  haze: number
  ringBoost: number
  skyGain: number
  ripple: number
  rippleR: number
  waves: number
  hot: number
  // observatory camera
  dolly: number
  elevAdd: number
  fovMul: number
  frame: number
  roll: number
  // gravity engine
  gravity: number
  swirl: number
  drag: number
  tremor: number
  pull: number
  tidal: number
  lens: number
  lensMask: number
  einstein: number
  warp: number
  consume: number
  // transitions
  bh: number
  streak: number
  tunnel: number
  tunnelSpeed: number
  hue: number
  aperture: number
  uni: number
  uniGain: number
  uniTravel: number
  implode: number
  // post
  flash: number
  flashCool: number
  fade: number
  exposure: number
  bloom: number
  ca: number
  grain: number
  vignette: number
  shake: number
  kick: number
  // audio
  roar: number
}

export const IDLE_PARAMS: Readonly<Params> = {
  diskSpeed: 1,
  diskBright: 1,
  beaming: 0.92,
  haze: 1,
  ringBoost: 1,
  skyGain: 1,
  ripple: 0,
  rippleR: 0,
  waves: 0,
  hot: 1,
  dolly: 1,
  elevAdd: 0,
  fovMul: 1,
  frame: 1,
  roll: 0,
  gravity: 0,
  swirl: 0,
  drag: 0.2,
  tremor: 0,
  pull: 0,
  tidal: 0,
  lens: 0,
  lensMask: 0,
  einstein: 1.3,
  warp: 0,
  consume: 0,
  bh: 1,
  streak: 0,
  tunnel: 0,
  tunnelSpeed: 0,
  hue: 0,
  aperture: 0,
  uni: 0,
  uniGain: 1,
  uniTravel: 1,
  implode: 0,
  flash: 0,
  flashCool: 0,
  fade: 0,
  exposure: 1,
  bloom: 1,
  ca: 0,
  grain: 1,
  vignette: 1,
  shake: 0,
  kick: 0,
  roar: 0,
}

export function freshParams(): Params {
  return { ...IDLE_PARAMS }
}
