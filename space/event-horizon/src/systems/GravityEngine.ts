import * as THREE from 'three'
import type { CameraRig, ScreenPoint } from '../gl/CameraRig'
import type { DebrisGPU } from '../gl/Debris'
import { GravityField, LensModel, type ParticleSystem } from './Physics'
import type { Params } from './params'
import type { Snapshot } from './Snapshot'

const enum Kind {
  Char,
  Word,
  Block,
}

const enum St {
  Home,
  Free,
  Shattered,
  Gone,
  Rebuild,
  Landed,
}

interface Body {
  el: HTMLElement
  kind: Kind
  ring: boolean
  boost: number
  hx: number
  hy: number
  hw: number
  hh: number
  cx: number
  cy: number
  mass: number
  coupling: number
  seed: number
  rank: number
  state: St
  releaseAt: number
  releasedAt: number
  maxFree: number
  p: THREE.Vector3
  v: THREE.Vector3
  rot: number
  rotV: number
  base: number
  sx: number
  sy: number
  depth: number
  scale: number
  m: Float32Array
  fade: number
  pending: number
  rbStart: number
  rbDur: number
  rbSpin: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** M = R(φ)·diag(s, 1/√s)·R(−φ)·R(rot)·scale — tidal stretch along the radial direction φ */
function tidalMatrix(phi: number, s: number, rot: number, scale: number, out: Float32Array) {
  const c = Math.cos(phi)
  const sn = Math.sin(phi)
  const q = 1 / Math.sqrt(s)
  const a00 = s * c * c + q * sn * sn
  const a01 = (s - q) * c * sn
  const a11 = s * sn * sn + q * c * c
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  out[0] = (a00 * cr + a01 * sr) * scale
  out[1] = (a01 * cr + a11 * sr) * scale
  out[2] = (-a00 * sr + a01 * cr) * scale
  out[3] = (-a01 * sr + a11 * cr) * scale
}

const easeOut3 = (u: number) => 1 - Math.pow(1 - u, 3)

/**
 * DOM Gravity Engine.
 *
 *  1. HOME     — real, interactive DOM. During activation each element is displaced
 *                by a spatial field (closer to the hole = stronger), trembles and
 *                leans, all through CSS matrix() transforms.
 *  2. FREE     — released in order of distance into a 3D simulation around the hole;
 *                still real DOM, now spiralling and tidally stretched.
 *  3. SHATTERED — handed to WebGL: the element is hidden and replaced, on the same
 *                frame and with the same transform, by jittered shards cut from the
 *                page snapshot; each shard then has its own orbit (tidal disruption
 *                emerges from differential gravity), bends, burns and sheds particles.
 *  REBUILD     — shards fly back out of the hole along unwinding spirals and land
 *                exactly on their layout boxes, where the live DOM takes over again.
 */
export class GravityEngine {
  bodies: Body[] = []
  t = 0
  field = new GravityField()
  readonly lens = new LensModel()
  snapshot: Snapshot | null = null
  /** increments every time an element tears — the audio listens to it */
  shatterEvents = 0
  private releasing = false
  private releaseT0 = 0
  private finishing = false
  private cell = 80
  private particleFactor = 1

  // shard state (structure of arrays)
  private readonly cap: number
  private count = 0
  private readonly sOn: Uint8Array
  private readonly sMode: Uint8Array
  private readonly sBody: Int32Array
  private readonly sP: Float32Array
  private readonly sV: Float32Array
  private readonly sRot: Float32Array
  private readonly sRotV: Float32Array
  private readonly sHeat: Float32Array
  private readonly sBurn: Float32Array
  private readonly sAge: Float32Array
  private readonly sCoupling: Float32Array
  private readonly sDepth0: Float32Array
  private readonly sScale0: Float32Array
  private readonly sEmit: Float32Array
  private readonly sEmitTotal: Float32Array
  private readonly sSize: Float32Array
  private readonly sRb: Float32Array
  /** accumulated tidal strain (spaghettification never springs back) */
  private readonly sStretch: Float32Array
  /** fracture generation: 0 = cut from the element, 1-2 = torn again by tides */
  private readonly sLevel: Uint8Array
  /** strain at the last shedding event — stretching tears matter off the edges */
  private readonly sShed: Float32Array

  private readonly sp: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private readonly m = new Float32Array(4)
  private readonly col = [0, 0, 0, 0]
  private bhx = 0
  private bhy = 0
  private shadowPx = 100

  constructor(
    private readonly rig: CameraRig,
    private readonly gpu: DebrisGPU | null,
    private readonly particles: ParticleSystem | null,
  ) {
    this.cap = gpu?.shardCap ?? 0
    const n = Math.max(1, this.cap)
    this.sOn = new Uint8Array(n)
    this.sMode = new Uint8Array(n)
    this.sBody = new Int32Array(n)
    this.sP = new Float32Array(n * 3)
    this.sV = new Float32Array(n * 3)
    this.sRot = new Float32Array(n)
    this.sRotV = new Float32Array(n)
    this.sHeat = new Float32Array(n)
    this.sBurn = new Float32Array(n)
    this.sAge = new Float32Array(n)
    this.sCoupling = new Float32Array(n)
    this.sDepth0 = new Float32Array(n)
    this.sScale0 = new Float32Array(n)
    this.sEmit = new Float32Array(n)
    this.sEmitTotal = new Float32Array(n)
    this.sSize = new Float32Array(n * 2)
    this.sRb = new Float32Array(n * 4)
    this.sStretch = new Float32Array(n)
    this.sLevel = new Uint8Array(n)
    this.sShed = new Float32Array(n)
  }

