import { Vector3 } from 'three'
import { clamp, smoothstep, type GravityMode } from '../core/config'
import type { Pointer } from '../tracking/GestureEngine'
import { syntheticHand } from '../fx/HandOverlay'

/** what the director is allowed to touch: the same actions a user has */
export interface DirectorHost {
  resetWorld(): void
  corePosition(): Vector3
  coreScreen(): { x: number; y: number }
  glassIntact(): boolean
  breakGlassAtCore(): void
  pulseAt(p: Vector3, radius: number): void
  setGravity(m: GravityMode): void
  setVortex(on: boolean): void
  rebuild(): void
  caption(text: string | null): void
  title(on: boolean): void
  shake(amount: number): void
  aspect(): number
  end(): void
}

type Key = [number, number, number, number] // t, x, y, z

function track(keys: Key[], t: number, out: Vector3) {
  if (t <= keys[0][0]) return out.set(keys[0][1], keys[0][2], keys[0][3])
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t <= b[0]) {
      const u = smoothstep(0, 1, (t - a[0]) / (b[0] - a[0]))
      return out.set(a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u)
    }
  }
  const l = keys[keys.length - 1]
  return out.set(l[1], l[2], l[3])
}

// simulated head: cm offsets (x, y) and eye distance (z) — sways wide so the parallax reads on video
const HEAD: Key[] = [
  [0, -17, 2, 62], [2.1, 15, -1, 60], [4, 5, 3, 56], [7, -7, 1, 58], [9, -4, 0, 60],
  [12, 9, 2, 47], [14, 3, 0, 52], [16.5, -10, 3, 57], [19.5, 11, -2, 61], [22.5, -12, 4, 63],
  [25.5, 8, 0, 60], [28, 0, 1, 64], [30, 0, 0, 60],
]

export const DEMO_LENGTH = 30

const CHAPTERS: [number, string][] = [
  [0, '01 — THE IMPOSSIBLE WINDOW'],
  [4, '02 — THE FIRST TOUCH'],
  [9, '03 — PULLING REALITY'],
  [14, '04 — BREAK THE SCREEN'],
  [20, '05 — GRAVITY COLLAPSE'],
  [25, '06 — REBUILD'],
]

/**
 * CINEMATIC DEMO: a 30-second performance played through the real engine.
 * It only feeds simulated inputs — a scripted head position and a procedural
 * hand pointer — into the same interaction, physics and fracture code a user
 * drives. A couple of beats are guaranteed (if the pull hasn't broken the glass
 * by 14 s, the director breaks it at the core) so the film always lands on time.
 */
export class CinematicDirector {
  active = false
  t = 0
  readonly head = new Vector3()
  readonly pointer: Pointer = {
    id: 'demo-hand',
    kind: 'demo',
    present: false,
    x: 0.8,
    y: 0.85,
    pinch: false,
    depth: 0,
    depthGain: 35,
    open: 1,
    charge: 0,
    confidence: 1,
    lostFor: 0,
    ghost: new Float32Array(42),
  }
  private fired = new Set<string>()
  private chapter = -1
  private grabAt = { x: 0.5, y: 0.5 }

  constructor(private host: DirectorHost) {}

  start() {
    this.host.resetWorld()
    this.active = true
    this.t = 0
    this.fired.clear()
    this.chapter = -1
    this.pointer.present = false
    this.pointer.pinch = false
    this.pointer.depth = 0
    this.host.title(false)
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.pointer.present = false
    this.pointer.pinch = false
    this.host.caption(null)
    this.host.title(false)
    this.host.setVortex(false)
  }

  private once(key: string, at: number, fn: () => void) {
    if (this.t >= at && !this.fired.has(key)) {
      this.fired.add(key)
      fn()
    }
  }

  update(dt: number) {
    if (!this.active) return
    this.t += dt
    const t = this.t
    const h = this.host
    track(HEAD, t, this.head)

    let ch = 0
    for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i][0]) ch = i
    if (ch !== this.chapter) {
      this.chapter = ch
      h.caption(CHAPTERS[ch][1])
    }

    // ── the simulated hand ──────────────────────────────────────────
    const p = this.pointer
    if (t < 4) {
      p.present = false
    } else if (t < 6) {
      // approach the core from the lower right
      p.present = true
      const c = h.coreScreen()
      this.grabAt = c
      const u = smoothstep(4, 5.8, t)
      p.x = 0.86 + (c.x - 0.86) * u
      p.y = 0.9 + (c.y - 0.9) * u
      p.pinch = false
      p.open = 1
      p.depth = 0
    } else if (t < 9) {
      // pinch, then a slow figure-eight: the core follows with weight
      p.pinch = true
      const k = smoothstep(6.2, 7, t)
      const w = (t - 6) * 1.6
      p.x = this.grabAt.x + Math.sin(w) * 0.07 * k
      p.y = this.grabAt.y + Math.sin(w * 2) * 0.035 * k
      p.depth = Math.sin(w * 0.5) * 0.03 * k
    } else if (t < 15.2) {
      // pull it towards the viewer: into the glass, through it, out of the screen
      p.pinch = true
      // reaches the glass around 11.8 s, strains against it, breaks it at ~14 s, then stops ~6 units in front of the screen
      const u = smoothstep(9, 14.6, t)
      p.x = this.grabAt.x + 0.04 * u + Math.sin(t * 7) * 0.004 * u
      p.y = this.grabAt.y - 0.03 * u + Math.sin(t * 9) * 0.004 * u
      p.depth = -0.45 * u
    } else if (t < 16.4) {
      p.pinch = false
      p.y += dt * 0.25
      p.x += dt * 0.1
    } else {
      p.present = false
      p.pinch = false
    }
    syntheticHand(p.x, p.y, p.pinch ? 1 : clamp((t - 5.6) * 3, 0, 1) * 0.3, h.aspect(), 0.13, p.ghost)

    // ── beats ───────────────────────────────────────────────────────
    this.once('break', 13.95, () => {
      if (h.glassIntact()) h.breakGlassAtCore()
    })
    this.once('kick', 14.1, () => h.shake(1))
    this.once('gravity', 20, () => h.setGravity('REVERSE'))
    this.once('vortex', 21.2, () => h.setVortex(true))
    this.once('vortexOff', 24.6, () => h.setVortex(false))
    this.once('rebuild', 25, () => h.rebuild())
    this.once('title', 27.6, () => h.title(true))
    this.once('end', DEMO_LENGTH, () => {
      this.stop()
      h.end()
    })
  }
}
