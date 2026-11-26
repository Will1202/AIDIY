// 世界基类：每个世界拥有自己的根节点、碰撞体、可交互物体、触发区、环境参数与生命周期。
// 坐标约定：列车固定在场景原点、车身沿 +X、车门朝 +Z。世界在停靠时根节点为单位矩阵，
// 因此世界局部坐标 = 场景坐标；列车行驶时移动的是世界根节点（玩家始终处在静止的车厢里）。
import { Color, Group, Matrix4, Object3D, Scene, Vector3 } from 'three'
import { CollisionWorld } from '../physics/collision'
import type { FxState } from '../engine/pipeline'
import type { QualityPreset } from '../engine/quality'
import type { WorldId } from '../game/types'
import { disposeTree } from './shared/kit'
import type { GameApi } from '../game/api'

export interface Interactable {
  id: string
  /** 世界局部坐标（列车交互物体为车厢坐标） */
  pos: Vector3
  radius: number
  /** 最大交互距离 */
  range?: number
  label: string | (() => string)
  verb: string | (() => string)
  enabled?: () => boolean
  /** 不满足时显示为灰色提示（例如“需要：重力电池”） */
  blocked?: () => string | null
  use: () => void
  /** 高亮的物体 */
  highlight?: Object3D | null
  /** 只在某一重力方向下可用 */
  gravity?: 1 | -1
  /** 按住型交互（时间倒转）：返回提示文字 */
  key?: 'E' | 'R' | 'F'
}

export interface Trigger {
  id: string
  min: Vector3
  max: Vector3
  once?: boolean
  fired?: boolean
  inside?: boolean
  enter?: () => void
  exit?: () => void
  stay?: (dt: number) => void
}

export interface WorldEnv {
  background: Color
  fogColor: Color
  fogDensity: number
  fx: Partial<FxState>
  score: WorldId | 'none'
  /** 0..1：声音是否“通透”（深海里会闷） */
  openness: number
  /** 车厢灯光倍率：白天的世界里车厢灯要暗一些，否则车内过曝 */
  interior?: number
}

export abstract class World {
  abstract readonly id: WorldId
  readonly root = new Group()
  readonly col = new CollisionWorld()
  readonly items: Interactable[] = []
  readonly triggers: Trigger[] = []
  env: WorldEnv = { background: new Color(0x05070a), fogColor: new Color(0x0a0e14), fogDensity: 0.02, fx: {}, score: 'none', openness: 1 }
  /** 驶入：距离（米）与时长（秒） */
  approachLength = 520
  approachTime = 20
  departLength = 520
  departTime = 13
  /** 读档时玩家不在车上的默认位置 */
  spawn = { x: 0, y: 1, z: 4, yaw: 0 }
  /** 掉出世界的高度（u 空间） */
  fallLimit = -30
  protected game!: GameApi
  protected q!: QualityPreset
  private disposers: (() => void)[] = []
  built = false

  init(game: GameApi, q: QualityPreset) {
    this.game = game
    this.q = q
    this.root.name = `world:${this.id}`
  }

  abstract build(): Promise<void>

  /** 环境贴图场景（PMREM），返回 null 使用默认 */
  envScene(): Scene | null {
    return null
  }

  update(_dt: number, _t: number): void {}

  /** 主渲染之前（平面反射等） */
  preRender(_renderer: import('three').WebGLRenderer, _camera: import('three').PerspectiveCamera): void {}

  /**
   * 列车在世界中的位姿：s < 0 驶入中，s = 0 停靠，s > 0 驶出中。
   * 默认沿 +X 直线行驶；世界可以覆写成弯道、下潜、环线。
   */
  trackPose(s: number, out: Matrix4): Matrix4 {
    return out.makeTranslation(s, 0, 0)
  }

  /** 驶入进度 0..1（标志性时刻在这里驱动） */
  onApproach(_p: number, _dt: number): void {}
  onDocked(): void {}
  onDepart(): void {}
  /** 驶出进度 0..1 */
  onDepartProgress(_p: number, _dt: number): void {}

  /** 注册清理函数（事件监听、音频循环……），卸载时统一释放 */
  protected own(fn: () => void) {
    this.disposers.push(fn)
  }

  item(i: Interactable) {
    this.items.push(i)
    return i
  }

  trigger(t: Trigger) {
    this.triggers.push(t)
    return t
  }

  dispose() {
    for (const d of this.disposers.splice(0)) {
      try { d() } catch { /* 已释放 */ }
    }
    disposeTree(this.root)
    this.root.removeFromParent()
    this.items.length = 0
    this.triggers.length = 0
  }
}

export const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z)
