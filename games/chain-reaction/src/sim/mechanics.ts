import type { Component } from './component'
import type { ConnectionSpec } from './schema'
import { cross, dot, len, norm, sub, type V3 } from './math'

/** One toothed ring on a rotor (gears can carry a coaxial pinion as a second layer). */
export interface GearLayer {
  /** offset of the layer plane along the rotor axis (m) */
  offset: number
  teeth: number
  /** pitch radius (m) */
  radius: number
}

/** Anything that turns on an axle: gears, motor pinions, conveyor drums, turntables, cams. */
export interface Rotor {
  key: string
  comp: Component
  center: V3
  axis: V3
  layers: GearLayer[]
  /** set only for motors: the driving angular velocity this step */
  drive?: () => number
  omega: number
  angle: number
  /** visual tooth phase so meshing gears interleave */
  phase: number
  /** true when the rotor was reached from a driver this step */
  powered: boolean
}

export interface Link {
  a: Rotor
  b: Rotor
  /** ω_b = ratio · ω_a */
  ratio: number
  kind: 'mesh' | 'chain'
  la: number
  lb: number
}

const MESH_TOL = 0.06

/**
 * Stable kinematic transmission: gear meshes are detected from geometry (parallel axes, same layer
 * plane, centre distance = sum of pitch radii) and propagate ω_b = −ω_a·N_a/N_b. Chains / shafts to
 * driven machines come from explicit mechanical connections. No tooth-on-tooth collision solving.
 */
export class MechanicalSystem {
  readonly rotors: Rotor[] = []
  readonly links: Link[] = []
  readonly conflicts: string[] = []

  build(rotors: Rotor[], connections: ConnectionSpec[], byComp: Map<string, Component>) {
    this.rotors.push(...rotors)
    // gear meshes
    for (let i = 0; i < rotors.length; i++) {
      for (let j = i + 1; j < rotors.length; j++) {
        const m = meshBetween(rotors[i], rotors[j])
        if (m) this.links.push(m)
      }
    }
    // explicit chains / shafts
    for (const c of connections) {
      if (c.kind !== 'mechanical') continue
      const from = byComp.get(c.from)?.rotors()[0]
      const to = byComp.get(c.to)?.rotors()[0]
      const ra = from && this.rotors.find((r) => r.key === from.key)
      const rb = to && this.rotors.find((r) => r.key === to.key)
      if (ra && rb) this.links.push({ a: ra, b: rb, ratio: c.ratio ?? 1, kind: 'chain', la: 0, lb: 0 })
    }
    this.computePhases()
  }

  /** propagate driver speeds through the transmission graph and integrate angles */
  update(dt: number) {
    for (const r of this.rotors) {
      r.powered = false
      r.omega = 0
    }
    const queue: Rotor[] = []
    for (const r of this.rotors) {
      if (r.drive) {
        r.omega = r.drive()
        r.powered = true
        queue.push(r)
      }
    }
    while (queue.length) {
      const r = queue.shift()!
      for (const l of this.links) {
        let other: Rotor | null = null
        let w = 0
        if (l.a === r) { other = l.b; w = r.omega * l.ratio }
        else if (l.b === r) { other = l.a; w = r.omega / l.ratio }
        if (!other) continue
        if (other.powered) continue
        other.omega = w
        other.powered = true
        queue.push(other)
      }
    }
    for (const r of this.rotors) r.angle += r.omega * dt
  }

  linksOf(r: Rotor) {
    return this.links.filter((l) => l.a === r || l.b === r)
  }

  private computePhases() {
    const seen = new Set<Rotor>()
    const order = [...this.rotors.filter((r) => r.drive), ...this.rotors]
    for (const root of order) {
      if (seen.has(root)) continue
      seen.add(root)
      const queue = [root]
      while (queue.length) {
        const a = queue.shift()!
        for (const l of this.linksOf(a)) {
          if (l.kind !== 'mesh') continue
          const b = l.a === a ? l.b : l.a
          if (seen.has(b)) continue
          const la = a.layers[l.a === a ? l.la : l.lb]
          const lb = b.layers[l.a === a ? l.lb : l.la]
          b.phase = meshPhase(a, la, b, lb)
          seen.add(b)
          queue.push(b)
        }
      }
    }
  }
}

/** in-plane basis for a rotor: u = local x of the component turned into the gear plane */
export function rotorBasis(r: Rotor): { u: V3; v: V3 } {
  const ref = Math.abs(r.axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  // v is "up" in the gear plane; u completes a right-handed (u, v, axis) frame
  const u = norm(cross(ref, r.axis))
  const v = cross(r.axis, u)
  return { u, v }
}

function angleIn(r: Rotor, p: V3) {
  const { u, v } = rotorBasis(r)
  const d = sub(p, r.center)
  return Math.atan2(dot(d, v), dot(d, u))
}

function meshBetween(a: Rotor, b: Rotor): Link | null {
  if (!a.layers.length || !b.layers.length) return null
  const s = dot(a.axis, b.axis)
  if (Math.abs(s) < 0.999) return null
  for (let i = 0; i < a.layers.length; i++) {
    for (let j = 0; j < b.layers.length; j++) {
      const la = a.layers[i]
      const lb = b.layers[j]
      const pa = { x: a.center.x + a.axis.x * la.offset, y: a.center.y + a.axis.y * la.offset, z: a.center.z + a.axis.z * la.offset }
      const pb = { x: b.center.x + b.axis.x * lb.offset, y: b.center.y + b.axis.y * lb.offset, z: b.center.z + b.axis.z * lb.offset }
      const d = sub(pb, pa)
      const along = dot(d, a.axis)
      if (Math.abs(along) > 0.08) continue
      const perp = len({ x: d.x - a.axis.x * along, y: d.y - a.axis.y * along, z: d.z - a.axis.z * along })
      if (Math.abs(perp - (la.radius + lb.radius)) > MESH_TOL) continue
      // external mesh reverses the sense; antiparallel axes flip it back
      return { a, b, ratio: -Math.sign(s) * (la.teeth / lb.teeth), kind: 'mesh', la: i, lb: j }
    }
  }
  return null
}

/** phase for b so that its tooth gaps line up with a's teeth on the line of centres */
function meshPhase(a: Rotor, la: GearLayer, b: Rotor, lb: GearLayer): number {
  const phiA = angleIn(a, b.center)
  const phiB = angleIn(b, a.center)
  const pitchA = (Math.PI * 2) / la.teeth
  let e = (phiA - (a.phase + a.angle)) % pitchA
  if (e < 0) e += pitchA
  const s = Math.sign(dot(a.axis, b.axis))
  return phiB + Math.PI / lb.teeth + s * e * (la.teeth / lb.teeth) - b.angle
}
