// 第一人称角色：平滑加减速、碰撞、跳跃、上台阶、头部晃动、落地下沉、重力翻转（镜头平滑滚转 180°）。
import { MathUtils, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { moveBody, type Body, type CollisionWorld, type Surface } from '../physics/collision'
import type { PlayerApi } from '../game/api'
import type { Input } from './Input'

const UP = new Vector3(0, 1, 0)
const qYaw = new Quaternion()
const qPitch = new Quaternion()
const tmp = new Vector3()
const tmp2 = new Vector3()

export interface PlayerSettings {
  sensitivity: number
  invertY: boolean
  headBob: boolean
}

export class Player implements PlayerApi {
  body: Body = { x: 0, y: 1, z: 4, vu: 0, radius: 0.3, height: 1.72, stepHeight: 0.42, grounded: false, ground: null }
  g: 1 | -1 = 1
  yaw = 0
  pitch = 0
  locked = false
  readonly eye = new Vector3()
  readonly forward = new Vector3(0, 0, -1)
  /** 移动参考系（重力翻转后为绕水平轴旋转 180°） */
  private frame = new Quaternion()
  private frameVis = new Quaternion()
  private frameFrom = new Quaternion()
  private flipT = 1
  private vx = 0
  private vz = 0
  private eyeH = 1.62
  private smoothY = 1
  private bob = 0
  private dip = 0
  private dipV = 0
  private lastStep = 0
  private airTime = 0
  /** 重力翻转后的漂浮期：重力减弱、终端速度降低，像被慢慢拽过去 */
  private floatT = 0
  speed = 0
  lastSafe = { x: 0, y: 1, z: 4, g: 1 as 1 | -1 }
  private safeTimer = 0
  onStep: ((s: Surface, k: number) => void) | null = null
  onLand: ((v: number) => void) | null = null
  /** 本帧是否在移动 */
  moving = false

  teleport(x: number, y: number, z: number, yaw = this.yaw, pitch = this.pitch) {
    this.body.x = x
    this.body.y = y
    this.body.z = z
    this.body.vu = 0
    this.vx = this.vz = 0
    this.yaw = yaw
    this.pitch = pitch
    this.smoothY = y
    this.updateEye()
  }

  setGravity(g: 1 | -1, instant = true) {
    if (g === this.g) return
    if (instant) {
      this.g = g
      this.frame.setFromAxisAngle(new Vector3(1, 0, 0), g > 0 ? 0 : Math.PI)
      this.frameVis.copy(this.frame)
      this.flipT = 1
      this.smoothY = this.body.y
    } else this.flipGravity()
  }

  /** 重力翻转：以当前水平朝向为轴滚转 180°，视线方向保持连续 */
  flipGravity() {
    const f = this.horizontalForward(tmp)
    const r = new Quaternion().setFromAxisAngle(f, Math.PI)
    this.frameFrom.copy(this.frameVis)
    this.frame.premultiply(r)
    this.flipT = 0
    // 以眼睛为轴翻转：脚移到原来头顶的位置，身体不会翻进地板里
    const eyeY = this.body.y + this.g * this.eyeH
    this.body.y = eyeY + this.g * this.eyeH
    this.smoothY = this.body.y
    this.g = (this.g * -1) as 1 | -1
    this.body.vu = 0.5
    this.body.grounded = false
    this.floatT = 3.5
  }

  get flipping() {
    return this.flipT < 1
  }

  horizontalForward(out: Vector3) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).applyQuaternion(this.frame)
    out.y = 0
    return out.normalize()
  }

  lookDot(p: Vector3) {
    tmp2.copy(p).sub(this.eye).normalize()
    return tmp2.dot(this.forward)
  }

  /** 世界坐标中的“上” */
  get up() {
    return tmp2.set(0, this.g, 0)
  }

  update(dt: number, input: Input, worlds: CollisionWorld[], s: PlayerSettings, allowMove: boolean) {
    const b = this.body
    // ---- 视角 ----
    if (!this.locked) {
      const sens = 0.0022 * s.sensitivity
      this.yaw -= input.lookDX * sens
      this.pitch -= input.lookDY * sens * (s.invertY ? -1 : 1)
      this.pitch = MathUtils.clamp(this.pitch, -1.45, 1.45)
    }
    // ---- 移动意图（参考系局部） ----
    let ix = 0, iz = 0
    let run = false
    if (allowMove && !this.locked) {
      if (input.down('KeyW') || input.down('ArrowUp')) iz -= 1
      if (input.down('KeyS') || input.down('ArrowDown')) iz += 1
      if (input.down('KeyA') || input.down('ArrowLeft')) ix -= 1
      if (input.down('KeyD') || input.down('ArrowRight')) ix += 1
      ix += input.moveX
      iz -= input.moveY
      run = input.down('ShiftLeft') || input.down('ShiftRight') || input.touchRun
    }
    const il = Math.hypot(ix, iz)
    if (il > 1) { ix /= il; iz /= il }
    const maxSpeed = run ? 5.4 : 3.1
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw)
    // 局部 → 参考系水平面
    let wx = ix * cy + iz * sy
    let wz = -ix * sy + iz * cy
    tmp.set(wx, 0, wz).applyQuaternion(this.frame)
    wx = tmp.x
    wz = tmp.z
    const tx = wx * maxSpeed, tz = wz * maxSpeed
    const accel = b.grounded ? (il > 0.01 ? 11 : 13) : 2.2
    const k = 1 - Math.exp(-accel * dt)
    this.vx += (tx - this.vx) * k
    this.vz += (tz - this.vz) * k
    // 跳跃
    if (allowMove && !this.locked && b.grounded && (input.hit('Space'))) {
      b.vu = 5.6
      b.grounded = false
    }
    const wasGrounded = b.grounded
    const vuBefore = b.vu
    const floating = this.floatT > 0 && !b.grounded
    if (this.floatT > 0) this.floatT -= dt
    moveBody(worlds, b, this.vx * dt, this.vz * dt, dt, this.g, floating ? 7 : 18, floating ? 13 : 40)
    if (b.grounded) this.floatT = 0
    // 撞墙后修正速度（避免贴墙积累）
    this.speed = Math.hypot(this.vx, this.vz)
    if (!wasGrounded && b.grounded) {
      this.airTime = 0
      if (vuBefore < -3) {
        this.dipV = Math.min(0.16, -vuBefore * 0.018)
        this.onLand?.(-vuBefore)
        if (b.ground) this.onStep?.(b.ground.surface, Math.min(1.6, -vuBefore / 5))
      }
    }
    if (!b.grounded) this.airTime += dt
    // 安全点（掉出世界后的复活位置）
    if (b.grounded && b.ground && b.ground.safe && this.speed < 6) {
      this.safeTimer += dt
      if (this.safeTimer > 0.4) {
        this.lastSafe = { x: b.x, y: b.y, z: b.z, g: this.g }
        this.safeTimer = 0
      }
    } else this.safeTimer = 0
    // ---- 头部晃动与脚步 ----
    this.moving = b.grounded && this.speed > 0.4
    if (this.moving) {
      this.bob += dt * (this.speed * 2.05)
      const stepN = Math.floor(this.bob / Math.PI)
      if (stepN !== this.lastStep) {
        this.lastStep = stepN
        if (b.ground) this.onStep?.(b.ground.surface, run ? 1.25 : 0.9)
      }
    } else {
      this.bob += (Math.round(this.bob / Math.PI) * Math.PI - this.bob) * (1 - Math.exp(-dt * 6))
    }
    // 落地下沉弹簧
    this.dip += (this.dipV - this.dip) * (1 - Math.exp(-dt * 25))
    this.dipV *= Math.exp(-dt * 6)
    // 台阶平滑
    const dy = b.y - this.smoothY
    if (Math.abs(dy) > 0.6 || !b.grounded) this.smoothY = b.y
    else this.smoothY += dy * (1 - Math.exp(-dt * 16))
    // 翻转动画
    if (this.flipT < 1) {
      this.flipT = Math.min(1, this.flipT + dt / 1.1)
      const e = this.flipT < 0.5 ? 2 * this.flipT * this.flipT : 1 - Math.pow(-2 * this.flipT + 2, 2) / 2
      this.frameVis.slerpQuaternions(this.frameFrom, this.frame, e)
    } else this.frameVis.copy(this.frame)
    this.bobAmt = s.headBob ? 1 : 0.15
    this.updateEye()
  }

  private bobAmt = 1

  private updateEye() {
    const b = this.body
    const bobY = Math.abs(Math.sin(this.bob)) * 0.045 * this.bobAmt * Math.min(1, this.speed / 3)
    this.eye.set(b.x, this.smoothY + this.g * (this.eyeH + bobY - 0.02 - this.dip), b.z)
    qYaw.setFromAxisAngle(UP, this.yaw)
    qPitch.setFromAxisAngle(tmp.set(1, 0, 0), this.pitch)
    this.orient.copy(this.frameVis).multiply(qYaw).multiply(qPitch)
    this.forward.set(0, 0, -1).applyQuaternion(this.orient)
  }

  readonly orient = new Quaternion()

  applyCamera(cam: PerspectiveCamera) {
    cam.position.copy(this.eye)
    // 走路时极轻微的侧倾
    const sway = Math.sin(this.bob) * 0.004 * this.bobAmt * Math.min(1, this.speed / 3)
    cam.quaternion.copy(this.orient)
    if (sway) cam.rotateZ(sway)
  }

  /** 从相机当前朝向反推 yaw / pitch（过场结束把控制交还给玩家时用） */
  syncFromCamera(cam: PerspectiveCamera) {
    const f = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const inv = this.frame.clone().invert()
    f.applyQuaternion(inv)
    this.yaw = Math.atan2(-f.x, -f.z)
    this.pitch = Math.asin(MathUtils.clamp(f.y, -1, 1))
    this.updateEye()
  }
}
