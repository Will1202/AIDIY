import RAPIER from '@dimforge/rapier3d-compat'
import type { Quaternion, Vector3 } from 'three'

export type Rapier = typeof RAPIER
export { RAPIER }

/** collision group bits */
export const G = { STATIC: 0x0001, PLAYER: 0x0002, PROP: 0x0004, HELD: 0x0008, PORTAL: 0x0010 }
export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff)

export const GROUPS = {
  static: groups(G.STATIC | G.PORTAL, G.PLAYER | G.PROP | G.HELD),
  player: groups(G.PLAYER, G.STATIC | G.PROP),
  prop: groups(G.PROP, G.STATIC | G.PLAYER | G.PROP | G.HELD),
  held: groups(G.HELD, G.STATIC | G.PROP),
}

export const GRAVITY = 9.81

/**
 * One Rapier world for both realities. The Other Side lives 3 km away along
 * +Z (well inside f32 precision), so a single solver handles objects passing
 * between worlds without ever moving bodies between simulations.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World
  readonly events: RAPIER.EventQueue
  readonly dt = 1 / 60
  /** simulation steps since start (used by the time recorder) */
  steps = 0

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 })
    this.world.timestep = this.dt
    this.world.integrationParameters.numSolverIterations = 6
    this.events = new RAPIER.EventQueue(true)
  }

  static async create() {
    await RAPIER.init()
    return new PhysicsWorld()
  }

  fixedBody(pos?: Vector3, quat?: Quaternion) {
    const d = RAPIER.RigidBodyDesc.fixed()
    if (pos) d.setTranslation(pos.x, pos.y, pos.z)
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    return this.world.createRigidBody(d)
  }

  box(body: RAPIER.RigidBody | null, hx: number, hy: number, hz: number, x: number, y: number, z: number, quat?: Quaternion, friction = 0.7) {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(0.1).setCollisionGroups(GROUPS.static)
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    return this.world.createCollider(d, body ?? undefined)
  }

  cylinder(halfH: number, r: number, x: number, y: number, z: number) {
    const d = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(x, y, z).setFriction(0.8).setCollisionGroups(GROUPS.static)
    return this.world.createCollider(d)
  }

  trimesh(vertices: Float32Array, indices: Uint32Array) {
    const d = RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8).setCollisionGroups(GROUPS.static)
    return this.world.createCollider(d)
  }

  setGravity(dir: number) {
    this.world.gravity = { x: 0, y: -GRAVITY * dir, z: 0 }
  }

  step(onContact?: (h1: number, h2: number, force: number) => void) {
    this.world.step(this.events)
    this.steps++
    if (onContact) {
      this.events.drainContactForceEvents((e) => onContact(e.collider1(), e.collider2(), e.totalForceMagnitude()))
    } else {
      this.events.drainContactForceEvents(() => {})
    }
    this.events.drainCollisionEvents(() => {})
  }
}
