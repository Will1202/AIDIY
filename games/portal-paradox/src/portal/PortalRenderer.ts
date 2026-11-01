import { HalfFloatType, LinearFilter, Matrix4, PerspectiveCamera, Plane, Vector3, Vector4, WebGLRenderTarget, type Scene, type WebGLRenderer } from 'three'
import { OPENING_H, OPENING_W, type Portal, type WorldId } from './Portal'

/**
 * Real-time portal rendering.
 *
 * For each open portal P visible from the main camera we walk a chain of
 * virtual cameras C_k = T(P→Q)^k · C_0. Each C_k sees the world beyond Q,
 * restricted to the screen rectangle where P is visible through every
 * previous level, and with a clip plane on Q so nothing between the virtual
 * camera and the exit plane can leak in. Levels are rendered deepest first;
 * level k samples level k+1 on P's own surface (ping-ponging two targets per
 * portal), so face-to-face portals produce true nested views — each level a
 * genuine render from its own camera, never a scaled copy.
 *
 * Every level uses an off-axis sub-frustum of the main projection covering
 * only the portal's screen rectangle, rendered into exactly that viewport of
 * the target. Pixels match the full-screen projection 1:1, so the portal
 * surface just samples its texture at gl_FragCoord — and three's frustum
 * culling automatically shrinks to the portal.
 */

export interface PortalRenderStats {
  levels: number[]
  renders: number
}

interface Level {
  cam: Matrix4
  /** NDC rect x0, y0, x1, y1 */
  rect: Vector4
}

export class PortalRenderer {
  readonly targets: WebGLRenderTarget[][] = []
  private readonly cam = new PerspectiveCamera()
  private readonly levels: Level[][] = []
  readonly stats: PortalRenderStats = { levels: [0, 0], renders: 0 }
  /** world-space plane used for every virtual render; degenerate (keeps all) for the main view */
  readonly clipPlane = new Plane(new Vector3(0, 0, 0), 1)
  width = 1
  height = 1

  constructor(private readonly renderer: WebGLRenderer, private readonly portals: Portal[]) {
    this.cam.matrixAutoUpdate = false
    this.cam.matrixWorldAutoUpdate = false
    for (let i = 0; i < portals.length; i++) {
      this.targets.push([this.makeTarget(), this.makeTarget()])
      this.levels.push(Array.from({ length: 16 }, () => ({ cam: new Matrix4(), rect: new Vector4() })))
    }
    renderer.clippingPlanes = [this.clipPlane]
  }

  private makeTarget() {
    const t = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter })
    t.texture.generateMipmaps = false
    t.scissorTest = true
    return t
  }

  setSize(w: number, h: number) {
    this.width = Math.max(2, Math.round(w))
    this.height = Math.max(2, Math.round(h))
    for (const pair of this.targets) for (const t of pair) t.setSize(this.width, this.height)
  }

  /**
   * Render all portal views needed by `main` looking at `world`.
   * Must run before the main pass: it leaves each portal surface's uniforms
   * pointing at its level-1 texture.
   */
  render(main: PerspectiveCamera, world: WorldId, scenes: Scene[], maxDepth: number, minPixels: number, onBeforeScene: (w: WorldId) => void) {
    this.stats.renders = 0
    const vw = this.width, vh = this.height
    const minNdc = (minPixels / Math.min(vw, vh)) * 2

    for (const P of this.portals) {
      this.stats.levels[P.id] = 0
      const u = P.surfaceMat.uniforms
      u.uHasTex.value = 0
      if (P.world !== world || P.open <= 0.001) continue
      const Q = P.partner
      const chain = this.levels[P.id]
      // ── build the chain of virtual cameras ───────────────────────────────
      let depth = 0
      let viewMat = main.matrixWorld
      const parentRect = _full.set(-1, -1, 1, 1)
      const r = _rect
      while (depth < maxDepth) {
        if (!portalRect(P, viewMat, main.projectionMatrix, main.near, parentRect, r)) break
        if (depth > 0 && (r.z - r.x < minNdc || r.w - r.y < minNdc)) break
        const lvl = chain[depth]
        lvl.cam.multiplyMatrices(P.link, viewMat)
        lvl.rect.copy(r)
        parentRect.copy(r)
        viewMat = lvl.cam
        depth++
        // P can only appear again if the exit lives in the same scene
        if (Q.world !== P.world) break
      }
      this.stats.levels[P.id] = depth
      if (depth === 0) continue

      // ── render deepest → shallowest ──────────────────────────────────────
      const scene = scenes[Q.world]
      const savedVis = Q.surface.visible
      Q.surface.visible = false
      onBeforeScene(Q.world)
      for (let k = depth - 1; k >= 0; k--) {
        const lvl = chain[k]
        const target = this.targets[P.id][k % 2]
        // what P shows inside this level
        if (k + 1 < depth) {
          const deeper = chain[k + 1]
          u.uTex.value = this.targets[P.id][(k + 1) % 2].texture
          u.uHasTex.value = 1
          ndcToUv(deeper.rect, u.uRect.value)
        } else {
          u.uHasTex.value = 0
        }
        u.uTarget.value.set(vw, vh)
        this.renderLevel(main, lvl, Q, scene, target)
      }
      Q.surface.visible = savedVis
      // main pass samples level 1
      u.uTex.value = this.targets[P.id][0].texture
      u.uHasTex.value = 1
      ndcToUv(chain[0].rect, u.uRect.value)
    }
    // the main view keeps everything
    this.clipPlane.normal.set(0, 0, 0)
    this.clipPlane.constant = 1
  }

  private renderLevel(main: PerspectiveCamera, lvl: Level, exit: Portal, scene: Scene, target: WebGLRenderTarget) {
    const cam = this.cam
    const W = this.width, H = this.height
    // snap the NDC rect to whole pixels, then build the exact sub-frustum for those pixels
    const px0 = Math.max(0, Math.floor(((lvl.rect.x + 1) / 2) * W))
    const py0 = Math.max(0, Math.floor(((lvl.rect.y + 1) / 2) * H))
    const px1 = Math.min(W, Math.ceil(((lvl.rect.z + 1) / 2) * W))
    const py1 = Math.min(H, Math.ceil(((lvl.rect.w + 1) / 2) * H))
    const pw = px1 - px0, ph = py1 - py0
    if (pw <= 0 || ph <= 0) return
    const x0 = (px0 / W) * 2 - 1, x1 = (px1 / W) * 2 - 1
    const y0 = (py0 / H) * 2 - 1, y1 = (py1 / H) * 2 - 1
    const sx = 2 / (x1 - x0), sy = 2 / (y1 - y0)
    _sub.set(
      sx, 0, 0, -(x0 + x1) / (x1 - x0),
      0, sy, 0, -(y0 + y1) / (y1 - y0),
      0, 0, 1, 0,
      0, 0, 0, 1,
    )
    cam.projectionMatrix.multiplyMatrices(_sub, main.projectionMatrix)
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
    cam.near = main.near
    cam.far = main.far
    cam.matrixWorld.copy(lvl.cam)
    cam.matrixWorldInverse.copy(lvl.cam).invert()

    // keep only what lies beyond the exit plane, as seen from this camera
    _p.setFromMatrixPosition(lvl.cam)
    const side = exit.forward.dot(_p) - exit.forward.dot(exit.position) >= 0 ? 1 : -1
    this.clipPlane.normal.copy(exit.forward).multiplyScalar(-side)
    this.clipPlane.constant = -this.clipPlane.normal.dot(exit.position) + 0.002

    // the near plane can still graze the far-side jambs of the exit when the camera is close
    for (const P of this.portals) P.fitSurfaceTo(_p)

    target.viewport.set(px0, py0, pw, ph)
    target.scissor.set(px0, py0, pw, ph)
    this.renderer.setRenderTarget(target)
    this.renderer.clear(true, true, false)
    this.renderer.render(scene, cam)
    this.stats.renders++
  }

  dispose() {
    for (const pair of this.targets) for (const t of pair) t.dispose()
  }
}

