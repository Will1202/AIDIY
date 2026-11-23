// 深海终点站：保险丝 → 通电 → 探照灯照亮声碑 → 声呐对频 → 升降梯 → 碎片。
import { describe, it, expect, beforeEach } from 'vitest'
import { mockGame, buildWorld, walk, use, step, resetState } from './sim'
import { AbyssStation } from '../world/abyss/AbyssStation'
import { S } from '../state/store'
import { SONAR, matches, inBeam } from '../puzzles/sonar'
import { bridges } from '../systems/bridges'

describe('sonar logic', () => {
  it('matches within tolerance only', () => {
    expect(matches(SONAR.targets[0], 0)).toBe(true)
    expect(matches(SONAR.targets[0] + SONAR.tol + 1, 0)).toBe(false)
    expect(inBeam({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.5, y: 0, z: 10 }, 0.1)).toBe(true)
    expect(inBeam({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 10 }, 0.1)).toBe(false)
  })
})

describe('Abyss Station walkthrough', () => {
  beforeEach(() => resetState())

  it('full route', async () => {
    const g = mockGame()
    const w = await buildWorld(AbyssStation, g)
    g.player.teleport(0, 1, 4, 0, 0)
    step(g, w, 0.5)
    // 进入穹顶
    let r = walk(g, w, [[0, 8], [0, 18], [0, 26]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.is('abyss.entered')).toBe(true)
    // 没电：探照灯和声呐不可用，升降梯封着
    walk(g, w, [[0, 30], [0, 41.5]])
    expect(use(g, w, 'searchlight')).toMatch(/^blocked/)
    // 配电室：没有保险丝拉不了闸
    r = walk(g, w, [[0, 41.5], [6, 40], [8.5, 34], [12, 34], [16.6, 34]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'mainLever')).toMatch(/^blocked/)
    // 更衣室拿保险丝（穿过穹顶）
    r = walk(g, w, [[8.5, 34], [6, 28], [0, 25.5], [-6, 28], [-8.5, 34], [-12, 34], [-16.8, 34]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'locker')).toBe('ok')
    expect(use(g, w, 'fuse')).toBe('ok')
    expect(S.has('fuse')).toBe(true)
    walk(g, w, [[-13.6, 36.4]])
    expect(use(g, w, 'lost3')).toBe('ok')
    r = walk(g, w, [[-12, 34], [-8.5, 34], [-6, 28], [0, 25.5], [6, 28], [8.5, 34], [12, 34], [16.6, 34.2]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'fuseSlot')).toBe('ok')
    expect(use(g, w, 'mainLever')).toBe('ok')
    step(g, w, 4)
    // 声呐：未照亮的声碑无法调准
    const b = bridges.sonar!
    b.set(0, SONAR.targets[0])
    expect(S.is('abyss.f0')).toBe(false)
    // 探照灯照亮三座声碑（直接驱动光束方向，相当于玩家拖动鼠标瞄准）
    const aim = (target: { x: number; y: number; z: number }) => {
      const sw = w as unknown as { sYaw: number; sPitch: number }
      const dx = target.x - 0, dy = target.y + 5 - 13.2, dz = target.z - 34
      sw.sYaw = Math.atan2(dx, dz)
      sw.sPitch = Math.atan2(dy, Math.hypot(dx, dz))
      step(g, w, 1.0)
    }
    aim({ x: -40, y: -9, z: 64 })
    aim({ x: 6, y: -13, z: 96 })
    aim({ x: 46, y: -10, z: 58 })
    expect([0, 1, 2].map((i) => S.is(`abyss.lit${i}`))).toEqual([true, true, true])
    // 错误频率不行，正确频率共振
    b.set(1, 200)
    expect(S.is('abyss.f1')).toBe(false)
    for (let i = 0; i < 3; i++) b.set(i, SONAR.targets[i] + 2)
    expect(S.is('abyss.gate')).toBe(true)
    // 升降梯下到遗迹
    r = walk(g, w, [[12, 34], [8.5, 34], [6, 28], [0, 25.5], [0, 30], [0.4, 33.6]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'elevator')).toBe('ok')
    step(g, w, 12)
    expect(g.player.body.y).toBeCloseTo(-19, 0)
    r = walk(g, w, [[0, 40], [0, 46.4]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'fragment')).toBe('ok')
    walk(g, w, [[-4.6, 43.6]])
    expect(use(g, w, 'archive3')).toBe('ok')
    r = walk(g, w, [[0, 40], [0.3, 33.8]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'elevatorDown')).toBe('ok')
    step(g, w, 12)
    expect(g.player.body.y).toBeCloseTo(1, 0)
    r = walk(g, w, [[0, 26], [0, 12], [0, 5]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.has('fragment_abyss')).toBe(true)
    expect(S.get().archives).toContain('a3')
  })
})
