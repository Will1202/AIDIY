import { Vector3 } from 'three'
import type { Simulation, SimEvent } from '../sim/simulation'
import type { Component } from '../sim/component'
import type { RigidBody } from '../sim/physics'
import type { Interp } from '../render/interp'
import type { Dominoes } from '../sim/components/dominoes'
import type { Lift } from '../sim/components/transport'
import type { CameraMode, Shot } from './rig'

type Focus =
  | { kind: 'overview' }
  | { kind: 'marble'; body: RigidBody | null }
  | { kind: 'group'; bodies: RigidBody[] }
  | { kind: 'comp'; comp: Component; style: string }

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z)

/**
 * AUTO DIRECTOR — cuts are triggered only by real simulation events (a component changing state),
 * never by a timeline. Each event proposes a shot; a minimum hold keeps cuts readable, and when an
 * event's action is over the camera falls back to chasing the fastest marble.
 */
export class Director {
  focus: Focus = { kind: 'overview' }
  shotName = 'OVERVIEW'
  private since = 0
  private hold = 0
  private pending: { focus: Focus; name: string; hold: number } | null = null
  private t = 0
  private chase = V()
  private chaseVel = V()
  private lastMarble: RigidBody | null = null
  aspect = 16 / 9

  constructor(private sim: Simulation) {}

  reset() {
    this.focus = { kind: 'overview' }
    this.shotName = 'OVERVIEW'
    this.pending = null
    this.since = 0
    this.hold = 0
    this.lastMarble = null
  }

  /** feed every simulation event */
  onEvent(e: SimEvent) {
    if (e.type === 'complete' && e.id) {
      const c = this.sim.byId.get(e.id)
      if (c) this.propose({ kind: 'comp', comp: c, style: 'finale' }, 'THE FINAL MACHINE', 999)
      return
    }
    if (e.type !== 'status' || !e.id) return
    const c = this.sim.byId.get(e.id)
    if (!c) return
    const s = e.status
    switch (c.type) {
      case 'hopper':
        if (s === 'ACTIVATED') {
          const hb = (c as unknown as { marbleBodies: RigidBody[] }).marbleBodies
          if (hb.length > 1) this.propose({ kind: 'group', bodies: hb }, 'GRAVITY DROP', 2.2)
          else this.propose({ kind: 'marble', body: hb[0] }, 'THE FIRST MARBLE', 2)
        }
        break
      case 'dominoes':
        if (s === 'ACTIVATED') this.propose({ kind: 'comp', comp: c, style: 'dominoes' }, 'DOMINO CASCADE', 3)
        break
      case 'lever':
        if (s === 'ACTIVATED') this.propose({ kind: 'comp', comp: c, style: 'lever' }, 'THE LEVER', 0.8)
        break
      case 'motor':
        if (s === 'ACTIVATED') this.propose({ kind: 'comp', comp: c, style: 'clockwork' }, 'THE CLOCKWORK', 1.8)
        break
      case 'pulley':
        if (s === 'ACTIVATED') this.propose({ kind: 'comp', comp: c, style: 'pulley' }, 'GRAVITY ENGINE', 1.4)
        break
      case 'pendulum':
        if (s === 'ACTIVATED') this.propose({ kind: 'comp', comp: c, style: 'pendulum' }, 'THE PENDULUM HALL', 1.2)
        break
      case 'launcher':
        if (s === 'ACTIVATED') {
          const mb = (c as unknown as { marbleBodies: RigidBody[] }).marbleBodies
          this.propose(mb.length ? { kind: 'marble', body: mb[0] } : { kind: 'comp', comp: c, style: 'macro' }, 'SPRING CHAMBER', 1.6)
        }
        break
      case 'lift':
        if (s === 'ACTIVATED' || s === 'RUNNING') this.propose({ kind: 'comp', comp: c, style: 'lift' }, 'THE ASCENSION', 3)
        if (s === 'COMPLETED') this.propose({ kind: 'marble', body: null }, 'THE CROWN', 1.5)
        break
      case 'final':
        if (s === 'ACTIVATED') this.propose({ kind: 'comp', comp: c, style: 'finale' }, 'THE FINAL MACHINE', 999)
        break
    }
  }

  private propose(focus: Focus, name: string, hold: number) {
    if (this.focus.kind === 'comp' && this.focus.style === 'finale') return
    if (this.t - this.since < this.hold && !(focus.kind === 'comp' && focus.style === 'finale')) {
      this.pending = { focus, name, hold }
      return
    }
    this.cut(focus, name, hold)
  }

  /** set when the director changed subject this frame (the rig hard-cuts instead of gliding) */
  justCut = false

  private cut(focus: Focus, name: string, hold: number) {
    this.justCut = true
    this.focus = focus
    this.shotName = name
    this.since = this.t
    this.hold = hold
    this.pending = null
  }

