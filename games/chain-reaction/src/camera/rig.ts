import { PerspectiveCamera, Spherical, Vector3 } from 'three'

export type CameraMode = 'director' | 'overview' | 'follow' | 'macro' | 'free'
export const CAMERA_MODES: CameraMode[] = ['director', 'overview', 'follow', 'macro', 'free']
export const CAMERA_LABEL: Record<CameraMode, string> = {
  director: 'AUTO DIRECTOR', overview: 'OVERVIEW', follow: 'FOLLOW MARBLE', macro: 'MACRO', free: 'FREE CAMERA',
}

export interface Shot {
  pos: Vector3
  target: Vector3
  fov: number
  /** smoothing rate (1/s): higher = snappier */
  rate: number
}

/**
 * Damped camera: shots set a desired pose; the rig eases position, aim and fov towards it, so cuts
 * between event-driven shots glide instead of jumping. In FREE mode the pointer drives an orbit.
 */
export class CameraRig {
  readonly pos = new Vector3(18, 16, 34)
  readonly target = new Vector3(0, 13, 0)
  fov = 40
  private desired: Shot = { pos: new Vector3(18, 16, 34), target: new Vector3(0, 13, 0), fov: 40, rate: 2 }
  // free-orbit state
  readonly orbit = new Spherical(36, 1.25, 0.5)
  readonly orbitTarget = new Vector3(0, 13, 0)
  private dragging: 'rotate' | 'pan' | null = null
  private last = { x: 0, y: 0 }
  shake = 0
  private shakePhase = 0
  onUserInput: (() => void) | null = null
  /** when false, pointer input is ignored (editor gizmo drags) */
  inputEnabled = true

  constructor(readonly camera: PerspectiveCamera, private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down)
    window.addEventListener('pointermove', this.move)
    window.addEventListener('pointerup', this.up)
    el.addEventListener('wheel', this.wheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  set(shot: Shot) {
    this.desired = shot
  }

  /** a director cut: jump if the new shot is far away (gliding there would fly through the machine) */
  cutTo(shot: Shot) {
    if (shot.pos.distanceTo(this.pos) > 5 || shot.target.distanceTo(this.target) > 5) this.snap(shot)
    else this.desired = shot
  }

  /** jump straight to a pose (first frame, reset) */
  snap(shot: Shot) {
    this.desired = shot
    this.pos.copy(shot.pos)
    this.target.copy(shot.target)
    this.fov = shot.fov
  }

  /** copy the current view into the orbit so FREE mode continues from where we are */
  syncOrbit() {
    this.orbitTarget.copy(this.target)
    const d = this.pos.clone().sub(this.target)
    this.orbit.setFromVector3(d)
  }

  freeShot(): Shot {
    const p = new Vector3().setFromSpherical(this.orbit).add(this.orbitTarget)
    return { pos: p, target: this.orbitTarget.clone(), fov: 40, rate: 14 }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-this.desired.rate * dt)
    this.pos.lerp(this.desired.pos, k)
    this.target.lerp(this.desired.target, k)
    this.fov += (this.desired.fov - this.fov) * k
    this.camera.position.copy(this.pos)
    if (this.shake > 0.001) {
      this.shakePhase += dt * 40
      const s = this.shake * 0.05
      this.camera.position.x += Math.sin(this.shakePhase * 1.3) * s
      this.camera.position.y += Math.sin(this.shakePhase * 1.7 + 1) * s
      this.shake *= Math.exp(-dt * 5)
    }
    this.camera.lookAt(this.target)
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov
      this.camera.updateProjectionMatrix()
    }
  }

  private down = (e: PointerEvent) => {
    if (!this.inputEnabled) return
    this.dragging = e.button === 2 || e.shiftKey ? 'pan' : e.button === 0 ? 'rotate' : 'pan'
    this.last = { x: e.clientX, y: e.clientY }
  }
  private move = (e: PointerEvent) => {
    if (!this.dragging || !this.inputEnabled) return
    const dx = e.clientX - this.last.x
    const dy = e.clientY - this.last.y
    this.last = { x: e.clientX, y: e.clientY }
    if (Math.abs(dx) + Math.abs(dy) < 1) return
    this.onUserInput?.()
    if (this.dragging === 'rotate') {
      this.orbit.theta -= dx * 0.005
      this.orbit.phi = Math.min(Math.PI - 0.05, Math.max(0.08, this.orbit.phi - dy * 0.005))
    } else {
      const right = new Vector3().subVectors(this.camera.position, this.orbitTarget).cross(this.camera.up).normalize()
      const s = this.orbit.radius * 0.0016
      this.orbitTarget.addScaledVector(right, dx * s)
      this.orbitTarget.y += dy * s
    }
  }
  private up = () => {
    this.dragging = null
  }
  private wheel = (e: WheelEvent) => {
    if (!this.inputEnabled) return
    e.preventDefault()
    this.onUserInput?.()
    this.orbit.radius = Math.min(140, Math.max(1.2, this.orbit.radius * Math.exp(e.deltaY * 0.0011)))
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.down)
    window.removeEventListener('pointermove', this.move)
    window.removeEventListener('pointerup', this.up)
    this.el.removeEventListener('wheel', this.wheel)
  }
}
