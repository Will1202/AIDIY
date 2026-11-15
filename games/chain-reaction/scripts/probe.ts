/** npx tsx scripts/probe.ts <until> <every> <ids...>  — print component progress over time */
import { initRapier } from '../src/sim/physics'
import { grandContraption } from '../src/sim/grandContraption'
import { Simulation } from '../src/sim/simulation'
import { jitterScene } from '../src/sim/trial'
await initRapier()
const until = Number(process.argv[2] ?? 30), every = Number(process.argv[3] ?? 1)
const ids = process.argv.slice(4)
const base = grandContraption(JSON.parse(process.env.TUNE ?? '{}'))
const sim = new Simulation(process.env.SEED ? jitterScene(base, Number(process.env.SEED), Number(process.env.MM ?? 2)) : base)
sim.start()
let next = Number(process.env.FROM ?? 0)
sim.on((e) => { if (e.type === 'status' || e.type === 'fail' || e.type === 'complete') console.log(`  [${e.t.toFixed(2)}] ${e.type} ${e.id ?? ''} ${e.status ?? ''} ${e.text ?? ''}`) })
while (sim.time < until) {
  sim.step()
  if (sim.time >= next) {
    next += every
    const parts = ids.map((id) => { const c = sim.byId.get(id)!; return `${id}: ${c.status} ${c.progress()}` })
    const ms = sim.marbles().filter((m) => !process.env.ONLY || m.id.startsWith(process.env.ONLY)).map((m) => { const t = m.body.translation(); return `${m.id}(${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)})` })
    console.log(sim.time.toFixed(1), parts.join(' | '), process.env.M ? ms.join(' ') : '')
  }
}
