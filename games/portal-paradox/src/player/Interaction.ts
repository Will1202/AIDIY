import {
  BoxGeometry, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry,
  Quaternion, Vector3, type Scene,
} from 'three'
import { RAPIER, G, GROUPS, groups, type PhysicsWorld } from '../physics/PhysicsWorld'
import type { Prop, PropSystem } from '../physics/Props'
import { mapVector, rayOpening, segmentCrossing } from '../portal/PortalMath'
import { GATE_DEPTH, GATE_OUTER_H, GATE_OUTER_W, OPENING_H, type Portal, type WorldId } from '../portal/Portal'
import type { PlayerController } from './PlayerController'

export interface PortalRayHit {
  collider: RAPIER.Collider
  point: Vector3
  normal: Vector3
  /** direction of the ray where it hit (after any portal mapping) */
  dir: Vector3
  distance: number
  world: WorldId
  /** number of portals the ray went through */
  hops: number
}

const QUERY = groups(0xffff, G.STATIC | G.PROP)

/**
 * Ray cast that follows portals: if the opening of an open portal is nearer
 * than the physics hit, the ray continues from the mapped point in the
 * mapped direction (used for grabbing, the kinetic pulse and portal placement
 * — you can place a portal through another portal).
 */
export function castThroughPortals(phys: PhysicsWorld, portals: Portal[], origin: Vector3, dir: Vector3, maxDist: number, world: WorldId, exclude?: RAPIER.Collider | null): PortalRayHit | null {
  const o = _o.copy(origin)
  const d = _d.copy(dir).normalize()
  let remain = maxDist
  let w = world
  let travelled = 0
  for (let hop = 0; hop < 3; hop++) {
    let best = -1
    let via: Portal | null = null
    for (const P of portals) {
      if (P.world !== w || P.open < 0.98) continue
      const t = rayOpening(P, o, d, remain)
      if (t > 0 && (best < 0 || t < best)) { best = t; via = P }
    }
    const ray = new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z })
    const hit = phys.world.castRayAndGetNormal(ray, best > 0 ? best : remain, true, undefined, QUERY, exclude ?? undefined)
    if (hit && (best < 0 || hit.timeOfImpact < best)) {
      return {
        collider: hit.collider,
        point: new Vector3(o.x + d.x * hit.timeOfImpact, o.y + d.y * hit.timeOfImpact, o.z + d.z * hit.timeOfImpact),
        normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        dir: d.clone(),
        distance: travelled + hit.timeOfImpact,
        world: w,
        hops: hop,
      }
    }
    if (!via) return null
    o.addScaledVector(d, best).applyMatrix4(via.link)
    mapVector(via.link, d)
    o.addScaledVector(d, 0.002)
    remain -= best
    travelled += best
    w = via.partner.world
  }
  return null
}

export type Tool = 'hand' | 'portalA' | 'portalB'

