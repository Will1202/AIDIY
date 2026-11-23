// 本地分支剧情（全部原创，离线可玩）。入口节点由游戏状态决定，选项会改变信任 / 怀疑与后续台词。
import type { Dialogue } from '../systems/dialogue'
import { S, gameStore } from '../state/store'

const asked = (k: string) => S.is(`ask.${k}`)
const ask = (k: string) => () => S.set(`ask.${k}`)
const placedCount = () => ['fragment_city', 'fragment_abyss', 'fragment_desert', 'fragment_museum'].filter((f) => S.is(`console.${f}`)).length

// ---------------- 站台上的列车长 ----------------
export const CONDUCTOR_STATION: Dialogue = {
  id: 'cs',
  entry: () => {
    if (S.is('station.boardOk')) return 'waiting'
    if (S.is('ticket.punched') && S.has('ticket')) return 'punched'
    if (S.has('ticket')) return S.is('cs.met') ? 'menu' : 'intro'
    return 'noTicket'
  },
  nodes: {
    noTicket: {
      lines: [
        { who: 'conductor', text: '……你醒了。' },
        { who: 'conductor', text: '这班车的每一位乘客，都要先有一张票。' },
        { who: 'conductor', text: '你醒来的那条长椅上，有一张是你的。' },
      ],
    },
    intro: {
      effect: () => S.set('cs.met'),
      lines: [
        { who: 'conductor', text: '末班 0000 次，零号站台。' },
        { who: 'conductor', text: '请出示车票。' },
        { who: 'narrator', text: '（列车长接过车票，对着车厢里的光看了很久，又还给你。）' },
        { who: 'conductor', text: '这张票还没检过。没检过的票，上不了车。' },
      ],
      next: 'menu',
    },
    menu: {
      lines: [{ who: 'conductor', text: () => (S.is('cs.menu') ? '还有什么想问的？' : '你有问题。每个人都有。') }],
      effect: () => S.set('cs.menu'),
      choices: [
        { id: 'where', text: '这班车开往哪里？', to: 'where', effect: ask('where') },
        { id: 'who', text: '你是谁？', to: 'who', cond: () => !asked('who'), effect: ask('who') },
        { id: 'why', text: '我为什么会在这里？', to: 'why', cond: () => !asked('why'), effect: ask('why') },
        { id: 'clock', text: '站台上的钟坏了。', to: 'clock', cond: () => S.is('station.clock') && !asked('clock'), effect: ask('clock') },
        { id: 'go', text: '我去找检票的东西。', to: 'go' },
      ],
    },
    where: {
      lines: [
        { who: 'conductor', text: '终点站。' },
        { who: 'you', text: '可票上没写目的地。' },
        { who: 'conductor', text: '所有车都有终点。只是有些终点，还没有被写上。' },
      ],
      next: 'menu',
    },
    who: {
      lines: [
        { who: 'conductor', text: '列车长。' },
        { who: 'conductor', text: '这班车只有一位列车长，每个夜晚也只有一位乘客。' },
      ],
      next: 'menu',
    },
    why: {
      lines: [
        { who: 'conductor', text: '每天夜里的 00:00，都会有一个人在那条长椅上醒来。' },
        { who: 'conductor', text: '今天是你。' },
      ],
      next: 'menu',
    },
    clock: {
      lines: [
        { who: 'conductor', text: '它没坏。它只是不肯往前走。' },
        { who: 'conductor', text: '你多看它一会儿，它也许会告诉你，它原本想停在哪一分钟。' },
      ],
      next: 'menu',
    },
    go: {
      lines: [{ who: 'conductor', text: '去吧。车站里总有人落下东西——储物柜、售票窗口，都看一看。' }],
    },
    punched: {
      lines: [
        { who: 'narrator', text: '（列车长接过车票，用拇指摸了摸那个月牙形的孔。）' },
        { who: 'conductor', text: '很好。' },
        { who: 'conductor', text: '上车以后就不能半路下车了。除非列车到站。' },
      ],
      choices: [
        { id: 'ready', text: '我准备好了。', to: 'ready', effect: () => S.addTrust(1) },
        { id: 'refuse', text: '如果我不上车呢？', to: 'refuse', effect: () => S.addDoubt(1) },
      ],
    },
    ready: {
      effect: () => S.set('station.boardOk'),
      lines: [{ who: 'conductor', text: '那就请上车。车门会为你开着。' }],
    },
    refuse: {
      effect: () => S.set('station.boardOk'),
      lines: [
        { who: 'conductor', text: '那你会在这条长椅上，再醒来一次。' },
        { who: 'conductor', text: '然后再一次。' },
        { who: 'narrator', text: '（列车长侧身让开了车门。）' },
      ],
    },
    waiting: {
      lines: [{ who: 'conductor', text: () => (S.num('travel.count') > 0 ? '列车会等你。它一直在等。' : '车门会为你开着。') }],
    },
  },
}

