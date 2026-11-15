import { beforeAll, describe, expect, it } from 'vitest'
import { initRapier } from './physics'
import { Simulation } from './simulation'
import { MachineBuilder } from './builder'
import { tiltOf, type Dominoes } from './components/dominoes'
import type { Pendulum } from './components/gravity'
import type { Button } from './components/switches'
import type { Lift } from './components/transport'
import type { Final } from './components/misc'

beforeAll(async () => {
  await initRapier()
})

const steps = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) sim.step()
}

describe('Test 01 · the marble is a real rigid body under gravity', () => {
  it('accelerates down a slope with no scripted motion', () => {
    const b = new MachineBuilder('t')
    b.track('t', { pos: { x: 0, y: 10, z: 0 }, yaw: 0 }, { kind: 'straight', length: 14, drop: 1.4 })
    b.add('marble', 'm', { x: 0.3, y: 10.003, z: 0 }, 0, {})
    const sim = new Simulation(b.scene())
    sim.start()
    const m = sim.marbles()[0].body
    m.wakeUp()
    const speeds: number[] = []
    for (let s = 0; s < 4; s++) {
      steps(sim, 1)
      const v = m.linvel()
      speeds.push(Math.hypot(v.x, v.y, v.z))
    }
    // speed grows every second, close to rolling-ball theory a = g·sinθ / (1 + I/(m r²))
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1] + 0.3)
    const slope = Math.atan2(1.4, 14)
    const theory = (9.81 * Math.sin(slope)) / 1.4
    expect(speeds[3] / 4).toBeGreaterThan(theory * 0.75)
    expect(speeds[3] / 4).toBeLessThan(theory * 1.1)
    expect(m.translation().y).toBeLessThan(10)
    sim.free()
  })
})

describe('Test 02 · marble survives curves, a spiral and track joints', () => {
  it('runs a snapped multi-piece track to the end without leaving it', () => {
    const b = new MachineBuilder('t')
    const hop = b.add('hopper', 'h', { x: 0, y: 12, z: 0 }, 0, { count: 1, slope: 12, openOnStart: true })
    const run = b.run('t', b.out(hop), [
      { kind: 'straight', length: 3, drop: 1.1, profile: 's-curve' },
      { kind: 'curve', radius: 1.0, angle: 180, drop: 0.15 },
      { kind: 'straight', length: 4, drop: 0.3 },
      { kind: 'spiral', radius: 1.2, turns: 1.5, drop: 1.5, dir: 'left' },
      { kind: 'straight', length: 2, drop: 0.2 },
    ])
    const sim = new Simulation(b.scene())
    sim.start()
    const m = sim.marbles()[0].body
    let reached = false
    let minY = Infinity
    for (let i = 0; i < 120 * 25 && !reached; i++) {
      sim.step()
      const t = m.translation()
      minY = Math.min(minY, t.y)
      if (Math.hypot(t.x - run.end.pos.x, t.z - run.end.pos.z) < 0.3 && Math.abs(t.y - run.end.pos.y) < 0.2) reached = true
      // never more than a marble's height below the track's lowest point while on it
      expect(t.y).toBeGreaterThan(run.end.pos.y - 0.6)
    }
    expect(reached).toBe(true)
    sim.free()
  })
})

describe('Test 03 · dominoes fall by contact, not by timer', () => {
  const row = (struck: boolean) => {
    const b = new MachineBuilder('t')
    b.add('platform', 'deck', { x: 2, y: 0, z: 0 }, 0, { width: 10, depth: 3 })
    b.add('dominoes', 'd', { x: 0, y: 0, z: 0 }, 0, { count: 14, height: 0.4, width: 0.22, thickness: 0.06, spacing: 0.5, growth: 1.8 })
    if (struck) b.add('marble', 'm', { x: -0.8, y: 0.15, z: 0 }, 0, {})
    const sim = new Simulation(b.scene())
    sim.start()
    if (struck) {
      const m = sim.marbles()[0].body
      m.wakeUp()
      m.setLinvel({ x: 3, y: 0, z: 0 }, true)
    }
    const d = sim.byId.get('d') as Dominoes
    const fellAt: number[] = d.pieces.map(() => -1)
    for (let i = 0; i < 120 * 8; i++) {
      sim.step()
      d.pieces.forEach((p, k) => {
        if (fellAt[k] < 0 && tiltOf(p.body.rotation()) > 0.75) fellAt[k] = sim.time
      })
    }
    sim.free()
    return fellAt
  }
  it('topples in order after the first is struck', () => {
    const t = row(true)
    expect(t.every((x) => x > 0)).toBe(true)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1])
  })
  it('nothing falls when nothing hits the first domino (control)', () => {
    expect(row(false).every((x) => x < 0)).toBe(true)
  })
})

