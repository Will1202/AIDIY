// 世界与专用 UI 面板之间的桥（收音机、声呐）。世界加载时注册，卸载时清空。

export interface RadioBridge {
  freq: number
  setFreq(f: number): void
  /** 0..1 信号强度 */
  signal: number
  text: string
}

export interface SonarBridge {
  /** 三组目标频率是否已被照亮（显示目标波形） */
  known: boolean[]
  solved: boolean[]
  /** 玩家当前设置 */
  values: number[]
  /** 目标（仅已照亮的才显示） */
  targets: number[]
  min: number
  max: number
  set(i: number, v: number): void
  ping(): void
  powered: boolean
}

export const bridges: { radio: RadioBridge | null; sonar: SonarBridge | null } = { radio: null, sonar: null }
