import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Quaternion, Vector3,
  DoubleSide,
} from 'three'
import { clamp, rng } from '../core/config'
import { RAPIER, GROUPS, type PhysObj, type PhysicsEngine } from '../physics/PhysicsEngine'
import { crackPattern, polyCentroid, type CrackPattern, type Poly } from './voronoi'
import type { ScreenBoundary } from './ScreenBoundary'

const THICK = 0.055

/** extrude a convex polygon (centred on its centroid) into a thin glass prism; group 0 = faces, 1 = edges */
export function shardGeometry(poly: Poly, cx: number, cy: number, halfW: number, halfH: number) {
  const n = poly.length
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const z = THICK / 2
  const push = (x: number, y: number, zz: number, nx: number, ny: number, nz: number) => {
    pos.push(x - cx, y - cy, zz)
    nor.push(nx, ny, nz)
    uv.push((x + halfW) / (2 * halfW), (y + halfH) / (2 * halfH))
  }
  // faces (ensure CCW for the front)
  const ccw = poly.reduce((a, p, i) => a + (p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1]), 0) > 0
  const P = ccw ? poly : [...poly].reverse()
  for (let i = 1; i < n - 1; i++) {
    push(P[0][0], P[0][1], z, 0, 0, 1)
    push(P[i][0], P[i][1], z, 0, 0, 1)
    push(P[i + 1][0], P[i + 1][1], z, 0, 0, 1)
    push(P[0][0], P[0][1], -z, 0, 0, -1)
    push(P[i + 1][0], P[i + 1][1], -z, 0, 0, -1)
    push(P[i][0], P[i][1], -z, 0, 0, -1)
  }
  const faceCount = pos.length / 3
  for (let i = 0; i < n; i++) {
    const a = P[i]
    const b = P[(i + 1) % n]
    let nx = b[1] - a[1]
    let ny = -(b[0] - a[0])
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    push(a[0], a[1], z, nx, ny, 0)
    push(a[0], a[1], -z, nx, ny, 0)
    push(b[0], b[1], -z, nx, ny, 0)
    push(a[0], a[1], z, nx, ny, 0)
    push(b[0], b[1], -z, nx, ny, 0)
    push(b[0], b[1], z, nx, ny, 0)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.addGroup(0, faceCount, 0)
  g.addGroup(faceCount, pos.length / 3 - faceCount, 1)
  g.computeBoundingSphere()
  return g
}

export interface Shard extends PhysObj {
  slot: Vector3
  stuckUntil: number
}

/**
 * Turns the cracked pane into real glass shards: every Voronoi cell becomes a
 * thin convex rigid body placed exactly where it sat in the pane, so the break
 * follows the cracks the user already watched spreading. Shards near the rim
 * may stay wedged in the frame and drop a moment later.
 */
export class FractureSystem {
  readonly group = new Group()
  shards: Shard[] = []
  pattern: CrackPattern | null = null
  shardCount = 110
  private readonly faceMat: MeshPhysicalMaterial
  private readonly edgeMat: MeshBasicMaterial
  private seed = 1
  private time = 0

  constructor(
    private physics: PhysicsEngine,
    private screen: ScreenBoundary,
  ) {
    this.faceMat = new MeshPhysicalMaterial({
      color: 0xdcefff,
      metalness: 0,
      roughness: 0.03,
      transparent: true,
      opacity: 0.1,
      envMapIntensity: 1.8,
      specularIntensity: 1,
      ior: 1.52,
      depthWrite: false,
      side: DoubleSide,
    })
    this.edgeMat = new MeshBasicMaterial({ color: new Color(0xbfe8ff).multiplyScalar(1.15), transparent: true, opacity: 0.6, depthWrite: false })
  }

  /** first damage: decide the fracture around this impact point */
  ensurePattern(x: number, y: number) {
    if (this.pattern) return this.pattern
    const hw = this.screen.halfW
    const hh = this.screen.halfH
    const ix = clamp(x, -hw + 0.3, hw - 0.3)
    const iy = clamp(y, -hh + 0.3, hh - 0.3)
    this.pattern = crackPattern([ix, iy], hw, hh, this.shardCount, this.seed++)
    this.screen.setPattern(this.pattern)
    return this.pattern
  }

