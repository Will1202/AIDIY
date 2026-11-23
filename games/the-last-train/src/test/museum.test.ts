// 记忆博物馆：错视、观察触发的门、影子雕塑、基座组合、镜子揭示、镜中世界。
import { describe, it, expect, beforeEach } from 'vitest'
import { Vector3 } from 'three'
import { mockGame, buildWorld, walk, use, step, resetState, type MockGame } from './sim'
import { Museum } from '../world/museum/Museum'
import { S } from '../state/store'
import { pedestalsSolved, pixelText, angleError } from '../puzzles/museum'
import type { World } from '../world/World'

function lookAt(g: MockGame, w: World, p: Vector3) {
  const d = p.clone().sub(g.player.eye).normalize()
  g.player.yaw = Math.atan2(-d.x, -d.z)
  g.player.pitch = Math.asin(d.y)
  step(g, w, 0.05)
}

describe('museum logic', () => {
  it('pedestal combinations and pixel font', () => {
    expect(pedestalsSolved(['toy_train', 'umbrella', 'wristwatch'])).toBe(true)
    expect(pedestalsSolved(['umbrella', 'toy_train', 'wristwatch'])).toBe(false)
    expect(pixelText('00:00').length).toBe(12 * 4 + 2)
    expect(angleError(Math.PI * 2 + 0.01, 0)).toBeCloseTo(0.01)
  })
})

describe('Museum walkthrough', () => {
  beforeEach(() => resetState())
  it('full route', async () => {
    const g = mockGame()
    const w = (await buildWorld(Museum, g)) as Museum
    g.player.teleport(0, 1, 5, 0, 0)
    step(g, w, 0.4)
    // 「最初」厅：玻璃罩打不开，站进金圈看过去才行
    let r = walk(g, w, [[0, 10], [0, 15], [0, 20], [-6, 24], [-9, 24], [-12.6, 27.4]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    use(g, w, 'toy_train')
    expect(S.has('toy_train')).toBe(false)
    r = walk(g, w, [[-16, 24], [-20, 20]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    lookAt(g, w, new Vector3(-10, 3, 20)) // 方向不对
    expect(S.is('museum.anamorph')).toBe(false)
    lookAt(g, w, new Vector3(-13.2, 2.9, 27.4))
    expect(S.is('museum.anamorph')).toBe(true)
    r = walk(g, w, [[-16, 24], [-12.6, 27.4]])
    expect(use(g, w, 'toy_train')).toBe('ok')
    // 走廊：看着墙时它不变；转身之后变成门
    r = walk(g, w, [[-9, 24], [-4, 24], [4, 24], [9, 24], [16, 24]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    lookAt(g, w, new Vector3(22, 3, 24))
    expect(S.is('museum.corridor')).toBe(false)
    lookAt(g, w, new Vector3(0, 3, 24))
    expect(S.is('museum.corridor')).toBe(true)
    r = walk(g, w, [[21, 24], [26, 24], [29.2, 25.2]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'umbrella')).toBe('ok')
    // 「等待」厅：转动雕塑直到影子成字
    r = walk(g, w, [[23, 24], [9, 24], [4, 24], [0, 20], [0, 15], [0, 11], [20, 11], [33, 10], [37.8, 10]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    use(g, w, 'wristwatch')
    expect(S.has('wristwatch')).toBe(false)
    const mw = w as unknown as { theta: number }
    // 模拟拖动：从初始角度一点点转
    const item = w.items.find((i) => i.id === 'sculpture')!
    const calls: ((dx: number) => void)[] = []
    ;(g as unknown as { manipulate: (l: string, f: (dx: number) => void) => void }).manipulate = (_l, f) => calls.push(f)
    item.use()
    for (let i = 0; i < 2000 && !S.is('museum.shadow'); i++) calls[0](-3)
    expect(S.is('museum.shadow')).toBe(true)
    expect(mw.theta).toBe(0)
    r = walk(g, w, [[42.4, 13.2]])
    expect(use(g, w, 'wristwatch')).toBe('ok')
    // 圆厅：先放错，门不开；纠正后打开
    r = walk(g, w, [[37.8, 10], [33, 10], [20, 11], [0, 11], [0, 15], [0, 20], [-3, 27.4]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    use(g, w, 'pedestal0') // 放上背包里第一件（玩具火车）
    walk(g, w, [[0, 27.8]])
    use(g, w, 'pedestal1') // 红伞
    walk(g, w, [[3, 27.4]])
    use(g, w, 'pedestal2')
    expect(S.is('museum.doorOpen')).toBe(true)
    // 镜厅：看见镜子里的自己
    r = walk(g, w, [[0, 30], [0, 33], [0, 40]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    lookAt(g, w, new Vector3(0, 2.6, 52))
    expect(S.is('museum.mirror')).toBe(true)
    // 读镜中字
    expect(use(g, w, 'mirrorText')).toBe('ok')
    // 穿过镜子
    r = walk(g, w, [[0, 45], [0, 48], [3.6, 51.8]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.is('museum.mirrorWorld')).toBe(true)
    expect(use(g, w, 'first_ticket')).toBe('ok')
    r = walk(g, w, [[-3.4, 52]])
    expect(use(g, w, 'archive5')).toBe('ok')
    r = walk(g, w, [[0, 55.6]])
    expect(use(g, w, 'fragment')).toBe('ok')
    r = walk(g, w, [[0, 48], [0, 40], [0, 30], [0, 20], [0, 10], [0, 5]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(S.has('fragment_museum')).toBe(true)
    expect(S.has('first_ticket')).toBe(true)
  })
})
