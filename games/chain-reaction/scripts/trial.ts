/** npm run trial -- [runs] [mm]   headless robustness trials of The Grand Contraption */
import { initRapier } from '../src/sim/physics'
import { grandContraption } from '../src/sim/grandContraption'
import { jitterScene, runTrial } from '../src/sim/trial'

await initRapier()
const runs = Number(process.argv[2] ?? 1)
const mm = Number(process.argv[3] ?? 0)
const verbose = runs === 1
let ok = 0
for (let i = 0; i < runs; i++) {
  const base = grandContraption()
  const scene = mm > 0 ? jitterScene(base, 1000 + i, mm) : base
  const t0 = performance.now()
  const r = runTrial(scene, 150)
  const ms = performance.now() - t0
  if (r.success) ok++
  if (verbose) for (const s of r.stages) console.log(`  ${s.t.toFixed(2).padStart(6)}s  ${s.label}  (${s.id})`)
  console.log(`run ${i + 1}: ${r.success ? 'SUCCESS' : 'FAILED'} at ${r.time.toFixed(2)}s  [${(ms / 1000).toFixed(1)}s wall]${r.failReason ? '  — ' + r.failReason : ''}`)
}
console.log(`\n${ok} / ${runs} runs reached THE FINAL MACHINE`)
