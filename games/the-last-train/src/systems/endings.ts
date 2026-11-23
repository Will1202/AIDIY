// 结局条件：由真实游戏状态决定。三个结局对应终点世界里三个不同的物理行为：
//   离开列车 —— 持写好目的地的车票走出出站闸机
//   成为新的列车长 —— 戴上驾驶室里的帽子并拉下发车杆
//   打破时间循环 —— 给站台大钟装上指针、放入第一张车票，让钟走到 00:01
import type { EndingId } from '../game/types'
import { S, gameStore } from '../state/store'
import { LOST_TICKETS } from '../content/archives'

export interface LoopRequirement {
  id: string
  label: string
  ok: boolean
}

/** 打破循环需要的条件（缺什么就告诉玩家什么，但措辞是剧情化的） */
export function loopRequirements(): LoopRequirement[] {
  const s = gameStore.getState()
  return [
    { id: 'hands', label: '钟表指针（时间沙漠的钟塔）', ok: S.has('hands') || S.is('terminus.handsIn') },
    { id: 'first', label: '第一张车票（记忆博物馆的镜中世界）', ok: S.has('first_ticket') || S.is('terminus.firstIn') },
    { id: 'archives', label: `至少读过 4 份异常档案（已读 ${s.read.length}）`, ok: s.read.length >= 4 },
    { id: 'consent', label: '告诉列车长你的决定', ok: S.is('terminus.clockOk') },
  ]
}

export function endingAvailable(id: EndingId): boolean {
  switch (id) {
    case 'leave':
      return S.is('ticket.final') && S.has('ticket')
    case 'conductor':
      return S.is('terminus.capOffered')
    case 'loop':
      return loopRequirements().every((r) => r.ok)
  }
}

/** 结局尾声的变体文字：读取一路上的选择 */
export function epilogue(id: EndingId): string[] {
  const s = gameStore.getState()
  const trusting = s.trust >= s.doubt
  const allTickets = s.collectibles.length >= Object.keys(LOST_TICKETS).length
  const lines: string[] = []
  if (id === 'leave') {
    lines.push('出站闸机吞下了你的车票，吐出一阵带着雨味的风。')
    lines.push('站外是一条你认识的街。天还没亮，路灯一盏一盏熄灭。')
    lines.push(trusting ? '你回头看了一眼。列车长站在站台上，向你抬了抬帽檐。' : '你没有回头。身后，那班车的灯一直亮着。')
    lines.push('钟还停在 00:00。但你已经不在钟里了。')
  } else if (id === 'conductor') {
    lines.push('帽子比想象中轻。')
    lines.push('你拉下发车杆。站台上，那个白发的人向你挥手，慢慢走进了晨光里。')
    lines.push(S.is('knowTruth') ? '你知道下一个醒来的人是谁。你会检 TA 的票，带 TA 走一遍你走过的路。' : '你不知道下一个醒来的人是谁。但你会为 TA 留一盏灯。')
    lines.push('末班 0000 次驶回了雨夜。')
  } else {
    lines.push('分针向前跳了一格。')
    lines.push('00:01。')
    lines.push('环形的铁轨在远处断开，变成一条笔直的线。列车第一次，驶向了一个真正的地方。')
    lines.push('站台上有人撑着一把红伞。TA 说：「你来啦。伞，替你拿了好久。」')
    lines.push(trusting ? '列车长摘下帽子，和你一起走下了车。' : '你回头时，驾驶室已经空了。帽子放在座位上，像是终于可以休息了。')
  }
  if (allTickets) lines.push(`你口袋里有 ${Object.keys(LOST_TICKETS).length} 张旧车票，来自 ${Object.keys(LOST_TICKETS).length} 个不同的夜晚。你不是第一个醒来的人——但你是最后一个。`)
  return lines
}
