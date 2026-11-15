/** npx tsx scripts/seeds.ts <from> <count> <mm> — which jitter seeds fail */
import { initRapier } from '../src/sim/physics'
import { grandContraption } from '../src/sim/grandContraption'
import { jitterScene, runTrial } from '../src/sim/trial'
await initRapier()
const from = Number(process.argv[2] ?? 500), n = Number(process.argv[3] ?? 10), mm = Number(process.argv[4] ?? 2)
let ok = 0
for (let i = 0; i < n; i++) {
  const r = runTrial(jitterScene(grandContraption(), from + i, mm), 120)
  if (r.success) ok++
  else console.log('seed', from + i, 'FAILED:', r.failReason)
}
console.log(`${ok}/${n}`)
