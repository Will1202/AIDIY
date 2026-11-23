// 对话图执行器：节点 = 若干台词 + 可选选项；入口、台词、选项、跳转都可以依赖游戏状态。
// 选择会写入存档（choices / trust / doubt / flags），后续台词、场景与结局都会读取它们。
import { S } from '../state/store'

export type Speaker = 'conductor' | 'you' | 'radio' | 'voice' | 'narrator'

export const SPEAKER_NAME: Record<Speaker, string> = {
  conductor: '列车长',
  you: '你',
  radio: '车站广播',
  voice: '？？？',
  narrator: '',
}

export interface DLine {
  who: Speaker
  text: string | (() => string)
}

export interface DChoice {
  id: string
  text: string | (() => string)
  to: string | null
  cond?: () => boolean
  effect?: () => void
}

export interface DNode {
  lines: DLine[]
  choices?: DChoice[]
  next?: string | null | (() => string | null)
  /** 进入节点时执行 */
  effect?: () => void
}

export interface Dialogue {
  id: string
  entry: () => string
  nodes: Record<string, DNode>
}

export interface DialogueView {
  who: Speaker
  name: string
  text: string
  choices: { id: string; text: string }[] | null
}

const resolve = (t: string | (() => string)) => (typeof t === 'function' ? t() : t)

/** 一次对话的运行状态。UI 通过 view() 渲染，通过 advance() / choose() 推进。 */
export class DialogueRun {
  private nodeId: string | null
  private line = 0
  done = false
  /** 本次对话经过的节点（测试与调试用） */
  readonly trail: string[] = []

  constructor(readonly dialogue: Dialogue, start?: string) {
    this.nodeId = start ?? dialogue.entry()
    this.enter()
  }

  private get node(): DNode | null {
    return this.nodeId ? this.dialogue.nodes[this.nodeId] ?? null : null
  }

  private enter() {
    const n = this.node
    if (!n) {
      this.done = true
      return
    }
    this.trail.push(this.nodeId!)
    this.line = 0
    n.effect?.()
    if (n.lines.length === 0 && !this.availableChoices()) this.follow()
  }

  private availableChoices() {
    const n = this.node
    if (!n?.choices) return null
    const c = n.choices.filter((x) => !x.cond || x.cond())
    return c.length ? c : null
  }

  private follow() {
    const n = this.node
    if (!n) {
      this.done = true
      return
    }
    const nx = typeof n.next === 'function' ? n.next() : n.next
    if (nx) {
      this.nodeId = nx
      this.enter()
    } else {
      this.done = true
      this.nodeId = null
    }
  }

  view(): DialogueView | null {
    const n = this.node
    if (this.done || !n) return null
    const atChoices = this.line >= n.lines.length - 1
    const l = n.lines[Math.min(this.line, n.lines.length - 1)]
    const ch = atChoices ? this.availableChoices() : null
    if (!l) {
      return { who: 'you', name: SPEAKER_NAME.you, text: '', choices: ch ? ch.map((c) => ({ id: c.id, text: resolve(c.text) })) : null }
    }
    return { who: l.who, name: SPEAKER_NAME[l.who], text: resolve(l.text), choices: ch ? ch.map((c) => ({ id: c.id, text: resolve(c.text) })) : null }
  }

  /** 推进到下一句（有选项时无效） */
  advance() {
    const n = this.node
    if (this.done || !n) return
    if (this.line < n.lines.length - 1) {
      this.line++
      return
    }
    if (this.availableChoices()) return
    this.follow()
  }

  choose(id: string) {
    const n = this.node
    const c = this.availableChoices()?.find((x) => x.id === id)
    if (!n || !c) return false
    S.choose(`${this.dialogue.id}/${this.nodeId}`, c.id)
    c.effect?.()
    if (c.to) {
      this.nodeId = c.to
      this.enter()
    } else {
      this.done = true
      this.nodeId = null
    }
    return true
  }
}
