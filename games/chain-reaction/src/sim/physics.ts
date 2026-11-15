import RAPIER from '@dimforge/rapier3d-compat'
import type { Q4, V3 } from './math'

export { RAPIER }
export type RigidBody = RAPIER.RigidBody
export type Collider = RAPIER.Collider

let ready: Promise<void> | null = null
/** Rapier's compat build carries its WASM inline, so this works the same in the browser and in Node. */
export function initRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init()
  return ready
}

/** Fixed physics step. Speed controls change how many of these run per real second, never their size. */
export const DT = 1 / 120

export type MaterialName = 'steel' | 'brass' | 'wood' | 'iron' | 'rubber' | 'felt'
export const MATERIALS: Record<MaterialName, { friction: number; restitution: number }> = {
  steel: { friction: 0.42, restitution: 0.32 },
  brass: { friction: 0.3, restitution: 0.22 },
  wood: { friction: 0.55, restitution: 0.08 },
  iron: { friction: 0.5, restitution: 0.12 },
  rubber: { friction: 0.9, restitution: 0.5 },
  felt: { friction: 0.8, restitution: 0.02 },
}

export interface ColliderOwner {
  /** component id */
  comp: string
  /** part name inside the component, e.g. "rail", "domino:12" */
  part: string
  material: MaterialName
}

export interface ImpactEvent {
  /** relative normal speed at first contact (m/s) */
  speed: number
  pos: V3
  a: ColliderOwner
  b: ColliderOwner
}

/** Owns the Rapier world, the event queue and collider → component bookkeeping. */
export class Physics {
  readonly world: RAPIER.World
  readonly queue: RAPIER.EventQueue
  readonly owners = new Map<number, ColliderOwner>()
  /** linear velocity of every dynamic body before the current step (for impact speeds) */
  private prevVel = new Map<number, V3>()

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = DT
    this.world.numSolverIterations = 8
    this.queue = new RAPIER.EventQueue(true)
  }

  body(desc: RAPIER.RigidBodyDesc): RigidBody {
    return this.world.createRigidBody(desc)
  }

  collider(desc: RAPIER.ColliderDesc, body: RigidBody, owner: ColliderOwner): Collider {
    const m = MATERIALS[owner.material]
    if (!desc.isSensor) desc.setFriction(m.friction).setRestitution(m.restitution)
    const c = this.world.createCollider(desc, body)
    this.owners.set(c.handle, owner)
    return c
  }

  /** remember velocities so the impact speed can be measured from the pre-solve state */
  beforeStep() {
    this.prevVel.clear()
    this.world.forEachActiveRigidBody((b) => {
      if (b.isDynamic()) {
        const v = b.linvel()
        this.prevVel.set(b.handle, { x: v.x, y: v.y, z: v.z })
      }
    })
  }

  step() {
    this.world.step(this.queue)
  }

  /** contact starts this step, with the approach speed along the contact normal */
  drainImpacts(minSpeed: number, out: ImpactEvent[]) {
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return
      const c1 = this.world.getCollider(h1)
      const c2 = this.world.getCollider(h2)
      if (!c1 || !c2 || c1.isSensor() || c2.isSensor()) return
      const a = this.owners.get(h1)
      const b = this.owners.get(h2)
      if (!a || !b) return
      const b1 = c1.parent()
      const b2 = c2.parent()
      const va = (b1 && this.prevVel.get(b1.handle)) || velOf(b1)
      const vb = (b2 && this.prevVel.get(b2.handle)) || velOf(b2)
      let n: V3 = { x: 0, y: 1, z: 0 }
      let p: V3 | null = null
      this.world.contactPair(c1, c2, (m) => {
        const nn = m.normal()
        n = { x: nn.x, y: nn.y, z: nn.z }
        if (m.numSolverContacts() > 0) {
          const sp = m.solverContactPoint(0)
          if (sp) p = { x: sp.x, y: sp.y, z: sp.z }
        }
      })
      const rel = { x: va.x - vb.x, y: va.y - vb.y, z: va.z - vb.z }
      const speed = Math.abs(rel.x * n.x + rel.y * n.y + rel.z * n.z)
      if (speed < minSpeed) return
      const pos = p ?? (b1 ? b1.translation() : c1.translation())
      out.push({ speed, pos: { x: pos.x, y: pos.y, z: pos.z }, a, b })
    })
    this.queue.drainContactForceEvents(() => {})
  }

  free() {
    this.queue.free()
    this.world.free()
  }
}

function velOf(b: RigidBody | null): V3 {
  if (!b) return { x: 0, y: 0, z: 0 }
  const v = b.linvel()
  return { x: v.x, y: v.y, z: v.z }
}

export const toQ = (q: { x: number; y: number; z: number; w: number }): Q4 => ({ x: q.x, y: q.y, z: q.z, w: q.w })
export const toV = (v: { x: number; y: number; z: number }): V3 => ({ x: v.x, y: v.y, z: v.z })
