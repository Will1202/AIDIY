// 午夜车站：车票 → 密码柜（2359）→ 检票钳 → 组合检票 → 列车长放行 → 走进车厢自动发车。
import { describe, it, expect, beforeEach } from 'vitest'
import { mockGame, buildWorld, walk, use, step, resetState } from './sim'
import { Station } from '../world/station/Station'
import { S } from '../state/store'
import { findRecipe } from '../content/items'
import { DialogueRun } from '../systems/dialogue'
import { CONDUCTOR_STATION } from '../content/dialogue'
import { activeObjective } from '../content/quests'

describe('Midnight Platform walkthrough', () => {
  beforeEach(() => resetState())
  it('full route to boarding', async () => {
    const g = mockGame()
    const w = await buildWorld(Station, g)
    S.set('station.intro')
    S.set('station.introDone')
    g.player.teleport(-6, 1, 5.9, 0, 0)
    step(g, w, 0.3)
    expect(activeObjective('station')!.step.id).toBe('q0.ticket')
    expect(use(g, w, 'ticket')).toBe('ok')
    expect(activeObjective('station')!.step.id).toBe('q0.punch')
    // 车门被挡住（还没放行）
    let r = walk(g, w, [[-5.5, 3], [-5.5, 0.5]], { maxPerPoint: 4 })
    expect(r.ok).toBe(false)
    // 去候车室开 7 号柜
    r = walk(g, w, [[-5.5, 5], [-14, 8], [-14, 11], [-16.36, 15.0]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'locker')).toBe('ok')
    const kp = (g as unknown as { keypadCheck: (d: number[]) => boolean }).keypadCheck
    expect(kp([1, 2, 3, 4])).toBe(false)
    expect(kp([0, 0, 0, 0])).toBe(false)
    expect(kp([2, 3, 5, 9])).toBe(true)
    expect(S.is('station.locker')).toBe(true)
    expect(use(g, w, 'punch')).toBe('ok')
    expect(use(g, w, 'archive1')).toBe('ok')
    expect(S.get().read).toContain('a1')
    // 背包组合：车票 + 检票钳
    const rec = findRecipe('punch', 'ticket')!
    expect(rec.ok()).toBe(true)
    rec.apply()
    expect(S.is('ticket.punched')).toBe(true)
    expect(activeObjective('station')!.step.id).toBe('q0.show')
    // 失落的车票在长椅下
    r = walk(g, w, [[-17.6, 10.9]])
    expect(use(g, w, 'lost1')).toBe('ok')
    // 和列车长对话：放行
    const run = new DialogueRun(CONDUCTOR_STATION)
    for (let i = 0; i < 20 && !run.done; i++) {
      const v = run.view()
      if (v?.choices) run.choose(v.choices[0].id)
      else run.advance()
    }
    expect(S.is('station.boardOk')).toBe(true)
    // 走进车厢：自动请求发车（前往倒悬都市）
    r = walk(g, w, [[-14, 11], [-14, 8], [-5.5, 4], [-5.5, 2.2], [-5.5, 0.0], [-3, 0]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    step(g, w, 2)
    await new Promise((res) => setTimeout(res, 2800))
    expect(g.log.departs).toEqual(['city'])
  })
})
