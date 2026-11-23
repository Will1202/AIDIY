// 世界与游戏总控之间的接口。世界只通过它影响游戏（字幕、拾取、对话、过场、重力……），
// 因此测试里可以用一个无渲染的实现替换，直接在 Node 里跑通关流程。
import type { PerspectiveCamera, Vector3 } from 'three'
import type { FxState } from '../engine/pipeline'
import type { AudioEngine, Sfx } from '../audio/AudioEngine'
import type { EndingId, MomentId } from './types'
import type { Body } from '../physics/collision'
import type { Train } from '../world/shared/Train'
import type { Conductor } from '../world/shared/Conductor'

export interface Shot {
  /** 时长（秒） */
  dur: number
  /** 相机位置关键点（场景坐标），按时间均匀插值（Catmull-Rom） */
  from: Vector3[]
  /** 注视点关键点 */
  look: Vector3[]
  fov?: [number, number]
  ease?: 'linear' | 'inOut' | 'out' | 'in'
  /** 每帧回调：p 为 0..1 */
  tick?: (p: number, dt: number) => void
  /** 开始时回调 */
  start?: () => void
  roll?: [number, number]
}

export interface Note {
  title: string
  sub?: string
  body: string[]
  kind?: 'archive' | 'note' | 'plaque' | 'mirror'
}

export interface PlayerApi {
  body: Body
  /** 重力方向 */
  g: 1 | -1
  yaw: number
  pitch: number
  readonly eye: Vector3
  readonly forward: Vector3
  flipGravity(axisYaw?: number): void
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void
  /** 锁定移动（过场、操纵模式） */
  locked: boolean
  /** 玩家正注视的方向与某点的夹角余弦 */
  lookDot(p: Vector3): number
}

export interface GameApi {
  readonly time: number
  readonly camera: PerspectiveCamera
  readonly fx: FxState
  readonly audio: AudioEngine
  readonly player: PlayerApi
  readonly train: Train
  readonly conductor: Conductor
  /** 键盘状态（时间能力等按住型操作） */
  readonly keys: { down(code: string): boolean; hit(code: string): boolean }
  /** 列车是否停靠（世界可交互） */
  readonly docked: boolean
  /** 当前是否在播放过场 */
  readonly inCinematic: boolean
  say(who: string, text: string, seconds?: number): void
  toast(title: string, text?: string): void
  read(note: Note): void
  pickup(item: string): void
  archive(id: string): void
  collect(id: string): void
  dialogue(id: string): void
  keypad(id: string, title: string, length: number, check: (digits: number[]) => boolean): void
  openSonar(): void
  openRadio(): void
  /** 操纵模式：鼠标移动交给 onMove，按 E / Esc 退出 */
  manipulate(label: string, onMove: (dx: number, dy: number) => void, onEnd?: () => void): void
  sfx(name: Sfx, at?: Vector3, gain?: number): void
  cinematic(shots: Shot[], opts?: { letterbox?: boolean; skippable?: boolean; keepControl?: boolean }): Promise<void>
  moment(id: MomentId): void
  ending(id: EndingId): void
  /** 闪电：点亮天空并在延迟后打雷 */
  flash(strength: number, delay?: number): void
  /** 请求立即存档 */
  save(): void
  /** 交互后刷新任务目标 */
  refresh(): void
  /** 请求列车发车（首次登车由车站世界触发） */
  requestDepart(to: import('./types').WorldId): void
  setEyes(v: number): void
  setFade(v: number, instant?: boolean): void
  /** 当前质量档位 */
  readonly renderSize: { w: number; h: number }
}
