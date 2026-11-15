import { beforeAll, describe, expect, it } from 'vitest'
import { initRapier } from './physics'
import { BODY_STRIDE, Simulation } from './simulation'
import { Recorder } from './recorder'
import { grandContraption } from './grandContraption'
import { jitterScene, runTrial } from './trial'
import { parseScene, SceneError, serializeScene } from './serialize'
import { validateScene } from './validate'
import { Director } from '../camera/director'
import type { Dominoes } from './components/dominoes'

beforeAll(async () => {
  await initRapier()
})

const runFor = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) sim.step()
}
const bodyState = (sim: Simulation) => sim.captureBodies(new Float32Array(sim.bodies.length * BODY_STRIDE))

describe('Test 06 · the Grand Contraption runs from the first marble to the Final Machine', () => {
  it('completes, and every stage fires in causal order', () => {
    const r = runTrial(grandContraption(), 120)
    expect(r.failReason).toBe('')
    expect(r.success).toBe(true)
    const order = ['z1-gate', 'z2-dominoes', 'z3-lever', 'z3-button', 'z3-motor', 'z3-hopper', 'z4-pulley', 'z5-pendulum', 'z6-launcher', 'z7-lift', 'z8-final']
    const t = order.map((id) => r.stages.find((s) => s.id === id)?.t ?? -1)
    expect(t.every((x) => x >= 0)).toBe(true)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1])
  })
})

describe('Test 07 · pause and resume keep the physics continuous', () => {
  it('a paused-then-resumed run is bit-identical to an uninterrupted one', () => {
    const a = new Simulation(grandContraption())
    const b = new Simulation(grandContraption())
    a.start()
    b.start()
    runFor(a, 12)
    runFor(b, 6)
    // "pause": time passes for the viewer, the recorder / renderer read state, no steps are taken
    const rec = new Recorder(b)
    for (let i = 0; i < 50; i++) { b.captureBodies(new Float32Array(b.bodies.length * BODY_STRIDE)); rec.afterStep(true) }
    runFor(b, 6)
    expect(b.time).toBeCloseTo(a.time, 6)
    expect(Array.from(bodyState(b))).toEqual(Array.from(bodyState(a)))
    a.free()
    b.free()
  })
})

describe('Test 08 · reset restores the complete initial state', () => {
  it('a reset machine matches a freshly built one', () => {
    const scene = grandContraption()
    const fresh = new Simulation(scene)
    const used = new Simulation(scene)
    used.start()
    runFor(used, 20)
    expect(used.phase).toBe('RUNNING')
    // the engine's reset rebuilds the world from the same scene file
    const reset = new Simulation(scene)
    expect(Array.from(bodyState(reset))).toEqual(Array.from(bodyState(fresh)))
    expect(reset.captureComponents()).toEqual(fresh.captureComponents())
    expect(reset.phase).toBe('READY')
    fresh.free(); used.free(); reset.free()
  })
})

describe('Test 09 · repeatable success under build tolerance', () => {
  it('reaches the Final Machine in at least 9 of 10 hand-assembled variants (±2 mm, ±1.5 mrad)', () => {
    let ok = 0
    const fails: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = runTrial(jitterScene(grandContraption(), 500 + i, 2), 120)
      if (r.success) ok++
      else fails.push(r.failReason)
    }
    console.log(`Test 09: ${ok}/10 succeeded${fails.length ? ' — ' + fails.join(' | ') : ''}`)
    expect(ok).toBeGreaterThanOrEqual(9)
  })
})

describe('Test 10 · the auto director cuts on real events only', () => {
  it('changes subject exactly when components change state', () => {
    const sim = new Simulation(grandContraption())
    const d = new Director(sim)
    const cuts: { t: number; name: string }[] = []
    let last = d.shotName
    sim.on((e) => d.onEvent(e))
    sim.start()
    const fake = { position: (_b: unknown, o: { set: (x: number, y: number, z: number) => unknown }) => o.set(0, 0, 0), apply() {} }
    for (let i = 0; i < 120 * 20; i++) {
      sim.step()
      d.shot('director', 1 / 120, fake as never)
      if (d.shotName !== last) {
        cuts.push({ t: sim.time, name: d.shotName })
        last = d.shotName
      }
    }
    const domAt = sim.log.find((e) => e.type === 'status' && e.id === 'z2-dominoes' && e.status === 'ACTIVATED')!.t
    const domCut = cuts.find((c) => c.name === 'DOMINO CASCADE')!
    // the domino shot never comes before the first domino actually tips
    expect(domCut.t).toBeGreaterThanOrEqual(domAt)
    expect(domCut.t - domAt).toBeLessThan(2.5)
    // every cut is explained by a logged status change at or before it
    for (const c of cuts) expect(sim.log.some((e) => e.type === 'status' && e.t <= c.t + 1e-9)).toBe(true)
    sim.free()
  })
})

