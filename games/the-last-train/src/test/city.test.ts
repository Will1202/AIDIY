// 倒悬都市：用真实碰撞和角色控制器走完整条谜题路线，并验证错误朝向确实过不去。
import { describe, it, expect, beforeEach } from 'vitest'
import { mockGame, buildWorld, walk, use, step, resetState } from './sim'
import { InvertedCity } from '../world/city/InvertedCity'
import { S } from '../state/store'
import { segmentBoxes, passable } from '../puzzles/bridge'

describe('bridge segment logic', () => {
  it('only the deck-facing-feet orientation is passable', () => {
    expect(passable(0, 1)).toBe(true)
    expect(passable(2, 1)).toBe(false)
    expect(passable(2, -1)).toBe(true)
    expect(passable(1, 1)).toBe(false)
    const d = { cx: 0, cy: 0.8, cz: 40, halfW: 1.6, halfL: 6, thick: 0.4, finH: 2.4, railH: 1.1 }
    const up = segmentBoxes(d, 0)
    expect(up[0].y1).toBeCloseTo(1.0)
    expect(up[1].y1).toBeCloseTo(0.6) // 鳍板在桥面下
    const down = segmentBoxes(d, 2)
    expect(down[1].y0).toBeCloseTo(1.0) // 翻过来后鳍板竖在桥面上，挡路
  })
})

describe('Inverted City walkthrough', () => {
  beforeEach(() => resetState())

  it('wrong orientations block, the full route works', async () => {
    const g = mockGame()
    const w = await buildWorld(InvertedCity, g)
    g.player.teleport(0, 1, 4, 0, 0)
    step(g, w, 0.5)
    expect(g.player.body.grounded).toBe(true)
    // 初始桥段竖着：走不过去
    let r = walk(g, w, [[0, 27], [0, 33.5], [0, 40]], { maxPerPoint: 6 })
    expect(r.ok).toBe(false)
    // 方位仪没有电
    walk(g, w, [[1.6, 26.4]])
    expect(use(g, w, 'pillarA')).toBe('ok')
    expect(S.num('city.rotA', 1)).toBe(1)
    // 去电车站拿电池
    walk(g, w, [[-6, 22], [-10.4, 22]])
    expect(use(g, w, 'cell')).toBe('ok')
    expect(S.has('cell')).toBe(true)
    walk(g, w, [[-3, 24], [1.6, 26.4]])
    expect(use(g, w, 'pillarA')).toBe('ok') // 放入电池
    expect(S.flag('city.cellAt')).toBe('C1')
    expect(use(g, w, 'pillarA')).toBe('ok') // 90 → 180：桥面朝下，鳍板竖起
    expect(S.num('city.rotA')).toBe(2)
    r = walk(g, w, [[0, 27.5], [0, 33], [0, 40]], { maxPerPoint: 6 })
    expect(r.ok).toBe(false)
    expect(r.fell).toBe(false)
    walk(g, w, [[1.6, 26.4]])
    use(g, w, 'pillarA')
    use(g, w, 'pillarA')
    expect(S.num('city.rotA')).toBe(0)
    // 取出电池，桥段锁定
    expect(use(g, w, 'pillarTakeA')).toBe('ok')
    expect(S.has('cell')).toBe(true)
    step(g, w, 6)
    r = walk(g, w, [[0, 27.5], [0, 40], [0, 55], [1.2, 63]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.is('city.reachedL2')).toBe(true)
    // 重力翻转
    expect(use(g, w, 'pylon1')).toBe('ok')
    step(g, w, 4)
    expect(g.player.g).toBe(-1)
    expect(g.player.body.grounded).toBe(true)
    expect(g.player.body.y).toBeCloseTo(34, 0)
    // 上层桥段初始桥面朝上（对倒悬的人是错的）
    r = walk(g, w, [[0, 70], [0, 76], [0, 83]], { maxPerPoint: 6 })
    expect(r.ok).toBe(false)
    walk(g, w, [[1.6, 72.2]])
    expect(use(g, w, 'pillarB')).toBe('ok') // 放电池
    use(g, w, 'pillarB')
    use(g, w, 'pillarB')
    expect(S.num('city.rotB')).toBe(2)
    step(g, w, 6)
    r = walk(g, w, [[0, 75.5], [0, 83], [0, 92], [0, 97], [0, 101.5]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.is('city.tower')).toBe(true)
    expect(use(g, w, 'fragment')).toBe('ok')
    expect(S.has('fragment_city')).toBe(true)
    // 回去：桥、重力塔、下层桥、站台
    r = walk(g, w, [[0, 97], [0, 92], [0, 83], [0, 75], [0.8, 63]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'pylon-1')).toBe('ok')
    step(g, w, 4)
    expect(g.player.g).toBe(1)
    r = walk(g, w, [[0, 55], [0, 40], [0, 27], [0, 10], [0, 4]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(g.player.body.y).toBeCloseTo(1, 1)
  })

  it('cannot rotate a segment while standing on it', async () => {
    const g = mockGame()
    const w = await buildWorld(InvertedCity, g)
    S.set('city.cellGot')
    S.set('city.cellAt', 'C1')
    S.set('city.rotA', 0)
    g.player.teleport(0, 1, 40, 0, 0)
    step(g, w, 0.3)
    const it = w.items.find((i) => i.id === 'pillarA')!
    it.use()
    expect(S.num('city.rotA')).toBe(0)
  })
})
