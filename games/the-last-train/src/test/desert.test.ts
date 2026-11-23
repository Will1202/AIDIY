// 时间沙漠：多步时间谜题（倒转 + 暂停 + 恢复，多个物体）完整走一遍。
import { describe, it, expect, beforeEach } from 'vitest'
import { Vector3 } from 'three'
import { mockGame, buildWorld, walk, use, step, resetState, type MockGame } from './sim'
import { FrozenHour } from '../world/desert/FrozenHour'
import { S } from '../state/store'
import { makeTimeObj, stepTime, startRewind, endRewind, togglePause } from '../puzzles/time'
import type { World } from '../world/World'

describe('time object rules', () => {
  it('rewind then release resumes time; pause snaps', () => {
    const o = makeTimeObj('x', 1, 0.1, { snaps: [0, 1], snapTol: 0.05 })
    startRewind(o)
    for (let i = 0; i < 60; i++) stepTime(o, 0.1)
    expect(o.t).toBeLessThan(0.5)
    endRewind(o)
    expect(o.mode).toBe('run')
    const before = o.t
    stepTime(o, 1)
    expect(o.t).toBeGreaterThan(before)
    o.t = 0.03
    togglePause(o)
    expect(o.mode).toBe('pause')
    expect(o.t).toBe(0)
  })
  it('cyclic hands wrap and snap to twelve', () => {
    const h = makeTimeObj('h', 0.98, 1 / 6, { cyclic: true, snaps: [0], snapTol: 0.035 })
    h.mode = 'run'
    stepTime(h, 0.2)
    expect(h.t).toBeLessThan(0.1)
    togglePause(h)
    expect(h.t).toBe(0)
  })
})

function aimAt(g: MockGame, w: World, p: Vector3) {
  const e = g.player.eye
  const d = p.clone().sub(e).normalize()
  g.player.yaw = Math.atan2(-d.x, -d.z)
  g.player.pitch = Math.asin(d.y)
  step(g, w, 1 / 60)
}

function press(g: MockGame, w: World, code: string) {
  g.input.keys.add(code)
  g.input.hits.add(code)
  step(g, w, 1 / 60)
  g.input.hits.clear()
  g.input.keys.delete(code)
  step(g, w, 1 / 60)
}

describe('Frozen Hour walkthrough', () => {
  beforeEach(() => resetState())

  it('full multi-step time puzzle', async () => {
    const g = mockGame()
    const w = await buildWorld(FrozenHour, g)
    const T = (w as FrozenHour)._time()
    g.player.teleport(0, 1, 5, 0, 0)
    step(g, w, 0.5)
    walk(g, w, [[0, 9.6]])
    expect(use(g, w, 'watch')).toBe('ok')
    expect(S.has('watch')).toBe(true)
    // 倒下的钟塔就是桥
    let r = walk(g, w, [[2.2, 9.6], [2.2, 13], [0, 22], [0, 35], [0, 45.5]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.is('desert.crossed')).toBe(true)
    // 站在塔会经过的地方：拒绝
    aimAt(g, w, new Vector3(0, -1, 35))
    g.input.keys.add('KeyR'); g.input.hits.add('KeyR'); step(g, w, 0.2); g.input.keys.delete('KeyR'); g.input.hits.clear(); step(g, w, 0.1)
    expect(T.spire.t).toBe(1)
    // 退到一旁，倒转钟塔
    walk(g, w, [[6, 45.5]])
    aimAt(g, w, new Vector3(0, -1.4, 35))
    g.input.keys.add('KeyR')
    let n = 0
    while (T.spire.t > 0.0 && n < 2000) {
      // 视线跟着塔身中段
      const a = (T.spire.t) * Math.PI / 2
      aimAt(g, w, new Vector3(0, -3.4 + Math.cos(a) * 12, 47 - Math.sin(a) * 12))
      n++
    }
    g.input.keys.delete('KeyR')
    step(g, w, 1 / 60)
    expect(T.spire.mode).toBe('run') // 松开后又开始倒下
    // 立刻暂停（靠近 0 会吸附）
    aimAt(g, w, new Vector3(0, 8, 47))
    press(g, w, 'KeyF')
    expect(T.spire.t).toBe(0)
    expect(S.is('desert.spireUp')).toBe(true)
    // 进塔：升降台停在顶上，先站在门外把它倒转下来
    r = walk(g, w, [[2.5, 45], [0, 45]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    aimAt(g, w, new Vector3(0, 18.6, 49.2))
    g.input.keys.add('KeyR')
    n = 0
    while (T.lift.t > 0 && n < 2000) { aimAt(g, w, new Vector3(0, 1 + T.lift.t * 17.6, 49.2)); n++ }
    g.input.keys.delete('KeyR')
    step(g, w, 1 / 60)
    press(g, w, 'KeyF') // 暂停在底部
    expect(T.lift.mode).toBe('pause')
    r = walk(g, w, [[0, 47.2], [0, 49.2]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    // 站在台上，低头对准它，恢复时间 → 上升
    aimAt(g, w, new Vector3(0, 1, 49.6))

    press(g, w, 'KeyF')
    expect(T.lift.mode).toBe('run')
    step(g, w, 14)
    expect(g.player.body.y).toBeCloseTo(18.6, 0)
    expect(S.is('desert.top')).toBe(true)
    // 时间悖论：分针向前、时针向后，各自停在 12 点
    const solveHand = (o: typeof T.minute, tipLen: number) => {
      const tip = () => new Vector3(Math.sin(o.t * Math.PI * 2) * tipLen, 20.8 + Math.cos(o.t * Math.PI * 2) * tipLen, 47.5)
      aimAt(g, w, tip())
      press(g, w, 'KeyF')
      expect(o.mode).toBe('run')
      let k = 0
      while (k < 4000) {
        const d = Math.min(o.t, 1 - o.t)
        if (d < 0.02) break
        aimAt(g, w, tip())
        k++
      }
      press(g, w, 'KeyF')
    }
    solveHand(T.minute, 1.1)
    expect(T.minute.t === 0 || T.minute.t === 1).toBe(true)
    solveHand(T.hour, 0.7)
    expect(S.is('desert.clock')).toBe(true)
    expect(use(g, w, 'fragment')).toBe('ok')
    expect(use(g, w, 'hands')).toBe('ok')
    // 下塔：站在升降台上倒转它
    aimAt(g, w, new Vector3(0, 18.6, 49.6))
    g.input.keys.add('KeyR')
    n = 0
    while (T.lift.t > 0 && n < 3000) { aimAt(g, w, new Vector3(0, 1 + T.lift.t * 17.6, 49.6)); n++ }
    g.input.keys.delete('KeyR')
    step(g, w, 1 / 60)
    press(g, w, 'KeyF')
    expect(g.player.body.y).toBeCloseTo(1, 0)
    r = walk(g, w, [[0, 47.2], [0, 45], [6, 45]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    // 恢复钟塔的时间：它再次倒下，变回桥
    aimAt(g, w, new Vector3(0, 8, 49))
    press(g, w, 'KeyF')
    expect(T.spire.mode).toBe('run')
    step(g, w, 12)
    expect(T.spire.t).toBe(1)
    r = walk(g, w, [[0, 45], [0, 35], [0, 20], [2.2, 13], [2.2, 9], [0, 5]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.has('fragment_desert')).toBe(true)
    expect(S.has('hands')).toBe(true)
  })
})
