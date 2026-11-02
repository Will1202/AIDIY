import { Vector3 } from 'three'
import { clamp } from '../core/config'
import type { Pointer } from '../tracking/GestureEngine'

/**
 * Mouse / touch fallback that drives the exact same pointer interface as a
 * tracked hand: press = pinch, wheel = push / pull in depth, right-click =
 * energy pulse. Alt + move (or the arrow keys) moves a simulated head so the
 * parallax can be explored without a camera.
 */
export class MouseInput {
  readonly pointer: Pointer = {
    id: 'mouse',
    kind: 'mouse',
    present: false,
    x: 0.5,
    y: 0.5,
    pinch: false,
    depth: 0,
    depthGain: 35,
    open: 0,
    charge: 0,
    confidence: 1,
    lostFor: 0,
  }
  /** simulated head offset in cm */
  readonly simHead = new Vector3()
  simActive = false
  /** gentle automatic head sway (landing page / attract) */
  autoSway = false
  onPulse: (() => void) | null = null
  onScale: ((factor: number) => void) | null = null
  onRoll: ((rad: number) => void) | null = null
  readonly keys = new Set<string>()
  enabled = true
  private altHead = new Vector3()
  private swayT = 0

  constructor(private el: HTMLElement) {
    el.addEventListener('pointermove', this.move)
    el.addEventListener('pointerdown', this.down)
    window.addEventListener('pointerup', this.up)
    el.addEventListener('pointerleave', () => {
      if (!this.pointer.pinch) this.pointer.present = false
    })
    el.addEventListener('wheel', this.wheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', (e) => this.keys.add(e.code))
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  private pos(e: PointerEvent) {
    const r = this.el.getBoundingClientRect()
    this.pointer.x = (e.clientX - r.left) / Math.max(1, r.width)
    this.pointer.y = (e.clientY - r.top) / Math.max(1, r.height)
  }

  private move = (e: PointerEvent) => {
    if (!this.enabled) return
    this.pos(e)
    this.pointer.present = true
    if (e.altKey) {
      this.simActive = true
      this.altHead.set((this.pointer.x - 0.5) * 36, (0.5 - this.pointer.y) * 24, 0)
    }
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled) return
    this.pos(e)
    this.pointer.present = true
    if (e.button === 2) {
      this.onPulse?.()
      return
    }
    if (e.button !== 0) return
    this.el.setPointerCapture?.(e.pointerId)
    this.pointer.pinch = true
  }

  private up = (e: PointerEvent) => {
    if (e.button === 0) this.pointer.pinch = false
    if (e.pointerType === 'touch') this.pointer.present = false
  }

  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return
    e.preventDefault()
    const d = clamp(e.deltaY, -200, 200)
    if (e.shiftKey) {
      this.onScale?.(Math.exp(-d * 0.0015))
      return
    }
    // wheel towards you (down) pulls the held object out of the screen
    this.pointer.depth -= d * 0.0005
  }

  update(dt: number) {
    const k = this.keys
    const v = 28 * dt
    let moved = false
    if (k.has('ArrowLeft')) (this.altHead.x -= v), (moved = true)
    if (k.has('ArrowRight')) (this.altHead.x += v), (moved = true)
    if (k.has('ArrowUp')) (this.altHead.y += v), (moved = true)
    if (k.has('ArrowDown')) (this.altHead.y -= v), (moved = true)
    if (k.has('PageUp')) (this.altHead.z -= v), (moved = true)
    if (k.has('PageDown')) (this.altHead.z += v), (moved = true)
    if (moved) this.simActive = true
    this.altHead.x = clamp(this.altHead.x, -30, 30)
    this.altHead.y = clamp(this.altHead.y, -20, 20)
    this.altHead.z = clamp(this.altHead.z, -30, 40)
    if (this.pointer.pinch && (k.has('KeyQ') || k.has('KeyE'))) this.onRoll?.((k.has('KeyQ') ? 1 : -1) * dt * 2)
    if (this.autoSway && !this.simActive) {
      this.swayT += dt
      this.simHead.set(Math.sin(this.swayT * 0.35) * 14, Math.sin(this.swayT * 0.23) * 5, 0)
    } else {
      this.simHead.copy(this.altHead)
    }
  }

  /** current simulated head offset, or null if the user never moved it */
  get simulated() {
    return this.simActive || this.autoSway ? this.simHead : null
  }

  resetHead() {
    this.altHead.set(0, 0, 0)
    this.simActive = false
  }
}
