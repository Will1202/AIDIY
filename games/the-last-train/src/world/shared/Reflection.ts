// 水平面的平面反射（斜近裁剪面技术，不需要重新编译着色器），用于站台积水与博物馆抛光地面。
import { HalfFloatType, LinearFilter, Matrix4, PerspectiveCamera, Plane, Vector3, Vector4, WebGLRenderTarget, type Object3D, type Scene, type WebGLRenderer } from 'three'

const rp = new Vector3()
const cp = new Vector3()
const n = new Vector3()
const view = new Vector3()
const look = new Vector3()
const target = new Vector3()
const rot = new Matrix4()
const plane = new Plane()
const clip = new Vector4()
const q = new Vector4()

export class PlanarReflection {
  readonly rt: WebGLRenderTarget
  readonly cam = new PerspectiveCamera()
  readonly texMatrix = new Matrix4()
  /** 反射时隐藏的物体（地面自身、雨） */
  hide: Object3D[] = []
  enabled = true

  constructor(private y: number, private scale: number) {
    this.rt = new WebGLRenderTarget(2, 2, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter })
    this.rt.texture.generateMipmaps = false
  }

  setPlaneY(y: number) {
    this.y = y
  }

  /** 在主渲染之前调用。planeY 为场景坐标中的平面高度。 */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, fullW: number, fullH: number, planeY = this.y) {
    if (!this.enabled) return
    const w = Math.max(2, Math.round(fullW * this.scale)), h = Math.max(2, Math.round(fullH * this.scale))
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h)
    rp.set(camera.position.x, planeY, camera.position.z)
    cp.setFromMatrixPosition(camera.matrixWorld)
    n.set(0, 1, 0)
    view.subVectors(rp, cp)
    if (view.dot(n) > 0) return
    view.reflect(n).negate().add(rp)
    rot.extractRotation(camera.matrixWorld)
    look.set(0, 0, -1).applyMatrix4(rot).add(cp)
    target.subVectors(rp, look).reflect(n).negate().add(rp)
    const vc = this.cam
    vc.position.copy(view)
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n)
    vc.lookAt(target)
    vc.far = camera.far
    vc.near = camera.near
    vc.updateMatrixWorld()
    vc.projectionMatrix.copy(camera.projectionMatrix)
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    this.texMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse)
    plane.setFromNormalAndCoplanarPoint(n, rp).applyMatrix4(vc.matrixWorldInverse)
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    const pm = vc.projectionMatrix.elements
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0]
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5]
    q.z = -1
    q.w = (1 + pm[10]) / pm[14]
    clip.multiplyScalar(2 / clip.dot(q))
    pm[2] = clip.x
    pm[6] = clip.y
    pm[10] = clip.z + 1 - 0.003
    pm[14] = clip.w
    const vis = this.hide.map((o) => o.visible)
    this.hide.forEach((o) => (o.visible = false))
    const prevRT = renderer.getRenderTarget()
    const sAuto = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.rt)
    renderer.clear(true, true, false)
    renderer.render(scene, vc)
    renderer.setRenderTarget(prevRT)
    renderer.shadowMap.autoUpdate = sAuto
    this.hide.forEach((o, i) => (o.visible = vis[i]))
  }

  dispose() {
    this.rt.dispose()
  }
}
