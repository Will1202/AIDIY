// 记忆博物馆长廊里的八幅画：每一幅都是这趟旅程里的一个地方（程序化绘制，带一点笔触噪声）。
// 画面坐标 u 向右、v 向上，aspect 是画布宽高比（让圆仍然是圆）。
import { fbm } from '../shared/textures'

type RGB = [number, number, number]

export const PAINTING_TITLES = ['雨夜 · 零号站台', '倒悬', '深海的鲸', '停住的时间', '回廊', '黎明之前', '隧道', '末班车']

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = clamp01(t)
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
const add = (a: RGB, b: RGB, k: number): RGB => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 斜落的雨丝：按列取随机长度与位置 */
function rain(u: number, v: number, aspect: number, dens: number) {
  const x = u * aspect * 60 + v * 9
  const col = Math.floor(x)
  const fx = x - col
  const seg = Math.floor(v * 5 + hash(col) * 5)
  return fx < 0.07 && hash(col * 13.7 + seg) > 1 - dens ? 1 : 0
}

function towers(u: number, v: number, aspect: number, fromTop: boolean, seed: number): RGB | null {
  const x = u * aspect * 5
  const k = Math.floor(x)
  const fx = x - k
  const w0 = 0.12 + hash(k + seed) * 0.2, w1 = 0.88 - hash(k + seed + 9) * 0.2
  if (fx < w0 || fx > w1) return null
  const h = 0.12 + hash(k * 3.1 + seed) * 0.28
  const y = fromTop ? 1 - v : v
  if (y > h) return null
  const tone = hash(k + seed * 2) < 0.5 ? ([0.86, 0.78, 0.66] as RGB) : ([0.55, 0.68, 0.68] as RGB)
  const wx = (fx - w0) / (w1 - w0)
  const win = (wx * 6) % 1 < 0.5 && (y * 60) % 1 < 0.5
  if (win) return hash(Math.floor(wx * 6) + Math.floor(y * 60) * 7 + k) < 0.4 ? [1.2, 0.85, 0.45] : [tone[0] * 0.55, tone[1] * 0.55, tone[2] * 0.55]
  return tone
}

