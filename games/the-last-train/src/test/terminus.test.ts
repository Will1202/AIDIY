// 终点世界：三个结局都必须由真实的游戏状态与实际操作触发。
import { describe, it, expect, beforeEach } from 'vitest'
import { mockGame, buildWorld, walk, use, step, resetState } from "./sim"
import { Terminus } from '../world/terminus/Terminus'
import { S } from '../state/store'
import { DialogueRun } from '../systems/dialogue'
import { CONDUCTOR_TERMINUS } from '../content/dialogue'
import { endingAvailable, loopRequirements } from '../systems/endings'

function talk(choice: string) {
  const r = new DialogueRun(CONDUCTOR_TERMINUS)
  for (let i = 0; i < 30 && !r.done; i++) {
    const v = r.view()
    if (v?.choices) {
      if (!v.choices.find((c) => c.id === choice)) return false
      r.choose(choice)
      break
    }
    r.advance()
  }
  for (let i = 0; i < 30 && !r.done; i++) { if (r.view()?.choices) break; r.advance() }
  return true
}

async function setup() {
  const g = mockGame()
  const w = await buildWorld(Terminus, g)
  S.give('ticket')
  S.set('ticket.punched')
  g.player.teleport(0, 1, 3.4, 0, 0)
  w.onDocked()
  step(g, w, 0.3)
  return { g, w }
}

const flushPromises = () => new Promise((r) => setTimeout(r, 0))

describe('Terminus endings', () => {
  beforeEach(() => resetState())

  it('nothing ends without the right state', async () => {
    const { g, w } = await setup()
    expect(endingAvailable('leave')).toBe(false)
    expect(endingAvailable('conductor')).toBe(false)
    expect(endingAvailable('loop')).toBe(false)
    walk(g, w, [[30, 5.6], [34.6, 5.6]])
    use(g, w, 'gate')
    // 闸机挡着：走不出去
    const r = walk(g, w, [[40, 5.6]], { maxPerPoint: 3 })
    expect(r.ok).toBe(false)
    expect(g.log.endings).toEqual([])
    // 没有指针：钟拨不动；对话里也没有“钟”的选项
    expect(talk('clock')).toBe(false)
  })

  it('ending 1: leave the train', async () => {
    const { g, w } = await setup()
    expect(talk('leave')).toBe(true)
    expect(S.is('ticket.final')).toBe(true)
    expect(endingAvailable('leave')).toBe(true)
    walk(g, w, [[30, 5.6], [34.6, 5.6]])
    expect(use(g, w, 'gate')).toBe('ok')
    await flushPromises()
    expect(g.log.endings).toEqual(['leave'])
  })

  it('ending 2: become the conductor', async () => {
    const { g, w } = await setup()
    expect(talk('stay')).toBe(true)
    step(g, w, 0.2)
    expect(g.train.cabOpen).toBe(1)
    const r = walk(g, w, [[5.5, 2.8], [5.5, 0.4], [9, 0], [12, 0], [15.0, 0]])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(use(g, w, 'cabLever')).toBe('ok') // 没帽子：拉不动
    expect(g.log.endings).toEqual([])
    expect(use(g, w, 'cap')).toBe('ok')
    expect(use(g, w, 'cabLever')).toBe('ok')
    await flushPromises()
    expect(g.log.endings).toEqual(['conductor'])
  })

  it('ending 3: break the loop needs hands, first ticket, archives and consent', async () => {
    const { g, w } = await setup()
    S.give('hands')
    S.give('first_ticket')
    walk(g, w, [[0, 5.5]])
    expect(use(g, w, 'clockHands')).toBe('ok') // 装上指针
    expect(S.is('terminus.handsIn')).toBe(true)
    expect(use(g, w, 'ticketSlot')).toBe('ok')
    expect(S.is('terminus.firstIn')).toBe(true)
    use(g, w, 'clockHands')
    expect(g.log.endings).toEqual([]) // 档案不够、也没有告诉列车长
    for (const a of ['a1', 'a2', 'a3', 'a4']) { S.addArchive(a); S.markRead(a) }
    expect(loopRequirements().find((r) => r.id === 'consent')!.ok).toBe(false)
    // 指针已经装上：对话里的条件看的是是否持有，装上之后用 handsIn 判断
    S.set('terminus.clockOk')
    expect(endingAvailable('loop')).toBe(true)
    use(g, w, 'clockHands')
    await flushPromises()
    expect(g.log.endings).toEqual(['loop'])
  })
})
