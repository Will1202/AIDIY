import { describe, expect, it } from 'vitest'
import { BASE_LEVEL, WATER_LEVEL } from '../core/constants'
import { pathLength, resample, type StrokePoint } from '../util/path'
import { Heightfield } from './Heightfield'
import { buildMountain } from './TerrainGenerator'
import { buildRiver } from './RiverGenerator'
import { deckY, planBridge } from './BridgeGenerator'

const stroke = (f: (u: number) => { x: number; z: number }, n = 40, p = 0.7): StrokePoint[] => {
  const a: StrokePoint[] = []
  for (let i = 0; i <= n; i++) a.push({ ...f(i / n), p, v: 20, t: i / n, w: 2 })
  return a
}

/** grow every patch to completion and fold it into the heightfield */
function settle(hf: Heightfield) {
  for (const p of hf.patches) {
    p.grow = 1
    p.detailGrow = 1
  }
  hf.markDirty()
  hf.rebuild()
}

describe('stroke paths', () => {
  it('resamples at a fixed spacing and keeps both ends', () => {
    const pts = stroke((u) => ({ x: -50 + u * 100, z: 10 * Math.sin(u * 6) }), 7)
    const r = resample(pts, 1.5)
    expect(r[0].x).toBeCloseTo(pts[0].x)
    expect(r[r.length - 1].x).toBeCloseTo(pts[pts.length - 1].x)
    for (let i = 1; i < r.length - 1; i++) expect(Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z)).toBeLessThanOrEqual(1.5001)
    expect(pathLength(r)).toBeGreaterThan(95)
  })
})

describe('mountain brush', () => {
  it('raises the ridge where the ink was drawn, not elsewhere', () => {
    const hf = new Heightfield()
    const pts = stroke((u) => ({ x: -60 + u * 120, z: 20 }))
    const { main, spec } = buildMountain(hf, pts, 42)
    hf.add(main)
    settle(hf)
    const onRidge = Math.max(...[-40, -10, 0, 10, 40].map((x) => hf.sample(x, 20)))
    expect(onRidge).toBeGreaterThan(BASE_LEVEL + 12)
    // far from the stroke the paper stays flat
    expect(hf.sample(0, 100)).toBeLessThan(BASE_LEVEL + 2)
    expect(hf.sample(-110, -100)).toBeLessThan(BASE_LEVEL + 2)
    // every peak lies close to the drawn path
    for (const pk of spec.peaks) expect(Math.abs(pk.z - 20)).toBeLessThan(4)
  })

  it('makes longer strokes into bigger ranges', () => {
    const hf = new Heightfield()
    const short = buildMountain(hf, stroke((u) => ({ x: -10 + u * 20, z: 0 })), 7).spec
    const long = buildMountain(hf, stroke((u) => ({ x: -90 + u * 180, z: 0 })), 7).spec
    expect(long.height).toBeGreaterThan(short.height)
    expect(long.length).toBeGreaterThan(short.length * 5)
  })
})

describe('bridge brush', () => {
  it('refuses to bridge flat paper', () => {
    const hf = new Heightfield()
    const plan = planBridge(hf, stroke((u) => ({ x: -20 + u * 30, z: 40 }), 10))
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.message).toContain('无需架桥')
  })

  it('spans a river with a deck that meets both banks', () => {
    const hf = new Heightfield()
    const river = buildRiver(stroke((u) => ({ x: 0, z: -90 + u * 180 }), 60))
    expect(river).not.toBeNull()
    hf.add(river!.patch)
    settle(hf)
    expect(hf.waterDepth(0, 0)).toBeGreaterThan(0.5)
    const plan = planBridge(hf, stroke((u) => ({ x: -14 + u * 28, z: 0 }), 12))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const s = plan.spec
    expect(s.crossesWater).toBe(true)
    expect(s.style).toBe('arch')
    // the deck starts and ends on the terrain and stays above the water
    expect(deckY(s, 0)).toBeCloseTo(hf.sample(s.ax, s.az), 4)
    expect(deckY(s, 1)).toBeCloseTo(hf.sample(s.bx, s.bz), 4)
    for (let t = 0.1; t < 0.9; t += 0.1) expect(deckY(s, t)).toBeGreaterThan(WATER_LEVEL + 0.4)
  })

  it('slides an end that landed in the water back onto the bank', () => {
    const hf = new Heightfield()
    hf.add(buildRiver(stroke((u) => ({ x: 0, z: -90 + u * 180 }), 60))!.patch)
    settle(hf)
    const plan = planBridge(hf, stroke((u) => ({ x: -14 + u * 14.5, z: 0 }), 12))
    if (plan.ok) expect(hf.waterDepth(plan.spec.bx, plan.spec.bz)).toBeLessThan(0.05)
  })
})
