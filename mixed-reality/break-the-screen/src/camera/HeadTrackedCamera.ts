import { Matrix4, PerspectiveCamera, Vector3 } from 'three'

export interface Frustum {
  left: number
  right: number
  bottom: number
  top: number
  near: number
  far: number
}

/**
 * Generalised (off-axis) perspective projection for a screen rectangle of
 * w x h centred on the origin in the z = 0 plane, seen from `eye` (z > 0).
 * This is Kooima's construction specialised to an axis-aligned screen: the
 * camera keeps facing -z and only the frustum skews, so the screen rectangle
 * always maps exactly onto the full viewport while the scene behind it shows
 * true motion parallax.
 */
export function offAxisFrustum(eye: Vector3, w: number, h: number, near: number, far: number): Frustum {
  const d = Math.max(eye.z, 1e-3)
  const k = near / d
  return {
    left: (-w / 2 - eye.x) * k,
    right: (w / 2 - eye.x) * k,
    bottom: (-h / 2 - eye.y) * k,
    top: (h / 2 - eye.y) * k,
    near,
    far,
  }
}

export function offAxisMatrix(eye: Vector3, w: number, h: number, near: number, far: number, out = new Matrix4()) {
  const f = offAxisFrustum(eye, w, h, near, far)
  return out.makePerspective(f.left, f.right, f.top, f.bottom, f.near, f.far)
}

/**
 * The viewer's eye as a three.js camera. The projection matrix is owned here;
 * PerspectiveCamera is kept only so Raycaster / culling treat it as perspective.
 */
export class HeadTrackedCamera {
  readonly camera = new PerspectiveCamera()
  /** world size of the canvas rectangle on the z = 0 plane */
  screenW = 17.78
  screenH = 10
  near = 0.08
  far = 1400
  readonly eye = new Vector3(0, 0, 28)

  constructor() {
    // three must never rebuild a symmetric frustum behind our back
    this.camera.updateProjectionMatrix = () => {}
    this.camera.matrixAutoUpdate = true
    this.apply()
  }

  setScreen(w: number, h: number) {
    this.screenW = w
    this.screenH = h
  }

  setEye(e: Vector3) {
    this.eye.copy(e)
    this.eye.z = Math.max(this.eye.z, 2)
    this.apply()
  }

  private apply() {
    const c = this.camera
    offAxisMatrix(this.eye, this.screenW, this.screenH, this.near, this.far, c.projectionMatrix)
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert()
    c.position.copy(this.eye)
    c.quaternion.identity()
    c.updateMatrixWorld(true)
  }

  /** NDC of a world point (for hover tests and HUD anchoring) */
  project(p: Vector3, out = new Vector3()) {
    return out.copy(p).project(this.camera)
  }
}
