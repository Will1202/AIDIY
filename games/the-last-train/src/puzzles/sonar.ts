// 深海声呐谜题：三座声碑各有一个目标频率。被探照灯照亮后，声呐屏上才显示它的回声波形。
// 玩家可以靠“看”（波形重合）或“听”（拍音变慢直至消失）把频率调准。
export const SONAR = {
  min: 80,
  max: 700,
  /** G3 · D#4 · A#4：一个悬而未决的和弦 */
  targets: [196, 311, 466] as const,
  tol: 4,
}

export const matches = (v: number, i: number) => Math.abs(v - SONAR.targets[i]) <= SONAR.tol

/** 拍频：两个频率之差（Hz），越小越接近 */
export const beat = (v: number, i: number) => Math.abs(v - SONAR.targets[i])

/** 探照灯是否照中某个目标：光束方向与目标方向夹角小于 halfAngle */
export function inBeam(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, halfAngle: number) {
  const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z
  const l = Math.hypot(dx, dy, dz)
  const dl = Math.hypot(dir.x, dir.y, dir.z)
  const c = (dx * dir.x + dy * dir.y + dz * dir.z) / (l * dl)
  return c > Math.cos(halfAngle)
}