/** grab / carry / throw / kinetic pulse, and the portal placement tool */
export class Interaction {
  held: Prop | null = null
  tool: Tool = 'hand'
  holdDist = 2.1
  /** extra yaw for portal placement, radians */
  placeYaw = 0
  readonly ghost = new Group()
  private readonly ghostMat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: true })
  private readonly ghostFill = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false })
  ghostValid = false
  private readonly ghostPose = { world: 0 as WorldId, pos: new Vector3(), yaw: 0 }
  /** what the crosshair points at (for UI) */
  aim: 'none' | 'grab' | 'pulse' = 'none'

  constructor(private readonly phys: PhysicsWorld, private readonly props: PropSystem, private readonly portals: Portal[], private readonly scenes: Scene[]) {
    const frame = new LineSegments(new EdgesGeometry(new BoxGeometry(GATE_OUTER_W, GATE_OUTER_H, GATE_DEPTH).translate(0, GATE_OUTER_H / 2, 0)), this.ghostMat)
    const opening = new LineSegments(new EdgesGeometry(new PlaneGeometry(2.6, OPENING_H).translate(0, OPENING_H / 2, 0)), this.ghostMat)
    const foot = new Mesh(new PlaneGeometry(GATE_OUTER_W + 1.2, 3.4).rotateX(-Math.PI / 2).translate(0, 0.03, 0), this.ghostFill)
    this.ghost.add(frame, opening, foot)
    this.ghost.visible = false
    this.ghost.matrixAutoUpdate = false
  }

  setTool(t: Tool) {
    this.tool = this.tool === t ? 'hand' : t
    if (this.tool !== 'hand') this.drop()
    this.ghost.visible = false
  }

  grab(player: PlayerController, eye: Vector3, fwd: Vector3) {
    if (this.held) return this.drop()
    const hit = castThroughPortals(this.phys, this.portals, eye, fwd, 3.6, player.world, player.collider)
    if (!hit) return null
    const p = this.props.byHandle(hit.collider.handle)
    if (!p) return null
    this.held = p
    p.held = true
    p.collider.setCollisionGroups(GROUPS.held)
    p.body.setGravityScale(0, true)
    p.body.wakeUp()
    return p
  }

  drop() {
    const p = this.held
    if (!p) return null
    p.held = false
    p.collider.setCollisionGroups(GROUPS.prop)
    p.body.setGravityScale(this.props.scaleFor(p), true)
    this.held = null
    return p
  }

  throw(player: PlayerController, fwd: Vector3, speed = 17) {
    const p = this.drop()
    if (!p) return null
    const dir = this.dirInFrameOf(p, player, fwd)
    p.body.setLinvel({ x: dir.x * speed + player.velocity.x * 0.5, y: dir.y * speed + 1.2, z: dir.z * speed + player.velocity.z * 0.5 }, true)
    p.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true)
    return p
  }

  /** shove whatever is under the crosshair */
  pulse(player: PlayerController, eye: Vector3, fwd: Vector3) {
    const hit = castThroughPortals(this.phys, this.portals, eye, fwd, 22, player.world, player.collider)
    if (!hit) return null
    const p = this.props.byHandle(hit.collider.handle)
    if (!p) return { hit, prop: null }
    const m = p.body.mass()
    const k = m * (11 - hit.distance * 0.25)
    p.body.applyImpulseAtPoint({ x: hit.dir.x * k, y: hit.dir.y * k + m * 2.2, z: hit.dir.z * k }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true)
    return { hit, prop: p }
  }

  /** player's look direction expressed in the frame the prop currently lives in */
  private dirInFrameOf(p: Prop, player: PlayerController, fwd: Vector3) {
    const d = _dir.copy(fwd)
    if (p.world === player.world && p.currP.distanceTo(player.position) < 6) return d
    for (const P of this.portals) {
      if (P.world === player.world && P.partner.world === p.world) return mapVector(P.link, d)
    }
    return d
  }

  /** fixed-step: spring the carried object towards the hold point (following through portals) */
  stepHeld(player: PlayerController, eye: Vector3, fwd: Vector3, dt: number) {
    const p = this.held
    if (!p) return
    const H = _h.copy(eye).addScaledVector(fwd, this.holdDist)
    // candidate hold points: the plain one, or mapped through any portal the eye→hold segment passes
    let target = H
    let best = p.world === player.world ? p.currP.distanceTo(H) : Infinity
    for (const P of this.portals) {
      if (P.world !== player.world || P.open < 0.98) continue
      if (!segmentCrossing(P, eye, H, 0)) continue
      const mapped = _hm.copy(H).applyMatrix4(P.link)
      const dist = P.partner.world === p.world ? p.currP.distanceTo(mapped) : Infinity
      if (dist < best) { best = dist; target = _ht.copy(mapped) }
    }
    if (best > 4.5) {
      this.drop()
      return
    }
    const k = 14
    const v = _v.copy(target).sub(p.currP).multiplyScalar(k)
    const max = 22
    if (v.length() > max) v.setLength(max)
    p.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
    const av = p.body.angvel()
    const damp = Math.exp(-10 * dt)
    p.body.setAngvel({ x: av.x * damp, y: av.y * damp, z: av.z * damp }, true)
  }

  /** portal tool preview: where would the gate stand? */
  updateGhost(player: PlayerController, eye: Vector3, fwd: Vector3, moving: Portal | null) {
    if (this.tool === 'hand' || !moving) {
      this.ghost.visible = false
      return
    }
    const hit = castThroughPortals(this.phys, this.portals, eye, fwd, 70, player.world, player.collider)
    if (!hit || hit.normal.y < 0.8) {
      this.ghost.visible = false
      this.ghostValid = false
      return
    }
    const yaw = Math.atan2(-hit.dir.x, -hit.dir.z) + this.placeYaw
    const pos = _gp.set(hit.point.x, hit.point.y + 0.002, hit.point.z)
    this.ghostPose.world = hit.world
    this.ghostPose.pos.copy(pos)
    this.ghostPose.yaw = yaw
    this.ghostValid = this.canPlace(moving, hit.world, pos, yaw, player)
    const col = this.ghostValid ? moving.color : _bad
    this.ghostMat.color.copy(col)
    this.ghostFill.color.copy(col)
    if (this.ghost.parent !== this.scenes[hit.world]) this.scenes[hit.world].add(this.ghost)
    this.ghost.matrix.compose(pos, _q.setFromAxisAngle(_up, yaw), _one)
    this.ghost.matrixWorldNeedsUpdate = true
    this.ghost.visible = true
  }

  canPlace(moving: Portal, world: WorldId, pos: Vector3, yaw: number, player: PlayerController) {
    const other = moving.partner
    if (other.world === world && other.position.distanceTo(pos) < GATE_OUTER_W + 1.2) return false
    // never carry the last gate out of the world you are standing in: there would be no way back
    if (moving.world === player.world && other.world !== player.world && world !== player.world) return false
    if (player.world === world && Math.hypot(player.position.x - pos.x, player.position.z - pos.z) < 1.4) return false
    const shape = new RAPIER.Cuboid(GATE_OUTER_W / 2 + 0.05, GATE_OUTER_H / 2 - 0.12, GATE_DEPTH / 2 + 0.25)
    const q = _q.setFromAxisAngle(_up, yaw)
    let blocked = false
    this.phys.world.intersectionsWithShape(
      { x: pos.x, y: pos.y + GATE_OUTER_H / 2 + 0.1, z: pos.z }, { x: q.x, y: q.y, z: q.z, w: q.w }, shape,
      (c) => {
        const body = c.parent()
        if (body && body.handle === moving.bodyHandle) return true
        blocked = true
        return false
      },
      undefined, groups(0xffff, G.STATIC),
    )
    return !blocked
  }

  /** returns the chosen pose if the placement was valid */
  takePlacement() {
    if (!this.ghost.visible || !this.ghostValid) return null
    return { world: this.ghostPose.world, pos: this.ghostPose.pos.clone(), yaw: this.ghostPose.yaw }
  }

  /** what is under the crosshair, for the HUD */
  updateAim(player: PlayerController, eye: Vector3, fwd: Vector3) {
    if (this.held || this.tool !== 'hand') { this.aim = 'none'; return }
    const hit = castThroughPortals(this.phys, this.portals, eye, fwd, 22, player.world, player.collider)
    const p = hit ? this.props.byHandle(hit.collider.handle) : undefined
    this.aim = p ? (hit!.distance < 3.6 ? 'grab' : 'pulse') : 'none'
  }
}

const _o = new Vector3()
const _d = new Vector3()
const _h = new Vector3()
const _hm = new Vector3()
const _ht = new Vector3()
const _v = new Vector3()
const _dir = new Vector3()
const _gp = new Vector3()
const _q = new Quaternion()
const _up = new Vector3(0, 1, 0)
const _one = new Vector3(1, 1, 1)
const _bad = new Color(1, 0.25, 0.2)