  get canShatter() {
    return !!(this.gpu && this.snapshot)
  }

  get shardsAlive() {
    let n = 0
    for (let i = 0; i < this.count; i++) n += this.sOn[i]
    return n
  }

  get bodiesLeft() {
    let n = 0
    for (const b of this.bodies) if (b.state !== St.Gone && b.state !== St.Landed) n++
    return n
  }

  configure(cellPx: number, particleFactor: number) {
    this.cell = cellPx
    this.particleFactor = particleFactor
  }

  setSnapshot(s: Snapshot | null) {
    if (this.snapshot && this.snapshot !== s) this.snapshot.dispose()
    this.snapshot = s
    this.gpu?.setSnapshot(s ? s.texture : null, s?.width ?? 1, s?.height ?? 1)
  }

  // ------------------------------------------------------------ measuring

  /** collect every gravity body under the site and measure its untransformed layout box */
  measure(site: HTMLElement, bh: { x: number; y: number }) {
    const base = site.getBoundingClientRect()
    const els = Array.from(site.querySelectorAll<HTMLElement>('[data-g]'))
    const bodies: Body[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.width < 0.5 || r.height < 0.5) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none') continue
      const g = el.dataset.g
      const kind = g === 'char' ? Kind.Char : g === 'word' ? Kind.Word : Kind.Block
      const hx = r.left - base.left
      const hy = r.top - base.top
      const area = r.width * r.height
      const mass = kind === Kind.Block ? Math.max(0.6, Math.sqrt(area) / 60) : kind === Kind.Word ? 0.8 : 0.45 + Math.sqrt(area) / 140
      bodies.push({
        el,
        kind,
        ring: el.dataset.ring !== undefined,
        boost: el.closest('.destroy') ? 2.6 : el.closest('.nav') ? 1.4 : 1,
        hx,
        hy,
        hw: r.width,
        hh: r.height,
        cx: hx + r.width / 2,
        cy: hy + r.height / 2,
        mass,
        coupling: Math.min(1.6, Math.max(0.35, 1 / Math.sqrt(mass))),
        seed: rnd(),
        rank: 0,
        state: St.Home,
        releaseAt: 0,
        releasedAt: 0,
        maxFree: 0,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        rot: 0,
        rotV: 0,
        base: 0,
        sx: hx + r.width / 2,
        sy: hy + r.height / 2,
        depth: this.rig.dist,
        scale: 1,
        m: new Float32Array([1, 0, 0, 1]),
        fade: 1,
        pending: 0,
        rbStart: 0,
        rbDur: 1,
        rbSpin: 0,
      })
    }
    const order = bodies
      .map((b, i) => ({ i, d: b.ring ? 0 : Math.hypot(b.cx - bh.x, b.cy - bh.y) }))
      .sort((a, b) => a.d - b.d)
    order.forEach((o, k) => (bodies[o.i].rank = order.length > 1 ? k / (order.length - 1) : 0))
    this.bodies = bodies
    for (const b of bodies) b.el.style.transformOrigin = '0 0'
    return bodies.length
  }

  // ------------------------------------------------------------ lifecycle

  beginRelease() {
    this.releasing = true
    this.releaseT0 = this.t
    let seed = 99
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (const b of this.bodies) {
      b.releaseAt = this.releaseT0 + Math.pow(b.rank, 0.8) * 4.0 + rnd() * 0.4 + (b.ring ? 0 : 0.15)
      b.maxFree = b.kind === Kind.Block ? 0.55 + rnd() * 0.5 : b.kind === Kind.Word ? 1.5 + rnd() * 0.6 : 1.8 + rnd() * 0.8
    }
  }

  /** speed up everything still out there (the page must be gone on cue) */
  forceFinish() {
    this.finishing = true
    for (const b of this.bodies) if (b.state === St.Home) b.releaseAt = this.t
  }

  /** the last sparks spiral in over `seconds` (used before the silence) */
  drain(seconds: number) {
    this.particles?.drain(seconds)
  }

  /** hard stop: remove anything left instantly (used right before the camera dive) */
  finalize() {
    for (const b of this.bodies) {
      if (b.state === St.Home || b.state === St.Free) {
        b.el.style.visibility = 'hidden'
        b.state = St.Gone
      }
    }
    for (let i = 0; i < this.count; i++) this.killShard(i)
    this.count = 0
    if (this.gpu) this.gpu.shardCount = 0
  }

