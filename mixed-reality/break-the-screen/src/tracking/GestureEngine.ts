import { clamp } from '../core/config'
import { OneEuroN } from '../core/OneEuro'

/**
 * A pointer is anything that can aim, pinch and push: a tracked hand, the
 * mouse, or the cinematic director's simulated hand. The interaction system
 * only ever sees pointers, so every input path exercises the same code.
 */
export interface Pointer {
  id: string
  kind: 'hand' | 'mouse' | 'demo'
  present: boolean
  /** canvas-normalised position, 0..1, y down */
  x: number
  y: number
  pinch: boolean
  /** push/pull signal; increasing = towards the screen. Hands: ln(palm size). */
  depth: number
  /** world units of z per unit of depth signal */
  depthGain: number
  /** 0 = fist, 1 = flat open hand */
  open: number
  /** open-palm pulse charge 0..1 */
  charge: number
  confidence: number
  /** seconds since this pointer was last seen */
  lostFor: number
  /** 21 mapped landmarks (x, y canvas-normalised) for the ghost-hand overlay */
  ghost?: Float32Array
}

export type GestureEvent =
  | { type: 'pulse'; pointer: Pointer }
  | { type: 'swipe'; dir: 'up' | 'down' | 'left' | 'right'; pointer: Pointer }
  | { type: 'clap'; x: number; y: number }

export interface HandInput {
  lm: Float32Array // 21 * 3 normalised raw-image coordinates
  score: number
}

const FINGERS: [number, number][] = [
  [6, 8],
  [10, 12],
  [14, 16],
  [18, 20],
]

export interface HandGestureOptions {
  pinchOn: number
  pinchOff: number
  stableFrames: number
  openOn: number
  chargeTime: number
  pulseCooldown: number
  swipeDistance: number
  swipeWindow: number
  swipeCooldown: number
  /** interaction zone: the part of the camera image that maps onto the whole canvas */
  zoneCx: number
  zoneCy: number
  zoneGx: number
  zoneGy: number
}

export const HAND_DEFAULTS: HandGestureOptions = {
  pinchOn: 0.3,
  pinchOff: 0.5,
  stableFrames: 2,
  openOn: 0.78,
  chargeTime: 0.45,
  pulseCooldown: 1.4,
  swipeDistance: 0.3,
  swipeWindow: 0.28,
  swipeCooldown: 1.1,
  zoneCx: 0.5,
  zoneCy: 0.55,
  zoneGx: 1.5,
  zoneGy: 1.7,
}

/**
 * One hand's gesture logic: pinch with hysteresis + frame stability, openness,
 * a hold-to-charge open-palm pulse that must re-arm, and swipes. Pure logic,
 * unit-tested with synthetic landmarks.
 */
export class HandGesture {
  readonly pointer: Pointer
  readonly o: HandGestureOptions
  private pinchState = false
  private pinchFrames = 0
  private chargeT = 0
  private armed = true
  private lastPulse = -Infinity
  private lastSwipe = -Infinity
  private lastSeen = -Infinity
  private hist: { t: number; x: number; y: number }[] = []
  private readonly cursorF = new OneEuroN(2, 1.6, 1.4, 1.2)
  private readonly depthF = new OneEuroN(1, 0.9, 0.6, 1.0)
  private lastT = 0
  /** raw wrist position (for slot matching) */
  wrist = { x: 0.5, y: 0.5 }
  pinchRatio = 1

  constructor(id: string, opts: Partial<HandGestureOptions> = {}) {
    this.o = { ...HAND_DEFAULTS, ...opts }
    this.pointer = {
      id,
      kind: 'hand',
      present: false,
      x: 0.5,
      y: 0.5,
      pinch: false,
      depth: 0,
      depthGain: 34,
      open: 0,
      charge: 0,
      confidence: 0,
      lostFor: Infinity,
      ghost: new Float32Array(42),
    }
  }

  /** map a raw-image point into canvas space (mirrored, interaction zone) */
  mapX(x: number) {
    return clamp((1 - x - this.o.zoneCx) * this.o.zoneGx + 0.5, -0.05, 1.05)
  }
  mapY(y: number) {
    return clamp((y - this.o.zoneCy) * this.o.zoneGy + 0.5, -0.05, 1.05)
  }

