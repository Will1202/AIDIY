import { BoxGeometry, BufferGeometry, Euler, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PhysicsWorld } from '../physics/PhysicsWorld'

/**
 * Accumulates architecture per material and merges it into one mesh each,
 * so a whole brutalist hall costs a handful of draw calls per portal level.
 * Optionally mirrors every solid piece into a static Rapier collider.
 */
export class Builder {
  private readonly parts = new Map<Material, BufferGeometry[]>()
  constructor(private readonly phys: PhysicsWorld | null, private readonly offset = new Vector3()) {}

  add(mat: Material, g: BufferGeometry) {
    let list = this.parts.get(mat)
    if (!list) this.parts.set(mat, (list = []))
    if (g.index === null) {
      const idx = Array.from({ length: g.attributes.position.count }, (_, i) => i)
      g.setIndex(idx)
    }
    // triplanar materials need nothing but position + normal; dropping the rest keeps merges compatible
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    list.push(g)
    return g
  }

  /** axis-aligned (optionally yawed) box centred at x,y,z */
  box(mat: Material | null, w: number, h: number, d: number, x: number, y: number, z: number, collide = false, yaw = 0, pitch = 0) {
    const ox = this.offset.x, oy = this.offset.y, oz = this.offset.z
    if (mat) {
      const g = new BoxGeometry(w, h, d)
      if (yaw || pitch) g.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(pitch, yaw, 0, 'YXZ')))
      g.translate(x + ox, y + oy, z + oz)
      this.add(mat, g)
    }
    if (collide && this.phys) {
      const q = yaw || pitch ? new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ')) : undefined
      this.phys.box(null, w / 2, h / 2, d / 2, x + ox, y + oy, z + oz, q)
    }
  }

  geometry(mat: Material, g: BufferGeometry, x = 0, y = 0, z = 0) {
    g.translate(x + this.offset.x, y + this.offset.y, z + this.offset.z)
    this.add(mat, g)
  }

  build(shadows: (m: Material) => { cast: boolean; receive: boolean } = () => ({ cast: false, receive: true })) {
    const meshes: Mesh[] = []
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      if (!merged) continue
      merged.computeBoundingSphere()
      const m = new Mesh(merged, mat)
      const s = shadows(mat)
      m.castShadow = s.cast
      m.receiveShadow = s.receive
      m.matrixAutoUpdate = false
      m.updateMatrix()
      meshes.push(m)
      for (const g of list) g.dispose()
    }
    this.parts.clear()
    return meshes
  }
}