export function memoryPainting(i: number, aspect: number) {
  return (u: number, v: number): RGB => {
    const n = fbm(u, v, 6, 4, 500 + i)
    let c: RGB
    switch (i) {
      case 0: {
        // 雨夜的零号站台：雨棚下一盏灯，站台黄线，斜雨
        c = mix([0.1, 0.12, 0.22], [0.24, 0.28, 0.42], v)
        if (v < 0.32) c = mix([0.16, 0.16, 0.19], [0.32, 0.3, 0.32], v / 0.32)
        if (Math.abs(v - 0.3) < 0.01) c = [0.75, 0.6, 0.2]
        if (v > 0.8) c = mix(c, [0.05, 0.05, 0.08], 0.75)
        const d = Math.hypot((u - 0.66) * aspect, v - 0.74)
        c = add(c, [1.0, 0.72, 0.38], Math.exp(-d * d * 70) * 0.9 + (d < 0.025 ? 1.2 : 0))
        const cone = v < 0.74 && v > 0.32 && Math.abs((u - 0.66) * aspect) < (0.74 - v) * 0.45
        if (cone) c = add(c, [0.35, 0.26, 0.15], 0.35)
        if (v < 0.32) c = add(c, [0.6, 0.45, 0.25], Math.exp(-(((u - 0.66) * aspect) ** 2) * 12 - (v - 0.26) ** 2 * 300) * 0.5)
        if (rain(u, v, aspect, 0.5)) c = add(c, [0.55, 0.6, 0.72], 0.6)
        break
      }
      case 1: {
        // 倒悬都市：上下两座城，中间一层云
        c = v > 0.5 ? mix([1.15, 0.72, 0.5], [0.3, 0.5, 0.66], (v - 0.5) * 2) : mix([1.15, 0.72, 0.5], [0.3, 0.5, 0.66], (0.5 - v) * 2)
        const cloud = Math.abs(v - 0.5) < 0.07 + n * 0.06
        if (cloud) c = mix(c, [1.2, 1.0, 0.95], 0.75)
        const t1 = towers(u, v, aspect, false, 1)
        if (t1 && v < 0.46) c = t1
        const t2 = towers(u, v, aspect, true, 7)
        if (t2 && v > 0.54) c = t2
        break
      }
      case 2: {
        // 深海：从上方斜落的光柱，一头鲸的剪影
        c = mix([0.03, 0.12, 0.18], [0.2, 0.5, 0.62], v)
        const ray = Math.pow(Math.max(0, Math.sin((u * aspect - v * 0.35) * 8 + n * 2)), 6) * v
        c = add(c, [0.5, 0.9, 1.0], ray * 0.6)
        const x = (u - 0.52) * aspect, y = v - 0.5 - Math.sin(x * 3) * 0.02
        const body = (x / 0.42) ** 2 + (y / (0.1 * (1 - Math.max(0, -x) * 1.2))) ** 2 < 1
        const tail = x < -0.38 && x > -0.58 && Math.abs(y) < (-0.38 - x) * 0.9
        if (body || tail) c = [0.02, 0.05, 0.08]
        if (hash(Math.floor(u * 90) + Math.floor(v * 60) * 91) > 0.985) c = add(c, [0.5, 0.8, 0.9], 0.5)
        break
      }
      case 3: {
        // 时间沙漠：地平线上的落日，沙丘，悬在空中的金环
        const hz = 0.36
        c = v > hz ? mix([1.1, 0.6, 0.32], [0.22, 0.13, 0.32], (v - hz) / (1 - hz)) : mix([0.55, 0.32, 0.2], [0.9, 0.55, 0.32], v / hz)
        if (v < hz) c = add(c, [0.12, 0.06, 0.02], Math.sin(u * aspect * 14 + v * 70 + n * 4) * 0.5)
        const d = Math.hypot((u - 0.5) * aspect, v - hz - 0.05)
        if (v > hz - 0.005) c = add(c, [1.4, 0.9, 0.5], d < 0.07 ? 1 : Math.exp(-d * 9) * 0.5)
        for (const [rx, ry, rr] of [[0.25, 0.72, 0.07], [0.72, 0.62, 0.05], [0.84, 0.82, 0.035]]) {
          const e = Math.abs(Math.hypot((u - rx) * aspect, (v - ry) * 2.2) - rr)
          if (e < 0.008) c = [0.95, 0.72, 0.3]
        }
        break
      }
      case 4: {
        // 回廊：圆厅的柱子与穹顶天光
        c = mix([0.42, 0.34, 0.26], [0.62, 0.52, 0.4], v)
        if (v < 0.24) c = mix([0.6, 0.57, 0.52], [0.82, 0.79, 0.74], v / 0.24)
        const cx = (u * 7) % 1
        if (v > 0.24 && v < 0.8 && cx > 0.4 && cx < 0.6) c = mix([0.78, 0.72, 0.62], [0.5, 0.44, 0.36], Math.abs(cx - 0.5) * 10)
        if (v > 0.8) c = mix([0.5, 0.4, 0.3], [0.7, 0.6, 0.48], 1 - Math.abs(u - 0.5) * 2)
        const beam = v > 0.24 && Math.abs(u - 0.5) * aspect < (1.05 - v) * 0.3 + 0.04
        if (beam) c = add(c, [0.4, 0.35, 0.28], 0.45)
        const dl = Math.hypot((u - 0.5) * aspect, (v - 0.95) * 3)
        c = add(c, [1.2, 1.1, 0.9], Math.exp(-dl * dl * 30))
        break
      }
      case 5: {
        // 黎明之前：环形轨道横跨天空，云海在下面
        const hz = 0.3
        c = v > hz ? mix([0.85, 0.48, 0.46], [0.04, 0.06, 0.18], Math.pow((v - hz) / (1 - hz), 0.7)) : mix([0.35, 0.3, 0.42], [0.62, 0.52, 0.6], v / hz + n * 0.3)
        if (v > 0.55 && hash(Math.floor(u * 160) + Math.floor(v * 100) * 161) > 0.992) c = add(c, [1, 1, 1], 0.8)
        const e = Math.abs(Math.hypot((u - 0.5) * aspect / 1.15, (v - 0.12) / 0.62) - 1)
        if (e < 0.012 && v > hz) c = [0.08, 0.08, 0.12]
        break
      }
      case 6: {
        // 隧道：世界之间的缝隙里掠过的光
        const x = (u - 0.5) * aspect, y = v - 0.5
        const r = Math.hypot(x, y), a = Math.atan2(y, x)
        c = [0.02, 0.02, 0.04]
        const streak = Math.pow(Math.max(0, Math.sin(a * 23 + hash(Math.floor(a * 3.66)) * 6)), 60) * clamp01((r - 0.06) * 3)
        c = add(c, hash(Math.floor(a * 23 / Math.PI)) < 0.5 ? [1.0, 0.75, 0.45] : [0.5, 0.7, 1.0], streak * 0.9)
        c = add(c, [1.0, 0.85, 0.6], Math.exp(-r * r * 160) * 1.2)
        break
      }
      default: {
        // 末班车：月亮下面，一列亮着窗的火车开过旷野
        const hz = 0.34
        c = v > hz ? mix([0.48, 0.44, 0.58], [0.08, 0.1, 0.2], Math.pow((v - hz) / (1 - hz), 0.6)) : mix([0.05, 0.05, 0.07], [0.12, 0.12, 0.15], v / hz)
        const d = Math.hypot((u - 0.76) * aspect, v - 0.76)
        c = add(c, [0.95, 0.92, 0.8], d < 0.06 ? 1 : Math.exp(-d * 8) * 0.4)
        const tx = u * aspect, start = 0.12 * aspect, end = 0.78 * aspect
        const inTrain = tx > start && tx < end + (0.42 - v) * 0.6 && v > hz && v < hz + 0.085
        if (inTrain) {
          c = [0.03, 0.03, 0.05]
          const wf = ((tx - start) * 9) % 1
          if (v > hz + 0.03 && v < hz + 0.06 && wf < 0.62 && tx < end - 0.05) c = [1.1, 0.78, 0.42]
        }
        if (v < hz && v > hz - 0.06) c = add(c, [0.4, 0.28, 0.16], (tx > start && tx < end ? 0.25 : 0) * (1 - (hz - v) / 0.06))
        break
      }
    }
    const k = 0.9 + n * 0.2
    return [c[0] * k, c[1] * k, c[2] * k]
  }
}
