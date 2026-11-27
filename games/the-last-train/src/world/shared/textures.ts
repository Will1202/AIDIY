// 程序化纹理：纯 JS 生成（可平铺的周期噪声），不依赖 Canvas，因此世界在 Node 测试里也能完整构建。
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'

// ---------- 噪声 ----------
function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

const fade = (t: number) => t * t * (3 - 2 * t)

/** 周期为 period 的值噪声，保证纹理边缘无缝 */
export function vnoise(x: number, y: number, period: number, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const p = period
  const m = (v: number) => ((v % p) + p) % p
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed)
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed)
  const u = fade(xf), v = fade(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** 分形噪声，u/v 为 0..1 */
export function fbm(u: number, v: number, base: number, oct = 5, seed = 1, gain = 0.5) {
  let s = 0, amp = 0.5, f = base, norm = 0
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(u * f, v * f, f, seed + i * 17)
    norm += amp
    amp *= gain
    f *= 2
  }
  return s / norm
}

/** Worley 细胞噪声（大理石纹、石砖） */
export function cell(u: number, v: number, n: number, seed = 3) {
  const x = u * n, y = v * n
  const xi = Math.floor(x), yi = Math.floor(y)
  let d1 = 9, d2 = 9
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j
    const mx = ((cx % n) + n) % n, my = ((cy % n) + n) % n
    const px = cx + hash2(mx, my, seed), py = cy + hash2(mx, my, seed + 9)
    const d = Math.hypot(px - x, py - y)
    if (d < d1) { d2 = d1; d1 = d } else if (d < d2) d2 = d
  }
  return { d1, d2 }
}

/** 错缝砌块：返回到砌缝的距离系数 edge（缝上为 0，块内为 1）与块的随机值 h。行偏移不规则，水平方向保证可平铺 */
function blocks(u: number, v: number, rows: number, cols: number, jx: number, jy: number, seed: number) {
  const ry = v * rows
  const row = Math.floor(ry)
  const rw = ((row % rows) + rows) % rows
  const rx = u * cols + hash2(rw, 0, seed) * 0.5 + (rw % 2) * 0.5
  const col = Math.floor(rx)
  const fx = rx - col, fy = ry - row
  const edge = Math.min(fx / jx, (1 - fx) / jx, fy / jy, (1 - fy) / jy, 1)
  return { edge, h: hash2(((col % cols) + cols) % cols, rw, seed + 1), fy }
}

// ---------- 纹理构建 ----------
type Px = (u: number, v: number, x: number, y: number) => [number, number, number, number?]

const cache = new Map<string, DataTexture>()

export function makeTex(key: string, size: number, fn: Px, srgb = true): DataTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = fn(x / size, y / size, x, y)
      const i = (y * size + x) * 4
      data[i] = Math.max(0, Math.min(255, r * 255))
      data[i + 1] = Math.max(0, Math.min(255, g * 255))
      data[i + 2] = Math.max(0, Math.min(255, b * 255))
      data[i + 3] = Math.max(0, Math.min(255, (a ?? 1) * 255))
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  t.needsUpdate = true
  t.userData.shared = true
  cache.set(key, t)
  return t
}

/** 从高度图算法线贴图 */
export function normalFromHeight(key: string, size: number, h: (u: number, v: number) => number, strength = 2): DataTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const hs = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hs[y * size + x] = h(x / size, y / size)
  const at = (x: number, y: number) => hs[((y + size) % size) * size + ((x + size) % size)]
  return makeTex(key, size, (_u, _v, x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength
    const l = Math.hypot(dx, dy, 1)
    return [(-dx / l) * 0.5 + 0.5, (-dy / l) * 0.5 + 0.5, 1 / l * 0.5 + 0.5]
  }, false)
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const sat = (x: number) => Math.max(0, Math.min(1, x))

