// 全局公共类型

export type WorldId = 'station' | 'city' | 'abyss' | 'desert' | 'museum' | 'terminus'

export const WORLD_ORDER: WorldId[] = ['station', 'city', 'abyss', 'desert', 'museum', 'terminus']

export interface WorldMeta {
  id: WorldId
  index: number
  name: string
  en: string
  /** 主题色（UI 强调色） */
  accent: string
  blurb: string
}

export const WORLDS: Record<WorldId, WorldMeta> = {
  station: { id: 'station', index: 0, name: '午夜车站', en: 'The Midnight Platform', accent: '#e8b060', blurb: '暴雨中的零号站台。钟停在 00:00。' },
  city: { id: 'city', index: 1, name: '倒悬都市', en: 'The Inverted City', accent: '#8fd8d2', blurb: '天空之上，还有另一座倒挂的城市。' },
  abyss: { id: 'abyss', index: 2, name: '深海终点站', en: 'The Abyss Station', accent: '#4cc9ff', blurb: '被海水包围的透明观测站。' },
  desert: { id: 'desert', index: 3, name: '时间沙漠', en: 'The Frozen Hour', accent: '#e6b65c', blurb: '沙粒停在半空，风暴停在原地。' },
  museum: { id: 'museum', index: 4, name: '记忆博物馆', en: 'The Museum of Memories', accent: '#d9705f', blurb: '每个房间都是一段记忆。' },
  terminus: { id: 'terminus', index: 5, name: '不存在的终点', en: 'The Station That Never Was', accent: '#f3e6c4', blurb: '列车从未抵达的地方。' },
}

export type EndingId = 'leave' | 'conductor' | 'loop'

export const ENDINGS: Record<EndingId, { name: string; en: string; line: string }> = {
  leave: { name: '离开列车', en: 'Leave the Train', line: '你没有等到那班车。但这一次，你自己走出了车站。' },
  conductor: { name: '成为新的列车长', en: 'The New Conductor', line: '下一位乘客会在 00:00 醒来。你会为 TA 留一盏灯。' },
  loop: { name: '打破时间循环', en: 'Break the Loop', line: '00:01。列车抵达终点。等你的人，一直都在。' },
}

export type MomentId = 'rain' | 'invert' | 'whale' | 'freeze' | 'reversal'

export const MOMENTS: Record<MomentId, { name: string; en: string; world: WorldId; desc: string }> = {
  rain: { name: '雨夜列车', en: 'The Rain Train', world: 'station', desc: '午夜暴雨，列车从雾里驶来。' },
  invert: { name: '世界倒转', en: 'The World Turns', world: 'city', desc: '窗外的城市缓缓倒悬，整片天空翻转。' },
  whale: { name: '深海鲸鱼', en: 'The Whale', world: 'abyss', desc: '车厢灯光熄灭，一头巨鲸游过车窗。' },
  freeze: { name: '时间冻结', en: 'The Frozen Hour', world: 'desert', desc: '沙粒、碎片和建筑部件悬停在空中。' },
  reversal: { name: '终点反转', en: 'The Reversal', world: 'terminus', desc: '之前见过的世界，以全新的方式连在一起。' },
}

export type Vec3 = { x: number; y: number; z: number }
