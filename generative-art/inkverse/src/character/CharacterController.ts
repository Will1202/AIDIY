import { Vector3 } from 'three'
import { HALF } from '../core/constants'
import { clamp, damp, dampAngle } from '../util/math'
import type { GroundHit, World } from '../world/World'
import { Character, type Pose } from './Character'

export interface MoveInput {
  forward: number
  right: number
  run: boolean
  jump: boolean
}

/**
 * Kinematic character controller. Ground = highest walkable surface under the feet
 * (terrain heightfield or a finished bridge deck, see World.groundAt). Handles slopes
 * (cliffs block, gentle slopes snap), deep water (blocks), tree trunks (push out),
 * bridge railings (clamp sideways), gravity, jumping and the paper's edge.
 */
export class CharacterController {
  readonly body = new Character()
  readonly pos = new Vector3()
  readonly vel = new Vector3()
  yaw = 0
  onGround = true
  pose: Pose = 'walk'
  /** scripted walking (cinematic): waypoints to follow */
  path: Vector3[] | null = null
  pathRun = false
  private pathI = 0
  onPathDone: (() => void) | null = null
  private g: GroundHit = { y: 0, bridge: null, t: 0, lat: 0 }
  private jumpHeld = false
  /** world units travelled on bridge decks (tests / stats) */
  bridgeDistance = 0
  idle = 0
  readonly head = new Vector3()
  speed = 0

  constructor(private world: World) {}

  spawn(x: number, z: number, yaw = 0) {
    // search outward for dry land
    let best = { x, z }
    outer: for (let r = 0; r < 40; r += 1.5) {
      for (let a = 0; a < 12; a++) {
        const px = x + Math.cos((a / 12) * Math.PI * 2) * r
        const pz = z + Math.sin((a / 12) * Math.PI * 2) * r
        if (Math.abs(px) > HALF - 4 || Math.abs(pz) > HALF - 4) continue
        if (this.world.waterDepth(px, pz) < 0.05 && this.slopeAt(px, pz) < 0.9) {
          best = { x: px, z: pz }
          break outer
        }
      }
    }
    this.world.groundAt(best.x, best.z, 1e4, 0, this.g)
    this.pos.set(best.x, this.g.y, best.z)
    this.vel.set(0, 0, 0)
    this.yaw = yaw
    this.onGround = true
    this.pose = 'walk'
    this.body.root.position.copy(this.pos)
  }

  private slopeAt(x: number, z: number) {
    const e = 0.6
    const dx = (this.world.heightAt(x + e, z) - this.world.heightAt(x - e, z)) / (2 * e)
    const dz = (this.world.heightAt(x, z + e) - this.world.heightAt(x, z - e)) / (2 * e)
    return Math.hypot(dx, dz)
  }

