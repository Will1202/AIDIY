// 物品数据：名称、描述、3D 预览模型类型、组合配方
import { S } from '../state/store'

export type ItemModel =
  | 'ticket' | 'punch' | 'cell' | 'fragment' | 'fuse' | 'watch' | 'hands' | 'toytrain' | 'umbrella' | 'wristwatch' | 'oldticket' | 'cap'

export interface ItemDef {
  id: string
  name: string
  model: ItemModel
  /** 模型主色 */
  color: string
  desc: () => string
}

export const ITEMS: Record<string, ItemDef> = {
  ticket: {
    id: 'ticket', name: '车票', model: 'ticket', color: '#e9dfc6',
    desc: () => {
      if (S.is('ticket.final')) return '末班 0000 次 · 零号站台。目的地一栏终于有了字：「终点站」。墨迹还是湿的。'
      if (S.is('ticket.punched')) return '末班 0000 次 · 零号站台 · 23:59 发车。票角被打了一个月牙形的孔。目的地一栏仍然空着。'
      return '末班 0000 次 · 零号站台 · 23:59 发车。目的地一栏是空白的，像是有人故意没写。票面还是温的。'
    },
  },
  punch: { id: 'punch', name: '检票钳', model: 'punch', color: '#b08a4a', desc: () => '黄铜检票钳，钳口是月牙形。手柄上刻着一行很小的字：「每一张票都应该被检一次」。' },
  cell: { id: 'cell', name: '重力电池', model: 'cell', color: '#8fd8d2', desc: () => '一枚会自己浮起来的电池，里面封着一小团翻转的天空。拿在手里，能感觉到它在往上拽。' },
  fragment_city: { id: 'fragment_city', name: '碎片 · 倒影', model: 'fragment', color: '#9fe6df', desc: () => '第一枚碎片。透过它看，任何东西都是倒过来的。它在路线控制台的一个凹槽前会发热。' },
  fuse: { id: 'fuse', name: '高压保险丝', model: 'fuse', color: '#d9c18a', desc: () => '玻璃管里的熔丝完好无损。标签：「观测站主电路 · 备用」。被人仔细地包在防水布里。' },
  fragment_abyss: { id: 'fragment_abyss', name: '碎片 · 回声', model: 'fragment', color: '#53c8ff', desc: () => '第二枚碎片。贴在耳边，能听见很远很远的地方有人在说话，听不清内容。' },
  watch: { id: 'watch', name: '时砂怀表', model: 'watch', color: '#e6b65c', desc: () => '表盘里装的不是指针，而是一小撮悬浮的沙。对准带有时间印记的物体：[R] 倒转，[F] 暂停 / 恢复。' },
  hands: { id: 'hands', name: '钟表指针', model: 'hands', color: '#c9a35a', desc: () => '从钟塔大钟上拆下来的一对指针，时针和分针。很重。它们本该属于某一座停走的钟。' },
  fragment_desert: { id: 'fragment_desert', name: '碎片 · 停摆', model: 'fragment', color: '#f0c36a', desc: () => '第三枚碎片。里面的光一动不动，像一秒钟被永远留住。' },
  toy_train: { id: 'toy_train', name: '玩具火车', model: 'toytrain', color: '#2f4f8a', desc: () => '铁皮玩具火车，车头漆着一个「0」。发条已经松了。展签：「我第一次看见火车时，以为它能带我去任何地方。」' },
  umbrella: { id: 'umbrella', name: '红伞', model: 'umbrella', color: '#b33a32', desc: () => '一把旧红伞，伞骨断了一根。展签：「那天下雨。我把伞留给了你，自己跑去赶车。」' },
  wristwatch: { id: 'wristwatch', name: '停走的手表', model: 'wristwatch', color: '#9aa3ad', desc: () => '指针停在 00:00 的手表。展签：「我在站台等了一整夜。钟一直没有走。」' },
  first_ticket: { id: 'first_ticket', name: '第一张车票', model: 'oldticket', color: '#d8c39a', desc: () => '泛黄的旧车票：末班 0000 次 · 零号站台 · 23:59。目的地：「回家」。票面没有检票孔——这张票从来没有被用过。' },
  fragment_museum: { id: 'fragment_museum', name: '碎片 · 镜像', model: 'fragment', color: '#f08a78', desc: () => '第四枚碎片。镜面里映出的人，穿着列车长的制服。' },
  cap: { id: 'cap', name: '列车长的帽子', model: 'cap', color: '#1c2638', desc: () => '深蓝色的大檐帽，帽徽是一个圆。内衬里缝着一个名字，和你的一模一样。' },
}

export interface Recipe {
  a: string
  b: string
  ok: () => boolean
  apply: () => string
}

/** 背包组合配方 */
export const RECIPES: Recipe[] = [
  {
    a: 'ticket', b: 'punch',
    ok: () => !S.is('ticket.punched'),
    apply: () => {
      S.set('ticket.punched')
      S.take('punch')
      return '咔哒。你给自己的车票检了票。月牙形的孔里，透出一点车厢的暖光。检票钳用不上了。'
    },
  },
]

export function findRecipe(a: string, b: string) {
  return RECIPES.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? null
}

export const FRAGMENTS = ['fragment_city', 'fragment_abyss', 'fragment_desert', 'fragment_museum'] as const
