import { describe, expect, it } from 'vitest'
import { clipHalfPlane, crackPattern, polyArea, voronoiCells, type Pt } from '../screen/voronoi'
import { rng } from '../core/config'

describe('voronoi fracture', () => {
  it('clips a square by a half plane', () => {
    const sq: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    expect(Math.abs(polyArea(clipHalfPlane(sq, 1, 0, 0.25)))).toBeCloseTo(0.25, 6)
  })

  it('cells tile the rectangle exactly and each contains its seed', () => {
    const r = rng(3)
    const seeds: Pt[] = Array.from({ length: 80 }, () => [r() * 16 - 8, r() * 9 - 4.5] as Pt)
    const cells = voronoiCells(seeds, { x0: -8, y0: -4.5, x1: 8, y1: 4.5 })
    const total = cells.reduce((a, c) => a + Math.abs(polyArea(c)), 0)
    expect(total).toBeCloseTo(16 * 9, 4)
    cells.forEach((c, i) => {
      // point-in-convex-polygon: same side of every edge
      const [px, py] = seeds[i]
      const sign = Math.sign(polyArea(c))
      for (let k = 0; k < c.length; k++) {
        const [ax, ay] = c[k]
        const [bx, by] = c[(k + 1) % c.length]
        expect(sign * ((bx - ax) * (py - ay) - (by - ay) * (px - ax))).toBeGreaterThanOrEqual(-1e-9)
      }
    })
  })

  it('a spider-web pattern lands near the requested size, dense at the impact', () => {
    const p = crackPattern([2, 1], 8.3, 4.4, 110, 7)
    expect(p.cells.length).toBeGreaterThan(70)
    expect(p.cells.length).toBeLessThanOrEqual(110)
    const total = p.cells.reduce((a, c) => a + Math.abs(polyArea(c)), 0)
    expect(total).toBeCloseTo(16.6 * 8.8, 3)
    // cells near the impact are smaller than cells at the rim
    const dist = (c: Pt[]) => Math.hypot(c.reduce((a, q) => a + q[0], 0) / c.length - 2, c.reduce((a, q) => a + q[1], 0) / c.length - 1)
    const near = p.cells.filter((c) => dist(c) < 1.5).map((c) => Math.abs(polyArea(c)))
    const far = p.cells.filter((c) => dist(c) > 5).map((c) => Math.abs(polyArea(c)))
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    expect(mean(near)).toBeLessThan(mean(far))
    // crack edges are ordered from the impact outwards
    for (const e of p.edges) expect(e.da).toBeLessThanOrEqual(e.db)
  })
})
