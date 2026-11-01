import { Euler, MathUtils, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { RAPIER, GROUPS, type PhysicsWorld } from '../physics/PhysicsWorld'
import { mapVector, segmentCrossing } from '../portal/PortalMath'
import type { Portal, WorldId } from '../portal/Portal'
import type { Input } from '../engine/Input'

export const CAPSULE_HALF = 0.55
export const CAPSULE_R = 0.35
/** capsule centre above the feet */
export const CENTER_H = CAPSULE_HALF + CAPSULE_R
/** eye above the capsule centre (eye ≈ 1.65 m above the feet) */
export const EYE_OFF = 0.75

const WALK = 5.0
const SPRINT = 8.6
const JUMP = 5.4
const PLAYER_G = 17.5

export interface Crossing {
  from: Portal
  to: Portal
}

/**
 * First-person character: Rapier kinematic character controller (slopes,
 * steps, sliding along walls, pushing props) moved once per rendered frame,
 * so the eye position used for portal crossing is exactly the eye that gets
 * rendered — no interpolation lag between physics and view to reconcile.
 */
export class PlayerController {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  private readonly kcc: RAPIER.KinematicCharacterController
  /** capsule centre */
  readonly position = new Vector3()
  readonly velocity = new Vector3()
  yaw = 0
  pitch = 0
  grounded = false
  world: WorldId = 0
  sensitivity = 0.0022
  invertY = false
  enabled = true
  /** smoothed for camera bob */
  private bobPhase = 0
  private bobAmp = 0
  private landKick = 0
  /** last safe ground position, for void respawn */
  private readonly safe = new Vector3()
  private safeWorld: WorldId = 0
  private safeYaw = 0

  constructor(private readonly phys: PhysicsWorld) {
    const w = phys.world
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTER_H, 0))
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R).setCollisionGroups(GROUPS.player).setFriction(0),
      this.body,
    )
    this.kcc = w.createCharacterController(0.02)
    this.kcc.setUp({ x: 0, y: 1, z: 0 })
    this.kcc.setMaxSlopeClimbAngle(MathUtils.degToRad(48))
    this.kcc.setMinSlopeSlideAngle(MathUtils.degToRad(55))
    this.kcc.enableAutostep(0.42, 0.2, false)
    this.kcc.enableSnapToGround(0.35)
    this.kcc.setApplyImpulsesToDynamicBodies(true)
    this.kcc.setCharacterMass(80)
    this.kcc.setSlideEnabled(true)
  }

  /** place the feet at `feet` */
  teleport(world: WorldId, feet: Vector3, yaw: number, pitch = 0) {
    this.world = world
    this.position.set(feet.x, feet.y + CENTER_H, feet.z)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw
    this.pitch = pitch
    this.syncBody()
    this.safe.copy(this.position)
    this.safeWorld = world
    this.safeYaw = yaw
  }

  get eye() {
    return _eye.set(this.position.x, this.position.y + EYE_OFF, this.position.z)
  }

  feet(out: Vector3) {
    return out.set(this.position.x, this.position.y - CENTER_H, this.position.z)
  }

  setPhysical(on: boolean) {
    this.collider.setEnabled(on)
  }

  private syncBody() {
    this.body.setTranslation({ x: this.position.x, y: this.position.y, z: this.position.z }, true)
    this.phys.world.propagateModifiedBodyPositionsToColliders()
  }

  look(input: Input) {
    const [dx, dy] = input.consumeLook()
    this.yaw -= dx * this.sensitivity
    this.pitch -= dy * this.sensitivity * (this.invertY ? -1 : 1)
    this.pitch = MathUtils.clamp(this.pitch, -1.5, 1.5)
  }

  /**
   * Move for one rendered frame and resolve portal crossings.
   * Returns the crossing that happened (if any) so audio / UI can react.
   */
  update(dt: number, input: Input, portals: Portal[], excludeCollider?: RAPIER.Collider | null): Crossing | null {
    if (!this.enabled) return null
    // ── intent ────────────────────────────────────────────────────────────
    let fx = 0, fz = 0
    if (input.down('KeyW') || input.down('ArrowUp')) fz -= 1
    if (input.down('KeyS') || input.down('ArrowDown')) fz += 1
    if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1
    if (input.down('KeyD') || input.down('ArrowRight')) fx += 1
    fx += input.stick.x
    fz += input.stick.y
    const len = Math.hypot(fx, fz)
    if (len > 1) { fx /= len; fz /= len }
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight') || input.touchSprint
    const speed = sprint ? SPRINT : WALK
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    const wantX = (fx * cy + fz * sy) * speed
    const wantZ = (-fx * sy + fz * cy) * speed
    const accel = this.grounded ? 14 : 2.2
    const k = 1 - Math.exp(-accel * dt)
    this.velocity.x += (wantX - this.velocity.x) * k
    this.velocity.z += (wantZ - this.velocity.z) * k
    this.velocity.y -= PLAYER_G * dt
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1.5

    // ── collide-and-slide ─────────────────────────────────────────────────
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt }
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined,
      excludeCollider ? (c) => c.handle !== excludeCollider.handle : undefined)
    const m = this.kcc.computedMovement()
    const wasGrounded = this.grounded
    this.grounded = this.kcc.computedGrounded()
    if (!wasGrounded && this.grounded && this.velocity.y < -6) this.landKick = Math.min(0.12, -this.velocity.y * 0.008)
    // hitting a ceiling kills upward speed
    if (this.velocity.y > 0 && m.y < desired.y * 0.5) this.velocity.y = 0

    const prevEye = _prev.set(this.position.x, this.position.y + EYE_OFF, this.position.z)
    this.position.x += m.x
    this.position.y += m.y
    this.position.z += m.z
    // velocity follows what actually happened horizontally (sliding along walls)
    if (dt > 0) {
      this.velocity.x = MathUtils.lerp(this.velocity.x, m.x / dt, 0.5)
      this.velocity.z = MathUtils.lerp(this.velocity.z, m.z / dt, 0.5)
    }

    // ── portal crossing (eye-based: the camera is what must never clip) ──
    let crossed: Crossing | null = null
    const newEye = _next.set(this.position.x, this.position.y + EYE_OFF, this.position.z)
    for (const P of portals) {
      if (P.world !== this.world || P.open < 0.98) continue
      if (!segmentCrossing(P, prevEye, newEye, 0.02)) continue
      this.position.applyMatrix4(P.link)
      mapVector(P.link, this.velocity)
      this.yaw += P.linkYaw
      this.world = P.partner.world
      crossed = { from: P, to: P.partner }
      break
    }
    this.syncBody()

    if (this.grounded && !crossed) {
      this.safe.copy(this.position)
      this.safeWorld = this.world
      this.safeYaw = this.yaw
    }

    // ── bob ───────────────────────────────────────────────────────────────
    const hs = Math.hypot(this.velocity.x, this.velocity.z)
    this.bobAmp = MathUtils.lerp(this.bobAmp, this.grounded ? Math.min(1, hs / SPRINT) : 0, 1 - Math.exp(-8 * dt))
    this.bobPhase += hs * dt * 1.55
    this.landKick *= Math.exp(-9 * dt)
    return crossed
  }

  jump() {
    if (!this.grounded || !this.enabled) return false
    this.velocity.y = JUMP
    this.grounded = false
    return true
  }

  /** fell into the void of the Other Side */
  needsRespawn(voidY: number) {
    return this.position.y < voidY
  }

  respawn() {
    this.position.copy(this.safe)
    this.position.y += 0.2
    this.world = this.safeWorld
    this.yaw = this.safeYaw
    this.velocity.set(0, 0, 0)
    this.syncBody()
  }

  applyToCamera(cam: PerspectiveCamera) {
    const bob = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmp
    cam.position.set(this.position.x, this.position.y + EYE_OFF + bob - this.landKick, this.position.z)
    _e.set(this.pitch + Math.sin(this.bobPhase * 2 + 0.6) * 0.004 * this.bobAmp - this.landKick * 0.6, this.yaw, Math.sin(this.bobPhase) * 0.006 * this.bobAmp, 'YXZ')
    cam.quaternion.setFromEuler(_e)
  }

  forward(out: Vector3) {
    _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'))
    return out.set(0, 0, -1).applyQuaternion(_q)
  }
}

const _eye = new Vector3()
const _prev = new Vector3()
const _next = new Vector3()
const _e = new Euler()
const _q = new Quaternion()
