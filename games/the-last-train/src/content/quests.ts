// 任务数据：每一步的完成条件都直接读取游戏状态（flags / 背包），任务进度因此天然与存档一致、不会“卡在假状态”。
import type { WorldId } from '../game/types'
import { S, gameStore } from '../state/store'
import { ARCHIVES, LOST_TICKETS } from './archives'

export interface QuestStep {
  id: string
  text: string
  done: () => boolean
  /** 逐级提示：第 1 条 60 秒后可看，第 2 条 150 秒后，第 3 条 240 秒后 */
  hints: string[]
}

export interface Quest {
  id: string
  kind: 'main' | 'side'
  world: WorldId | null
  title: string
  steps: QuestStep[]
  visible: () => boolean
  /** 支线：进度文字 */
  progress?: () => string
}

const placed = (f: string) => S.is(`console.${f}`)

export const QUESTS: Quest[] = [
  {
    id: 'q0', kind: 'main', world: 'station', title: '午夜 00:00',
    visible: () => true,
    steps: [
      { id: 'q0.ticket', text: '长椅上放着一张车票。', done: () => S.has('ticket') || S.is('ticket.punched'), hints: ['你醒来的那张长椅上。'] },
      {
        id: 'q0.punch', text: '列车长说，没有检过的票不能上车。找到能给车票打孔的东西。', done: () => S.is('ticket.punched'),
        hints: ['车站里总会有失物招领。看看候车室。', '售票窗口贴着一张告示，提到了储物柜的密码。', '密码与末班车的发车时间有关。那座坏掉的钟偶尔会“说漏嘴”。', '密码是 2359。拿到检票钳后，在背包里把它和车票组合。'],
      },
      { id: 'q0.show', text: '把检过的车票给列车长看。', done: () => S.is('station.boardOk'), hints: ['列车长站在敞开的车门边。'] },
      { id: 'q0.board', text: '登上末班 0000 次。', done: () => S.num('travel.count') > 0, hints: ['走进车厢，车门会自己关上。'] },
    ],
  },
  {
    id: 'q1', kind: 'main', world: 'city', title: '倒悬都市',
    visible: () => S.get().visited.includes('city'),
    steps: [
      { id: 'q1.explore', text: '走出列车，看看这座悬在空中的城市。', done: () => S.is('city.explored'), hints: ['车门外就是站台广场。'] },
      {
        id: 'q1.bridge', text: '通往中央岛的桥断了，中间一段竖了起来。想办法让它恢复。', done: () => S.is('city.reachedL2'),
        hints: ['桥头有一座方位仪，但它没有电。', '广场边那座废弃的电车站里，有什么东西在往上飘。', '把重力电池放进方位仪，转动桥段，直到桥面朝上。'],
      },
      {
        id: 'q1.up', text: '中央岛上有一座重力塔。去上面那座倒悬的城市。', done: () => S.is('city.inverted'),
        hints: ['站进重力塔的光柱里，启动它。', '在倒悬城市里，脚下才是天空。'],
      },
      {
        id: 'q1.tower', text: '核心塔在另一座倒悬的岛上，中间隔着一段需要转动的桥。', done: () => S.is('city.tower'),
        hints: ['上面的方位仪也需要那块电池。', '先把下面的桥转好，再取出电池——桥会锁在原来的位置。', '对倒悬的你来说，桥面必须朝向“下方”的你。墙上倒写的字也许能帮你。', '把上方的桥段转到 180°。'],
      },
      { id: 'q1.frag', text: '取得核心塔里的碎片。', done: () => S.has('fragment_city') || placed('fragment_city'), hints: ['碎片悬浮在塔的中心。'] },
      { id: 'q1.back', text: '回到列车，把碎片放进路线控制台。', done: () => placed('fragment_city'), hints: ['重力塔可以把你送回下面。', '控制台在车厢最前端。'] },
    ],
  },
  {
    id: 'q2', kind: 'main', world: 'abyss', title: '深海终点站',
    visible: () => S.get().visited.includes('abyss'),
    steps: [
      { id: 'q2.enter', text: '沿着玻璃通道走进观测站。', done: () => S.is('abyss.entered'), hints: ['站台尽头的玻璃通道。'] },
      {
        id: 'q2.power', text: '观测站没有电。恢复主电路。', done: () => S.is('abyss.power'),
        hints: ['配电室的主闸缺了一根保险丝。', '被水淹过的更衣室里，有人把备用件仔细收好了。', '装上保险丝，再拉下主闸。'],
      },
      {
        id: 'q2.light', text: '用探照灯照亮外面黑暗里的三座声碑。', done: () => S.is('abyss.lit0') && S.is('abyss.lit1') && S.is('abyss.lit2'),
        hints: ['探照灯控制台在穹顶边缘。按住鼠标拖动来转动灯。', '三座声碑分别在左、正前、右三个方向，有一座藏得很深。'],
      },
      {
        id: 'q2.sonar', text: '用声呐调出与三座声碑一致的频率。', done: () => S.is('abyss.f0') && S.is('abyss.f1') && S.is('abyss.f2'),
        hints: ['照亮声碑后，声呐屏上会出现它的目标波形。', '听：频率接近时会出现缓慢的“拍音”，完全一致时声音变得纯净。', '让你的波形和目标波形重合，数一数一个屏幕里有几个波峰。'],
      },
      { id: 'q2.ruin', text: '遗迹的入口打开了。下去，找到第二枚碎片。', done: () => S.has('fragment_abyss') || placed('fragment_abyss'), hints: ['穹顶中央的升降梯。'] },
      { id: 'q2.back', text: '回到列车，把碎片放进路线控制台。', done: () => placed('fragment_abyss'), hints: ['控制台在车厢最前端。'] },
    ],
  },
  {
    id: 'q3', kind: 'main', world: 'desert', title: '时间沙漠',
    visible: () => S.get().visited.includes('desert'),
    steps: [
      { id: 'q3.watch', text: '整个世界都停住了。找到能触碰时间的东西。', done: () => S.has('watch'), hints: ['驼队营地的祭台上，有一样东西还在走。'] },
      {
        id: 'q3.cross', text: '倒下的钟塔横在裂谷上。走过去。', done: () => S.is('desert.crossed'),
        hints: ['倒下的塔身就是桥。'],
      },
      {
        id: 'q3.raise', text: '塔门压在地下。让钟塔重新站起来，并且让它停在那里。', done: () => S.is('desert.spireUp'),
        hints: ['对准钟塔按住 [R] 倒转时间。', '松开后，塔会继续倒下——在它立直的时候按 [F] 暂停。', '不要站在塔上做这件事。'],
      },
      {
        id: 'q3.climb', text: '进入钟塔，登上塔顶。', done: () => S.is('desert.top'),
        hints: ['塔里的升降台停在顶上。', '倒转升降台让它下来，站上去后恢复它的时间。'],
      },
      {
        id: 'q3.clock', text: '时间悖论：一根指针向前走，一根向后走。让它们同时回到零点。', done: () => S.is('desert.clock'),
        hints: ['两根指针可以分别暂停、恢复和倒转。', '先让一根停在 12 点，再处理另一根。', '指针接近 12 点时暂停，会自动吸附到刻度上。'],
      },
      { id: 'q3.back', text: '带着第三枚碎片回到列车。', done: () => placed('fragment_desert'), hints: ['回去的路，需要钟塔再倒下一次。', '离开塔，然后恢复钟塔的时间。'] },
    ],
  },
  {
    id: 'q4', kind: 'main', world: 'museum', title: '记忆博物馆',
    visible: () => S.get().visited.includes('museum'),
    steps: [
      {
        id: 'q4.find', text: '圆厅的门需要三段记忆。在展厅里找到它们。', done: () => ['toy_train', 'umbrella', 'wristwatch'].every((i) => S.has(i) || [0, 1, 2].some((k) => S.flag(`museum.ped${k}`) === i)),
        hints: ['每个展厅都有一件发着微光的展品，但都不容易拿到。', '「最初」厅：站在地上的圆圈里看那些碎片。', '「离别」厅：走廊会在你不看它的时候改变。', '「等待」厅：转动雕塑，读它投在墙上的影子。'],
      },
      {
        id: 'q4.place', text: '把三段记忆放回圆厅的三座基座上。', done: () => S.is('museum.doorOpen'),
        hints: ['基座上分别写着：最初、离别、等待。', '读每件展品的展签。'],
      },
      { id: 'q4.mirror', text: '走进镜厅。', done: () => S.is('museum.mirror'), hints: ['圆厅后面的门。'] },
      { id: 'q4.through', text: '镜子里的人不是你。穿过镜子。', done: () => S.is('museum.mirrorWorld'), hints: ['直接走进镜面。'] },
      { id: 'q4.frag', text: '在镜中世界找到第四枚碎片，回到列车。', done: () => placed('fragment_museum'), hints: ['镜中世界里，一切都是反的。'] },
    ],
  },
  {
    id: 'q5', kind: 'main', world: 'terminus', title: '不存在的终点',
    visible: () => S.get().visited.includes('terminus'),
    steps: [
      { id: 'q5.arrive', text: '列车停了。走出去。', done: () => S.is('terminus.out'), hints: [] },
      { id: 'q5.talk', text: '列车长在站台上等你。', done: () => S.is('terminus.talked'), hints: [] },
      {
        id: 'q5.choose', text: '作出你的选择。', done: () => !!gameStore.getState().ending,
        hints: ['出站口需要一张写好了目的地的车票。', '驾驶室的门开着，帽子放在座位上。', '站台大钟没有指针。也许你在别处见过它们。'],
      },
    ],
  },
  // ---------- 支线 ----------
  {
    id: 's1', kind: 'side', world: null, title: '失落的车票',
    visible: () => S.get().collectibles.length > 0,
    progress: () => `${S.get().collectibles.length} / ${Object.keys(LOST_TICKETS).length}`,
    steps: [{ id: 's1.all', text: '每个世界都藏着一张以前的乘客留下的车票。', done: () => S.get().collectibles.length >= Object.keys(LOST_TICKETS).length, hints: ['它们通常在不容易看到的角落：长椅下、倒悬的屋顶、水里、沙里、画框里……'] }],
  },
  {
    id: 's2', kind: 'side', world: null, title: '异常档案',
    visible: () => S.get().archives.length > 0,
    progress: () => `${S.get().archives.length} / ${Object.keys(ARCHIVES).length}`,
    steps: [{ id: 's2.all', text: '收集零号线管理局的全部异常档案。', done: () => S.get().archives.length >= Object.keys(ARCHIVES).length, hints: ['档案总在离真相最近的地方。'] }],
  },
  {
    id: 's3', kind: 'side', world: 'station', title: '零号线广播',
    visible: () => S.is('station.timetable') || S.is('station.radioSeen'),
    steps: [{ id: 's3.tune', text: '售票室里的旧收音机还开着。调到零号线的频道。', done: () => S.is('station.radio'), hints: ['时刻表底部印着零号线广播的频率。', '88.0。'] }],
  },
  {
    id: 's4', kind: 'side', world: 'city', title: '倒写的字',
    visible: () => S.get().visited.includes('city'),
    steps: [{ id: 's4.read', text: '倒悬城市的墙上有一行字，只有倒过来才读得懂。', done: () => S.is('city.mural'), hints: ['翻转重力之后，看看中央岛上方那面墙。'] }],
  },
  {
    id: 's5', kind: 'side', world: 'abyss', title: '鲸之歌',
    visible: () => S.is('abyss.power'),
    steps: [{ id: 's5.whale', text: '那头鲸还在附近。用探照灯找到它。', done: () => S.is('abyss.whale'), hints: ['它会在穹顶上方缓慢地游过。抬高探照灯。'] }],
  },
  {
    id: 's6', kind: 'side', world: 'museum', title: '镜中字',
    visible: () => S.is('museum.mirror'),
    steps: [{ id: 's6.read', text: '镜厅墙上的字是反着写的。', done: () => S.is('museum.mirrorText'), hints: ['在镜子里读它。'] }],
  },
]

/** 某任务当前步骤（全部完成返回 null） */
export function currentStep(q: Quest): QuestStep | null {
  for (const s of q.steps) if (!s.done()) return s
  return null
}

export function questDone(q: Quest) {
  return currentStep(q) === null
}

/** 当前世界的主线目标 */
export function activeObjective(world: WorldId): { quest: Quest; step: QuestStep } | null {
  // 先找本世界的主线；本世界已完成则看下一个未完成的主线（引导玩家回到列车）
  const mains = QUESTS.filter((q) => q.kind === 'main' && q.visible())
  const here = mains.find((q) => q.world === world)
  if (here) {
    const st = currentStep(here)
    if (st) return { quest: here, step: st }
  }
  for (const q of mains) {
    const st = currentStep(q)
    if (st) return { quest: q, step: st }
  }
  return null
}

/** 提示解锁所需的停留时间（秒） */
export const HINT_UNLOCK = [45, 120, 210, 300]

export function unlockedHints(step: QuestStep): number {
  const t = gameStore.getState().stepTime[step.id] ?? 0
  let n = 0
  for (let i = 0; i < step.hints.length; i++) if (t >= HINT_UNLOCK[i]) n = i + 1
  return n
}
