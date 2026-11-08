/** small seeded PRNG (mulberry32) so a given stroke always grows the same world */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9
  }
  next() {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next()
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length]
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1
  }
}

/** hash a list of numbers (e.g. stroke points) into a 32-bit seed */
export function hashNumbers(values: ArrayLike<number>, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < values.length; i++) {
    const v = Math.round(values[i] * 100)
    h ^= v & 0xffff
    h = Math.imul(h, 16777619)
    h ^= v >>> 16
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
