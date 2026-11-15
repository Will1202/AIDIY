/** TUNE sweep: npx tsx scripts/sweep.ts '{"leverOffset":[1.3,1.5]}' <stopAtId> */
import { initRapier } from '../src/sim/physics'
import { grandContraption } from '../src/sim/grandContraption'
import { Simulation } from '../src/sim/simulation'
await initRapier()
const grid = JSON.parse(process.argv[2]) as Record<string, number[]>
const stopId = process.argv[3]
const keys = Object.keys(grid)
const combos: Record<string, number>[] = [{}]
for (const k of keys) { const next: Record<string, number>[] = []; for (const c of combos) for (const v of grid[k]) next.push({ ...c, [k]: v }); combos.splice(0, combos.length, ...next) }
for (const c of combos) {
  const sim = new Simulation(grandContraption(c))
  sim.start()
  let tHit = -1
  while (sim.time < 120 && sim.phase === 'RUNNING') {
    sim.step()
    const s = sim.byId.get(stopId)
    if (s && s.status !== 'ARMED' && s.status !== 'IDLE' && tHit < 0) { tHit = sim.time; break }
  }
  const last = [...sim.log].reverse().find((e) => e.type === 'status')
  console.log(JSON.stringify(c), tHit > 0 ? `reached ${stopId} @${tHit.toFixed(2)}` : `NO (${sim.phase} ${sim.failReason.slice(0, 120)})`, 'last:', last?.id, last?.status)
  sim.free()
}
