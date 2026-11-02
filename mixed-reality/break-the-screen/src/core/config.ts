import { Vector3 } from 'three'

/**
 * World layout. The physical screen is the plane z = 0, centred on the origin,
 * +y up, +z towards the viewer. Everything "inside the window" lives at z < 0;
 * whatever breaks out of it lives between the screen and the viewer (z > 0).
 *
 * The canvas is always WORLD_H world units tall; its width follows the aspect.
 */
export const WORLD_H = 10

/** width of the frame bezel around the window opening, in world units */
export const BEZEL = 0.62
/** depth of the window reveal (the tunnel between the glass and the room) */
export const REVEAL_DEPTH = 1.25

/** the laboratory behind the window */
export const ROOM = { halfX: 20, floor: -3.4, ceil: 13.5, back: -46 }

/** the invisible catch volume in front of the screen (out of view on every side) */
export const FRONT = { halfX: 28, floor: -11.5, ceil: 11.5, far: 40 }

export const CORE_HOME = new Vector3(0, 0.6, -9)
export const CORE_RADIUS = 1.05

export const GRAVITY = 12

/** a typical adult inter-pupillary distance, used as the face's built-in ruler */
export const IPD_CM = 6.3

export type GravityMode = 'NORMAL' | 'ZERO' | 'REVERSE' | 'SIDEWAYS'
export const GRAVITY_MODES: GravityMode[] = ['NORMAL', 'ZERO', 'REVERSE', 'SIDEWAYS']

export type CreationMode = 'PLANET' | 'LIQUID' | 'GALAXY' | 'CUBE'
export const CREATION_MODES: { id: CreationMode; label: string }[] = [
  { id: 'PLANET', label: 'PLANET' },
  { id: 'LIQUID', label: 'LIQUID METAL' },
  { id: 'GALAXY', label: 'PARTICLE GALAXY' },
  { id: 'CUBE', label: 'PHYSICS CUBE' },
]

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
/** frame-rate independent exponential approach factor */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

/** small deterministic PRNG (mulberry32) so fractures and layouts are reproducible */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
