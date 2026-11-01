import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Engine } from '../engine/Engine'
import { segmentCrossing } from '../portal/PortalMath'
import type { WorldId } from '../portal/Portal'
import { coilCharge } from '../world/Lab'
import { GRAVITY } from '../physics/PhysicsWorld'
import { useStore } from '../state/store'

/** Hermite spline through timed keys (C1-continuous, time-parametrised). */
class Track {
  constructor(readonly keys: { t: number; v: Vector3 }[]) {}
  at(t: number, out: Vector3) {
    const k = this.keys
    if (t <= k[0].t) return out.copy(k[0].v)
    if (t >= k[k.length - 1].t) return out.copy(k[k.length - 1].v)
    let i = 0
    while (k[i + 1].t < t) i++
    const a = k[i], b = k[i + 1]
    const pa = k[Math.max(0, i - 1)], pb = k[Math.min(k.length - 1, i + 2)]
    const dt = b.t - a.t
    const u = (t - a.t) / dt
    const m0 = _m0.copy(b.v).sub(pa.v).multiplyScalar(dt / Math.max(1e-4, b.t - pa.t))
    const m1 = _m1.copy(pb.v).sub(a.v).multiplyScalar(dt / Math.max(1e-4, pb.t - a.t))
    if (i === 0) m0.copy(b.v).sub(a.v).multiplyScalar(0.0)
    if (i + 2 >= k.length) m1.copy(b.v).sub(a.v).multiplyScalar(0.0)
    const u2 = u * u, u3 = u2 * u
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2
    return out.copy(a.v).multiplyScalar(h00).addScaledVector(m0, h10).addScaledVector(b.v, h01).addScaledVector(m1, h11)
  }
}
const _m0 = new Vector3()
const _m1 = new Vector3()

const key = (t: number, x: number, y: number, z: number) => ({ t, v: new Vector3(x, y, z) })
/** B-local (Other Side gate frame) → unfolded lab coordinates through α (α at z=-6 facing +Z) */
const fromB = (t: number, x: number, y: number, z: number) => key(t, -x, y, -z - 6)

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

const TOTAL = 30
const T_LAUNCH = 10.35
const T_RELOCATE = 15.0
const T_GRAVITY = 20.55
const T_REWIND = 23.5
const T_REWIND_END = 26.3

/**
 * The 30-second showcase. It drives a camera through the real engine — the
 * same portal renderer, the same crossing test, the same Rapier world — so
 * every frame of the film is the interactive system running live.
 *
 * The camera path is authored in "unfolded" coordinates (as if portals were
 * holes in one continuous space); a traveller transform accumulates the
 * portal links each time the camera crosses an opening, exactly like the
 * player does.
 */
export class Director {
  active = false
  t = 0
  private M = new Matrix4()
  private world: WorldId = 0
  private readonly lastReal = new Vector3()
  private fired = new Set<string>()
  private camPath!: Track
  private lookPath!: Track
  private readonly u = new Vector3()
  private readonly look = new Vector3()
  private rebased = false
  private wasPlaying = false
  private captionId = 0
  private savedHud = true

  constructor(private readonly e: Engine) {}

  start() {
    const e = this.e
    this.wasPlaying = e.playing
    e.input.releaseLock()
    e.resetWorld()
    e.player.setPhysical(false)
    for (const p of e.portals) { p.open = 0; p.energy = 0 }
    e.setPortalTargets(0, 0)
    e.lab.setPower(0)
    e.fx.fade = 1
    e.fx.letterbox = 0
    this.t = 0
    this.M.identity()
    this.world = 0
    this.fired.clear()
    this.rebased = false
    this.build()
    this.camPath.at(0, this.u)
    this.lastReal.copy(this.u)
    this.active = true
    const st = useStore.getState()
    this.savedHud = st.hud
    st.set({ phase: 'cinematic', caption: null, cineT: 0 })
    e.audio?.resume()
  }

