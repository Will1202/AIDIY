import { clamp } from '../util/math'

/**
 * The visible brush: a bamboo-handled 毛笔 drawn in SVG, positioned imperatively every
 * frame (no React re-render). It trails the pointer with spring inertia, leans into the
 * direction of motion and its tip squashes with pressure.
 */
export class BrushCursor {
  readonly el: HTMLDivElement
  private tip: SVGPathElement
  private x = -200
  private y = -200
  private vx = 0
  private vy = 0
  private tx = -200
  private ty = -200
  private lean = 0
  private press = 0
  visible = true
  /** colour of the ink loaded on the tip */
  private ink = '#1a1715'

  constructor(parent: HTMLElement) {
    const el = document.createElement('div')
    el.className = 'brush-cursor'
    el.innerHTML = `
      <svg width="64" height="190" viewBox="0 0 64 190" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bc-handle" x1="0" x2="1">
            <stop offset="0" stop-color="#6b4a2b"/><stop offset="0.45" stop-color="#a77b4b"/><stop offset="1" stop-color="#5a3d22"/>
          </linearGradient>
          <linearGradient id="bc-hair" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#e8dcc4"/><stop offset="0.55" stop-color="#8d7d67"/><stop offset="1" stop-color="#1a1715"/>
          </linearGradient>
        </defs>
        <rect x="26" y="0" width="12" height="118" rx="5" fill="url(#bc-handle)"/>
        <rect x="26" y="20" width="12" height="2.5" fill="#3b2715" opacity="0.6"/>
        <rect x="26" y="70" width="12" height="2.5" fill="#3b2715" opacity="0.6"/>
        <rect x="24.5" y="112" width="15" height="12" rx="3" fill="#2a1e14"/>
        <rect x="24.5" y="114" width="15" height="3" fill="#b3261e"/>
        <path class="bc-tip" d="M25 124 C22 140 26 160 32 188 C38 160 42 140 39 124 Z" fill="url(#bc-hair)"/>
      </svg>`
    parent.appendChild(el)
    this.el = el
    this.tip = el.querySelector('.bc-tip') as SVGPathElement
  }

  setTarget(x: number, y: number) {
    this.tx = x
    this.ty = y
  }
  snap(x: number, y: number) {
    this.x = this.tx = x
    this.y = this.ty = y
  }
  setInk(color: string) {
    if (color === this.ink) return
    this.ink = color
    const stop = this.el.querySelector('#bc-hair stop:last-child')
    stop?.setAttribute('stop-color', color)
  }

  update(dt: number, pressure: number, drawing: boolean) {
    // critically damped spring → a little lag and overshoot-free inertia
    const w = drawing ? 38 : 22
    const ax = w * w * (this.tx - this.x) - 2 * w * this.vx
    const ay = w * w * (this.ty - this.y) - 2 * w * this.vy
    const h = Math.min(dt, 1 / 30)
    this.vx += ax * h
    this.vy += ay * h
    this.x += this.vx * h
    this.y += this.vy * h
    const leanT = clamp(-this.vx * 0.018, -32, 32)
    this.lean += (leanT - this.lean) * (1 - Math.exp(-dt * 10))
    const pt = drawing ? 0.35 + pressure * 0.65 : 0
    this.press += (pt - this.press) * (1 - Math.exp(-dt * 14))
    const sy = 1 - this.press * 0.18
    const sx = 1 + this.press * 0.35
    this.tip.setAttribute('transform', `translate(32 124) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-32 -124)`)
    // the SVG tip point (32,188) sits on the hotspot
    this.el.style.transform = `translate(${(this.x - 32).toFixed(1)}px, ${(this.y - 188 + this.press * 11.5).toFixed(1)}px) rotate(${(this.lean + 18).toFixed(2)}deg)`
    this.el.style.opacity = this.visible ? '1' : '0'
  }
}
