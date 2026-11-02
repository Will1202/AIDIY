/**
 * One Euro filter (Casiez, Roussel, Vogel — CHI 2012): a low-pass filter whose
 * cutoff rises with speed, so slow motion is jitter-free while fast motion keeps
 * little lag. t is in seconds.
 */
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  constructor(
    public minCutoff = 1,
    public beta = 0.02,
    public dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, t: number) {
    if (this.x === null) {
      this.x = value
      this.t = t
      this.dx = 0
      return value
    }
    const dt = Math.max(1e-4, t - this.t)
    this.t = t
    const rawDx = (value - this.x) / dt
    this.dx += (rawDx - this.dx) * OneEuro.alpha(this.dCutoff, dt)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += (value - this.x) * OneEuro.alpha(cutoff, dt)
    return this.x
  }

  get value() {
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}

/** n independent One Euro channels sharing parameters */
export class OneEuroN {
  readonly ch: OneEuro[]
  readonly out: number[]
  constructor(n: number, minCutoff: number, beta: number, dCutoff = 1) {
    this.ch = Array.from({ length: n }, () => new OneEuro(minCutoff, beta, dCutoff))
    this.out = new Array(n).fill(0)
  }
  filter(v: ArrayLike<number>, t: number) {
    for (let i = 0; i < this.ch.length; i++) this.out[i] = this.ch[i].filter(v[i], t)
    return this.out
  }
  reset() {
    for (const c of this.ch) c.reset()
  }
  get primed() {
    return this.ch[0].value !== null
  }
}
