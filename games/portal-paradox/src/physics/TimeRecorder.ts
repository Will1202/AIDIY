import { Quaternion, Vector3 } from 'three'
import type { Prop, PropSystem } from './Props'
import type { WorldId } from '../portal/Portal'

const STRIDE = 13 // p(3) q(4) v(3) w(3)

/**
 * Time rewind by recording and replaying — not by running physics backwards.
 *
 * After every fixed 60 Hz step the full rigid-body state of every prop
 * (position, rotation, linear and angular velocity, world, portal-crossing
 * count) goes into a ring buffer. Rewinding pauses the solver and scrubs a
 * playhead backwards through that history with continuous interpolation;
 * releasing writes the state at the playhead back into Rapier and truncates
 * the future, so simulation resumes from a consistent state (velocities
 * included) as if the last seconds never happened.
 */
export class TimeRecorder {
  readonly capacity: number
  private data: Float32Array
  private worlds: Uint8Array
  private tele: Uint16Array
  private gravity: Int8Array
  private head = 0
  count = 0
  rewinding = false
  /** frames back from the newest snapshot */
  playhead = 0
  speed = 0
  private n = 0

  constructor(seconds = 10, private readonly hz = 60) {
    this.capacity = seconds * hz
    this.data = new Float32Array(0)
    this.worlds = new Uint8Array(0)
    this.tele = new Uint16Array(0)
    this.gravity = new Int8Array(this.capacity)
  }

  private ensure(n: number) {
    if (n === this.n) return
    this.n = n
    this.data = new Float32Array(this.capacity * n * STRIDE)
    this.worlds = new Uint8Array(this.capacity * n)
    this.tele = new Uint16Array(this.capacity * n)
    this.count = 0
    this.head = 0
  }

  clear() {
    this.count = 0
    this.head = 0
    this.rewinding = false
    this.playhead = 0
  }

  /** seconds of history available */
  get seconds() {
    return this.count / this.hz
  }

  record(props: Prop[], gravityDir: number) {
    this.ensure(props.length)
    const f = this.head
    let o = f * this.n * STRIDE
    for (let i = 0; i < props.length; i++) {
      const p = props[i]
      const lv = p.body.linvel(), av = p.body.angvel()
      const d = this.data
      d[o++] = p.currP.x; d[o++] = p.currP.y; d[o++] = p.currP.z
      d[o++] = p.currQ.x; d[o++] = p.currQ.y; d[o++] = p.currQ.z; d[o++] = p.currQ.w
      d[o++] = lv.x; d[o++] = lv.y; d[o++] = lv.z
      d[o++] = av.x; d[o++] = av.y; d[o++] = av.z
      this.worlds[f * this.n + i] = p.world
      this.tele[f * this.n + i] = p.teleports & 0xffff
    }
    this.gravity[f] = gravityDir
    this.head = (this.head + 1) % this.capacity
    this.count = Math.min(this.capacity, this.count + 1)
  }

  private index(back: number) {
    return (this.head - 1 - back + this.capacity * 2) % this.capacity
  }

  begin() {
    if (this.count < 2) return false
    this.rewinding = true
    this.playhead = 0
    this.speed = 0
    return true
  }

  /** advance the playhead; `rate` is history-seconds per real second */
  advance(dt: number, rate: number) {
    this.speed = rate
    this.playhead = Math.min(this.count - 1, this.playhead + rate * dt * this.hz)
    return this.playhead >= this.count - 1
  }

  /** pose every prop at the playhead (interpolating between snapshots) */
  apply(sys: PropSystem) {
    const back = this.playhead
    const b0 = Math.floor(back)
    const frac = back - b0
    const fA = this.index(b0) // newer
    const fB = this.index(Math.min(this.count - 1, b0 + 1)) // older
    const props = sys.props
    for (let i = 0; i < props.length; i++) {
      const p = props[i]
      const oA = (fA * this.n + i) * STRIDE, oB = (fB * this.n + i) * STRIDE
      const d = this.data
      const sameSide = this.worlds[fA * this.n + i] === this.worlds[fB * this.n + i] && this.tele[fA * this.n + i] === this.tele[fB * this.n + i]
      // never blend across a portal teleport: snap to whichever snapshot is nearer
      const t = sameSide ? frac : frac < 0.5 ? 0 : 1
      _a.set(d[oA], d[oA + 1], d[oA + 2])
      _b.set(d[oB], d[oB + 1], d[oB + 2])
      p.renderP.lerpVectors(_a, _b, t)
      _qa.set(d[oA + 3], d[oA + 4], d[oA + 5], d[oA + 6])
      _qb.set(d[oB + 3], d[oB + 4], d[oB + 5], d[oB + 6])
      p.renderQ.slerpQuaternions(_qa, _qb, t)
      const w = (t < 0.5 ? this.worlds[fA * this.n + i] : this.worlds[fB * this.n + i]) as WorldId
      sys.setWorld(p, w)
      p.currP.copy(p.renderP); p.prevP.copy(p.renderP)
      p.currQ.copy(p.renderQ); p.prevQ.copy(p.renderQ)
      p.body.setTranslation({ x: p.renderP.x, y: p.renderP.y, z: p.renderP.z }, false)
      p.body.setRotation({ x: p.renderQ.x, y: p.renderQ.y, z: p.renderQ.z, w: p.renderQ.w }, false)
    }
  }

  /** resume simulation from the playhead; returns the gravity direction recorded there */
  end(sys: PropSystem) {
    this.rewinding = false
    const b0 = Math.round(this.playhead)
    const f = this.index(b0)
    const props = sys.props
    for (let i = 0; i < props.length; i++) {
      const p = props[i]
      const o = (f * this.n + i) * STRIDE
      const d = this.data
      p.currP.set(d[o], d[o + 1], d[o + 2]); p.prevP.copy(p.currP); p.renderP.copy(p.currP)
      p.currQ.set(d[o + 3], d[o + 4], d[o + 5], d[o + 6]); p.prevQ.copy(p.currQ); p.renderQ.copy(p.currQ)
      sys.setWorld(p, this.worlds[f * this.n + i] as WorldId)
      p.teleports = this.tele[f * this.n + i]
      p.body.setTranslation({ x: p.currP.x, y: p.currP.y, z: p.currP.z }, true)
      p.body.setRotation({ x: p.currQ.x, y: p.currQ.y, z: p.currQ.z, w: p.currQ.w }, true)
      p.body.setLinvel({ x: d[o + 7], y: d[o + 8], z: d[o + 9] }, true)
      p.body.setAngvel({ x: d[o + 10], y: d[o + 11], z: d[o + 12] }, true)
      const still = Math.abs(d[o + 7]) + Math.abs(d[o + 8]) + Math.abs(d[o + 9]) < 0.02
      if (still) p.body.sleep()
    }
    const g = this.gravity[f]
    // the future is gone: history now ends at the playhead
    this.count = Math.max(1, this.count - b0)
    this.head = (f + 1) % this.capacity
    this.playhead = 0
    return g
  }
}

const _a = new Vector3()
const _b = new Vector3()
const _qa = new Quaternion()
const _qb = new Quaternion()
