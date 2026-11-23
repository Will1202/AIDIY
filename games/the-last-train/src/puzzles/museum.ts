// 记忆博物馆的纯逻辑：基座组合、错视对齐、影子雕塑角度。
export const PEDESTALS = [
  { key: '最初', en: 'BEGINNING', item: 'toy_train' },
  { key: '离别', en: 'PARTING', item: 'umbrella' },
  { key: '等待', en: 'WAITING', item: 'wristwatch' },
] as const

export const MEMORY_ITEMS = PEDESTALS.map((p) => p.item) as string[]

export function pedestalsSolved(placed: (string | undefined)[]) {
  return PEDESTALS.every((p, i) => placed[i] === p.item)
}

/** 错视：玩家眼睛离观察点足够近，且视线方向与目标方向夹角足够小 */
export function anamorphAligned(eye: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, spot: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, posTol = 0.55, angTol = 0.1) {
  const d = Math.hypot(eye.x - spot.x, eye.z - spot.z)
  if (d > posTol || Math.abs(eye.y - spot.y) > 0.5) return false
  const dl = Math.hypot(dir.x, dir.y, dir.z), fl = Math.hypot(fwd.x, fwd.y, fwd.z)
  const c = (fwd.x * dir.x + fwd.y * dir.y + fwd.z * dir.z) / (dl * fl)
  return c > Math.cos(angTol)
}

/** 影子雕塑：转台角度与解的角度差（弧度，取最短） */
export function angleError(theta: number, solution: number) {
  let d = (theta - solution) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}

/** 3×5 点阵字体（影子里显示的“00:00”） */
export const PIXEL_FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  ':': ['0', '1', '0', '1', '0'],
}

export function pixelText(text: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  let cx = 0
  for (const ch of text) {
    const g = PIXEL_FONT[ch]
    if (!g) continue
    for (let r = 0; r < 5; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === '1') out.push({ x: cx + c, y: 4 - r })
    cx += g[0].length + 1
  }
  return out
}
