import type { CameraRig, ScreenPoint } from '../gl/CameraRig'
import type { DebrisGPU } from '../gl/Debris'
import type { Params } from './params'

/** world units: Schwarzschild radius r_s = 1, black hole at the origin */
export const GM = 420

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Thin-lens imaging of matter behind the hole. A point at depth dz behind the
 * hole's plane, seen from distance D, has Einstein radius θE = √(2 r_s dz / (D (D+dz))).
 * It is floored just outside the shadow, where the strong-field images of nearby
 * matter (like the far side of the disk) actually sit.
 */
export class LensModel {
  D = 29
  kPx = 1000
  floorPx = 100
  /** >0: behind the hole (value = shadow-mask strength), ≤0: in front */
  sm = -1

  set(rig: CameraRig, shadowPx: number) {
    this.D = rig.dist
    this.kPx = (rig.height * 0.5) / rig.tanY
    this.floorPx = shadowPx * 1.03
  }

  /** θE in px for a point at view depth `depth`; also sets `sm` */
  theta(depth: number): number {
    const dz = depth - this.D
    if (dz <= 0) {
      this.sm = -1
      return 0
    }
    this.sm = Math.max(0.001, smooth(0, 0.8, dz))
    const te = Math.sqrt((2 * dz) / (this.D * (this.D + dz))) * this.kPx
    return Math.max(te, this.floorPx) * smooth(0, 1.5, dz)
  }
}

/**
 * The force field everything falls through. Newtonian gravity plus an accretion
 * "flow": matter is dragged towards a sub-Keplerian, inward-spiralling velocity
 * field. Far away the flow circulates in the screen plane (readable spirals);
 * close in it tilts into the disk plane so the page literally becomes the disk.
 * Coupling strength depends on mass, so heavy cards fall straighter than letters.
 */
export class GravityField {
  g = 0
  flowF = 0
  drag = 0.2
  inflow = 0.15
  settle = 0
  consume = 0
  ax = 0
  ay = 0
  az = 0
  /** rotation axes: viewAxis = −(towards camera), diskAxis = −y (clockwise as seen) */
  private vax = 0
  private vay = 0
  private vaz = -1

  setFrame(P: Params, rig: CameraRig) {
    this.g = GM * P.gravity
    this.flowF = 0.9 * P.swirl
    this.drag = P.drag
    // a slow inward drift so matter winds around several times before it is taken
    this.inflow = 0.07 + P.consume * 1.5
    this.settle = 0.9 * P.swirl
    this.consume = P.consume
    const d = rig.dist || 1
    this.vax = -(rig.pos.x - rig.target.x) / d
    this.vay = -(rig.pos.y - rig.target.y) / d
    this.vaz = -(rig.pos.z - rig.target.z) / d
  }

  /** writes acceleration into ax/ay/az */
  accel(x: number, y: number, z: number, vx: number, vy: number, vz: number, coupling: number) {
    const r2 = x * x + y * y + z * z
    const r = Math.sqrt(r2) + 1e-6
    // Paczyński–Wiita potential Φ = −GM/(r − r_s): reproduces the innermost stable
    // circular orbit at 3 r_s and the plunge inside it, which Newton cannot
    const rr = Math.max(r - 1, 0.3)
    const inv = this.g / (rr * rr + 0.04) / r
    let ax = -x * inv
    let ay = -y * inv
    let az = -z * inv
    const plunge = 1 - smooth(1.7, 3.0, r)

    // swirl axis blends from the view axis (far) to the disk axis (near)
    const w = smooth(3.5, 15, r)
    let Ax = this.vax * w
    let Ay = this.vay * w - (1 - w)
    let Az = this.vaz * w
    const al = Math.hypot(Ax, Ay, Az) || 1
    Ax /= al
    Ay /= al
    Az /= al

    // tangential direction A × p
    let tx = Ay * z - Az * y
    let ty = Az * x - Ax * z
    let tz = Ax * y - Ay * x
    const tl = Math.hypot(tx, ty, tz)
    const vc = Math.min(30, Math.sqrt(this.g * r) / rr)
    if (tl > 1e-4) {
      const k = (this.flowF * (1 - plunge * 0.75) * vc * Math.min(1, tl / 1.5)) / tl
      tx *= k
      ty *= k
      tz *= k
    } else {
      tx = ty = tz = 0
    }
    // inward drift of the flow
    const vin = (this.inflow + plunge * 1.1) * vc
    const ux = tx - (x / r) * vin
    const uy = ty - (y / r) * vin
    const uz = tz - (z / r) * vin
    const k = this.drag * coupling
    ax -= k * (vx - ux)
    ay -= k * (vy - uy)
    az -= k * (vz - uz)

    // settle into the plane perpendicular to the swirl axis
    const s = this.settle * (1 - w * 0.75)
    if (s > 0) {
      const h = x * Ax + y * Ay + z * Az
      const hv = vx * Ax + vy * Ay + vz * Az
      const f = h * s * 1.4 + hv * s * 1.1
      ax -= Ax * f
      ay -= Ay * f
      az -= Az * f
    }
    if (this.consume > 0) {
      const c = (this.consume * 14) / r
      ax -= x * c
      ay -= y * c
      az -= z * c
    }
    this.ax = ax
    this.ay = ay
    this.az = az
  }
}

/** sRGB byte → linear float */
const lin = (c: number) => Math.pow(c / 255, 2.2)

