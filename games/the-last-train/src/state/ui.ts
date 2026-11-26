// 界面状态（不存档）：由游戏总控写入，React 组件订阅。
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DialogueView } from '../systems/dialogue'
import type { EndingId, MomentId, WorldId } from '../game/types'

export type Screen = 'boot' | 'menu' | 'loading' | 'play' | 'pause' | 'ending' | 'credits'
export type PauseTab = 'journal' | 'inventory' | 'archives' | 'map' | 'settings' | 'collect'
export type MenuPanel = null | 'chapters' | 'settings' | 'credits' | 'showcase' | 'confirmNew' | 'confirmReset'

export interface Toast {
  id: number
  kind: 'item' | 'objective' | 'archive' | 'info' | 'collect' | 'save'
  title: string
  text?: string
}

export interface Subtitle {
  id: number
  who: string
  text: string
  until: number
}

export interface Prompt {
  key: string
  verb: string
  label: string
  /** 不可用时的说明（例如“需要：重力电池”） */
  note?: string
  disabled?: boolean
}

export interface UIState {
  screen: Screen
  menuPanel: MenuPanel
  pauseTab: PauseTab
  hasSave: boolean
  loadingText: string
  prompt: Prompt | null
  /** 目标物体在屏幕上的位置（0..1），用于把交互提示贴在物体旁 */
  promptAt: { x: number; y: number } | null
  toasts: Toast[]
  subtitles: Subtitle[]
  dialogue: DialogueView | null
  /** 正在阅读：档案 / 告示 / 展签 */
  reading: { title: string; sub?: string; body: string[]; kind: 'archive' | 'note' | 'plaque' | 'mirror' } | null
  /** 正在查看的物品（3D 预览） */
  inspecting: string | null
  keypad: { id: string; digits: number[]; title: string } | null
  sonar: boolean
  radio: boolean
  /** 操纵模式提示（拖动探照灯、转动雕塑） */
  manipulate: string | null
  cinema: boolean
  photo: boolean
  letterbox: boolean
  fps: number
  world: WorldId
  ending: EndingId | null
  endingLines: string[]
  showcase: MomentId | null
  /** 时间能力 HUD（沙漠） */
  timeHud: { target: string | null; state: 'run' | 'pause' | 'rewind' | null } | null
  hint: string | null
  /** 章节标题卡 */
  chapterCard: { index: number; name: string; en: string } | null
  /** 开场后的操作说明卡 */
  controlsCard: boolean
  touch: boolean
  pointerLocked: boolean
  /** 移动端：是否显示虚拟按键 */
  saveFlash: number
  /** 正在播放过场（隐藏“点击画面继续”等） */
  cutscene: boolean
}

export const uiStore = createStore<UIState>(() => ({
  screen: 'boot', menuPanel: null, pauseTab: 'journal', hasSave: false, loadingText: '', prompt: null, promptAt: null, toasts: [], subtitles: [],
  dialogue: null, reading: null, inspecting: null, keypad: null, sonar: false, radio: false, manipulate: null, cinema: false, photo: false,
  letterbox: false, fps: 0, world: 'station', ending: null, endingLines: [], showcase: null, timeHud: null, hint: null, chapterCard: null,
  touch: false, pointerLocked: false, saveFlash: 0, cutscene: false, controlsCard: false,
}))

export const useUI = <T,>(sel: (s: UIState) => T) => useStore(uiStore, sel)
export const ui = () => uiStore.getState()
export const setUI = (p: Partial<UIState>) => uiStore.setState(p)

let toastId = 1
export function toast(kind: Toast['kind'], title: string, text?: string, ms = 4200) {
  const t: Toast = { id: toastId++, kind, title, text }
  uiStore.setState((s) => ({ toasts: [...s.toasts.slice(-3), t] }))
  setTimeout(() => uiStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), ms)
}

let subId = 1
/** 字幕：who 为空表示环境字幕 */
export function subtitle(who: string, text: string, seconds = 4) {
  const s: Subtitle = { id: subId++, who, text, until: performance.now() + seconds * 1000 }
  uiStore.setState((st) => ({ subtitles: [...st.subtitles.filter((x) => x.until > performance.now()).slice(-1), s] }))
  setTimeout(() => uiStore.setState((st) => ({ subtitles: st.subtitles.filter((x) => x.id !== s.id) })), seconds * 1000)
}