  update(hand: HandInput | null, aspect: number, t: number, out: GestureEvent[]) {
    const p = this.pointer
    const dt = Math.min(0.2, Math.max(1e-3, t - this.lastT))
    this.lastT = t
    if (!hand) {
      p.lostFor = t - this.lastSeen
      if (p.lostFor > 0.15) {
        p.present = false
        p.pinch = false
        this.pinchState = false
        this.pinchFrames = 0
        this.chargeT = 0
        p.charge = 0
        this.hist.length = 0
      }
      if (p.lostFor > 0.6) {
        this.cursorF.reset()
        this.depthF.reset()
      }
      return
    }
    this.lastSeen = t
    p.lostFor = 0
    p.present = true
    p.confidence += (hand.score - p.confidence) * 0.3
    const L = hand.lm
    const X = (i: number) => L[i * 3] * aspect
    const Y = (i: number) => L[i * 3 + 1]
    const dist = (a: number, b: number) => Math.hypot(X(a) - X(b), Y(a) - Y(b))
    this.wrist = { x: L[0], y: L[1] }

    const palm = Math.max(1e-4, dist(0, 9))
    const pinchRatio = dist(4, 8) / palm
    this.pinchRatio = pinchRatio

    // pinch: hysteresis + N stable frames
    const want = this.pinchState ? pinchRatio < this.o.pinchOff : pinchRatio < this.o.pinchOn
    this.pinchFrames = want === this.pinchState ? 0 : this.pinchFrames + 1
    if (this.pinchFrames >= this.o.stableFrames) {
      this.pinchState = want
      this.pinchFrames = 0
    }
    p.pinch = this.pinchState

    // openness: how far each fingertip reaches beyond its middle joint, from the wrist
    let open = 0
    for (const [pip, tip] of FINGERS) {
      const ratio = dist(0, tip) / Math.max(dist(0, pip), 1e-4)
      open += clamp((ratio - 0.95) / 0.45, 0, 1)
    }
    p.open = open / FINGERS.length

    // cursor: the pinch point (thumb tip + index tip), mirrored into the interaction zone
    const cx = this.mapX((L[4 * 3] + L[8 * 3]) / 2)
    const cy = this.mapY((L[4 * 3 + 1] + L[8 * 3 + 1]) / 2)
    const c = this.cursorF.filter([cx, cy], t)
    p.x = c[0]
    p.y = c[1]
    p.depth = this.depthF.filter([Math.log(palm)], t)[0]
    const g = p.ghost!
    for (let i = 0; i < 21; i++) {
      g[i * 2] = this.mapX(L[i * 3])
      g[i * 2 + 1] = this.mapY(L[i * 3 + 1])
    }

    // motion history (for swipes and to keep a moving hand from charging)
    this.hist.push({ t, x: p.x, y: p.y })
    while (this.hist.length && t - this.hist[0].t > this.o.swipeWindow) this.hist.shift()
    const first = this.hist[0]
    const span = Math.max(1e-3, t - first.t)
    const speed = Math.hypot(p.x - first.x, p.y - first.y) / span

    // open palm: hold still to charge, fires once, re-arms when the hand closes
    const isOpen = p.open > this.o.openOn && pinchRatio > 0.8 && !p.pinch
    if (p.open < 0.55 || p.pinch) this.armed = true
    if (isOpen && this.armed && speed < 0.9 && t - this.lastPulse > this.o.pulseCooldown) {
      this.chargeT += dt
      if (this.chargeT >= this.o.chargeTime) {
        out.push({ type: 'pulse', pointer: p })
        this.lastPulse = t
        this.chargeT = 0
        this.armed = false
      }
    } else {
      this.chargeT = Math.max(0, this.chargeT - dt * 2)
    }
    p.charge = clamp(this.chargeT / this.o.chargeTime, 0, 1)

    // swipe: a fast, mostly straight open-hand motion
    if (!p.pinch && p.open > 0.55 && t - this.lastSwipe > this.o.swipeCooldown && this.hist.length > 3) {
      const dx = p.x - first.x
      const dy = p.y - first.y
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      if (Math.max(ax, ay) > this.o.swipeDistance && Math.min(ax, ay) < Math.max(ax, ay) * 0.6) {
        const dir = ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
        out.push({ type: 'swipe', dir, pointer: p })
        this.lastSwipe = t
        this.chargeT = 0
        this.hist.length = 0
      }
    }
  }
}

/**
 * Up to two hands. Detections are matched to stable slots by wrist proximity
 * so each physical hand keeps its own state machine frame to frame.
 */
export class GestureEngine {
  readonly hands = [new HandGesture('hand0'), new HandGesture('hand1')]
  private clapHist: { t: number; d: number }[] = []
  private lastClap = -Infinity

  update(inputs: HandInput[], aspect: number, t: number): GestureEvent[] {
    const events: GestureEvent[] = []
    const assigned: (HandInput | null)[] = [null, null]
    const free = new Set([0, 1])
    // match to slots already tracking a nearby wrist
    const pending = [...inputs]
    for (const s of [0, 1]) {
      const h = this.hands[s]
      if (!h.pointer.present && h.pointer.lostFor > 0.4) continue
      let bi = -1
      let bd = 0.25
      pending.forEach((inp, i) => {
        const d = Math.hypot(inp.lm[0] - h.wrist.x, inp.lm[1] - h.wrist.y)
        if (d < bd) {
          bd = d
          bi = i
        }
      })
      if (bi >= 0) {
        assigned[s] = pending[bi]
        pending.splice(bi, 1)
        free.delete(s)
      }
    }
    for (const inp of pending) {
      const s = [...free][0]
      if (s === undefined) break
      assigned[s] = inp
      free.delete(s)
    }
    this.hands.forEach((h, i) => h.update(assigned[i], aspect, t, events))

    // clap: two open hands that were apart come together
    const [a, b] = this.hands.map((h) => h.pointer)
    if (a.present && b.present && a.open > 0.45 && b.open > 0.45 && !a.pinch && !b.pinch) {
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      this.clapHist.push({ t, d })
      while (this.clapHist.length && t - this.clapHist[0].t > 1.2) this.clapHist.shift()
      const wasApart = this.clapHist.some((s) => s.d > 0.32)
      if (wasApart && d < 0.12 && t - this.lastClap > 2.5) {
        events.push({ type: 'clap', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
        this.lastClap = t
        this.clapHist.length = 0
      }
    } else {
      this.clapHist.length = 0
    }
    return events
  }

  get pointers() {
    return this.hands.map((h) => h.pointer)
  }

  reset() {
    for (const h of this.hands) h.update(null, 1, Number.POSITIVE_INFINITY, [])
  }
}