  /**
   * Break the pane. `push` is the velocity of whatever went through it (world);
   * `eye` lets a few shards fly straight past the viewer.
   */
  shatter(push: Vector3, eye: Vector3) {
    if (!this.screen.intact) return
    const p = this.pattern ?? this.ensurePattern(0, 0)
    const r = rng(this.seed * 977)
    const hw = this.screen.halfW
    const hh = this.screen.halfH
    const [ix, iy] = p.impact
    const pz = Math.max(4, push.z)
    for (const cell of p.cells) {
      const [cx, cy] = polyCentroid(cell)
      const geo = shardGeometry(cell, cx, cy, hw, hh)
      const mesh = new Mesh(geo, [this.faceMat, this.edgeMat])
      mesh.renderOrder = 11
      mesh.position.set(cx, cy, 0)
      this.group.add(mesh)

      const dist = Math.hypot(cx - ix, cy - iy)
      const near = 1 - clamp(dist / p.maxDist, 0, 1)
      const onRim = cell.some(([x, y]) => Math.abs(Math.abs(x) - hw) < 0.01 || Math.abs(Math.abs(y) - hh) < 0.01)
      const stuck = onRim && near < 0.55 && r() < 0.5
      const body = this.physics.world.createRigidBody(
        (stuck ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
          .setTranslation(cx, cy, 0)
          .setLinearDamping(0.05)
          .setAngularDamping(0.2)
          .setCcdEnabled(near > 0.6),
      )
      // collider slightly shrunk so neighbours don't start interpenetrating
      const hull: number[] = []
      for (const [x, y] of cell) {
        const sx = cx + (x - cx) * 0.9
        const sy = cy + (y - cy) * 0.9
        hull.push(sx - cx, sy - cy, THICK / 2, sx - cx, sy - cy, -THICK / 2)
      }
      const cd = RAPIER.ColliderDesc.convexHull(new Float32Array(hull)) ?? RAPIER.ColliderDesc.ball(0.1)
      const collider = this.physics.world.createCollider(
        cd.setDensity(2.5).setFriction(0.5).setRestitution(0.2).setCollisionGroups(GROUPS.shard),
        body,
      )
      const o = this.physics.register({
        kind: 'shard',
        body,
        collider,
        object: mesh,
        radius: Math.sqrt(Math.max(...cell.map(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2))),
        scale: 1,
        grabbable: false,
        heavy: 1,
        gravityScale: 1,
        home: { p: new Vector3(cx, cy, 0), q: new Quaternion() },
        dispose: () => geo.dispose(),
      }) as Shard
      o.slot = new Vector3(cx, cy, 0)
      o.stuckUntil = stuck ? this.time + 0.5 + r() * 4.5 : 0
      if (!stuck) {
        const dx = cx - ix
        const dy = cy - iy
        const l = Math.hypot(dx, dy) || 1
        const out = 2.5 + near * 9 + r() * 2
        let v = new Vector3((dx / l) * out, (dy / l) * out + 1.2, pz * (0.25 + near * 0.55) + 2 + r() * 3)
        if (near > 0.5 && r() < 0.12) {
          // a few shards come straight at the viewer and fly past the camera
          const aim = eye.clone().add(new Vector3((r() - 0.5) * 7, (r() - 0.5) * 5, 2))
          v = aim.sub(o.slot).normalize().multiplyScalar(22 + r() * 12)
        }
        body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
        body.setAngvel({ x: (r() - 0.5) * 14 * (0.3 + near), y: (r() - 0.5) * 14 * (0.3 + near), z: (r() - 0.5) * 8 }, true)
      }
      this.shards.push(o)
    }
    this.screen.shatter()
    this.physics.setGlassSolid(false)
  }

  update(dt: number) {
    this.time += dt
    for (const s of this.shards) {
      if (s.stuckUntil > 0 && this.time > s.stuckUntil && !s.homing) {
        s.stuckUntil = 0
        s.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
        s.body.setLinvel({ x: 0, y: -0.5, z: 1.5 + Math.random() * 2 }, true)
        s.body.setAngvel({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 }, true)
      }
    }
  }

  /** the shards have all flown home: swap them back for the intact pane */
  restore() {
    for (const s of this.shards) this.physics.remove(s)
    this.shards = []
    this.pattern = null
    this.screen.restore()
    this.physics.setGlassSolid(true)
  }

  get broken() {
    return !this.screen.intact
  }
}