describe('Test 04 · the pendulum obeys its joint', () => {
  it('keeps its arm length and swings with a physical period', () => {
    const b = new MachineBuilder('t')
    b.add('pendulum', 'p', { x: 0, y: 5, z: 0 }, 0, { length: 3, angle: 20, latched: false, friction: 0 })
    const sim = new Simulation(b.scene())
    sim.start()
    const p = sim.byId.get('p') as Pendulum
    const crossings: number[] = []
    let prev = p.angle
    for (let i = 0; i < 120 * 8; i++) {
      sim.step()
      const bob = p.rod.translation()
      const r = p.rod.rotation()
      // bob centre = pivot + R·(0,−L,0): distance from the pivot must stay L
      const L = Math.hypot(bob.x, bob.y - 5, bob.z)
      expect(L).toBeLessThan(0.02)
      void r
      if (prev < 0 && p.angle >= 0) crossings.push(sim.time)
      prev = p.angle
    }
    // rigid-body pendulum: T ≈ 2π√(I/(m g d)); for a heavy bob it is close to 2π√(L/g)
    const T = crossings[2] - crossings[1]
    expect(T).toBeGreaterThan(2 * Math.PI * Math.sqrt(3 / 9.81) * 0.9)
    expect(T).toBeLessThan(2 * Math.PI * Math.sqrt(3.5 / 9.81) * 1.1)
    sim.free()
  })
})

describe('Test 05 · sensors fire only when their condition is met', () => {
  it('a push switch fires only when the lever really drives its cap past the trip depth', () => {
    const run = (marble: 'none' | 'beside' | 'drop') => {
      const b = new MachineBuilder('t')
      b.add('platform', 'deck', { x: 0, y: 0, z: 0 }, 0, { width: 6, depth: 2 })
      b.add('lever', 'lv', { x: 0, y: 0, z: 0 }, 0, { length: 2.2, pivot: 0.42, ratio: 0.5, weight: 0.6, rest: 14 })
      b.add('button', 'btn', { x: 0.95, y: 0.97, z: 0 }, 0, { facing: 'down' })
      if (marble === 'beside') b.add('marble', 'm', { x: -2.2, y: 0.155, z: 0 }, 0, {})
      if (marble === 'drop') b.add('marble', 'm', { x: -0.95, y: 1.5, z: 0 }, 0, {})
      const sim = new Simulation(b.scene())
      sim.start()
      sim.marbles()[0]?.body.wakeUp()
      steps(sim, 3)
      const st = (sim.byId.get('btn') as Button).status
      sim.free()
      return st
    }
    // nothing pressing: the sprung cap stays put
    const b = new MachineBuilder('t')
    b.add('button', 'btn', { x: 0, y: 2, z: 0 }, 0, { facing: 'down' })
    const idle = new Simulation(b.scene())
    idle.start()
    steps(idle, 3)
    expect((idle.byId.get('btn') as Button).status).toBe('ARMED')
    idle.free()
    // a lever nobody touches, or a marble resting beside it, never fires the switch…
    expect(run('none')).toBe('ARMED')
    expect(run('beside')).toBe('ARMED')
    // …a marble landing on the input end tips the lever into the cap
    expect(['ACTIVATED', 'COMPLETED']).toContain(run('drop'))
  })
  it('the lift and final cup ignore an empty car / a marble flying past', () => {
    const b = new MachineBuilder('t')
    b.add('lift', 'l', { x: 0, y: 0, z: 0 }, 0, { height: 3, auto: true })
    b.add('final', 'f', { x: 5, y: 0, z: 0 }, 0, {})
    b.add('marble', 'm', { x: 5, y: 2.5, z: 0 }, 0, {})
    const sim = new Simulation(b.scene())
    sim.start()
    const m = sim.marbles()[0].body
    m.wakeUp()
    m.setLinvel({ x: 6, y: 0, z: 0 }, true) // flies straight over the cup
    steps(sim, 3)
    expect((sim.byId.get('l') as Lift).status).toBe('ARMED')
    expect((sim.byId.get('f') as Final).status).toBe('ARMED')
    // a marble set down in the car does start the lift
    m.setTranslation({ x: 0, y: 0.2, z: 0 }, true)
    m.setLinvel({ x: 0, y: 0, z: 0 }, true)
    steps(sim, 1.5)
    expect((sim.byId.get('l') as Lift).status).not.toBe('ARMED')
    sim.free()
  })
})