  /** can the feet move from the current spot to (x,z)? */
  private probe: GroundHit = { y: 0, bridge: null, t: 0, lat: 0 }
  private passable(x: number, z: number, curGround: number) {
    if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5) return false
    const d = Math.hypot(x - this.pos.x, z - this.pos.z)
    if (d < 1e-5) return true
    // look a little ahead so slopes are judged over a stride, not a frame
    const ax = this.pos.x + ((x - this.pos.x) / d) * 0.6
    const az = this.pos.z + ((z - this.pos.z) / d) * 0.6
    const g = this.world.groundAt(ax, az, this.pos.y, 0.8, this.probe)
    if (!g.bridge && this.world.waterDepth(ax, az) > 0.7) return false
    const rise = g.y - curGround
    // cliffs: more than ~51° up is a wall
    if (!g.bridge && this.onGround && rise / 0.6 > 1.25) return false
    if (!this.onGround && rise > 0.9 && this.pos.y < g.y - 0.3) return false
    return true
  }

  update(dt: number, input: MoveInput, camYaw: number) {
    const w = this.world
    // scripted path → synthetic input
    if (this.path) {
      const target = this.path[this.pathI]
      const dx = target.x - this.pos.x
      const dz = target.z - this.pos.z
      const dist = Math.hypot(dx, dz)
      if (dist < 1.1) {
        this.pathI++
        if (this.pathI >= this.path.length) {
          this.path = null
          const cb = this.onPathDone
          this.onPathDone = null
          cb?.()
        }
      }
      if (this.path) {
        const want = Math.atan2(dx, dz)
        input = { forward: 1, right: 0, run: this.pathRun, jump: false }
        camYaw = want + Math.PI
      }
    }

    const moving = Math.abs(input.forward) > 0.01 || Math.abs(input.right) > 0.01
    if (moving && this.pose !== 'walk') this.pose = 'walk'
    // camera-relative direction (camera sits at +offset(yaw), looks the other way)
    const fx = -Math.sin(camYaw)
    const fz = -Math.cos(camYaw)
    const rx = -fz
    const rz = fx
    let mx = fx * input.forward + rx * input.right
    let mz = fz * input.forward + rz * input.right
    const ml = Math.hypot(mx, mz)
    if (ml > 1) {
      mx /= ml
      mz /= ml
    }
    w.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.8, this.g)
    // wading only when the feet are actually in the river (not on a bridge above it)
    const wade = !this.g.bridge && w.waterDepth(this.pos.x, this.pos.z) > 0.12 && this.pos.y < 0.6
    const maxSpeed = (input.run ? 9.2 : 4.1) * (wade ? 0.55 : 1)
    const accel = this.onGround ? 16 : 4
    this.vel.x = damp(this.vel.x, mx * maxSpeed, accel * 0.5, dt)
    this.vel.z = damp(this.vel.z, mz * maxSpeed, accel * 0.5, dt)
    if (!moving && this.onGround) {
      // stop crisply where the player lets go
      this.vel.x = damp(this.vel.x, 0, 14, dt)
      this.vel.z = damp(this.vel.z, 0, 14, dt)
    }
    if (ml > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 10, dt)

    // horizontal move with sliding against blockers
    w.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.8, this.g)
    const cur = this.g.y
    const nx = this.pos.x + this.vel.x * dt
    const nz = this.pos.z + this.vel.z * dt
    if (this.passable(nx, nz, cur)) {
      this.pos.x = nx
      this.pos.z = nz
    } else if (this.passable(nx, this.pos.z, cur)) {
      this.pos.x = nx
      this.vel.z *= 0.5
    } else if (this.passable(this.pos.x, nz, cur)) {
      this.pos.z = nz
      this.vel.x *= 0.5
    } else {
      this.vel.x *= 0.2
      this.vel.z *= 0.2
    }

    // tree trunks
    for (const t of w.trees) {
      const dx = this.pos.x - t.x
      const dz = this.pos.z - t.z
      const r = t.trunkRadius * t.group.scale.x + 0.35
      const d = Math.hypot(dx, dz)
      if (d < r && d > 1e-4 && this.pos.y < t.group.position.y + t.height * t.group.scale.x) {
        this.pos.x = t.x + (dx / d) * r
        this.pos.z = t.z + (dz / d) * r
      }
    }

    // bridge railings: stay on the deck between the ends
    w.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.8, this.g)
    if (this.g.bridge && Math.abs(this.pos.y - this.g.y) < 0.6) {
      const s = this.g.bridge.spec
      if (this.g.t > 0.03 && this.g.t < 0.97) {
        const lim = s.halfW - 0.32
        if (Math.abs(this.g.lat) > lim) {
          const lat = clamp(this.g.lat, -lim, lim)
          const t = this.g.t * s.span
          this.pos.x = s.ax + s.dx * t - s.dz * lat
          this.pos.z = s.az + s.dz * t + s.dx * lat
        }
      }
      this.bridgeDistance += Math.hypot(this.vel.x, this.vel.z) * dt
    }

    // vertical
    const jump = input.jump && !this.jumpHeld
    this.jumpHeld = input.jump
    if (jump && this.onGround) {
      this.vel.y = 8.2
      this.onGround = false
      this.pose = 'walk'
    }
    this.vel.y -= 24 * dt
    this.pos.y += this.vel.y * dt
    w.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.8, this.g)
    const ground = this.g.y
    if (this.pos.y <= ground) {
      this.pos.y = ground
      this.vel.y = 0
      this.onGround = true
    } else if (this.onGround && this.vel.y <= 0 && this.pos.y - ground < 0.7) {
      // stick to downhill slopes and steps
      this.pos.y = ground
      this.vel.y = 0
    } else this.onGround = false

    this.speed = Math.hypot(this.vel.x, this.vel.z)
    this.idle = this.speed < 0.2 && this.onGround ? this.idle + dt : 0

    const b = this.body
    b.root.position.copy(this.pos)
    b.root.rotation.y = this.yaw
    b.animate(dt, this.speed, !this.onGround, this.vel.y, this.pose, ground)
    this.head.set(this.pos.x, this.pos.y + 1.55, this.pos.z)
  }

  setPose(p: Pose) {
    if (!this.onGround) return
    this.pose = this.pose === p ? 'walk' : p
    this.vel.x = this.vel.z = 0
  }

  followPath(points: Vector3[], run: boolean, onDone?: () => void) {
    this.path = points
    this.pathI = 0
    this.pathRun = run
    this.onPathDone = onDone ?? null
  }

  dispose() {
    this.body.dispose()
  }
}
