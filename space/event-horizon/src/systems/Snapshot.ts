import * as THREE from 'three'
import { toCanvas } from 'html-to-image'
import { fontEmbedCss } from '../utils/fonts'

/**
 * A pixel-exact picture of the web page at the instant gravity takes it. Shards
 * sample it by their home rectangles, particles inherit its colours. The real DOM
 * stays live and interactive until the moment each element is handed over.
 */
export class Snapshot {
  readonly texture: THREE.CanvasTexture
  private readonly pixels: Uint8ClampedArray
  private readonly pw: number
  private readonly ph: number
  private readonly sx: number
  private readonly sy: number

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    readonly method: 'dom' | 'fallback',
  ) {
    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.premultiplyAlpha = true
    this.texture.generateMipmaps = true
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.anisotropy = 4
    this.texture.needsUpdate = true
    this.pw = Math.max(1, Math.round(width / 2))
    this.ph = Math.max(1, Math.round(height / 2))
    const small = document.createElement('canvas')
    small.width = this.pw
    small.height = this.ph
    const ctx = small.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(canvas, 0, 0, this.pw, this.ph)
    this.pixels = ctx.getImageData(0, 0, this.pw, this.ph).data
    this.sx = this.pw / width
    this.sy = this.ph / height
  }

  /** colour at a stage-px position; returns alpha 0..255 */
  sample(x: number, y: number, out: Uint8ClampedArray | number[]): number {
    const ix = Math.min(this.pw - 1, Math.max(0, Math.floor(x * this.sx)))
    const iy = Math.min(this.ph - 1, Math.max(0, Math.floor(y * this.sy)))
    const o = (iy * this.pw + ix) * 4
    out[0] = this.pixels[o]
    out[1] = this.pixels[o + 1]
    out[2] = this.pixels[o + 2]
    out[3] = this.pixels[o + 3]
    return this.pixels[o + 3]
  }

  /** max alpha over a rect (dense scan of the half-res copy) — used to skip empty shards */
  coverage(x: number, y: number, w: number, h: number): number {
    const x0 = Math.max(0, Math.floor(x * this.sx))
    const y0 = Math.max(0, Math.floor(y * this.sy))
    const x1 = Math.min(this.pw - 1, Math.ceil((x + w) * this.sx))
    const y1 = Math.min(this.ph - 1, Math.ceil((y + h) * this.sy))
    let m = 0
    for (let j = y0; j <= y1; j++) {
      let o = (j * this.pw + x0) * 4 + 3
      for (let i = x0; i <= x1; i++, o += 4) {
        if (this.pixels[o] > m) {
          m = this.pixels[o]
          if (m > 40) return m
        }
      }
    }
    return m
  }

  dispose() {
    this.texture.dispose()
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        window.clearTimeout(id)
        resolve(v)
      },
      (err) => {
        console.warn('[event-horizon] snapshot failed', err)
        window.clearTimeout(id)
        resolve(null)
      },
    )
  })
}

export async function captureSite(site: HTMLElement, pixelRatio: number, timeoutMs = 2600): Promise<Snapshot> {
  const w = site.clientWidth
  const h = site.clientHeight
  const pr = Math.max(1, Math.min(pixelRatio, 2))
  const t0 = performance.now()
  const css = await withTimeout(fontEmbedCss(), 1500)
  const canvas = await withTimeout(
    toCanvas(site, {
      width: w,
      height: h,
      pixelRatio: pr,
      fontEmbedCSS: css ?? '',
      skipFonts: !css,
      cacheBust: false,
      skipAutoScale: true,
      style: { opacity: '1', visibility: 'visible', transform: 'none', left: '0', top: '0' },
      filter: (node) => !(node instanceof HTMLElement && node.dataset.snapSkip !== undefined),
    }),
    timeoutMs,
  )
  if (canvas && canvas.width > 0) {
    console.info(`[event-horizon] page snapshot ${w}x${h}@${pr} in ${Math.round(performance.now() - t0)}ms`)
    return new Snapshot(canvas, w, h, 'dom')
  }
  console.warn('[event-horizon] html-to-image unavailable — using the built-in rasterizer')
  return new Snapshot(await rasterizeFallback(site, pr), w, h, 'fallback')
}