// ---------------- 车厢里的列车长（随进度变化） ----------------
export const CONDUCTOR_TRAIN: Dialogue = {
  id: 'ct',
  entry: () => {
    const s = gameStore.getState()
    const w = s.world
    const placed = placedCount()
    if (S.is('museum.mirror') && !S.is('ct.mirrorTalk')) return 'afterMirror'
    if (placed >= 4) return 'toTerminus'
    for (const f of ['fragment_city', 'fragment_abyss', 'fragment_desert', 'fragment_museum']) if (S.has(f)) return 'placeFrag'
    if (S.is('console.fragment_desert') && !S.is('ct.afterDesert')) return 'afterDesert'
    if (S.is('console.fragment_abyss') && !S.is('ct.afterAbyss')) return 'afterAbyss'
    if (S.is('console.fragment_city') && !S.is('ct.afterCity')) return 'afterCity'
    if (w === 'station') return 'toCity'
    if (w === 'city') return 'inCity'
    if (w === 'abyss') return 'inAbyss'
    if (w === 'desert') return 'inDesert'
    if (w === 'museum') return 'inMuseum'
    return 'idle'
  },
  nodes: {
    toCity: {
      lines: [
        { who: 'conductor', text: '第一次坐这班车的人，都会先看窗外。' },
        { who: 'conductor', text: '下一站，倒悬都市。到了那里，记得抬头。' },
      ],
      choices: [
        { id: 'dest', text: '这辆车到底要去哪？', to: 'dest' },
        { id: 'back', text: '我还能回到车站吗？', to: 'back' },
      ],
    },
    dest: { lines: [{ who: 'conductor', text: '去它一直想去的地方。路线控制台会告诉你，它还差几段路。' }] },
    back: { lines: [{ who: 'conductor', text: '你随时可以回去。车站一直都在，钟也一直停着。' }] },
    inCity: {
      lines: [
        { who: 'conductor', text: '这座城市没有坏。它只是忘了哪边是上。' },
        { who: 'conductor', text: () => (S.is('city.inverted') ? '你已经站到天上去过了。那里的风景，和下面一样吗？' : '如果路断了，就换一个方向走。') },
      ],
    },
    afterCity: {
      effect: () => S.set('ct.afterCity'),
      lines: [{ who: 'conductor', text: '你看见那座城市了吗？倒挂在天上的那一座。' }],
      choices: [
        { id: 'flip', text: '它只是翻了过来。', to: 'flip', effect: () => S.addTrust(1) },
        { id: 'fake', text: '那都不是真的。', to: 'fake', effect: () => S.addDoubt(1) },
      ],
    },
    flip: { lines: [{ who: 'conductor', text: '对。很多东西都只是翻了过来，并没有坏。' }, { who: 'conductor', text: '下一站在很深的地方。那里很暗，别怕。' }] },
    fake: { lines: [{ who: 'conductor', text: '真不真，要看你站在哪一边。' }, { who: 'conductor', text: '下一站在很深的地方。那里很暗。' }] },
    inAbyss: {
      lines: [
        { who: 'conductor', text: '深海里很安静。安静到能听见一个人在等待的声音。' },
        { who: 'conductor', text: () => (S.is('abyss.power') ? '灯亮了。那些石碑一直在唱歌，只是以前没有人听。' : '观测站没有电很久了。值班的人走之前，把备用件收得很好。') },
      ],
    },
    afterAbyss: {
      effect: () => S.set('ct.afterAbyss'),
      lines: [{ who: 'conductor', text: '那艘沉船……你看见了。' }],
      choices: [
        { id: 'car', text: '那不是船，是一节车厢。', to: 'car', effect: () => S.addTrust(1) },
        { id: 'none', text: '我什么都没看见。', to: 'none', effect: () => S.addDoubt(1) },
      ],
    },
    car: { lines: [{ who: 'conductor', text: '这班车开了很久很久。总有几节车厢，沉在了半路上。' }, { who: 'conductor', text: '下一站，时间沙漠。那里什么都不会动——除了你。' }] },
    none: { lines: [{ who: 'conductor', text: '那就好。' }, { who: 'conductor', text: '下一站，时间沙漠。那里什么都不会动。' }] },
    inDesert: {
      lines: [
        { who: 'conductor', text: '这里的时间，是被人亲手停下来的。' },
        { who: 'conductor', text: () => (S.has('watch') ? '你手里那块怀表……你也许认识它。' : '营地里有一块表还在走。去把它拿起来。') },
      ],
    },
    afterDesert: {
      effect: () => S.set('ct.afterDesert'),
      lines: [{ who: 'conductor', text: '你把时间握在手里了。' }],
      choices: [
        { id: 'who', text: '是谁把时间停下来的？', to: 'whoStop', effect: () => S.addTrust(1) },
        { id: 'restart', text: '我可以让它重新走起来。', to: 'restart', effect: () => S.addDoubt(1) },
      ],
    },
    whoStop: { lines: [{ who: 'conductor', text: '一个不想错过末班车的人。' }, { who: 'conductor', text: '下一站是博物馆。那里收着的，都是不肯离开的东西。' }] },
    restart: { lines: [{ who: 'conductor', text: '可以。但钟一走，有些人就再也等不到了。' }, { who: 'conductor', text: '下一站是博物馆。' }] },
    inMuseum: {
      lines: [
        { who: 'conductor', text: '博物馆里收着的，都是不肯离开的东西。' },
        { who: 'conductor', text: '我在那里……也放过几样。' },
      ],
    },
    afterMirror: {
      effect: () => S.set('ct.mirrorTalk'),
      lines: [
        { who: 'conductor', text: '你看到了。' },
        { who: 'narrator', text: '（列车长第一次抬起头。帽檐下的那张脸，你每天早上都在镜子里见过。）' },
      ],
      choices: [
        { id: 'me', text: '你就是我。', to: 'me', effect: () => { S.set('knowTruth'); S.addTrust(1) } },
        { id: 'whyNot', text: '为什么不早点告诉我？', to: 'whyNot', effect: () => { S.set('knowTruth'); S.addDoubt(1) } },
        { id: 'silent', text: '……', to: 'silent', effect: () => S.set('knowTruth') },
      ],
    },
    me: {
      lines: [
        { who: 'conductor', text: '是很多个夜晚以前的你。' },
        { who: 'conductor', text: '那晚我错过了末班车。等我的人，在终点站等了一整夜。' },
        { who: 'conductor', text: '所以我留了下来，开着这班车，一遍又一遍。我想准时到一次。' },
      ],
    },
    whyNot: { lines: [{ who: 'conductor', text: '有些路，要自己走一遍才算数。' }, { who: 'conductor', text: '我说了，你也不会信。我当年就不信。' }] },
    silent: { lines: [{ who: 'conductor', text: '没关系。我当年也说不出话。' }] },
    placeFrag: {
      lines: [{ who: 'conductor', text: '碎片会记得回去的路。把它放进前面的路线控制台。' }],
    },
    toTerminus: {
      lines: [
        { who: 'conductor', text: () => (S.is('terminus.arrived') ? '终点就在外面。我在站台上等你。' : '四枚碎片都回来了。控制台上的那一站，亮了。') },
        { who: 'conductor', text: () => (S.is('terminus.arrived') ? '不着急。' : '我开了这么多年，第一次看见它亮着。') },
      ],
    },
    idle: {
      lines: [{ who: 'conductor', text: '列车会等你。' }],
    },
  },
}