  stop() {
    if (!this.active) return
    const e = this.e
    this.active = false
    if (e.recorder.rewinding) e.endRewind()
    e.player.setPhysical(true)
    e.fx.fade = 0
    e.fx.letterbox = 0
    e.applyCamera()
    e.resetWorld()
    e.lab.setPower(1)
    e.setPortalTargets(1)
    const st = useStore.getState()
    st.set({ caption: null, phase: this.wasPlaying ? 'paused' : 'menu', hud: this.savedHud })
    if (this.wasPlaying) e.paused = true
  }

  private build() {
    this.camPath = new Track([
      // 0–4  the lab wakes up
      key(0, 3.4, 1.95, 27.5),
      key(4.0, 1.1, 1.78, 9.5),
      // 4–9  push through α and out of Ω, rising over the island
      key(6.6, 0.25, 1.86, -4.8),
      fromB(7.3, 0.0, 1.95, 1.6),
      fromB(9.0, 2.2, 3.9, 12.5),
      // 9–14 swing round to face Ω; the lab is visible through it
      fromB(10.3, 5.6, 2.55, 8.2),
      fromB(12.4, 4.6, 2.1, 6.6),
      fromB(13.4, 2.4, 2.05, 4.2),
      // 14–15 back through Ω into the lab, out of α facing the hall
      fromB(14.2, 0.35, 1.9, 0.4),
      key(14.8, 0.2, 1.85, -1.2),
      // 15–18.4 Ω re-forms in the lab ahead: the infinite corridor; dolly in
      key(15.6, 0.35, 1.9, 0.2),
      key(18.3, -0.15, 1.95, 3.6),
      // 18.4–19.6 fly through Ω twice (lands back in the same corridor each time)
      key(19.0, -0.05, 2.0, 10.0),
      key(19.6, 0.0, 2.05, 18.5),
    ])
    this.lookPath = new Track([
      key(0, 0.4, 5.5, -40),
      key(3.6, 0, 2.3, -6),
      key(6.2, 0, 2.15, -12),
      fromB(7.4, 0.2, 2.6, 30),
      fromB(9.0, -6, 9, 80),
      fromB(10.3, 0, 2.2, 0),
      fromB(13.4, 0, 2.1, 0),
      fromB(14.2, 0, 2.0, -10),
      key(14.8, 0, 2.0, 12),
      key(18.3, 0, 2.1, 30),
      key(19.6, 0, 2.1, 40),
    ])
  }

  /** the traveller: map an unfolded pose into the real world, following portals */
  private place(u: Vector3, look: Vector3, roll: number) {
    const e = this.e
    const real = _r.copy(u).applyMatrix4(this.M)
    for (const P of e.portals) {
      if (P.world !== this.world || P.open < 0.98) continue
      if (!segmentCrossing(P, this.lastReal, real, 0.02)) continue
      this.M.premultiply(P.link)
      this.world = P.partner.world
      real.copy(u).applyMatrix4(this.M)
      e.audio?.cross(this.world)
      break
    }
    this.lastReal.copy(real)
    _cm.lookAt(u, look, _up)
    _q.setFromRotationMatrix(_cm)
    if (roll) _q.multiply(_roll.setFromAxisAngle(_z, roll))
    _cm.compose(u, _q, _one).premultiply(this.M)
    _cm.decompose(e.camera.position, e.camera.quaternion, _s)
    e.viewWorld = this.world
  }

