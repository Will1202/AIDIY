import { MathUtils, PerspectiveCamera, Quaternion, Ray, Vector3 } from 'three'
import { BASE_LEVEL, HALF } from '../core/constants'
import { clamp, damp, smootherstep } from '../util/math'

export type CamMode = 'paper' | 'orbit' | 'follow' | 'script'

export interface CamContext {
  /** world-space ground height */
  heightAt(x: number, z: number): number
  scaleY: number
  /** character head position in follow mode */
  followTarget: Vector3 | null
  followHeading: number
}

const tmpQ = new Quaternion()
const tmpV = new Vector3()
const tmpV2 = new Vector3()
const UP = new Vector3(0, 1, 0)

const lookDummy = new PerspectiveCamera()
/** pose from position + look target */
function poseLook(pos: Vector3, target: Vector3, out: Quaternion) {
  lookDummy.position.copy(pos)
  lookDummy.up.copy(UP)
  lookDummy.lookAt(target)
  return out.copy(lookDummy.quaternion)
}

export class CameraRig {
  readonly camera: PerspectiveCamera
  mode: CamMode = 'paper'
  aspect = 16 / 9

  // paper (drawing) framing
  readonly paperPos = new Vector3()
  readonly paperTarget = new Vector3()
  paperPitch = MathUtils.degToRad(66)
  paperFov = 34
  /** small extra yaw/zoom the director can add to the paper view */
  paperYaw = 0
  paperZoom = 1

  // orbit
  readonly orbitTarget = new Vector3(0, 6, 0)
  orbitYaw = 0
  orbitPitch = MathUtils.degToRad(22)
  orbitDist = 150
  private oYaw = 0
  private oPitch = 0.4
  private oDist = 150
  private oTarget = new Vector3(0, 6, 0)
  /** orbit field of view: starts from the hand-off camera, eases to 42° */
  orbitFov = 42

  // follow
  followYaw = 0
  followPitch = MathUtils.degToRad(14)
  followDist = 8
  private fYaw = 0
  private fPitch = 0.25
  private fDist = 8
  private fTarget = new Vector3()
  private fInit = false
  /** extra pull-back for the "observe" pose */
  followBoost = 0

  // scripted (director)
  readonly scriptPos = new Vector3()
  readonly scriptTarget = new Vector3()
  scriptFov = 40

  // blending between modes
  private fromPos = new Vector3()
  private fromQuat = new Quaternion()
  private fromFov = 40
  private blendT = 1
  private blendDur = 1

  private desiredPos = new Vector3()
  private desiredQuat = new Quaternion()
  private desiredFov = 40

  constructor() {
    this.camera = new PerspectiveCamera(this.paperFov, 16 / 9, 0.3, 4000)
  }

  setAspect(a: number) {
    this.aspect = a
    this.camera.aspect = a
    this.computePaperFraming(BASE_LEVEL * 0.42)
  }