const _full = new Vector4()
const _rect = new Vector4()
const _sub = new Matrix4()
const _p = new Vector3()

function ndcToUv(r: Vector4, out: Vector4) {
  out.set((r.x + 1) / 2, (r.y + 1) / 2, (r.z + 1) / 2, (r.w + 1) / 2)
}

const _corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
const _poly: Vector3[] = Array.from({ length: 10 }, () => new Vector3())
const _clipped: Vector3[] = Array.from({ length: 10 }, () => new Vector3())
const _inv = new Matrix4()
const _local = new Vector3()

/**
 * Screen rectangle (NDC) of P's opening seen from a camera with world matrix
 * `camWorld`, intersected with `parent`. The opening polygon is clipped
 * against the near plane in view space before projecting, so portals that
 * wrap around or behind the camera stay correct.
 */
export function portalRect(P: Portal, camWorld: Matrix4, proj: Matrix4, near: number, parent: Vector4, out: Vector4) {
  _local.setFromMatrixPosition(camWorld).applyMatrix4(P.inverse)
  // camera practically inside the window: everything in the parent rect may be portal
  if (Math.abs(_local.z) < 0.75 && Math.abs(_local.x) < OPENING_W / 2 + 0.05 && _local.y > -0.05 && _local.y < OPENING_H + 0.05) {
    out.copy(parent)
    return true
  }
  const m = 0.03
  _corners[0].set(-OPENING_W / 2 - m, -m, 0)
  _corners[1].set(OPENING_W / 2 + m, -m, 0)
  _corners[2].set(OPENING_W / 2 + m, OPENING_H + m, 0)
  _corners[3].set(-OPENING_W / 2 - m, OPENING_H + m, 0)
  _inv.copy(camWorld).invert()
  for (let i = 0; i < 4; i++) _poly[i].copy(_corners[i]).applyMatrix4(P.matrix).applyMatrix4(_inv)
  // Sutherland–Hodgman against z = -near (view space looks down -Z)
  const zc = -near
  let n = 0
  for (let i = 0; i < 4; i++) {
    const a = _poly[i], b = _poly[(i + 1) % 4]
    const ina = a.z <= zc, inb = b.z <= zc
    if (ina) _clipped[n++].copy(a)
    if (ina !== inb) {
      const t = (zc - a.z) / (b.z - a.z)
      _clipped[n++].copy(a).lerp(b, t)
    }
  }
  if (n < 3) return false
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const e = proj.elements
  for (let i = 0; i < n; i++) {
    const v = _clipped[i]
    const w = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15]
    const x = (e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]) / w
    const y = (e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]) / w
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  out.set(Math.max(x0, parent.x), Math.max(y0, parent.y), Math.min(x1, parent.z), Math.min(y1, parent.w))
  return out.z > out.x && out.w > out.y
}