// ---------------- 终点站台 ----------------
export const CONDUCTOR_TERMINUS: Dialogue = {
  id: 'cf',
  entry: () => (S.is('terminus.talked') ? 'again' : 'final'),
  nodes: {
    final: {
      effect: () => S.set('terminus.talked'),
      lines: [
        { who: 'conductor', text: '到了。' },
        { who: 'conductor', text: '这里就是终点站。它从来没有存在过——因为我一次也没有到过这里。' },
        { who: 'conductor', text: () => (S.is('knowTruth') ? '你知道我是谁，也知道那天晚上发生了什么。' : '你大概还有很多不明白的事。没关系，终点不需要都明白。') },
        { who: 'conductor', text: () => (gameStore.getState().trust >= gameStore.getState().doubt ? '这一路，谢谢你愿意相信我。' : '这一路你一直在怀疑。这很好，我当年就是太相信那座钟了。') },
        { who: 'conductor', text: '现在，轮到你选了。' },
      ],
      next: 'choose',
    },
    again: { lines: [{ who: 'conductor', text: '想好了吗？' }], next: 'choose' },
    choose: {
      lines: [],
      choices: [
        { id: 'leave', text: '我想下车。', to: 'leave', cond: () => !S.is('ticket.final') },
        { id: 'stay', text: '我留下来，替你开这班车。', to: 'stay', cond: () => !S.is('terminus.capOffered') },
        {
          id: 'clock', text: '钟还能再走一分钟。', to: 'clock',
          cond: () => S.has('hands') && S.has('first_ticket') && !S.is('terminus.clockOk'),
        },
        { id: 'wait', text: '我还没想好。', to: 'wait' },
      ],
    },
    leave: {
      effect: () => S.set('ticket.final'),
      lines: [
        { who: 'narrator', text: '（列车长从上衣口袋里拿出一支笔，在你车票的目的地一栏写下：「终点站」。）' },
        { who: 'conductor', text: '出站口在站台另一头。走出去，就别回头。' },
      ],
    },
    stay: {
      effect: () => S.set('terminus.capOffered'),
      lines: [
        { who: 'narrator', text: '（列车长摘下帽子。帽子底下的头发，已经白了。）' },
        { who: 'conductor', text: '帽子我放在驾驶室的座位上了。想好了，就去拉下发车杆。' },
        { who: 'conductor', text: '记得每天夜里，给下一个人留一盏灯。' },
      ],
    },
    clock: {
      effect: () => S.set('terminus.clockOk'),
      lines: [
        { who: 'conductor', text: '……你找到了指针。还有那张票。' },
        { who: 'conductor', text: '如果钟走到 00:01，这班车就再也不会回到零号站台了。我也不会。' },
        { who: 'conductor', text: '可是那个人，也就不用再等了。' },
        { who: 'conductor', text: '去吧。大钟就在站台中央。' },
      ],
    },
    wait: { lines: [{ who: 'conductor', text: '列车会等你。它一直都在等。' }] },
  },
}

export const DIALOGUES: Record<string, Dialogue> = { cs: CONDUCTOR_STATION, ct: CONDUCTOR_TRAIN, cf: CONDUCTOR_TERMINUS }
