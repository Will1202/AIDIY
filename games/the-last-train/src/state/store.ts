// 游戏状态（可序列化、可存档）+ 设置 + 跨周目的元数据。
// 规则：所有玩法进度都写进 flags / inventory 等字段，世界在加载时完全由这些字段重建，刷新页面不丢进度。
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { EndingId, MomentId, WorldId } from '../game/types'
import type { QualityLevel } from '../engine/quality'
import { kvDelete, kvGet, kvSet } from './save'

export const SAVE_VERSION = 3

export type FlagValue = number | boolean | string

export interface PlayerSnap {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  g: 1 | -1
}

export interface GameData {
  version: number
  world: WorldId
  /** 存档时玩家是否在车厢里 */
  aboard: boolean
  player: PlayerSnap | null
  flags: Record<string, FlagValue>
  inventory: string[]
  archives: string[]
  read: string[]
  collectibles: string[]
  visited: WorldId[]
  /** 对话选择记录：dialogueId/nodeId → 选项 id */
  choices: Record<string, string>
  /** 叙事倾向：信任 / 怀疑 */
  trust: number
  doubt: number
  playTime: number
  /** 每个任务步骤已停留的时间（秒），用于逐级解锁提示 */
  stepTime: Record<string, number>
  hintsUsed: number
  ending: EndingId | null
}

export interface Meta {
  endings: EndingId[]
  moments: MomentId[]
  /** 已到达过的章节（章节记录） */
  chapters: WorldId[]
  /** 每个章节开始时的状态快照（章节记录 / 重新开始本章） */
  checkpoints: Partial<Record<WorldId, GameData>>
}

export interface Settings {
  sensitivity: number
  invertY: boolean
  fov: number
  quality: QualityLevel | null
  master: number
  music: number
  ambience: number
  sfx: number
  muted: boolean
  headBob: boolean
  subtitleSize: number
  showFps: boolean
}

export const defaultSettings = (): Settings => ({
  sensitivity: 1, invertY: false, fov: 72, quality: null, master: 0.85, music: 0.7, ambience: 0.8, sfx: 0.85, muted: false,
  headBob: true, subtitleSize: 1, showFps: false,
})

export const newGameData = (): GameData => ({
  version: SAVE_VERSION, world: 'station', aboard: false, player: null, flags: {}, inventory: [], archives: [], read: [], collectibles: [],
  visited: ['station'], choices: {}, trust: 0, doubt: 0, playTime: 0, stepTime: {}, hintsUsed: 0, ending: null,
})

export const emptyMeta = (): Meta => ({ endings: [], moments: [], chapters: [], checkpoints: {} })

export const gameStore = createStore<GameData>(() => newGameData())
export const metaStore = createStore<Meta>(() => emptyMeta())
export const settingsStore = createStore<Settings>(() => defaultSettings())

export const useGameData = <T,>(sel: (s: GameData) => T) => useStore(gameStore, sel)
export const useMeta = <T,>(sel: (s: Meta) => T) => useStore(metaStore, sel)
export const useSettings = <T,>(sel: (s: Settings) => T) => useStore(settingsStore, sel)

// ---------- 读写辅助（游戏逻辑统一走这里） ----------

type Listener = (kind: 'flag' | 'item' | 'archive' | 'collectible' | 'any', id: string) => void
const listeners = new Set<Listener>()
export const onStateChange = (l: Listener) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const emit = (kind: Parameters<Listener>[0], id: string) => {
  for (const l of listeners) l(kind, id)
  markDirty()
}