  /** drop all transforms and shards; the page is back to pristine layout */
  clearAll() {
    for (const b of this.bodies) {
      const s = b.el.style
      s.transform = ''
      s.visibility = ''
      s.opacity = ''
      s.transformOrigin = ''
    }
    this.bodies = []
    this.releasing = false
    this.finishing = false
    for (let i = 0; i < this.count; i++) this.sOn[i] = 0
    this.count = 0
    if (this.gpu) {
      this.gpu.fx.fill(0)
      this.gpu.shardCount = 0
    }
    this.particles?.clear()
  }

  hideAll() {
    for (const b of this.bodies) {
      b.el.style.visibility = 'hidden'
      b.el.style.transform = ''
    }
  }

  // ------------------------------------------------------------ shards

  private killShard(i: number) {
    if (!this.sOn[i]) return
    this.sOn[i] = 0
    if (this.gpu) this.gpu.fx[i * 4] = 0
  }

  /** cut a body into jittered quads and hand it to WebGL with an identical transform */
  private shatter(b: Body, rebuild: boolean) {
    const gpu = this.gpu
    const snap = this.snapshot
    if (!gpu || !snap) return 0
    const cell = this.cell * Math.max(0.45, this.rig.height / 1080)
    const target = b.kind === Kind.Block ? cell : Math.max(10, Math.min(b.hw, b.hh) * (b.kind === Kind.Char ? 0.55 : 0.75))
    const cols = Math.max(1, Math.min(12, Math.round(b.hw / target)))
    const rows = Math.max(1, Math.min(12, Math.round(b.hh / target)))
    const cw = b.hw / cols
    const ch = b.hh / rows
    // jittered vertex lattice — interior vertices only, so the shards tile exactly
    const vx = new Float32Array((cols + 1) * (rows + 1))
    const vy = new Float32Array((cols + 1) * (rows + 1))
    let seed = Math.floor(b.seed * 1e6) + 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i
        const jx = i > 0 && i < cols ? (rnd() - 0.5) * 0.62 * cw : 0
        const jy = j > 0 && j < rows ? (rnd() - 0.5) * 0.62 * ch : 0
        vx[k] = i * cw + jx
        vy[k] = j * ch + jy
      }
    const wpp = this.rig.worldPerPx(b.depth)
    const R = this.rig.right
    const U = this.rig.up
    const M = b.m
    let made = 0
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        if (this.count >= this.cap) return made
        const k0 = j * (cols + 1) + i
        const k1 = k0 + 1
        const k2 = k0 + cols + 2
        const k3 = k0 + cols + 1
        const ccx = (vx[k0] + vx[k1] + vx[k2] + vx[k3]) / 4
        const ccy = (vy[k0] + vy[k1] + vy[k2] + vy[k3]) / 4
        const homeX = b.hx + ccx
        const homeY = b.hy + ccy
        if (snap.coverage(b.hx + i * cw, b.hy + j * ch, cw, ch) < 4) continue
        const s = this.count++
        this.sOn[s] = 1
        this.sMode[s] = rebuild ? 1 : 0
        this.sBody[s] = this.bodies.indexOf(b)
        const ca = gpu.cornA
        const cb = gpu.cornB
        ca[s * 4] = vx[k0] - ccx
        ca[s * 4 + 1] = vy[k0] - ccy
        ca[s * 4 + 2] = vx[k1] - ccx
        ca[s * 4 + 3] = vy[k1] - ccy
        cb[s * 4] = vx[k2] - ccx
        cb[s * 4 + 1] = vy[k2] - ccy
        cb[s * 4 + 2] = vx[k3] - ccx
        cb[s * 4 + 3] = vy[k3] - ccy
        gpu.home[s * 4] = homeX
        gpu.home[s * 4 + 1] = homeY
        gpu.home[s * 4 + 2] = rnd() * 10
        this.sSize[s * 2] = cw
        this.sSize[s * 2 + 1] = ch
        this.sStretch[s] = 1 + Math.max(0, b.base)
        this.sShed[s] = this.sStretch[s]
        this.sLevel[s] = 0
        gpu.lens[s * 4] = 0
        gpu.lens[s * 4 + 1] = -1
        gpu.lens[s * 4 + 3] = 1
        this.sHeat[s] = 0
        this.sBurn[s] = 0
        this.sAge[s] = 0
        this.sEmit[s] = 0
        this.sEmitTotal[s] = Math.min(320, Math.max(10, (cw * ch) / 12)) * this.particleFactor
        this.sCoupling[s] = Math.min(1.8, b.coupling * Math.sqrt(Math.max(0.3, (b.hw * b.hh) / Math.max(1, cw * ch))) * 0.7)
        if (rebuild) {
          this.sRb[s * 4] = b.rbStart + (rnd() - 0.5) * 0.12
          this.sRb[s * 4 + 1] = b.rbDur * (0.9 + rnd() * 0.2)
          this.sRb[s * 4 + 2] = b.rbSpin * (0.85 + rnd() * 0.3)
          this.sRb[s * 4 + 3] = rnd()
          gpu.fx[s * 4] = 0
          gpu.pos[s * 2] = this.bhx
          gpu.pos[s * 2 + 1] = this.bhy
        } else {
          // same affine map the DOM element had this frame
          const lx = ccx - b.hw / 2
          const ly = ccy - b.hh / 2
          const dx = M[0] * lx + M[2] * ly
          const dy = M[1] * lx + M[3] * ly
          const p3 = s * 3
          this.sP[p3] = b.p.x + (R.x * dx - U.x * dy) * wpp
          this.sP[p3 + 1] = b.p.y + (R.y * dx - U.y * dy) * wpp
          this.sP[p3 + 2] = b.p.z + (R.z * dx - U.z * dy) * wpp
          const spread = 0.25 + this.field.consume * 0.4
          this.sV[p3] = b.v.x + (rnd() - 0.5) * spread + lx * wpp * 0.25
          this.sV[p3 + 1] = b.v.y + (rnd() - 0.5) * spread
          this.sV[p3 + 2] = b.v.z + (rnd() - 0.5) * spread - ly * wpp * 0.25
          this.sRot[s] = b.rot
          this.sRotV[s] = b.rotV + (rnd() - 0.5) * 0.9
          this.sDepth0[s] = b.depth
          this.sScale0[s] = b.scale
          gpu.pos[s * 2] = b.sx + dx
          gpu.pos[s * 2 + 1] = b.sy + dy
          gpu.mat.set(M, s * 4)
          gpu.fx[s * 4] = 1
          gpu.fx[s * 4 + 1] = 0
          gpu.fx[s * 4 + 2] = 0
          gpu.fx[s * 4 + 3] = 0
        }
        made++
      }
    return made
  }

  private emit(s: number, n: number) {
    const ps = this.particles
    const snap = this.snapshot
    const gpu = this.gpu
    if (!ps || !snap || !gpu || n <= 0) return
    const R = this.rig.right
    const U = this.rig.up
    const p3 = s * 3
    const depth = Math.max(1, this.sp.depth)
    const wpp = this.rig.worldPerPx(depth)
    const hw = this.sSize[s * 2] * 0.5
    const hh = this.sSize[s * 2 + 1] * 0.5
    const M = gpu.mat
    const hot = Math.min(1, 0.35 + this.sHeat[s] * 0.5)
    for (let k = 0; k < n; k++) {
      let lx = 0
      let ly = 0
      let a = 0
      for (let tries = 0; tries < 3 && a < 30; tries++) {
        lx = (Math.random() * 2 - 1) * hw
        ly = (Math.random() * 2 - 1) * hh
        a = snap.sample(gpu.home[s * 4] + lx, gpu.home[s * 4 + 1] + ly, this.col)
      }
      if (a < 30) {
        this.col[0] = 255
        this.col[1] = 190
        this.col[2] = 120
      }
      const dx = M[s * 4] * lx + M[s * 4 + 2] * ly
      const dy = M[s * 4 + 1] * lx + M[s * 4 + 3] * ly
      const x = this.sP[p3] + (R.x * dx - U.x * dy) * wpp
      const y = this.sP[p3 + 1] + (R.y * dx - U.y * dy) * wpp
      const z = this.sP[p3 + 2] + (R.z * dx - U.z * dy) * wpp
      // stripped matter keeps the orbital sense of the disk (prograde kick), so it
      // forms a glowing debris ring outside the ISCO before spiralling in
      const r = Math.hypot(x, y, z)
      const rr = Math.max(r - 1, 0.3)
      const vc = Math.min(30, Math.sqrt(this.field.g * r) / rr)
      const tl = Math.hypot(x, z) || 1
      const orb = vc * (0.25 + Math.random() * 0.35) * smooth(2.6, 4.5, r)
      const kick = 0.8
      ps.spawn(
        x,
        y,
        z,
        this.sV[p3] + (-z / tl) * orb + (Math.random() - 0.5) * kick,
        this.sV[p3 + 1] + (Math.random() - 0.5) * kick,
        this.sV[p3 + 2] + (x / tl) * orb + (Math.random() - 0.5) * kick,
        this.col[0],
        this.col[1],
        this.col[2],
        hot,
        1.0 + Math.random() * 2.2,
        2.4 + Math.random() * 2.8,
      )
    }
  }

  // ------------------------------------------------------------ rebuild

  startRebuild() {
    let seed = 4242
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (const b of this.bodies) {
      b.state = St.Rebuild
      b.rbStart = this.t + 0.05 + Math.pow(b.rank, 0.9) * 1.35 + rnd() * 0.25
      b.rbDur = 1.25 + b.rank * 0.55 + rnd() * 0.25
      b.rbSpin = 2.2 + rnd() * 1.4
      b.el.style.visibility = 'hidden'
      b.el.style.transform = ''
      b.pending = this.shatter(b, true)
      if (b.pending === 0 && this.canShatter) {
        // nothing visible to fly in (e.g. transparent) — just land it on time
        b.pending = -1
      }
    }
  }

  forceLandAll() {
    for (const b of this.bodies) if (b.state !== St.Landed) this.land(b)
    for (let i = 0; i < this.count; i++) this.killShard(i)
    this.count = 0
    if (this.gpu) this.gpu.shardCount = 0
  }

  get rebuildDone() {
    return this.bodies.every((b) => b.state === St.Landed)
  }

  private rebuildPath(hx: number, hy: number, u: number, spin: number, out: { x: number; y: number; e: number; phi: number }) {
    const e = easeOut3(u)
    const dx = hx - this.bhx
    const dy = hy - this.bhy
    const R0 = Math.hypot(dx, dy)
    const a0 = Math.atan2(dy, dx)
    const a = a0 + spin * Math.pow(1 - e, 1.6)
    const R = R0 * e
    out.x = this.bhx + Math.cos(a) * R
    out.y = this.bhy + Math.sin(a) * R
    out.e = e
    out.phi = a
    return out
  }

  // ------------------------------------------------------------ frame

  update(dt: number, P: Params, bh: { x: number; y: number }, shadowPx: number) {
    this.t += dt
    this.bhx = bh.x
    this.bhy = bh.y
    this.shadowPx = shadowPx
    this.field.setFrame(P, this.rig)
    this.lens.set(this.rig, shadowPx)
    if (this.bodies.length === 0) {
      this.particles?.update(dt, this.field, this.rig, 0.45, this.lens)
      return
    }
    const sub = dt > 1 / 50 ? 2 : 1
    const h = dt / sub
    for (const b of this.bodies) {
      switch (b.state) {
        case St.Home:
          this.updateHome(b, P)
          if (this.releasing && this.t >= b.releaseAt) this.release(b)
          break
        case St.Free:
          this.updateFree(b, P, h, sub, dt)
          break
        case St.Rebuild:
          if (!this.canShatter) this.updateDomRebuild(b)
          else if (b.pending === -1 && this.t >= b.rbStart + b.rbDur) this.land(b)
          break
        default:
          break
      }
    }
    this.updateShards(dt, P, h, sub)
    this.particles?.update(dt, this.field, this.rig, 0.45, this.lens)
  }

  private writeDom(b: Body, sx: number, sy: number, M: Float32Array) {
    const e = sx - b.hx - (M[0] * b.hw + M[2] * b.hh) * 0.5
    const f = sy - b.hy - (M[1] * b.hw + M[3] * b.hh) * 0.5
    b.el.style.transform = `matrix(${M[0].toFixed(5)},${M[1].toFixed(5)},${M[2].toFixed(5)},${M[3].toFixed(5)},${e.toFixed(2)},${f.toFixed(2)})`
  }

  private updateHome(b: Body, P: Params) {
    if (P.pull <= 0.0005 && P.tremor <= 0.0005) return
    const t = this.t
    const s0 = b.seed * 50
    const dx = this.bhx - b.cx
    const dy = this.bhy - b.cy
    const r = Math.hypot(dx, dy) + 1e-3
    const ux = dx / r
    const uy = dy / r
    const q = r / this.shadowPx
    const F = Math.min(1.3, 2.2 / (q + 0.2))
    const amp = P.tremor * (0.5 + 2.2 * F) * b.boost
    const jx = (Math.sin(t * 13.1 + s0) * 0.6 + Math.sin(t * 29.7 + s0 * 1.7) * 0.4) * amp
    const jy = (Math.sin(t * 11.3 + s0 * 2.3) * 0.6 + Math.sin(t * 24.1 + s0 * 0.7) * 0.4) * amp
    if (b.ring) {
      const sc = 1 - P.pull * 0.12
      const rot = P.pull * 0.05 + P.tremor * 0.004 * Math.sin(t * 9 + s0)
      tidalMatrix(0, 1, rot, sc, b.m)
      b.sx = b.cx + jx * 0.4
      b.sy = b.cy + jy * 0.4
    } else {
      const off = P.pull * F * 0.38 * this.shadowPx
      const side = ux * 0.3 - uy >= 0 ? 1 : -1
      const rot = P.pull * F * 0.12 * side + P.tremor * F * 0.02 * Math.sin(t * 8.7 + s0) * b.boost
      const s = 1 + P.pull * F * 0.3 + P.tremor * F * 0.04 * Math.sin(t * 6.1 + s0)
      tidalMatrix(Math.atan2(uy, ux), s, rot, 1, b.m)
      b.sx = b.cx + ux * off + jx
      b.sy = b.cy + uy * off + jy
      b.base = s - 1
      b.rot = rot
    }
    this.writeDom(b, b.sx, b.sy, b.m)
  }

  private release(b: Body) {
    b.state = St.Free
    b.releasedAt = this.t
    this.rig.unprojectToSkyPlane(b.sx, b.sy, b.p)
    b.depth = this.rig.dist
    b.scale = 1
    const r = b.p.length() + 1e-3
    const speed = 1.6 + Math.random() * 1.0
    b.v.copy(b.p).multiplyScalar(-speed / r)
    b.rotV = (Math.random() - 0.5) * (b.kind === Kind.Block ? 0.4 : 1.4)
    if (b.ring) {
      b.base = 0
      b.rot = 0
      // the measuring rings are centred on the hole — they break apart immediately
      if (this.canShatter) this.shatterBody(b)
    }
  }

  private shatterBody(b: Body) {
    this.shatterEvents++
    const n = this.shatter(b, false)
    b.el.style.visibility = 'hidden'
    b.state = n > 0 || this.canShatter ? St.Shattered : St.Gone
  }

  private updateFree(b: Body, P: Params, h: number, sub: number, dt: number) {
    const f = this.field
    for (let k = 0; k < sub; k++) {
      f.accel(b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z, b.coupling)
      b.v.x += f.ax * h
      b.v.y += f.ay * h
      b.v.z += f.az * h
      b.p.addScaledVector(b.v, h)
    }
    this.rig.project(b.p.x, b.p.y, b.p.z, this.sp)
    b.sx = this.sp.x
    b.sy = this.sp.y
    b.depth = Math.max(0.5, this.sp.depth)
    b.scale = this.rig.dist / b.depth
    const r = b.p.length()
    // tidal strain accumulates (plastic): the element only ever gets longer as it falls
    b.base += dt * P.tidal * (14 / Math.pow(Math.max(r, 1.6), 2.2)) * (1 + b.base)
    const s = Math.min(5, 1 + b.base)
    // angular momentum: spin rate climbs as it falls
    b.rot += b.rotV * dt * (1 + 4 / Math.max(r, 1.5))
    const phi = Math.atan2(this.bhy - b.sy, this.bhx - b.sx)
    tidalMatrix(phi, s, b.rot, b.scale, b.m)
    const age = this.t - b.releasedAt
    if (this.canShatter) {
      const minAge = b.kind === Kind.Block ? 0.2 : 0.45
      if (age > minAge && (s > 1.62 || r < 5.5 || age > b.maxFree || this.finishing)) {
        this.writeDom(b, b.sx, b.sy, b.m)
        this.shatterBody(b)
        return
      }
    } else if (r < 2.6 || this.finishing) {
      b.fade -= dt * 2.5
      b.el.style.opacity = String(Math.max(0, b.fade))
      if (b.fade <= 0) {
        b.el.style.visibility = 'hidden'
        b.state = St.Gone
        return
      }
    }
    this.writeDom(b, b.sx, b.sy, b.m)
  }

  private updateDomRebuild(b: Body) {
    const u = Math.min(1, Math.max(0, (this.t - b.rbStart) / b.rbDur))
    if (u <= 0) return
    const o = this.rebuildPath(b.cx, b.cy, u, b.rbSpin, { x: 0, y: 0, e: 0, phi: 0 })
    const s = 1 + 1.6 * Math.pow(1 - o.e, 2)
    tidalMatrix(o.phi, s, -Math.pow(1 - o.e, 2) * 1.5, 0.25 + 0.75 * o.e, b.m)
    b.el.style.visibility = 'visible'
    b.el.style.opacity = String(Math.min(1, u * 5))
    this.writeDom(b, o.x, o.y, b.m)
    if (u >= 1) this.land(b)
  }

  private land(b: Body) {
    b.state = St.Landed
    const s = b.el.style
    s.visibility = ''
    s.transform = ''
    s.opacity = ''
  }

  /**
   * Tidal fracture: the piece splits into four along its (stretched) geometry, on
   * the same frame and with the same transform, so nothing jumps. The halves
   * nearer the hole get extra inward speed — the difference in pull is what
   * tears it — so the pieces string out into a stream instead of drifting apart.
   */
  private fracture(s: number, depth: number) {
    const gpu = this.gpu!
    const ca = gpu.cornA
    const cb = gpu.cornB
    const o = s * 4
    const c = [ca[o], ca[o + 1], ca[o + 2], ca[o + 3], cb[o], cb[o + 1], cb[o + 2], cb[o + 3]]
    // corners: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
    const pt = (i: number) => [c[i * 2], c[i * 2 + 1]]
    const mid = (a: number, b: number) => [(c[a * 2] + c[b * 2]) / 2, (c[a * 2 + 1] + c[b * 2 + 1]) / 2]
    const w = Math.hypot(c[2] - c[0], c[3] - c[1])
    const hgt = Math.hypot(c[6] - c[0], c[7] - c[1])
    const cc = [(c[0] + c[2] + c[4] + c[6]) / 4 + (Math.random() - 0.5) * 0.3 * w, (c[1] + c[3] + c[5] + c[7]) / 4 + (Math.random() - 0.5) * 0.3 * hgt]
    const m01 = mid(0, 1)
    const m12 = mid(1, 2)
    const m23 = mid(2, 3)
    const m30 = mid(3, 0)
    const quads = [
      [pt(0), m01, cc, m30],
      [m01, pt(1), m12, cc],
      [cc, m12, pt(2), m23],
      [m30, cc, m23, pt(3)],
    ]
    this.emit(s, 14)
    const M = gpu.mat
    const wpp = this.rig.worldPerPx(depth)
    const R = this.rig.right
    const U = this.rig.up
    const s3 = s * 3
    const px = this.sP[s3]
    const py = this.sP[s3 + 1]
    const pz = this.sP[s3 + 2]
    const rl = Math.hypot(px, py, pz) || 1
    const ix = -px / rl
    const iy = -py / rl
    const iz = -pz / rl
    for (const q of quads) {
      const kx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4
      const ky = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4
      const n = this.count++
      const n3 = n * 3
      const dx = M[o] * kx + M[o + 2] * ky
      const dy = M[o + 1] * kx + M[o + 3] * ky
      const ox = (R.x * dx - U.x * dy) * wpp
      const oy = (R.y * dx - U.y * dy) * wpp
      const oz = (R.z * dx - U.z * dy) * wpp
      // differential pull: the part nearer the hole is already falling faster
      const along = (ox * ix + oy * iy + oz * iz) * 1.6
      this.sOn[n] = 1
      this.sMode[n] = 0
      this.sBody[n] = this.sBody[s]
      this.sP[n3] = px + ox
      this.sP[n3 + 1] = py + oy
      this.sP[n3 + 2] = pz + oz
      this.sV[n3] = this.sV[s3] + ix * along + (Math.random() - 0.5) * 0.3
      this.sV[n3 + 1] = this.sV[s3 + 1] + iy * along + (Math.random() - 0.5) * 0.3
      this.sV[n3 + 2] = this.sV[s3 + 2] + iz * along + (Math.random() - 0.5) * 0.3
      this.sRot[n] = this.sRot[s]
      this.sRotV[n] = this.sRotV[s] + (Math.random() - 0.5) * 1.2
      this.sHeat[n] = this.sHeat[s]
      this.sBurn[n] = 0
      this.sAge[n] = this.sAge[s]
      this.sCoupling[n] = Math.min(1.9, this.sCoupling[s] * 1.1)
      this.sDepth0[n] = this.sDepth0[s]
      this.sScale0[n] = this.sScale0[s]
      this.sEmit[n] = 0
      this.sEmitTotal[n] = this.sEmitTotal[s] * 0.3
      this.sStretch[n] = this.sStretch[s]
      this.sShed[n] = this.sStretch[s]
      this.sLevel[n] = this.sLevel[s] + 1
      let minX = 1e9
      let maxX = -1e9
      let minY = 1e9
      let maxY = -1e9
      for (const v of q) {
        minX = Math.min(minX, v[0])
        maxX = Math.max(maxX, v[0])
        minY = Math.min(minY, v[1])
        maxY = Math.max(maxY, v[1])
      }
      this.sSize[n * 2] = maxX - minX
      this.sSize[n * 2 + 1] = maxY - minY
      const no = n * 4
      ca[no] = q[0][0] - kx
      ca[no + 1] = q[0][1] - ky
      ca[no + 2] = q[1][0] - kx
      ca[no + 3] = q[1][1] - ky
      cb[no] = q[2][0] - kx
      cb[no + 1] = q[2][1] - ky
      cb[no + 2] = q[3][0] - kx
      cb[no + 3] = q[3][1] - ky
      gpu.home[no] = gpu.home[o] + kx
      gpu.home[no + 1] = gpu.home[o + 1] + ky
      gpu.home[no + 2] = Math.random() * 10
      gpu.pos[n * 2] = gpu.pos[s * 2] + dx
      gpu.pos[n * 2 + 1] = gpu.pos[s * 2 + 1] + dy
      for (let i = 0; i < 4; i++) {
        M[no + i] = M[o + i]
        gpu.fx[no + i] = gpu.fx[o + i]
        gpu.lens[no + i] = gpu.lens[o + i]
      }
    }
    this.killShard(s)
  }

  private updateShards(dt: number, P: Params, h: number, sub: number) {
    const gpu = this.gpu
    if (!gpu || this.count === 0) {
      if (gpu) gpu.shardCount = 0
      return
    }
    const f = this.field
    const rig = this.rig
    const path = { x: 0, y: 0, e: 0, phi: 0 }
    let high = 0
    for (let s = 0; s < this.count; s++) {
      if (!this.sOn[s]) continue
      high = s + 1
      const p3 = s * 3
      if (this.sMode[s] === 1) {
        // ---- rebuild: analytic unwinding spiral onto the exact home box
        const start = this.sRb[s * 4]
        const dur = this.sRb[s * 4 + 1]
        const u = (this.t - start) / dur
        if (u <= 0) {
          gpu.fx[s * 4] = 0
          continue
        }
        const uu = Math.min(1, u)
        const o = this.rebuildPath(gpu.home[s * 4], gpu.home[s * 4 + 1], uu, this.sRb[s * 4 + 2], path)
        const inv = 1 - o.e
        tidalMatrix(o.phi, 1 + 2.2 * inv * inv, -inv * inv * 2.2 * (this.sRb[s * 4 + 3] - 0.5), 0.2 + 0.8 * o.e, this.m)
        gpu.mat.set(this.m, s * 4)
        gpu.pos[s * 2] = o.x
        gpu.pos[s * 2 + 1] = o.y
        gpu.fx[s * 4] = Math.min(1, uu * 6)
        gpu.fx[s * 4 + 1] = inv * inv * 1.4
        gpu.fx[s * 4 + 2] = 0
        gpu.fx[s * 4 + 3] = Math.pow(inv, 2.4) * 0.85
        gpu.lens[s * 4] = 0
        gpu.lens[s * 4 + 1] = -1
        gpu.lens[s * 4 + 3] = 1
        if (u >= 1) {
          this.killShard(s)
          const b = this.bodies[this.sBody[s]]
          if (b && --b.pending <= 0) this.land(b)
        }
        continue
      }

      // ---- physics, with gravitational time dilation (clocks near the hole run slow)
      const c = this.sCoupling[s]
      const r0 = Math.hypot(this.sP[p3], this.sP[p3 + 1], this.sP[p3 + 2])
      const lh = h * (0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - 1 / Math.max(r0, 1.0001))))
      for (let k = 0; k < sub; k++) {
        f.accel(this.sP[p3], this.sP[p3 + 1], this.sP[p3 + 2], this.sV[p3], this.sV[p3 + 1], this.sV[p3 + 2], c)
        this.sV[p3] += f.ax * lh
        this.sV[p3 + 1] += f.ay * lh
        this.sV[p3 + 2] += f.az * lh
        const sp = Math.hypot(this.sV[p3], this.sV[p3 + 1], this.sV[p3 + 2])
        if (sp > 40) {
          const k2 = 40 / sp
          this.sV[p3] *= k2
          this.sV[p3 + 1] *= k2
          this.sV[p3 + 2] *= k2
        }
        this.sP[p3] += this.sV[p3] * lh
        this.sP[p3 + 1] += this.sV[p3 + 1] * lh
        this.sP[p3 + 2] += this.sV[p3 + 2] * lh
      }
      const x = this.sP[p3]
      const y = this.sP[p3 + 1]
      const z = this.sP[p3 + 2]
      const r = Math.hypot(x, y, z)
      const g = Math.sqrt(Math.max(0, 1 - 1 / Math.max(r, 1.0001)))
      const ldt = dt * (0.25 + 0.75 * g)
      this.sAge[s] += dt
      const age = this.sAge[s]
      rig.project(x, y, z, this.sp)
      const depth = Math.max(0.5, this.sp.depth)
      const scale = (this.sScale0[s] * this.sDepth0[s]) / depth

      // spaghettification: strain grows with the tidal gradient (∝ 1/r³, softened)
      // and never relaxes; past a threshold the piece tears apart
      this.sStretch[s] = Math.min(9, this.sStretch[s] * (1 + ldt * P.tidal * (16 / Math.pow(Math.max(r, 1.5), 2.2))))
      // stretching tears glowing matter off the piece
      if (this.sStretch[s] - this.sShed[s] > 0.12) {
        this.emit(s, Math.max(2, Math.round(this.sEmitTotal[s] * 0.07)))
        this.sShed[s] = this.sStretch[s]
      }
      if (
        this.sStretch[s] > 1.5 + this.sLevel[s] * 0.8 &&
        this.sLevel[s] < 2 &&
        Math.max(this.sSize[s * 2], this.sSize[s * 2 + 1]) > 13 &&
        this.count + 4 <= this.cap &&
        !this.finishing
      ) {
        this.fracture(s, depth)
        continue
      }

      // heating and burning only deep in the well (inside the ISCO region)
      const near = r < 3.6 || age > 9.5 || this.finishing
      const ambient = smooth(9, 3, r) * 0.6
      if (near) this.sHeat[s] += ldt * (1.0 + P.consume * 2.2 + (this.finishing ? 1.2 : 0))
      else this.sHeat[s] = Math.max(this.sHeat[s], ambient)
      const burn = Math.min(1, Math.max(0, (this.sHeat[s] - 0.5) / 0.9))
      this.sBurn[s] = burn
      const want = Math.floor(this.sEmitTotal[s] * burn)
      if (want > this.sEmit[s]) {
        this.emit(s, want - this.sEmit[s])
        this.sEmit[s] = want
      }
      if (burn >= 1 || r < 1.3) {
        this.emit(s, Math.max(0, Math.floor(this.sEmitTotal[s] - this.sEmit[s])))
        this.killShard(s)
        continue
      }

      const spin = this.sRotV[s] * (1 + 5 / Math.max(r, 1.5))
      this.sRot[s] += spin * ldt
      const stretch = Math.min(10, this.sStretch[s] * (1 + this.sHeat[s] * 0.15))
      const phi = Math.atan2(this.bhy - this.sp.y, this.bhx - this.sp.x)
      tidalMatrix(phi, stretch, this.sRot[s], scale, this.m)
      gpu.mat.set(this.m, s * 4)
      gpu.pos[s * 2] = this.sp.x
      gpu.pos[s * 2 + 1] = this.sp.y
      // no fading: it reddens and darkens (shader) and is finally swallowed at the horizon
      gpu.fx[s * 4] = smooth(1.3, 1.7, r) * (this.sp.depth > 0.3 ? 1 : 0)
      gpu.fx[s * 4 + 1] = this.sHeat[s]
      gpu.fx[s * 4 + 2] = Math.min(1, age / 0.9) * P.warp
      gpu.fx[s * 4 + 3] = burn
      gpu.lens[s * 4] = this.lens.theta(this.sp.depth)
      gpu.lens[s * 4 + 1] = this.lens.sm
      gpu.lens[s * 4 + 3] = g
    }
    gpu.shardCount = high
    if (high === 0) this.count = 0
  }
}
