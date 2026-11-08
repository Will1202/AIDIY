import { MathUtils, Vector3 } from 'three'
import { PAPER_SCALE_Y } from '../core/constants'
import type { CameraRig } from '../camera/CameraRig'
import { U } from '../render/uniforms'
import { clamp, easeInOutCubic, lerp, phase, smootherstep } from '../util/math'
import type { World } from './World'

/**
 * AWAKEN THE WORLD — one continuous move from the drawing view into the living world.
 * Nothing is swapped: the same terrain, ink map and objects are on screen throughout.
 *   0.0–1.8  every ink mark trembles on the paper
 *   0.9–4.4  the pressed world inflates from the sheet to full height
 *   1.6–7.6  the camera swings from top-down to a perspective view of the valleys
 *   2.2–7.2  sky, distance haze, mist sheets and the far ranges rise out of the paper
 *   7.0–10   the camera pushes forward, into the painting
 */
export interface SphereParams {
  yaw: number
  pitch: number
  dist: number
  target: Vector3
}

export class WorldTransition {
  active = false
  t = 0
  duration = 10
  private from: SphereParams = { yaw: 0, pitch: 1, dist: 200, target: new Vector3() }
  private mid: SphereParams = { yaw: 0, pitch: 0.4, dist: 220, target: new Vector3() }
  private to: SphereParams = { yaw: 0, pitch: 0.2, dist: 130, target: new Vector3() }
  private fromScale = PAPER_SCALE_Y
  private fromAwaken = 0
  onDone: (() => void) | null = null
  /** fast variant used by EXPLORE / the cinematic (seconds) */
  speed = 1

  constructor(
    private world: World,
    private rig: CameraRig,
  ) {}

  /** begin from the camera's current pose; focus = centre of interest of what was drawn */
  start(focus: Vector3, speed = 1, endOverride?: Partial<SphereParams>) {
    const cam = this.rig.camera
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const tHit = fwd.y < -0.05 ? (this.world.heightAt(cam.position.x, cam.position.z) - cam.position.y) / fwd.y : 150
    const target = cam.position.clone().addScaledVector(fwd, clamp(Math.abs(tHit), 20, 400))
    const off = cam.position.clone().sub(target)
    const dist = off.length()
    this.from = { yaw: Math.atan2(off.x, off.z), pitch: Math.asin(clamp(off.y / dist, -1, 1)), dist, target }
    const yawSide = focus.x > 8 ? 1 : -1
    this.mid = { yaw: this.from.yaw - yawSide * MathUtils.degToRad(22), pitch: MathUtils.degToRad(30), dist: 215, target: new Vector3(focus.x * 0.4, 8, focus.z * 0.4 - 10) }
    this.to = {
      yaw: endOverride?.yaw ?? this.from.yaw - yawSide * MathUtils.degToRad(9),
      pitch: endOverride?.pitch ?? MathUtils.degToRad(13),
      dist: endOverride?.dist ?? 118,
      target: endOverride?.target ?? new Vector3(focus.x * 0.6, 7, focus.z * 0.6 - 6),
    }
    this.fromScale = this.world.scaleY
    this.fromAwaken = U.uAwaken.value
    this.t = 0
    this.speed = speed
    this.active = true
    this.rig.setMode('script', 0)
    this.apply(this.from)
  }

  private apply(p: SphereParams) {
    const cp = Math.cos(p.pitch)
    this.rig.scriptPos.set(Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp).multiplyScalar(p.dist).add(p.target)
    const g = this.world.heightAt(this.rig.scriptPos.x, this.rig.scriptPos.z) + 5
    if (this.rig.scriptPos.y < g) this.rig.scriptPos.y = g
    this.rig.scriptTarget.copy(p.target)
  }

  private blend(a: SphereParams, b: SphereParams, k: number, out: SphereParams) {
    let dy = b.yaw - a.yaw
    while (dy > Math.PI) dy -= Math.PI * 2
    while (dy < -Math.PI) dy += Math.PI * 2
    out.yaw = a.yaw + dy * k
    out.pitch = lerp(a.pitch, b.pitch, k)
    out.dist = Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), k))
    out.target.lerpVectors(a.target, b.target, k)
    return out
  }

  private cur: SphereParams = { yaw: 0, pitch: 0, dist: 0, target: new Vector3() }

  update(dt: number) {
    if (!this.active) return
    this.t += dt * this.speed
    const t = this.t
    // tremble
    const tr = phase(t, 0, 0.6) * (1 - phase(t, 1.8, 2.6))
    U.uTremble.value = tr
    // inflate
    const s = easeInOutCubic(phase(t, 0.9, 3.5))
    this.world.setScaleY(lerp(this.fromScale, 1, s))
    // atmosphere & far ranges
    U.uAwaken.value = Math.max(this.fromAwaken, smootherstep(phase(t, 2.2, 5)))
    this.world.backdrop.setRise(Math.max(this.world.backdrop.rise, smootherstep(phase(t, 2.6, 5))))
    // camera: two arcs
    const k1 = easeInOutCubic(phase(t, 1.2, 6.4))
    const k2 = easeInOutCubic(phase(t, 6.8, 3.2))
    this.blend(this.from, this.mid, k1, this.cur)
    if (k2 > 0) {
      const tmp: SphereParams = { yaw: 0, pitch: 0, dist: 0, target: new Vector3() }
      this.blend(this.mid, this.to, k2, tmp)
      this.blend(this.cur, tmp, Math.min(1, k2 * 1.6), this.cur)
    }
    // a slight lean-in during the tremble
    if (t < 2) this.cur.dist *= 1 - 0.03 * Math.sin(phase(t, 0, 2) * Math.PI)
    this.apply(this.cur)
    if (t >= this.duration) {
      this.active = false
      U.uTremble.value = 0
      this.world.setScaleY(1)
      U.uAwaken.value = 1
      this.world.backdrop.setRise(1)
      this.rig.syncOrbitFromCamera(this.to.target)
      this.rig.setMode('orbit', 0)
      const cb = this.onDone
      this.onDone = null
      cb?.()
    }
  }

  /** jump straight to the awakened state (no animation) */
  finishNow() {
    this.t = this.duration
    this.update(0)
  }
}
