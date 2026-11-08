export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a))
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const smootherstep = (t: number) => {
  t = clamp(t)
  return t * t * t * (t * (t * 6 - 15) + 10)
}
export const easeInOutCubic = (t: number) => {
  t = clamp(t)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3)
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3)
export const easeOutBack = (t: number) => {
  t = clamp(t)
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
/** frame-rate independent exponential approach: rate = 1/seconds */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt))
export const dampAngle = (a: number, b: number, rate: number, dt: number) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * (1 - Math.exp(-rate * dt))
}
/** polynomial smooth max (k = blend width) */
export const smax = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (a - b)) / k)
  return lerp(b, a, h) + k * h * (1 - h)
}
/** progress of a phase that starts at `start` and lasts `dur` */
export const phase = (t: number, start: number, dur: number) => clamp((t - start) / dur)
