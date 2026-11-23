// 倒悬都市的可旋转桥段：纯逻辑（可在 Node 测试）。
// 桥段局部坐标：桥面板 y∈[-0.2,0.2]，桥面（铺装、栏杆）在 +y 一侧；桁架鳍板在 -y 一侧的两端。
// 旋转 rot（0..3）= 绕桥轴（z）旋转 rot × 90°。只有“桥面朝向玩家的脚”时才能通过：
//   正常重力：rot = 0；反重力：rot = 2。rot = 1 / 3 时桥段竖起，无处落脚。

export interface SegmentDef {
  cx: number
  /** 桥面板中心高度 */
  cy: number
  cz: number
  halfW: number
  halfL: number
  thick: number
  finH: number
  railH: number
}

export interface AABB {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
  role: 'deck' | 'fin' | 'rail'
}

/** 局部盒（x,y 平面）绕 z 旋转 rot × 90° */
function rot2(x0: number, x1: number, y0: number, y1: number, rot: number): [number, number, number, number] {
  const pts: [number, number][] = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]
  const r = ((rot % 4) + 4) % 4
  const out = pts.map(([x, y]) => {
    switch (r) {
      case 0: return [x, y]
      case 1: return [-y, x]
      case 2: return [-x, -y]
      default: return [y, -x]
    }
  })
  const xs = out.map((p) => p[0]), ys = out.map((p) => p[1])
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
}

export function segmentBoxes(d: SegmentDef, rot: number): AABB[] {
  const t = d.thick / 2
  const local: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; role: AABB['role'] }[] = [
    { x0: -d.halfW, x1: d.halfW, y0: -t, y1: t, z0: -d.halfL, z1: d.halfL, role: 'deck' },
    { x0: -d.halfW, x1: d.halfW, y0: -t - d.finH, y1: -t, z0: -d.halfL, z1: -d.halfL + 0.4, role: 'fin' },
    { x0: -d.halfW, x1: d.halfW, y0: -t - d.finH, y1: -t, z0: d.halfL - 0.4, z1: d.halfL, role: 'fin' },
    { x0: -d.halfW, x1: -d.halfW + 0.12, y0: t, y1: t + d.railH, z0: -d.halfL, z1: d.halfL, role: 'rail' },
    { x0: d.halfW - 0.12, x1: d.halfW, y0: t, y1: t + d.railH, z0: -d.halfL, z1: d.halfL, role: 'rail' },
  ]
  return local.map((b) => {
    const [x0, x1, y0, y1] = rot2(b.x0, b.x1, b.y0, b.y1, rot)
    return { x0: d.cx + x0, x1: d.cx + x1, y0: d.cy + y0, y1: d.cy + y1, z0: d.cz + b.z0, z1: d.cz + b.z1, role: b.role }
  })
}

/** 当前朝向下，某重力方向的玩家能否走过 */
export function passable(rot: number, g: 1 | -1) {
  const r = ((rot % 4) + 4) % 4
  return g > 0 ? r === 0 : r === 2
}