  /** after the corridor flight: author the rest of the film in real lab coordinates */
  private rebase() {
    const e = this.e
    this.M.identity()
    this.world = e.viewWorld
    const p = e.camera.position.clone()
    const fwd = new Vector3(0, 0, -1).applyQuaternion(e.camera.quaternion)
    this.lastReal.copy(p)
    this.camPath = new Track([
      { t: 19.6, v: p },
      key(20.2, 1.2, 5.6, -1.0),
      // swing out beside Ω's right post (never through its opening) and settle low behind the pyramid
      key(20.9, 5.2, 3.0, 5.5),
      key(21.6, 7.6, 1.4, 9.6),
      key(23.4, 7.8, 1.6, 10.2),
      key(26.0, 6.2, 1.85, 8.8),
      key(26.6, 3.4, 1.86, 6.3),
      // between the gates, facing α: the title holds on the endless corridor while we drift back
      key(27.4, 0.7, 1.9, 2.7),
      key(28.2, 0.05, 1.9, 2.3),
      key(30.0, 0.0, 1.95, 4.3),
    ])
    this.lookPath = new Track([
      { t: 19.6, v: p.clone().addScaledVector(fwd, 20) },
      key(20.2, 0, 3.4, -12),
      key(20.9, 0.5, 3.0, -6),
      key(21.6, 0.5, 3.4, -4),
      key(22.6, 0.5, 9.5, -5),
      key(23.4, 0.5, 15, -6),
      key(24.6, 0.5, 9, -5),
      key(25.8, 0.5, 2.6, -5),
      key(26.6, 1, 2.3, -6),
      key(27.4, 0, 2.25, -6),
      key(30.0, 0, 2.2, -6),
    ])
    this.rebased = true
  }

  /** time-rewind playback speed (history seconds per second) */
  rewindRate() {
    const x = this.t - T_REWIND
    return 0.2 + smooth(0, 0.5, x) * 1.7
  }

  /** physics-synchronous events: they happen on an exact simulation step */
  fixedStep(_dt: number) {
    if (!this.active) return
    const e = this.e
    if (this.t >= T_LAUNCH && this.once('launch')) {
      const cube = e.demoCube
      if (cube) {
        // ballistic solve: reach the middle of α's opening in a fixed flight time
        const A = e.portals[0]
        const target = new Vector3(0, 2.25, 0).applyMatrix4(A.matrix)
        const T = 0.9
        const g = GRAVITY * e.gravityDir
        const d = target.sub(cube.currP)
        const v = new Vector3(d.x / T, (d.y + 0.5 * g * T * T) / T, d.z / T)
        cube.body.wakeUp()
        cube.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
        cube.body.setAngvel({ x: 4.5, y: 2.2, z: -3.1 }, true)
        e.audio?.launch()
        coilCharge.value = 1.4
      }
    }
    if (this.t >= T_GRAVITY && this.once('gravity')) {
      e.setGravity(-1)
      e.fx.shock.set(0.5, 0.42, 0.02, 1.3)
    }
  }

  private once(id: string) {
    if (this.fired.has(id)) return false
    this.fired.add(id)
    return true
  }

  private caption(title: string, sub?: string, kind: 'chapter' | 'title' = 'chapter') {
    useStore.getState().set({ caption: { id: ++this.captionId, title, sub, kind } })
  }

