import { Quaternion, Vector3 } from 'three'
import { clamp, easeInOutCubic } from '../core/config'
import { RAPIER, type PhysObj, type PhysicsEngine } from './PhysicsEngine'

/**
 * Sends a body home along a smooth path (quadratic Bézier through an optional
 * waypoint), as a kinematic body so it can still shove anything in its way.
 * Used by REBUILD: shards fly back into the pane, objects back to their spots.
 */
export function startHoming(
  o: PhysObj,
  to: Vector3,
  toQ: Quaternion,
  opts: { delay: number; duration: number; via?: Vector3 | null; after: 'dynamic' | 'fixed' | 'remove' },
) {
  o.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  o.homing = {
    from: o.currP.clone(),
    fromQ: o.currQ.clone(),
    via: opts.via ?? null,
    to: to.clone(),
    toQ: toQ.clone(),
    delay: opts.delay,
    duration: Math.max(0.05, opts.duration),
    t: 0,
    after: opts.after,
    done: false,
  }
}

const P = new Vector3()
const C = new Vector3()
const Q = new Quaternion()

export function installHoming(physics: PhysicsEngine, onLanded: (o: PhysObj) => void) {
  physics.preStep.push((h) => {
    for (const o of physics.objs) {
      const m = o.homing
      if (!m || m.done) continue
      m.t += h
      const u = clamp((m.t - m.delay) / m.duration, 0, 1)
      const e = easeInOutCubic(u)
      if (m.via) {
        // control point chosen so the curve passes through the waypoint at u = 0.5
        C.copy(m.via).multiplyScalar(2).addScaledVector(m.from, -0.5).addScaledVector(m.to, -0.5)
        const a = (1 - e) * (1 - e)
        const b = 2 * e * (1 - e)
        const c = e * e
        P.set(a * m.from.x + b * C.x + c * m.to.x, a * m.from.y + b * C.y + c * m.to.y, a * m.from.z + b * C.z + c * m.to.z)
      } else {
        P.lerpVectors(m.from, m.to, e)
      }
      Q.slerpQuaternions(m.fromQ, m.toQ, e)
      o.body.setNextKinematicTranslation({ x: P.x, y: P.y, z: P.z })
      o.body.setNextKinematicRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w })
      if (u >= 1) {
        m.done = true
        if (m.after === 'dynamic') {
          o.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
          o.body.setTranslation({ x: m.to.x, y: m.to.y, z: m.to.z }, true)
          o.body.setRotation({ x: m.toQ.x, y: m.toQ.y, z: m.toQ.z, w: m.toQ.w }, true)
          o.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          o.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
          o.homing = null
        }
        onLanded(o)
      }
    }
  })
}
