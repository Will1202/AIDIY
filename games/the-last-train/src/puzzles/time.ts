// 时间沙漠的“时间印记物体”：纯逻辑，可在 Node 测试。
// 每个物体有一条时间线 t ∈ [0,1]（或角度），以及三种状态：
//   pause  —— 停在原地（整个世界默认如此）
//   run    —— 沿自身的“自然方向”流动（钟塔继续倒下、升降台继续上升、分针向前、时针向后）
//   rewind —— 按住 R 时逆着自然方向倒转；松开后时间重新开始流动（变为 run）—— 所以倒转之后常常要立刻按 F 暂停
export type TimeMode = 'pause' | 'run' | 'rewind'

export interface TimeObj {
  id: string
  t: number
  mode: TimeMode
  /** 自然流动速度（每秒 t 的变化，可为负） */
  rate: number
  /** 倒转速度倍率 */
  rewindK: number
  /** 是否是循环量（指针角度，单位：圈） */
  cyclic: boolean
  /** 暂停时吸附到的刻度及阈值 */
  snaps?: number[]
  snapTol?: number
}

export function makeTimeObj(id: string, t: number, rate: number, o: Partial<TimeObj> = {}): TimeObj {
  return { id, t, mode: 'pause', rate, rewindK: 1.6, cyclic: false, ...o }
}

export function stepTime(o: TimeObj, dt: number) {
  if (o.mode === 'pause') return
  const v = o.mode === 'run' ? o.rate : -o.rate * o.rewindK
  o.t += v * dt
  if (o.cyclic) o.t = ((o.t % 1) + 1) % 1
  else o.t = Math.min(1, Math.max(0, o.t))
}

export function startRewind(o: TimeObj) {
  o.mode = 'rewind'
}

/** 松开 R：时间重新开始流动 */
export function endRewind(o: TimeObj) {
  if (o.mode === 'rewind') o.mode = 'run'
}

/** F：暂停 / 恢复。暂停时若接近吸附刻度则吸附过去 */
export function togglePause(o: TimeObj) {
  if (o.mode === 'pause') {
    o.mode = 'run'
    return
  }
  o.mode = 'pause'
  snap(o)
}

export function snap(o: TimeObj) {
  if (!o.snaps) return
  for (const s of o.snaps) {
    let d = Math.abs(o.t - s)
    if (o.cyclic) d = Math.min(d, 1 - d)
    if (d <= (o.snapTol ?? 0.03)) {
      o.t = s
      return
    }
  }
}

/** 指针是否在 12 点（循环量 0） */
export const atTwelve = (o: TimeObj) => o.mode === 'pause' && (Math.abs(o.t) < 1e-6 || Math.abs(o.t - 1) < 1e-6)