  update(dt: number) {
    if (!this.active) return
    const e = this.e
    this.t += dt
    const t = this.t
    const st = useStore.getState()
    if (Math.floor(t * 10) !== Math.floor((t - dt) * 10)) st.set({ cineT: t })

    // ── look ───────────────────────────────────────────────────────────────
    const fx = e.fx
    fx.fade = t < 1.4 ? 1 - smooth(0.05, 1.4, t) : t > TOTAL - 1.0 ? smooth(TOTAL - 1.0, TOTAL, t) : 0
    const portrait = e.camera.aspect < 1
    fx.letterbox = portrait ? 0 : 1 - smooth(TOTAL - 0.01, TOTAL, t)
    fx.barAspect = 2.1
    // lens: wide establishing, tighter on the corridor, wide again for the finale
    const fov = t < 4 ? 64 : t < 9 ? 66 + smooth(6.4, 7.4, t) * 8 : t < 14 ? 60 : t < 19.6 ? 56 - smooth(15.6, 18.3, t) * 6 + smooth(18.3, 19.4, t) * 18 : 68 + smooth(19.6, 20.4, t) * 6 - smooth(26.4, 27.6, t) * 18
    e.applyCamera(fov)

    // ── events ─────────────────────────────────────────────────────────────
    if (t > 0.35 && this.once('power')) e.audio?.powerOn()
    e.lab.setPower(t < 0.35 ? 0 : Math.min(1, smooth(0.35, 2.6, t) * 1.05))
    if (t > 0.8 && this.once('cap1')) this.caption('SECTOR 07', 'PORTAL RESEARCH FACILITY · 03:12 LOCAL')
    if (t > 2.1 && this.once('energize')) e.setPortalTarget(0, 0, 1, 1.6)
    if (t > 2.65 && this.once('openA')) { e.setPortalTarget(0, 1, 1, 0.85); e.audio?.portalOpen() }
    if (t > 7.15 && this.once('cap2')) this.caption('THE OTHER SIDE', 'SAME SPACE · DIFFERENT REALITY')
    if (t > 8.9 && this.once('openB')) e.setPortalTarget(1, 1, 1, 3)
    if (t > 9.6 && this.once('charge')) coilCharge.value = 0.6
    if (t > 11.3 && this.once('cap3')) this.caption('MOMENTUM IS CONSERVED', 'POSITION · ROTATION · VELOCITY · SPIN — MAPPED THROUGH THE LINK')
    if (t > T_RELOCATE && this.once('relocate')) {
      // Ω tears itself out of the Other Side and re-anchors in the lab, facing α
      const B = e.portals[1]
      e.movePortal(B, 0, new Vector3(0, 0, 6), Math.PI)
      B.open = 0
      B.energy = 0
      e.setPortalTarget(1, 0, 1, 2.5)
      fx.flash.setRGB(0.25, 0.12, 0.22)
      e.audio?.place(true)
    }
    if (t > T_RELOCATE + 0.55 && this.once('openB2')) { e.setPortalTarget(1, 1, 1, 1.2); e.audio?.portalOpen() }
    if (t > 16.3 && this.once('cap4')) this.caption('INFINITE RECURSION', 'EVERY LEVEL IS A REAL RENDER FROM ITS OWN CAMERA')
    if (t > 19.6 && !this.rebased) this.rebase()
    if (t > T_GRAVITY + 0.25 && this.once('cap5')) this.caption('GRAVITY · INVERTED')
    if (t > T_REWIND && this.once('rewind')) e.startRewind()
    if (t > T_REWIND + 0.3 && this.once('cap6')) this.caption('TIME · REVERSED', 'RECORDED STATE, PLAYED BACKWARDS')
    if (t > T_REWIND_END && this.once('rewindEnd')) e.endRewind()
    if (t > 26.6 && this.once('title')) this.caption('PORTAL PARADOX', 'REALITY IS BROKEN.', 'title')
    // gravity flicker: the strips stutter when the field flips
    if (t > T_GRAVITY && t < T_GRAVITY + 0.8) e.lab.setPower(0.75 + 0.25 * Math.sin(t * 90) * Math.sin(t * 37))

    // ── camera ─────────────────────────────────────────────────────────────
    this.camPath.at(t, this.u)
    this.lookPath.at(t, this.look)
    // 11–13.4: let the look follow the real cube as it tumbles out of Ω
    if (!this.rebased && t > 10.9 && t < 13.6 && e.demoCube) {
      const c = e.demoCube.renderP
      const inv = _inv.copy(this.M).invert()
      const cu = _c.copy(c).applyMatrix4(inv)
      const k = smooth(10.9, 11.5, t) * (1 - smooth(12.9, 13.6, t))
      this.look.lerp(cu, k * 0.85)
    }
    const roll = t > 15.6 && t < 19.6 ? Math.sin((t - 15.6) * 0.8) * 0.035 : 0
    this.place(this.u, this.look, roll)

    if (t >= TOTAL) this.stop()
  }
}

const _r = new Vector3()
const _c = new Vector3()
const _cm = new Matrix4()
const _inv = new Matrix4()
const _q = new Quaternion()
const _roll = new Quaternion()
const _z = new Vector3(0, 0, 1)
const _up = new Vector3(0, 1, 0)
const _one = new Vector3(1, 1, 1)
const _s = new Vector3()