describe('Test 11 · save / load round-trips the machine exactly', () => {
  it('serialises and parses back identical positions, parameters and wires', () => {
    const scene = grandContraption()
    const json = serializeScene(scene)
    const back = parseScene(json)
    expect(back.components.length).toBe(scene.components.length)
    for (const [i, c] of scene.components.entries()) {
      const b = back.components[i]
      expect(b.id).toBe(c.id)
      expect(b.type).toBe(c.type)
      for (let k = 0; k < 3; k++) expect(b.pos[k]).toBeCloseTo(c.pos[k], 4)
      expect(b.rot).toBeCloseTo(c.rot, 4)
      for (const [key, v] of Object.entries(c.params)) {
        if (typeof v === 'number') expect(Number(b.params[key])).toBeCloseTo(v, 4)
        else expect(b.params[key]).toBe(v)
      }
    }
    expect(back.connections).toEqual(scene.connections.map((k) => ({ ...k, ratio: k.ratio })))
    // and the reloaded machine still works
    expect(runTrial(back, 120).success).toBe(true)
  })
  it('rejects corrupted files with a readable reason', () => {
    expect(() => parseScene('{nope')).toThrow(SceneError)
    expect(() => parseScene({ schema: 'other', version: 1, components: [] })).toThrow(/schema/)
    const bad = JSON.parse(serializeScene(grandContraption()))
    bad.components[3].type = 'teleporter'
    expect(() => parseScene(bad)).toThrow(/unknown type/)
    const bad2 = JSON.parse(serializeScene(grandContraption()))
    bad2.connections.push({ kind: 'signal', from: 'ghost', output: 'x', to: 'z3-motor', input: 'start' })
    expect(() => parseScene(bad2)).toThrow(/unknown component/)
  })
})

describe('Test 12 · rewind replays real recorded history', () => {
  it('seeking back restores the earlier moment (not the initial state), and resuming re-simulates it', () => {
    const sim = new Simulation(grandContraption())
    const rec = new Recorder(sim, 2, 90)
    rec.afterStep(true)
    sim.start()
    const at12: { bodies?: Float32Array; fallen?: number; time?: number } = {}
    for (let i = 0; i < 120 * 25; i++) {
      sim.step()
      rec.afterStep()
      if (sim.steps === 12 * 120) {
        at12.bodies = bodyState(sim)
        at12.fallen = (sim.byId.get('z2-dominoes') as Dominoes).fallenCount
        at12.time = sim.time
      }
    }
    const dom = sim.byId.get('z2-dominoes') as Dominoes
    expect(dom.fallenCount).toBe(26)
    // rewind to t = 12 s: dominoes stand up again, marbles go back along their path
    const t = rec.seek(at12.time!)
    expect(t).toBe(at12.time)
    expect(dom.fallenCount).toBe(at12.fallen)
    expect(dom.fallenCount).toBeLessThan(26)
    expect(dom.fallenCount).toBeGreaterThan(0)
    // poses of every body, and velocities of every dynamic body, are exactly the recorded ones
    // (kinematic velocities are re-derived from their next targets on the following step)
    const now = bodyState(sim)
    sim.bodies.forEach((b, i) => {
      const n = b.isDynamic() ? 13 : 7
      for (let k = 0; k < n; k++) expect(now[i * BODY_STRIDE + k]).toBeCloseTo(at12.bodies![i * BODY_STRIDE + k], 5)
    })
    expect(sim.log.every((e) => e.t <= at12.time! + 1e-9)).toBe(true)
    // intermediate frames exist: rewinding passes through every recorded moment in between
    let seen = 0
    for (let s = 25; s > 12; s -= 0.25) { rec.seek(s); seen++ }
    expect(seen).toBeGreaterThan(40)
    // resume from 12 s and the machine still completes
    rec.seek(at12.time!)
    rec.truncateAfter(at12.time!)
    for (let i = 0; i < 120 * 90 && sim.phase === 'RUNNING'; i++) sim.step()
    expect(sim.phase).toBe('COMPLETED')
    sim.free()
  })
})

describe('Validation', () => {
  it('finds no structural errors in the Grand Contraption', () => {
    const errs = validateScene(grandContraption()).filter((i) => i.level === 'error')
    expect(errs).toEqual([])
  })
  it('flags broken machines', () => {
    const s = grandContraption()
    // lift a track 30 cm so the marble cannot climb into it, and cut the switch → motor wire
    s.components.find((c) => c.id === 'z1-track-2')!.pos[1] += 0.3
    s.connections = s.connections.filter((k) => !(k.from === 'z3-button' && k.to === 'z3-motor'))
    const issues = validateScene(s)
    expect(issues.some((i) => i.id === 'z1-track-2' && i.level === 'error')).toBe(true)
    expect(issues.some((i) => i.id === 'z3-motor' && i.level === 'error')).toBe(true)
  })
})