/**
 * CPU particle system on typed arrays (zero allocations per frame). Integrates the
 * same field as the page shards, with gravitational time dilation (matter appears
 * to slow and redden as it nears the horizon) and writes velocity-aligned streaks
 * straight into the instanced GPU buffers.
 */
export class ParticleSystem {
  readonly cap: number
  limit: number
  private head = 0
  private high = 0
  alive = 0
  private readonly p: Float32Array
  private readonly v: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly on: Uint8Array
  private readonly sp: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private readonly sp2: ScreenPoint = { x: 0, y: 0, depth: 0 }

  constructor(private readonly gpu: DebrisGPU, limit: number) {
    this.cap = gpu.partCap
    this.limit = Math.min(limit, this.cap)
    this.p = new Float32Array(this.cap * 3)
    this.v = new Float32Array(this.cap * 3)
    this.life = new Float32Array(this.cap)
    this.maxLife = new Float32Array(this.cap)
    this.on = new Uint8Array(this.cap)
  }

  setLimit(n: number) {
    this.limit = Math.max(256, Math.min(n, this.cap))
    if (this.head >= this.limit) this.head = 0
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r8: number, g8: number, b8: number, hot: number, size: number, life: number) {
    const i = this.head
    this.head = (this.head + 1) % this.limit
    if (!this.on[i]) this.alive++
    this.on[i] = 1
    this.p[i * 3] = x
    this.p[i * 3 + 1] = y
    this.p[i * 3 + 2] = z
    this.v[i * 3] = vx
    this.v[i * 3 + 1] = vy
    this.v[i * 3 + 2] = vz
    this.life[i] = 0
    this.maxLife[i] = life
    // content colour, pushed towards incandescence
    const c = this.gpu.col
    const br = 1.1 + hot * 2.4
    c[i * 4] = (lin(r8) * (1 - hot * 0.5) + 1.0 * hot * 0.5) * br
    c[i * 4 + 1] = (lin(g8) * (1 - hot * 0.5) + 0.5 * hot * 0.5) * br
    c[i * 4 + 2] = (lin(b8) * (1 - hot * 0.5) + 0.16 * hot * 0.5) * br
    c[i * 4 + 3] = size
    if (i + 1 > this.high) this.high = i + 1
  }

  /** every live particle ends within `seconds` (they keep falling meanwhile) */
  drain(seconds: number) {
    for (let i = 0; i < this.high; i++) {
      if (!this.on[i]) continue
      this.maxLife[i] = Math.min(this.maxLife[i], this.life[i] + seconds * (0.5 + Math.random() * 0.5))
    }
  }

  clear() {
    this.on.fill(0)
    this.gpu.pfx.fill(0)
    this.head = 0
    this.high = 0
    this.alive = 0
    this.gpu.partCount = 0
  }

  update(dt: number, field: GravityField, rig: CameraRig, coupling: number, lens: LensModel) {
    const gpu = this.gpu
    const { p, v, life, maxLife, on } = this
    const pv = gpu.pv
    const fx = gpu.pfx
    let alive = 0
    for (let i = 0; i < this.high; i++) {
      if (!on[i]) continue
      const i3 = i * 3
      let x = p[i3]
      let y = p[i3 + 1]
      let z = p[i3 + 2]
      const r = Math.hypot(x, y, z)
      // gravitational time dilation as seen from far away
      const g = Math.sqrt(Math.max(0, 1 - 1 / Math.max(r, 1.0001)))
      const ldt = dt * (0.2 + 0.8 * g)
      field.accel(x, y, z, v[i3], v[i3 + 1], v[i3 + 2], coupling)
      v[i3] += field.ax * ldt
      v[i3 + 1] += field.ay * ldt
      v[i3 + 2] += field.az * ldt
      const sp = Math.hypot(v[i3], v[i3 + 1], v[i3 + 2])
      if (sp > 30) {
        const s = 30 / sp
        v[i3] *= s
        v[i3 + 1] *= s
        v[i3 + 2] *= s
      }
      x += v[i3] * ldt
      y += v[i3 + 1] * ldt
      z += v[i3 + 2] * ldt
      p[i3] = x
      p[i3 + 1] = y
      p[i3 + 2] = z
      life[i] += dt
      const L = life[i] / maxLife[i]
      if (L >= 1 || r < 1.08) {
        on[i] = 0
        fx[i * 4] = 0
        continue
      }
      alive++
      rig.project(x, y, z, this.sp)
      rig.project(x + v[i3] * 0.03, y + v[i3 + 1] * 0.03, z + v[i3 + 2] * 0.03, this.sp2)
      pv[i * 4] = this.sp.x
      pv[i * 4 + 1] = this.sp.y
      pv[i * 4 + 2] = (this.sp2.x - this.sp.x) / 0.03
      pv[i * 4 + 3] = (this.sp2.y - this.sp.y) / 0.03
      const fadeIn = Math.min(1, life[i] / 0.12)
      const fadeOut = 1 - smooth(0.7, 1, L)
      fx[i * 4] = fadeIn * fadeOut * smooth(1.05, 1.3, r) * (this.sp.depth > 0.5 ? 1 : 0)
      fx[i * 4 + 1] = g
      fx[i * 4 + 2] = lens.theta(this.sp.depth)
      fx[i * 4 + 3] = lens.sm
    }
    this.alive = alive
    gpu.partCount = alive > 0 ? this.high : 0
    if (alive === 0) this.high = 0
  }
}