// ---------------------------------------------------------------- fallback

function parseAlpha(c: string) {
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (!m) return 1
  const parts = m[1].split(/[,\s/]+/).filter(Boolean)
  return parts.length > 3 ? parseFloat(parts[3]) : 1
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function stretchKeyword(s: string) {
  const v = parseFloat(s)
  if (isNaN(v)) return 'normal'
  if (v >= 124) return 'ultra-expanded'
  if (v >= 112) return 'expanded'
  if (v >= 105) return 'semi-expanded'
  return 'normal'
}

/**
 * Hand-rolled Canvas2D rasterizer for when foreign-object snapshots are blocked:
 * backgrounds, borders, images, inline SVG (with computed paint inlined) and text.
 */
async function rasterizeFallback(site: HTMLElement, pr: number): Promise<HTMLCanvasElement> {
  const base = site.getBoundingClientRect()
  const c = document.createElement('canvas')
  c.width = Math.round(base.width * pr)
  c.height = Math.round(base.height * pr)
  const ctx = c.getContext('2d')!
  ctx.scale(pr, pr)
  const visible = (el: Element) => {
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01
  }

  const els = Array.from(site.querySelectorAll<HTMLElement>('*'))
  for (const el of els) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const x = r.left - base.left
    const y = r.top - base.top
    if (parseAlpha(cs.backgroundColor) > 0.01 && cs.backgroundColor !== 'transparent') {
      ctx.fillStyle = cs.backgroundColor
      ctx.fillRect(x, y, r.width, r.height)
    }
    const sides: [string, string, number, number, number, number][] = [
      ['Top', cs.borderTopColor, x, y, r.width, 0],
      ['Bottom', cs.borderBottomColor, x, y + r.height, r.width, 0],
      ['Left', cs.borderLeftColor, x, y, 0, r.height],
      ['Right', cs.borderRightColor, x + r.width, y, 0, r.height],
    ]
    for (const [side, color, sx, sy, sw, sh] of sides) {
      const bw = parseFloat((cs as unknown as Record<string, string>)[`border${side}Width`])
      if (bw > 0 && parseAlpha(color) > 0.01) {
        ctx.strokeStyle = color
        ctx.lineWidth = bw
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + sw, sy + sh)
        ctx.stroke()
      }
    }
    if (el instanceof HTMLImageElement && el.complete) {
      ctx.drawImage(el, x, y, r.width, r.height)
    }
    if (el instanceof SVGSVGElement) {
      const clone = el.cloneNode(true) as SVGSVGElement
      const src = el.querySelectorAll('*')
      const dst = clone.querySelectorAll('*')
      src.forEach((n, i) => {
        const s = getComputedStyle(n)
        ;(dst[i] as SVGElement).setAttribute(
          'style',
          `fill:${s.fill};stroke:${s.stroke};stroke-width:${s.strokeWidth};stroke-dasharray:${s.strokeDasharray};opacity:${s.opacity}`,
        )
      })
      clone.setAttribute('width', String(r.width))
      clone.setAttribute('height', String(r.height))
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)))
      if (img) ctx.drawImage(img, x, y, r.width, r.height)
    }
  }

  const walker = document.createTreeWalker(site, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? ''
    if (!text.trim()) continue
    const parent = n.parentElement
    if (!parent || parent.closest('svg') || !visible(parent)) continue
    const cs = getComputedStyle(parent)
    range.selectNodeContents(n)
    const rect = range.getBoundingClientRect()
    if (rect.width < 0.5) continue
    const size = parseFloat(cs.fontSize)
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    try {
      ctx.fontStretch = stretchKeyword(cs.fontStretch) as CanvasFontStretch
      ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing
    } catch {
      /* older canvases */
    }
    ctx.fillStyle = cs.color
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text.trim(), rect.left - base.left, rect.top - base.top + rect.height * 0.5 + size * 0.36)
  }
  return c
}