  /** fastest marble moving right now (the natural hero) */
  heroMarble(): RigidBody | null {
    let best: RigidBody | null = null
    let bestV = 0.25
    for (const m of this.sim.marbles()) {
      const v = m.body.linvel()
      const s = Math.hypot(v.x, v.y, v.z)
      if (s > bestV) { bestV = s; best = m.body }
    }
    if (best) this.lastMarble = best
    return best ?? this.lastMarble ?? this.sim.marbles()[0]?.body ?? null
  }

  overview(): Shot {
    const b = this.sim.bounds()
    const isDemo = this.sim.scene.name === 'The Grand Contraption'
    const min = V(b.min.x, Math.max(0, b.min.y), b.min.z)
    const max = V(b.max.x, b.max.y, b.max.z)
    if (isDemo) { min.set(-8.6, 0, -2.5); max.set(7.6, 29.5, 3.8) }
    const c = min.clone().add(max).multiplyScalar(0.5)
    const size = max.clone().sub(min)
    const fov = 36
    const t = Math.tan((fov * Math.PI) / 360)
    const dist = Math.max(size.y / 2 / t, size.x / 2 / (t * this.aspect)) * 1.12 + size.z / 2
    const dir = V(0.34, 0.12, 1).normalize()
    return { pos: c.clone().addScaledVector(dir, dist), target: c, fov, rate: 1.4 }
  }

  private wide(k: number) {
    // portrait frames are narrow: pull back for horizontal subjects
    return this.aspect < 1 ? k * (0.7 + 0.55 / this.aspect) : k
  }

  shot(mode: CameraMode, dt: number, interp: Interp, macroId?: string): Shot {
    this.t += dt
    if (this.pending && this.t - this.since >= this.hold) this.cut(this.pending.focus, this.pending.name, this.pending.hold)
    if (mode === 'overview') return this.overview()
    if (mode === 'follow') return this.follow(this.heroMarble(), interp, dt)
    if (mode === 'macro') {
      const c = (macroId && this.sim.byId.get(macroId)) || this.latestActive()
      return c ? this.compShot(c, 'macro', interp, dt) : this.overview()
    }
    // director
    const f = this.focus
    if (f.kind === 'overview') return this.establishing()
    if (f.kind === 'marble') return this.follow(f.body ?? this.heroMarble(), interp, dt)
    if (f.kind === 'group') return this.group(f.bodies, interp, dt)
    // when a component's moment is over, chase the fastest marble instead of staring at a still part
    if (f.style !== 'finale' && this.t - this.since > this.hold + 2.5) {
      const h = this.heroMarble()
      if (h) {
        const v = h.linvel()
        if (Math.hypot(v.x, v.y, v.z) > 0.6) return this.follow(h, interp, dt)
      }
    }
    return this.compShot(f.comp, f.style, interp, dt)
  }

  private latestActive(): Component | undefined {
    for (let i = this.sim.log.length - 1; i >= 0; i--) {
      const e = this.sim.log[i]
      if (e.type === 'status' && e.id && (e.status === 'ACTIVATED' || e.status === 'RUNNING')) {
        const c = this.sim.byId.get(e.id)
        if (c && c.type !== 'marble' && c.type !== 'gear') return c
      }
    }
    return this.sim.components.find((c) => c.drive !== 'passive')
  }

  /** landing page: the whole tower, pushed to the right third so the title has room */
  hero(): Shot {
    const o = this.overview()
    if (this.aspect < 1) return o
    const right = V(1, 0, 0).applyAxisAngle(V(0, 1, 0), Math.atan2(o.pos.x - o.target.x, o.pos.z - o.target.z))
    const drift = Math.sin(this.t * 0.07) * 0.6
    const shift = o.pos.distanceTo(o.target) * 0.3
    return { pos: o.pos.clone().addScaledVector(right, -shift + drift), target: o.target.clone().addScaledVector(right, -shift), fov: o.fov, rate: 1 }
  }

  /** before START: slow drift on the tower crown and the first marble */
  private establishing(): Shot {
    const o = this.overview()
    const gate = this.sim.components.find((c) => c.type === 'hopper')
    if (!gate) return o
    const drift = Math.sin(this.t * 0.12) * 0.15
    const target = V(gate.origin.x + 2.2, gate.origin.y - 1.4, gate.origin.z)
    const pos = target.clone().add(V(4 + drift * 10, 2.2, this.wide(9.5)))
    return { pos, target, fov: 38, rate: 0.9 }
  }

  private follow(body: RigidBody | null, interp: Interp, dt: number): Shot {
    if (!body) return this.overview()
    const p = interp.position(body, V())
    const v = body.linvel()
    const vel = V(v.x, v.y * 0.3, v.z)
    this.chaseVel.lerp(vel, 1 - Math.exp(-dt * 2))
    if (this.chase.distanceTo(p) > 6) this.chase.copy(p)
    this.chase.lerp(p, 1 - Math.exp(-dt * 6))
    const speed = this.chaseVel.length()
    const dir = speed > 0.2 ? this.chaseVel.clone().normalize() : V(1, 0, 0)
    // three-quarter chase from the camera side of the tower
    const side = V(0, 0, 1)
    const dist = this.wide(2.6 + Math.min(2.6, speed * 0.6))
    // a marble on a back run (z < 0.4) hides behind the front tracks: climb and look down over them
    const back = Math.max(0, 0.4 - this.chase.z)
    const pos = this.chase.clone().addScaledVector(dir, -dist * 0.75).addScaledVector(side, dist * 0.95 + back * 0.6).add(V(0, 1.0 + speed * 0.12 + back * 1.5, 0))
    const target = this.chase.clone().addScaledVector(dir, Math.min(1.4, speed * 0.3))
    return { pos, target, fov: 44, rate: 4.5 }
  }

