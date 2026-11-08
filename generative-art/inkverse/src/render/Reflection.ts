import { HalfFloatType, LinearFilter, Matrix4, PerspectiveCamera, Plane, Vector3, Vector4, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three'

/**
 * Planar mirror for the river surface (all water sits on one plane, y = 0 in world space,
 * because rivers fill their channels to a common level). Ported from three's Reflector
 * so a custom ink water shader can sample the mirrored view.
 */
export class PlanarReflection {
  readonly rt: WebGLRenderTarget
  readonly camera = new PerspectiveCamera()
  readonly textureMatrix = new Matrix4()
  enabled = true
  private plane = new Plane()
  private normal = new Vector3(0, 1, 0)
  private point = new Vector3()
  private view = new Vector3()
  private target = new Vector3()
  private look = new Vector3()
  private rot = new Matrix4()
  private clip = new Vector4()
  private q = new Vector4()

  constructor(public scale: number) {
    this.rt = new WebGLRenderTarget(16, 16, { type: HalfFloatType, magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: true })
  }

  setSize(w: number, h: number) {
    const s = Math.max(0.05, this.scale)
    this.rt.setSize(Math.max(16, Math.round(w * s)), Math.max(16, Math.round(h * s)))
  }

  /** returns false if the camera is below the plane (nothing to mirror) */
  update(renderer: WebGLRenderer, scene: Object3D, cam: PerspectiveCamera, planeY: number, hide: Object3D[]) {
    if (!this.enabled || this.scale <= 0) return false
    this.point.set(0, planeY, 0)
    cam.updateMatrixWorld()
    this.view.setFromMatrixPosition(cam.matrixWorld)
    if (this.view.y <= planeY + 0.05) return false
    this.rot.extractRotation(cam.matrixWorld)
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.view)
    this.target.subVectors(this.point, this.look).reflect(this.normal).negate().add(this.point)
    this.view.sub(this.point).reflect(this.normal).negate().add(this.point)
    const vc = this.camera
    vc.position.copy(this.view)
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal)
    vc.lookAt(this.target)
    vc.far = cam.far
    vc.near = cam.near
    vc.updateMatrixWorld()
    vc.projectionMatrix.copy(cam.projectionMatrix)
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse)
    // oblique near plane clips everything below the water
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.point)
    this.plane.applyMatrix4(vc.matrixWorldInverse)
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant)
    const pm = vc.projectionMatrix.elements
    this.q.x = (Math.sign(this.clip.x) + pm[8]) / pm[0]
    this.q.y = (Math.sign(this.clip.y) + pm[9]) / pm[5]
    this.q.z = -1
    this.q.w = (1 + pm[10]) / pm[14]
    this.clip.multiplyScalar(2 / this.clip.dot(this.q))
    pm[2] = this.clip.x
    pm[6] = this.clip.y
    pm[10] = this.clip.z + 1 - 0.003
    pm[14] = this.clip.w
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert()

    const vis = hide.map((o) => o.visible)
    for (const o of hide) o.visible = false
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.rt)
    renderer.clear()
    renderer.render(scene, vc)
    renderer.setRenderTarget(prev)
    hide.forEach((o, i) => (o.visible = vis[i]))
    return true
  }

  dispose() {
    this.rt.dispose()
  }
}