export const S = {
  get: () => gameStore.getState(),
  flag(k: string): FlagValue | undefined {
    return gameStore.getState().flags[k]
  },
  is(k: string): boolean {
    return !!gameStore.getState().flags[k]
  },
  num(k: string, d = 0): number {
    const v = gameStore.getState().flags[k]
    return typeof v === 'number' ? v : d
  },
  set(k: string, v: FlagValue = true) {
    const s = gameStore.getState()
    if (s.flags[k] === v) return
    gameStore.setState({ flags: { ...s.flags, [k]: v } })
    emit('flag', k)
  },
  has(item: string) {
    return gameStore.getState().inventory.includes(item)
  },
  give(item: string) {
    const s = gameStore.getState()
    if (s.inventory.includes(item)) return false
    gameStore.setState({ inventory: [...s.inventory, item] })
    emit('item', item)
    return true
  },
  take(item: string) {
    const s = gameStore.getState()
    if (!s.inventory.includes(item)) return false
    gameStore.setState({ inventory: s.inventory.filter((i) => i !== item) })
    emit('item', item)
    return true
  },
  addArchive(id: string) {
    const s = gameStore.getState()
    if (s.archives.includes(id)) return false
    gameStore.setState({ archives: [...s.archives, id] })
    emit('archive', id)
    return true
  },
  markRead(id: string) {
    const s = gameStore.getState()
    if (s.read.includes(id)) return
    gameStore.setState({ read: [...s.read, id] })
    emit('archive', id)
  },
  collect(id: string) {
    const s = gameStore.getState()
    if (s.collectibles.includes(id)) return false
    gameStore.setState({ collectibles: [...s.collectibles, id] })
    emit('collectible', id)
    return true
  },
  choose(key: string, choice: string) {
    const s = gameStore.getState()
    gameStore.setState({ choices: { ...s.choices, [key]: choice } })
    emit('any', key)
  },
  addTrust(n: number) {
    gameStore.setState({ trust: gameStore.getState().trust + n })
    emit('any', 'trust')
  },
  addDoubt(n: number) {
    gameStore.setState({ doubt: gameStore.getState().doubt + n })
    emit('any', 'doubt')
  },
  visit(w: WorldId) {
    const s = gameStore.getState()
    if (!s.visited.includes(w)) gameStore.setState({ visited: [...s.visited, w] })
    const m = metaStore.getState()
    if (!m.chapters.includes(w)) metaStore.setState({ chapters: [...m.chapters, w] })
    emit('any', 'visit')
  },
}

export const Meta = {
  seeMoment(id: MomentId) {
    const m = metaStore.getState()
    if (m.moments.includes(id)) return
    metaStore.setState({ moments: [...m.moments, id] })
    markDirty()
  },
  reachEnding(id: EndingId) {
    const m = metaStore.getState()
    if (!m.endings.includes(id)) metaStore.setState({ endings: [...m.endings, id] })
    markDirty()
  },
  checkpoint(w: WorldId, data: GameData) {
    const m = metaStore.getState()
    metaStore.setState({ checkpoints: { ...m.checkpoints, [w]: JSON.parse(JSON.stringify(data)) as GameData } })
    markDirty()
  },
}

// ---------- 自动存档 ----------

let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 存档前由游戏总控填入玩家位置等实时数据 */
let beforeSave: (() => void) | null = null
export const setBeforeSave = (fn: (() => void) | null) => { beforeSave = fn }
let autosaveEnabled = false
export const setAutosave = (on: boolean) => { autosaveEnabled = on }
const saveListeners = new Set<() => void>()
export const onSaved = (fn: () => void) => {
  saveListeners.add(fn)
  return () => saveListeners.delete(fn)
}

export function markDirty() {
  dirty = true
  if (!autosaveEnabled) return
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNow()
  }, 1200)
}

export async function saveNow() {
  if (!autosaveEnabled) return
  beforeSave?.()
  dirty = false
  await Promise.all([kvSet('save', gameStore.getState()), kvSet('meta', metaStore.getState())])
  for (const f of saveListeners) f()
}

export const isDirty = () => dirty

export async function saveSettings() {
  await kvSet('settings', settingsStore.getState())
}

/** 迁移旧版本存档：缺失字段补默认值 */
export function migrate(d: Partial<GameData>): GameData | null {
  if (!d || typeof d !== 'object' || !d.world) return null
  const base = newGameData()
  const out = { ...base, ...d, version: SAVE_VERSION } as GameData
  out.flags = { ...(d.flags ?? {}) }
  return out
}

export async function loadAll() {
  const [save, meta, settings] = await Promise.all([kvGet<GameData>('save'), kvGet<Meta>('meta'), kvGet<Settings>('settings')])
  if (meta) metaStore.setState({ ...emptyMeta(), ...meta })
  if (settings) settingsStore.setState({ ...defaultSettings(), ...settings })
  const g = save ? migrate(save) : null
  return { hasSave: !!(g && g.flags['game.started']), save: g }
}

export async function resetEverything() {
  gameStore.setState(newGameData(), true)
  metaStore.setState(emptyMeta(), true)
  await Promise.all([kvDelete('save'), kvDelete('meta')])
}

export async function deleteSave() {
  gameStore.setState(newGameData(), true)
  await kvDelete('save')
}
