import { Simulation, type SimEvent } from './simulation'
import type { SceneSpec } from './schema'
import { rng } from './math'

export interface TrialResult {
  success: boolean
  /** sim time of the final activation (or of failure) */
  time: number
  failReason: string
  log: SimEvent[]
  stages: { id: string; label: string; t: number }[]
}

/** Run a machine headless until it completes, fails, or `maxTime` simulated seconds pass. */
export function runTrial(scene: SceneSpec, maxTime = 120, onStep?: (sim: Simulation) => void): TrialResult {
  const sim = new Simulation(scene)
  sim.start()
  const limit = Math.round(maxTime * 120)
  for (let i = 0; i < limit; i++) {
    sim.step()
    onStep?.(sim)
    if (sim.phase === 'COMPLETED' || sim.phase === 'FAILED') break
  }
  const stages: TrialResult['stages'] = []
  const seen = new Set<string>()
  for (const e of sim.log) {
    if (e.type === 'status' && e.id && !seen.has(e.id) && (e.status === 'ACTIVATED' || e.status === 'RUNNING' || e.status === 'COMPLETED')) {
      seen.add(e.id)
      const c = sim.byId.get(e.id)!
      stages.push({ id: e.id, label: c.spec.label ?? c.id, t: e.t })
    }
  }
  const res: TrialResult = {
    success: sim.phase === 'COMPLETED',
    time: sim.phase === 'COMPLETED' ? sim.completeTime : sim.time,
    failReason: sim.phase === 'FAILED' ? sim.failReason : sim.phase === 'COMPLETED' ? '' : `timeout after ${maxTime}s`,
    log: sim.log,
    stages,
  }
  sim.free()
  return res
}

/**
 * Build-tolerance jitter: every component is displaced by up to `mm` millimetres and turned by up
 * to `mrad` milliradians, as if the machine were re-assembled by hand. Deterministic per seed.
 */
export function jitterScene(scene: SceneSpec, seed: number, mm = 2, mrad = 1.5): SceneSpec {
  const r = rng(seed)
  const j = (a: number) => (r() * 2 - 1) * a
  return {
    ...scene,
    components: scene.components.map((c) => ({
      ...c,
      pos: [c.pos[0] + j(mm / 1000), c.pos[1] + j(mm / 2000), c.pos[2] + j(mm / 1000)] as [number, number, number],
      rot: c.rot + j(mrad / 1000),
    })),
  }
}
