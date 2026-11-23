// 过场导演：镜头序列由时长 + 位置/注视点关键点（Catmull-Rom）组成，完全由 dt 驱动，
// 因此可以逐帧回放（Showcase 模式、测试截图），跳过时会把剩余镜头的状态回调执行到终点，保证世界状态一致。
import { CatmullRomCurve3, MathUtils, Vector3, type PerspectiveCamera } from 'three'
import type { Shot } from './api'

const ease = (k: Shot['ease'], t: number) => {
  switch (k) {
    case 'linear': return t
    case 'in': return t * t * t
    case 'out': return 1 - Math.pow(1 - t, 3)
    default: return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }
}

interface Compiled {
  shot: Shot
  pos: CatmullRomCurve3 | Vector3
  look: CatmullRomCurve3 | Vector3
}

const tmpP = new Vector3()
const tmpL = new Vector3()

export class Director {
  private list: Compiled[] = []
  private i = 0
  private t = 0
  private resolve: (() => void) | null = null
  active = false
  skippable = true
  letterbox = true
  keepControl = false

  play(shots: Shot[], opts: { letterbox?: boolean; skippable?: boolean; keepControl?: boolean } = {}): Promise<void> {
    this.finish(false)
    this.list = shots.map((s) => ({
      shot: s,
      pos: s.from.length > 1 ? new CatmullRomCurve3(s.from, false, 'centripetal') : s.from[0],
      look: s.look.length > 1 ? new CatmullRomCurve3(s.look, false, 'centripetal') : s.look[0],
    }))
    this.i = 0
    this.t = 0
    this.active = this.list.length > 0
    this.skippable = opts.skippable ?? true
    this.letterbox = opts.letterbox ?? true
    this.keepControl = opts.keepControl ?? false
    if (this.active) this.list[0].shot.start?.()
    return new Promise((r) => {
      if (!this.active) r()
      else this.resolve = r
    })
  }

  /** 推进；返回 true 表示仍在播放 */
  update(dt: number, cam: PerspectiveCamera): boolean {
    if (!this.active) return false
    let c = this.list[this.i]
    this.t += dt
    while (this.t >= c.shot.dur) {
      c.shot.tick?.(1, dt)
      this.t -= c.shot.dur
      this.i++
      if (this.i >= this.list.length) {
        this.apply(c, 1, cam)
        this.finish(true)
        return false
      }
      c = this.list[this.i]
      c.shot.start?.()
    }
    const p = c.shot.dur > 0 ? this.t / c.shot.dur : 1
    c.shot.tick?.(p, dt)
    this.apply(c, p, cam)
    return true
  }

  private apply(c: Compiled, p: number, cam: PerspectiveCamera) {
    const e = ease(c.shot.ease, p)
    if (c.pos instanceof Vector3) tmpP.copy(c.pos)
    else c.pos.getPoint(e, tmpP)
    if (c.look instanceof Vector3) tmpL.copy(c.look)
    else c.look.getPoint(e, tmpL)
    cam.position.copy(tmpP)
    cam.up.set(0, 1, 0)
    cam.lookAt(tmpL)
    if (c.shot.roll) cam.rotateZ(MathUtils.lerp(c.shot.roll[0], c.shot.roll[1], e))
    if (c.shot.fov) {
      cam.fov = MathUtils.lerp(c.shot.fov[0], c.shot.fov[1], e)
      cam.updateProjectionMatrix()
    }
  }

  /** 跳过：剩余镜头的 start / tick(1) 全部执行，世界停在过场结束时的状态 */
  skip(cam: PerspectiveCamera) {
    if (!this.active || !this.skippable) return
    for (let k = this.i; k < this.list.length; k++) {
      const c = this.list[k]
      if (k > this.i) c.shot.start?.()
      c.shot.tick?.(1, 0)
      if (k === this.list.length - 1) this.apply(c, 1, cam)
    }
    this.finish(true)
  }

  private finish(resolve: boolean) {
    this.active = false
    const r = this.resolve
    this.resolve = null
    if (resolve) r?.()
  }

  get progress() {
    if (!this.active) return 1
    const total = this.list.reduce((a, c) => a + c.shot.dur, 0)
    const done = this.list.slice(0, this.i).reduce((a, c) => a + c.shot.dur, 0) + this.t
    return total > 0 ? done / total : 1
  }
}