  private group(bodies: RigidBody[], interp: Interp, dt: number): Shot {
    const c = V()
    let n = 0
    for (const b of bodies) {
      const p = interp.position(b, V())
      if (p.y < -2) continue
      c.add(p)
      n++
    }
    if (!n) return this.overview()
    c.multiplyScalar(1 / n)
    this.chase.lerp(c, 1 - Math.exp(-dt * 3))
    const pos = this.chase.clone().add(V(-1.2, 1.6, this.wide(5.4)))
    return { pos, target: this.chase.clone().add(V(0.8, -0.3, 0)), fov: 42, rate: 2.6 }
  }

  private compShot(c: Component, style: string, interp: Interp, dt: number): Shot {
    const b = c.bounds()
    const center = V((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
    const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 0.8)
    const age = this.t - this.since
    switch (style) {
      case 'dominoes': {
        const d = c as Dominoes
        const i = Math.max(0, Math.min(d.pieces.length - 1, d.front + 1))
        const p = interp.position(d.pieces[i].body, V())
        this.chase.lerp(p, 1 - Math.exp(-dt * 3.5))
        const pos = this.chase.clone().add(V(-1.4, 0.35, this.wide(2.6)))
        return { pos, target: this.chase.clone().add(V(1.1, 0.25, 0)), fov: 46, rate: 3.2 }
      }
      case 'lever':
        return { pos: center.clone().add(V(1.6, 0.6, this.wide(3.6))), target: center.clone().add(V(0.3, 0.3, 0)), fov: 40, rate: 3 }
      case 'clockwork': {
        // the gear wall, pushing in slowly
        const g = this.sim.components.filter((x) => x.type === 'gear' || x.type === 'motor')
        const m = V()
        for (const x of g) m.add(V(x.origin.x, x.origin.y, x.origin.z))
        m.multiplyScalar(1 / Math.max(1, g.length))
        const push = Math.min(1, age / 6)
        return { pos: m.clone().add(V(1.5 - push * 1.2, 0.4, this.wide(8.5 - push * 2.4))), target: m.clone().add(V(0.6, 0, 0)), fov: 40, rate: 1.6 }
      }
      case 'pulley':
        return { pos: center.clone().add(V(-1.6, 1.4, this.wide(4.6))), target: center.clone().add(V(0.2, -0.3, 0)), fov: 44, rate: 2.4 }
      case 'pendulum': {
        // side-on composition that holds the whole swing
        const piv = V(c.origin.x, c.origin.y, c.origin.z)
        const L = c.num('length')
        return { pos: piv.clone().add(V(0.4, -L * 0.6, this.wide(L * 2.1 + 1.6))), target: piv.clone().add(V(0.2, -L * 0.62, 0)), fov: 44, rate: 2.2 }
      }
      case 'lift': {
        const l = c as Lift
        const y = c.origin.y + l.y
        const tgt = V(c.origin.x + 0.8, y + 0.4, c.origin.z)
        // from inside the open front of the tower, looking across and up at the climbing car
        const lift = 1.2 + Math.min(1, l.v / 3) * 1.6
        return { pos: tgt.clone().add(V(2.6, -lift, this.wide(4.0))), target: tgt.clone().add(V(-0.2, 0.5, 0)), fov: 48, rate: 3.5 }
      }
      case 'finale': {
        // fast pull-back from the core to the whole tower lit up, then a slow orbit
        const o = this.overview()
        const core = V(c.origin.x, c.origin.y + 4.3, c.origin.z)
        const k = Math.min(1, Math.max(0, (age - 1.2) / 3.2))
        const e = k * k * (3 - 2 * k)
        const near = core.clone().add(V(2.5, -0.6, this.wide(7.5)))
        const ang = Math.max(0, age - 4.4) * 0.05
        const far = o.pos.clone().sub(o.target).applyAxisAngle(V(0, 1, 0), ang).add(o.target)
        const pos = near.lerp(far, e)
        const target = core.clone().lerp(o.target.clone().add(V(0, 2.5, 0)), e)
        return { pos, target, fov: 38 + e * 2, rate: age < 1.2 ? 2.5 : 3.2 }
      }
      default:
        return { pos: center.clone().add(V(size * 0.5, size * 0.35 + 0.4, this.wide(size * 1.4 + 2.4))), target: center, fov: 40, rate: 2.5 }
    }
  }
}
