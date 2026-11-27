// Canvas 文字贴图：站牌、时刻表、告示、展签、倒写的字……
// Node 测试环境没有 document，这时返回 1×1 的占位纹理，场景结构保持一致。
import { CanvasTexture, DataTexture, Group, LinearFilter, Mesh, PlaneGeometry, SRGBColorSpace, type Material, type Texture } from 'three'

export const SERIF_CN = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif'
export const SANS_CN = '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
export const MONO = '"Geist Mono Variable", "Geist Mono", ui-monospace, Consolas, monospace'
export const DISPLAY = '"Cormorant Garamond", "Times New Roman", serif'

export interface TextOpts {
  w: number
  h: number
  bg?: string
  /** 每行：文字、字号（相对高度 0..1）、颜色、字体、对齐、y 位置（0..1） */
  lines: { text: string; size: number; color?: string; font?: string; align?: CanvasTextAlign; y: number; x?: number; weight?: string; spacing?: number }[]
  /** 水平镜像（镜中字） */
  mirror?: boolean
  /** 上下颠倒（倒写的字） */
  flip?: boolean
  /** 旧纸 / 污渍 */
  grain?: number
  border?: string
  glow?: string
}

const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function'

export function textTexture(o: TextOpts): Texture {
  if (!hasDom()) {
    const t = new DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1)
    t.needsUpdate = true
    return t
  }
  const c = document.createElement('canvas')
  c.width = o.w
  c.height = o.h
  const g = c.getContext('2d')!
  if (o.bg) {
    g.fillStyle = o.bg
    g.fillRect(0, 0, o.w, o.h)
  }
  if (o.grain) {
    const img = g.getImageData(0, 0, o.w, o.h)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 255 * o.grain
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
    }
    g.putImageData(img, 0, 0)
  }
  if (o.border) {
    g.strokeStyle = o.border
    g.lineWidth = Math.max(2, o.h * 0.012)
    g.strokeRect(g.lineWidth * 2, g.lineWidth * 2, o.w - g.lineWidth * 4, o.h - g.lineWidth * 4)
  }
  g.save()
  if (o.mirror) { g.translate(o.w, 0); g.scale(-1, 1) }
  if (o.flip) { g.translate(o.w, o.h); g.scale(-1, -1) }
  for (const l of o.lines) {
    const px = Math.round(l.size * o.h)
    g.font = `${l.weight ?? '500'} ${px}px ${l.font ?? SERIF_CN}`
    g.fillStyle = l.color ?? '#efe8d8'
    g.textAlign = l.align ?? 'center'
    g.textBaseline = 'middle'
    if (o.glow) {
      g.shadowColor = o.glow
      g.shadowBlur = px * 0.5
    }
    const x = l.x !== undefined ? l.x * o.w : l.align === 'left' ? o.w * 0.06 : l.align === 'right' ? o.w * 0.94 : o.w / 2
    if (l.spacing) {
      ;(g as unknown as { letterSpacing: string }).letterSpacing = `${l.spacing * px}px`
    }
    g.fillText(l.text, x, l.y * o.h)
    ;(g as unknown as { letterSpacing: string }).letterSpacing = '0px'
  }
  g.restore()
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearFilter
  t.anisotropy = 4
  return t
}

/** 动态数字屏（电子钟等），返回可重绘的纹理 */
export class DigitScreen {
  readonly texture: Texture
  private c: HTMLCanvasElement | null = null
  private g: CanvasRenderingContext2D | null = null
  private last = ''
  constructor(readonly w: number, readonly h: number, private color = '#ff5a3c', private bg = '#0b0503') {
    if (hasDom()) {
      this.c = document.createElement('canvas')
      this.c.width = w
      this.c.height = h
      this.g = this.c.getContext('2d')
      const t = new CanvasTexture(this.c)
      t.colorSpace = SRGBColorSpace
      this.texture = t
    } else {
      const t = new DataTexture(new Uint8Array([20, 5, 3, 255]), 1, 1)
      t.needsUpdate = true
      this.texture = t
    }
    this.draw('')
  }
  draw(text: string, sub = '', dim = 1) {
    const key = `${text}|${sub}|${dim.toFixed(2)}`
    if (key === this.last || !this.g || !this.c) return
    this.last = key
    const g = this.g
    g.fillStyle = this.bg
    g.fillRect(0, 0, this.w, this.h)
    // 未点亮的数码管底纹
    g.font = `700 ${this.h * 0.62}px ${MONO}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = 'rgba(255,90,60,0.07)'
    g.fillText('88:88', this.w / 2, this.h * 0.47)
    g.globalAlpha = dim
    g.shadowColor = this.color
    g.shadowBlur = this.h * 0.12
    g.fillStyle = this.color
    g.fillText(text, this.w / 2, this.h * 0.47)
    if (sub) {
      g.font = `500 ${this.h * 0.12}px ${MONO}`
      g.shadowBlur = 0
      g.fillText(sub, this.w / 2, this.h * 0.88)
    }
    g.globalAlpha = 1
    g.shadowBlur = 0
    this.texture.needsUpdate = true
  }
}

/** 琥珀色点阵 LED 屏（车厢两端的“下一站”显示） */
export class LedScreen {
  readonly texture: Texture
  private c: HTMLCanvasElement | null = null
  private g: CanvasRenderingContext2D | null = null
  private last = ''
  constructor(readonly w: number, readonly h: number) {
    if (hasDom()) {
      this.c = document.createElement('canvas')
      this.c.width = w
      this.c.height = h
      this.g = this.c.getContext('2d')
      const t = new CanvasTexture(this.c)
      t.colorSpace = SRGBColorSpace
      this.texture = t
    } else {
      const t = new DataTexture(new Uint8Array([20, 10, 0, 255]), 1, 1)
      t.needsUpdate = true
      this.texture = t
    }
  }
  draw(top: string, bottom: string) {
    const key = top + '|' + bottom
    if (key === this.last || !this.g || !this.c) return
    this.last = key
    const g = this.g, w = this.w, h = this.h
    g.fillStyle = '#0a0602'
    g.fillRect(0, 0, w, h)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = '#ffb040'
    g.shadowBlur = h * 0.08
    g.fillStyle = '#ffb848'
    g.font = `600 ${h * 0.34}px ${SANS_CN}`
    g.fillText(top, w / 2, h * 0.36)
    g.font = `500 ${h * 0.18}px ${MONO}`
    g.fillStyle = '#d08a30'
    g.fillText(bottom, w / 2, h * 0.76)
    g.shadowBlur = 0
    // 点阵遮罩
    g.fillStyle = 'rgba(10,6,2,0.55)'
    const step = Math.max(3, Math.round(h / 40))
    for (let y = 0; y < h; y += step) g.fillRect(0, y, w, 1)
    for (let x = 0; x < w; x += step) g.fillRect(x, 0, 1, h)
    this.texture.needsUpdate = true
  }
}

/** 背靠背的两块单面牌子：两面看都是正字（双面材质从背面看是镜像的反字）。材质须是单面的 */
export function signBoard(mat: Material, w: number, h: number, gap = 0.01): Group {
  const g = new Group()
  const geo = new PlaneGeometry(w, h)
  const a = new Mesh(geo, mat)
  a.position.z = gap / 2
  const b = new Mesh(geo, mat)
  b.rotation.y = Math.PI
  b.position.z = -gap / 2
  g.add(a, b)
  return g
}
