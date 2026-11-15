import { Quaternion, Vector3, type Object3D } from 'three'
import type { Simulation } from '../sim/simulation'
import type { RigidBody } from '../sim/physics'

/**
 * Smooth rendering between fixed physics steps: keeps the previous and current pose of every
 * non-fixed body and blends by the accumulator fraction (essential at 0.25× where physics only
 * runs ~30 steps per second).
 */
export class Interp {
  private prev = new Float32Array(0)
  private cur = new Float32Array(0)
  private index = new Map<number, number>()
  alpha = 1
  private qa = new Quaternion()
  private qb = new Quaternion()

  constructor(private sim: Simulation) {
    this.reset()
  }

  reset() {
    const n = this.sim.bodies.length
    this.prev = new Float32Array(n * 7)
    this.cur = new Float32Array(n * 7)
    this.index.clear()
    this.sim.bodies.forEach((b, i) => this.index.set(b.handle, i))
    this.capture(this.cur)
    this.prev.set(this.cur)
  }

  private capture(out: Float32Array) {
    const bodies = this.sim.bodies
    for (let i = 0; i < bodies.length; i++) {
      const t = bodies[i].translation()
      const r = bodies[i].rotation()
      const o = i * 7
      out[o] = t.x; out[o + 1] = t.y; out[o + 2] = t.z
      out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = r.w
    }
  }

  /** call before each physics step */
  beforeStep() {
    const t = this.prev
    this.prev = this.cur
    this.cur = t
  }
  /** call after each physics step */
  afterStep() {
    this.capture(this.cur)
  }
  /** teleports (reset / rewind): no blending across the jump */
  snap() {
    this.capture(this.cur)
    this.prev.set(this.cur)
  }

  apply(obj: Object3D, body: RigidBody) {
    const i = this.index.get(body.handle)
    if (i === undefined) {
      const t = body.translation()
      const r = body.rotation()
      obj.position.set(t.x, t.y, t.z)
      obj.quaternion.set(r.x, r.y, r.z, r.w)
      return
    }
    const o = i * 7
    const a = this.alpha
    const p = this.prev
    const c = this.cur
    obj.position.set(p[o] + (c[o] - p[o]) * a, p[o + 1] + (c[o + 1] - p[o + 1]) * a, p[o + 2] + (c[o + 2] - p[o + 2]) * a)
    this.qa.set(p[o + 3], p[o + 4], p[o + 5], p[o + 6])
    this.qb.set(c[o + 3], c[o + 4], c[o + 5], c[o + 6])
    obj.quaternion.slerpQuaternions(this.qa, this.qb, a)
  }

  position(body: RigidBody, out = new Vector3()) {
    const i = this.index.get(body.handle)
    if (i === undefined) {
      const t = body.translation()
      return out.set(t.x, t.y, t.z)
    }
    const o = i * 7
    const a = this.alpha
    const p = this.prev
    const c = this.cur
    return out.set(p[o] + (c[o] - p[o]) * a, p[o + 1] + (c[o + 1] - p[o + 1]) * a, p[o + 2] + (c[o + 2] - p[o + 2]) * a)
  }
}