  /**
   * Fit the tilted drawing view inside the paper: bisection on distance so the four
   * screen corners land just inside the sheet, footprint centred on the origin.
   */
  computePaperFraming(groundY: number) {
    const cam = new PerspectiveCamera(this.paperFov, this.aspect, 0.3, 4000)
    const pitch = this.paperPitch
    const dir = new Vector3(0, Math.sin(pitch), Math.cos(pitch))
    const ray = new Ray()
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    const margin = 4
    const foot = (d: number, tz: number) => {
      cam.position.set(0, groundY, tz).addScaledVector(dir, d)
      cam.up.set(0, 1, 0)
      cam.lookAt(0, groundY, tz)
      cam.updateMatrixWorld()
      cam.updateProjectionMatrix()
      let maxX = 0
      let minZ = Infinity
      let maxZ = -Infinity
      for (const [cx, cy] of corners) {
        tmpV.set(cx, cy, 0.5).unproject(cam)
        ray.origin.copy(cam.position)
        ray.direction.copy(tmpV).sub(cam.position).normalize()
        if (ray.direction.y >= -1e-4) return null
        const t = (groundY - ray.origin.y) / ray.direction.y
        const px = ray.origin.x + ray.direction.x * t
        const pz = ray.origin.z + ray.direction.z * t
        maxX = Math.max(maxX, Math.abs(px))
        minZ = Math.min(minZ, pz)
        maxZ = Math.max(maxZ, pz)
      }
      return { maxX, minZ, maxZ }
    }
    let lo = 10
    let hi = 1200
    let tz = 0
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2
      // centre the footprint along z
      let f = foot(mid, tz)
      for (let k = 0; k < 4 && f; k++) {
        tz -= (f.minZ + f.maxZ) / 2
        f = foot(mid, tz)
      }
      if (!f) {
        hi = mid
        continue
      }
      const ext = Math.max(f.maxX, Math.abs(f.minZ), Math.abs(f.maxZ))
      if (ext > HALF - margin) hi = mid
      else lo = mid
    }
    const d = lo
    this.paperTarget.set(0, groundY, tz)
    this.paperPos.copy(this.paperTarget).addScaledVector(dir, d)
  }

  setMode(mode: CamMode, blend = 1.2) {
    if (mode === this.mode && this.blendT >= 1) return
    this.fromPos.copy(this.camera.position)
    this.fromQuat.copy(this.camera.quaternion)
    this.fromFov = this.camera.fov
    this.blendT = blend > 0 ? 0 : 1
    this.blendDur = Math.max(0.001, blend)
    if (mode === 'follow') this.fInit = false
    this.mode = mode
  }

  /** derive orbit params from wherever the camera is now */
  syncOrbitFromCamera(target?: Vector3) {
    const c = this.camera
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(c.quaternion)
    if (target) this.orbitTarget.copy(target)
    else {
      // look target: where the view ray meets the ground (or 120 ahead)
      const t = fwd.y < -0.05 ? (BASE_LEVEL - c.position.y) / fwd.y : 120
      this.orbitTarget.copy(c.position).addScaledVector(fwd, Math.min(t, 260))
    }
    const off = tmpV2.copy(c.position).sub(this.orbitTarget)
    this.orbitDist = off.length()
    this.orbitYaw = Math.atan2(off.x, off.z)
    this.orbitPitch = Math.asin(clamp(off.y / Math.max(this.orbitDist, 1e-3), -1, 1))
    this.oYaw = this.orbitYaw
    this.oPitch = this.orbitPitch
    this.oDist = this.orbitDist
    this.oTarget.copy(this.orbitTarget)
    this.orbitFov = c.fov
  }

  get blending() {
    return this.blendT < 1
  }

  orbitDrag(dx: number, dy: number) {
    this.orbitYaw -= dx * 0.005
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, MathUtils.degToRad(4), MathUtils.degToRad(84))
  }
  orbitZoom(delta: number) {
    this.orbitDist = clamp(this.orbitDist * Math.exp(delta * 0.0012), 18, 420)
  }
  orbitPan(dx: number, dy: number) {
    const s = this.orbitDist * 0.0016
    const fx = Math.cos(this.orbitYaw)
    const fz = -Math.sin(this.orbitYaw)
    this.orbitTarget.x = clamp(this.orbitTarget.x - (dx * fx + dy * Math.sin(this.orbitYaw)) * s, -HALF, HALF)
    this.orbitTarget.z = clamp(this.orbitTarget.z - (dx * fz + dy * Math.cos(this.orbitYaw)) * s, -HALF, HALF)
  }
  followDrag(dx: number, dy: number) {
    this.followYaw -= dx * 0.005
    this.followPitch = clamp(this.followPitch + dy * 0.004, MathUtils.degToRad(-12), MathUtils.degToRad(70))
  }
  followZoom(delta: number) {
    this.followDist = clamp(this.followDist * Math.exp(delta * 0.0012), 3, 30)
  }

  update(dt: number, ctx: CamContext) {
    const c = this.camera
    switch (this.mode) {
      case 'paper': {
        const t = this.paperTarget
        const off = tmpV.copy(this.paperPos).sub(t).multiplyScalar(this.paperZoom)
        off.applyAxisAngle(UP, this.paperYaw)
        this.desiredPos.copy(t).add(off)
        poseLook(this.desiredPos, t, this.desiredQuat)
        this.desiredFov = this.paperFov
        break
      }
      case 'orbit': {
        this.oYaw = damp(this.oYaw, this.orbitYaw, 8, dt)
        this.oPitch = damp(this.oPitch, this.orbitPitch, 8, dt)
        this.oDist = damp(this.oDist, this.orbitDist, 6, dt)
        this.oTarget.lerp(this.orbitTarget, 1 - Math.exp(-6 * dt))
        const cp = Math.cos(this.oPitch)
        this.desiredPos.set(Math.sin(this.oYaw) * cp, Math.sin(this.oPitch), Math.cos(this.oYaw) * cp).multiplyScalar(this.oDist).add(this.oTarget)
        const g = ctx.heightAt(this.desiredPos.x, this.desiredPos.z) + 4
        if (this.desiredPos.y < g) this.desiredPos.y = g
        poseLook(this.desiredPos, this.oTarget, this.desiredQuat)
        this.orbitFov = damp(this.orbitFov, 42, 0.25, dt)
        this.desiredFov = this.orbitFov
        break
      }
      case 'follow': {
        const tgt = ctx.followTarget
        if (!tgt) break
        if (!this.fInit) {
          this.fInit = true
          this.fYaw = this.followYaw
          this.fPitch = this.followPitch
          this.fDist = this.followDist
          this.fTarget.copy(tgt)
        }
        this.fYaw = damp(this.fYaw, this.followYaw, 10, dt)
        this.fPitch = damp(this.fPitch, this.followPitch, 10, dt)
        this.fDist = damp(this.fDist, this.followDist + this.followBoost, 5, dt)
        this.fTarget.lerp(tgt, 1 - Math.exp(-14 * dt))
        const cp = Math.cos(this.fPitch)
        const dir = tmpV.set(Math.sin(this.fYaw) * cp, Math.sin(this.fPitch), Math.cos(this.fYaw) * cp)
        // pull in if terrain blocks the line of sight
        let dist = this.fDist
        for (let k = 1; k <= 10; k++) {
          const s = (k / 10) * this.fDist
          const px = this.fTarget.x + dir.x * s
          const pz = this.fTarget.z + dir.z * s
          const py = this.fTarget.y + dir.y * s
          if (ctx.heightAt(px, pz) + 0.6 > py) {
            dist = Math.max(1.6, s * 0.85)
            break
          }
        }
        this.desiredPos.copy(this.fTarget).addScaledVector(dir, dist)
        const g = ctx.heightAt(this.desiredPos.x, this.desiredPos.z) + 0.7
        if (this.desiredPos.y < g) this.desiredPos.y = g
        tmpV2.copy(this.fTarget)
        tmpV2.y += 0.2
        poseLook(this.desiredPos, tmpV2, this.desiredQuat)
        this.desiredFov = 52
        break
      }
      case 'script': {
        this.desiredPos.copy(this.scriptPos)
        poseLook(this.scriptPos, this.scriptTarget, this.desiredQuat)
        this.desiredFov = this.scriptFov
        break
      }
    }

    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur)
      const k = smootherstep(this.blendT)
      c.position.lerpVectors(this.fromPos, this.desiredPos, k)
      tmpQ.copy(this.fromQuat).slerp(this.desiredQuat, k)
      c.quaternion.copy(tmpQ)
      c.fov = this.fromFov + (this.desiredFov - this.fromFov) * k
    } else {
      c.position.copy(this.desiredPos)
      c.quaternion.copy(this.desiredQuat)
      c.fov = this.desiredFov
    }
    c.updateProjectionMatrix()
    c.updateMatrixWorld()
  }
}