// ---------- 具体材质纹理 ----------
export const TEX = {
  /** 混凝土：颜色 + 粗糙度 */
  concrete: (size = 256) => makeTex(`concrete${size}`, size, (u, v) => {
    const n = fbm(u, v, 4, 5, 11)
    const s = fbm(u, v, 32, 2, 12)
    const k = 0.42 + n * 0.22 + (s - 0.5) * 0.06
    return [k, k * 0.98, k * 0.95]
  }),
  concreteRough: (size = 256) => makeTex(`concreteR${size}`, size, (u, v) => {
    const n = fbm(u, v, 4, 4, 21)
    const r = 0.75 + (n - 0.5) * 0.3
    return [r, r, r]
  }, false),
  /** 积水遮罩：值越大越湿（粗糙度贴图用 1-mask） */
  puddles: (size = 256) => makeTex(`puddles${size}`, size, (u, v) => {
    const n = fbm(u, v, 3, 5, 31)
    const w = sat((n - 0.5) * 6)
    return [w, w, w]
  }, false),
  /** 站台瓷砖（带缝） */
  tiles: (size = 256) => makeTex(`tiles${size}`, size, (u, v) => {
    const g = 4
    const fx = (u * g) % 1, fy = (v * g) % 1
    const grout = Math.min(fx, 1 - fx, fy, 1 - fy) < 0.025 ? 1 : 0
    const tile = hash2(Math.floor(u * g), Math.floor(v * g), 5)
    const n = fbm(u, v, 8, 3, 41)
    const k = grout ? 0.22 : 0.5 + tile * 0.08 + (n - 0.5) * 0.12
    return [k * 1.02, k, k * 0.96]
  }),
  /** 拉丝金属 */
  brushed: (size = 256) => makeTex(`brushed${size}`, size, (u, v) => {
    const n = fbm(u * 0.05, v, 64, 3, 51)
    const k = 0.6 + (n - 0.5) * 0.25
    return [k, k, k]
  }),
  /** 红砖（错缝砌法 + 灰缝） */
  brick: (size = 512) => makeTex(`brick${size}`, size, (u, v) => {
    const rows = 16, cols = 8
    const ry = v * rows
    const row = Math.floor(ry)
    const rx = u * cols + (row % 2) * 0.5
    const col = Math.floor(rx)
    const fx = rx - col, fy = ry - row
    const mortar = fx < 0.04 || fy < 0.08
    const h = hash2(((col % cols) + cols) % cols, row, 151)
    const n = fbm(u, v, 16, 3, 152)
    if (mortar) {
      const k = 0.42 + n * 0.1
      return [k, k * 0.98, k * 0.94]
    }
    const k = 0.5 + h * 0.18 + (n - 0.5) * 0.2
    return [k * 0.78, k * 0.4, k * 0.3]
  }),
  brickNormal: (size = 512) => normalFromHeight(`brickN${size}`, size, (u, v) => {
    const rows = 16, cols = 8
    const ry = v * rows
    const row = Math.floor(ry)
    const rx = u * cols + (row % 2) * 0.5
    const fx = rx - Math.floor(rx), fy = ry - row
    const m = Math.min(fx / 0.04, (1 - fx) / 0.04, fy / 0.08, (1 - fy) / 0.08, 1)
    return m * 0.8 + fbm(u, v, 32, 2, 153) * 0.2
  }, 2.5),
  /** 博物馆的灰泥墙：非常轻的起伏，不脏 */
  plaster: (size = 256) => makeTex(`plaster${size}`, size, (u, v) => {
    const n = fbm(u, v, 6, 4, 161)
    const k = 0.9 + (n - 0.5) * 0.06
    return [k, k * 0.985, k * 0.96]
  }),
  /** 条纹帆布（帐篷） */
  canvasStripe: (size = 128) => makeTex(`canvasStripe${size}`, size, (u, v, x, y) => {
    const band = Math.floor(u * 8) % 2
    const weave = ((x + y) % 3 === 0 ? 0.04 : 0) + (fbm(u, v, 8, 3, 171) - 0.5) * 0.12
    const base = band ? [0.62, 0.2, 0.14] : [0.86, 0.76, 0.56]
    const edge = Math.abs((u * 8) % 1 - 0.5) > 0.46 ? 0.75 : 1
    return [base[0] * edge + weave, base[1] * edge + weave, base[2] * edge + weave]
  }),
  /** 黄黑警示斜纹 */
  hazard: (size = 128) => makeTex(`hazard${size}`, size, (u, v) => {
    const k = Math.floor((u + v) * 6) % 2
    const n = fbm(u, v, 8, 3, 181) * 0.15
    return k ? [0.85 - n, 0.65 - n, 0.12] : [0.08 + n * 0.3, 0.08 + n * 0.3, 0.09 + n * 0.3]
  }),
  /** 木纹 */
  wood: (size = 256) => makeTex(`wood${size}`, size, (u, v) => {
    const n = fbm(u, v, 4, 4, 61)
    const ring = Math.sin((v * 22 + n * 6) * Math.PI) * 0.5 + 0.5
    const k = 0.32 + ring * 0.12 + (n - 0.5) * 0.1
    return [k * 1.25, k * 0.85, k * 0.55]
  }),
  /** 大理石 */
  marble: (size = 512) => makeTex(`marble${size}`, size, (u, v) => {
    const n = fbm(u, v, 3, 6, 71)
    const vein = Math.abs(Math.sin((u * 3 + v * 2 + n * 4.5) * Math.PI))
    const k = 0.88 - Math.pow(1 - vein, 14) * 0.45 - (1 - n) * 0.06
    return [k, k * 0.985, k * 0.96]
  }),
  /** 沙 */
  sand: (size = 256) => makeTex(`sand${size}`, size, (u, v) => {
    const n = fbm(u, v, 6, 4, 81)
    const g = hash2(Math.floor(u * size), Math.floor(v * size), 82)
    const k = 0.6 + (n - 0.5) * 0.2 + (g - 0.5) * 0.08
    return [k * 1.18, k * 0.92, k * 0.66]
  }),
  /** 沙丘风纹高度 → 法线 */
  sandNormal: (size = 256) => normalFromHeight(`sandN${size}`, size, (u, v) => Math.sin((v * 16 + fbm(u, v, 4, 3, 91) * 3) * Math.PI * 2) * 0.5 + fbm(u, v, 16, 2, 92) * 0.3, 3),
  /** 车厢座椅织物 */
  fabric: (size = 128) => makeTex(`fabric${size}`, size, (u, v, x, y) => {
    const weave = ((x + y) % 4 < 2 ? 0.04 : -0.04) + ((x - y + 64) % 6 < 3 ? 0.03 : 0)
    const n = fbm(u, v, 8, 3, 101)
    const k = 0.5 + weave + (n - 0.5) * 0.1
    return [k * 0.55, k * 0.22, k * 0.24]
  }),
  /** 石砖（沙漠建筑、遗迹） */
  stone: (size = 256) => makeTex(`stone${size}`, size, (u, v) => {
    const c = cell(u, v, 6, 111)
    const edge = sat((c.d2 - c.d1) * 8)
    const n = fbm(u, v, 8, 4, 112)
    const k = (0.45 + n * 0.25) * mix(0.55, 1, edge)
    return [k * 1.1, k * 0.95, k * 0.78]
  }),
  stoneNormal: (size = 256) => normalFromHeight(`stoneN${size}`, size, (u, v) => {
    const c = cell(u, v, 6, 111)
    return sat((c.d2 - c.d1) * 8) * 0.6 + fbm(u, v, 16, 3, 113) * 0.4
  }, 3),
  /** 砂岩砌块（沙漠的钟塔、石柱、祭台）：错缝大块，块内有沉积层理和风化 */
  ashlar: (size = 256) => makeTex(`ashlar${size}`, size, (u, v) => {
    const b = blocks(u, v, 6, 3, 0.025, 0.05, 301)
    const n = fbm(u, v, 8, 4, 302)
    const strata = Math.sin((v * 6 * 7 + n * 3) * Math.PI) * 0.03
    const chip = sat((b.edge - 0.15) * 3)
    const k = (0.64 + b.h * 0.18 + (n - 0.5) * 0.28 + strata) * mix(0.6, 1, chip)
    return [k * 1.07, k * 0.93, k * 0.78]
  }),
  ashlarNormal: (size = 256) => normalFromHeight(`ashlarN${size}`, size, (u, v) => {
    const b = blocks(u, v, 6, 3, 0.025, 0.05, 301)
    return sat(b.edge * 1.4) * 0.75 + fbm(u, v, 16, 3, 303) * 0.25
  }, 2.5),
  /** 石板地面（站台、广场）：大块方石，细缝，中间被磨得更亮 */
  flagstone: (size = 256) => makeTex(`flagstone${size}`, size, (u, v) => {
    const b = blocks(u, v, 3, 3, 0.018, 0.018, 311)
    const n = fbm(u, v, 6, 4, 312)
    const k = (0.74 + b.h * 0.16 + (n - 0.5) * 0.2) * mix(0.55, 1, sat(b.edge * 2))
    return [k * 1.03, k * 0.96, k * 0.86]
  }),
  flagstoneNormal: (size = 256) => normalFromHeight(`flagstoneN${size}`, size, (u, v) => {
    const b = blocks(u, v, 3, 3, 0.018, 0.018, 311)
    return sat(b.edge * 1.6) * 0.7 + fbm(u, v, 12, 3, 313) * 0.3
  }, 2),
  /** 锈蚀 / 深海金属 */
  rust: (size = 256) => makeTex(`rust${size}`, size, (u, v) => {
    const n = fbm(u, v, 5, 5, 121)
    const r = sat((n - 0.45) * 3)
    return [mix(0.35, 0.42, r), mix(0.38, 0.24, r), mix(0.4, 0.15, r)]
  }),
  /** 通用细噪声（用于粗糙度扰动） */
  grime: (size = 256) => makeTex(`grime${size}`, size, (u, v) => {
    const n = fbm(u, v, 8, 5, 131)
    const k = 0.55 + (n - 0.5) * 0.5
    return [k, k, k]
  }, false),
  /** 柔和径向光斑（粒子、光晕） */
  glow: (size = 64) => makeTex(`glow${size}`, size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2
    const k = Math.pow(sat(1 - d), 2.2)
    return [1, 1, 1, k]
  }, false),
  /** 云（天空城的云海） */
  cloud: (size = 256) => makeTex(`cloud${size}`, size, (u, v) => {
    const n = fbm(u, v, 3, 6, 141)
    const k = sat((n - 0.42) * 2.4)
    return [k, k, k, k]
  }, false),
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose()
  cache.clear()
}
