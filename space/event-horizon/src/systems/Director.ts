import * as THREE from 'three'
import { gsap } from 'gsap'
import { CameraRig, DEG, observatoryFraming, universeTanY, type Framing } from '../gl/CameraRig'
import { GLRenderer, type FrameState } from '../gl/Renderer'
import { AudioEngine } from './AudioEngine'
import { GravityEngine } from './GravityEngine'
import { ParticleSystem } from './Physics'
import { captureSite, type Snapshot } from './Snapshot'
import { AdaptiveScaler, TIERS, detectTier, type QualitySetting, type Tier } from './Quality'
import { IDLE_PARAMS, freshParams, type Params } from './params'
import { useStore, type Phase } from '../state/store'

export const directorRef: { current: Director | null } = { current: null }

interface DirectorOptions {
  stage: HTMLElement
  canvas: HTMLCanvasElement
  getSite: () => HTMLElement | null
}

const BASE_ELEV = 7.5 * DEG

/**
 * Transition Director — the single owner of time.
 *
 *   IDLE → ACTIVATING → DISTORTING → FRAGMENTING → ACCRETING → CROSSING
 *        → PARALLEL_UNIVERSE → REBUILDING → IDLE
 *
 * One GSAP master timeline per sequence tweens the shared Params object and fires
 * the phase changes; one gsap.ticker callback runs physics and rendering. Starting
 * anything kills whatever ran before, so replays can never stack or corrupt state.
 */
export class Director {
  readonly P: Params = freshParams()
  readonly rig = new CameraRig()
  readonly uniRig = new CameraRig()
  readonly audio = new AudioEngine()
  readonly engine: GravityEngine
  readonly gl: GLRenderer | null
  private readonly particles: ParticleSystem | null
  private readonly scaler: AdaptiveScaler
  private tier: Tier
  private quality: QualitySetting = 'auto'
  private tl: gsap.core.Timeline | null = null
  private delayed: gsap.core.Tween | null = null
  private phase: Phase = 'LOADING'
  private framing: Framing = observatoryFraming(16 / 9)
  private uniTan = 0.4
  private time = 0
  private diskTime = 0
  private tunnelTravel = 0
  private skyAngle = 0
  private uniDrift = 0
  private readonly bhPx = { x: 0, y: 0 }
  private shadowPx = 100
  private readonly shake = { x: 0, y: 0 }
  private readonly hotPos = new THREE.Vector3(8, 0, 0)
  private readonly mouse = { x: 0, y: 0, sx: 0, sy: 0, px: -1, py: -1, act: 0 }
  private parallax = 1
  private lastTears = 0
  private cssKey = ''
  private ro: ResizeObserver | null = null
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private readonly tick = (_t: number, deltaMs: number) => this.frame(deltaMs / 1000)
  private readonly uniPos = new THREE.Vector3()
  private readonly uniTarget = new THREE.Vector3()
  private state!: FrameState

  constructor(private readonly opts: DirectorOptions) {
    let probeTier: Tier = 'high'
    try {
      const c = document.createElement('canvas')
      probeTier = detectTier(c.getContext('webgl2'))
    } catch {
      probeTier = 'low'
    }
    this.tier = probeTier
    const spec = TIERS[this.tier]
    this.gl = GLRenderer.create(opts.canvas, spec)
    this.scaler = new AdaptiveScaler(spec)
    this.particles = this.gl ? new ParticleSystem(this.gl.debris, spec.particles) : null
    this.engine = new GravityEngine(this.rig, this.gl?.debris ?? null, this.particles)
    this.engine.configure(spec.shardCell, spec.particles / TIERS.high.particles)
    useStore.getState().set({ glOk: !!this.gl, tier: this.tier })
  }

  start() {
    const { stage } = this.opts
    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(stage)
    window.addEventListener('resize', this.onResize)
    window.addEventListener('pointermove', this.onPointer, { passive: true })
    window.addEventListener('pointerdown', this.onGesture, { passive: true })
    window.addEventListener('keydown', this.onGesture)
    this.updateCamera(0)
    this.state = {
      time: 0,
      dt: 1 / 60,
      P: this.P,
      rig: this.rig,
      uniRig: this.uniRig,
      bhPx: this.bhPx,
      shadowPx: this.shadowPx,
      diskTime: 0,
      tunnelTravel: 0,
      hotPos: this.hotPos,
      shakePx: this.shake,
      skyAngle: 0,
    }
    if (this.gl) {
      this.updateUniverseCamera(0)
      this.gl.warmUp(this.state)
    }
    this.P.exposure = 0
    gsap.to(this.P, { exposure: 1, duration: 1.6, ease: 'power2.out', delay: 0.15 })
    gsap.ticker.lagSmoothing(250, 33)
    gsap.ticker.add(this.tick)
    this.setPhase('IDLE')
    if (import.meta.env.DEV || location.search.includes('debug')) this.exposeDebug()
  }

  /**
   * Dev hook: a manual clock for headless/hidden previews where rAF is throttled.
   * __EH.manual(true) detaches GSAP and the frame loop from rAF; __EH.step(sec)
   * then advances the whole film deterministically; __EH.bench(n) times frames.
   */
  private exposeDebug() {
    let manual = false
    let clock = 0
    const api = {
      director: this,
      manual: (on: boolean) => {
        if (on === manual) return
        manual = on
        if (on) {
          gsap.ticker.remove(this.tick)
          gsap.ticker.remove(gsap.updateRoot)
          clock = gsap.ticker.time
        } else {
          gsap.ticker.add(gsap.updateRoot)
          gsap.ticker.add(this.tick)
        }
      },
      step: (seconds: number, fps = 30) => {
        const n = Math.max(1, Math.round(seconds * fps))
        for (let i = 0; i < n; i++) {
          clock += 1 / fps
          gsap.updateRoot(clock)
          this.frame(1 / fps)
        }
        return { phase: this.phase, shards: this.engine.shardsAlive, bodies: this.engine.bodiesLeft, particles: this.particles?.alive ?? 0 }
      },
      bench: (n = 20) => {
        const gl = this.gl?.renderer.getContext()
        const px = new Uint8Array(4)
        const t0 = performance.now()
        for (let i = 0; i < n; i++) {
          this.frame(1 / 60)
          gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        }
        return { msPerFrame: (performance.now() - t0) / n, scale: this.gl?.worldScale, canvas: [this.gl?.canvasW, this.gl?.canvasH] }
      },
    }
    ;(window as unknown as { __EH: typeof api }).__EH = api
  }

  dispose() {
    gsap.ticker.remove(this.tick)
    this.tl?.kill()
    this.delayed?.kill()
    gsap.killTweensOf(this.P)
    this.ro?.disconnect()
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('pointermove', this.onPointer)
    window.removeEventListener('pointerdown', this.onGesture)
    window.removeEventListener('keydown', this.onGesture)
    this.engine.clearAll()
    this.engine.setSnapshot(null)
    this.audio.dispose()
    this.gl?.dispose()
    if (directorRef.current === this) directorRef.current = null
  }

  // ------------------------------------------------------------ input

  private readonly onGesture = () => {
    if (useStore.getState().sound) this.audio.unlock()
  }

  private readonly onPointer = (e: PointerEvent) => {
    const r = this.opts.stage.getBoundingClientRect()
    this.mouse.px = e.clientX - r.left
    this.mouse.py = e.clientY - r.top
    this.mouse.x = (this.mouse.px / r.width) * 2 - 1
    this.mouse.y = (this.mouse.py / r.height) * 2 - 1
    this.mouse.act = 1
  }

  // ------------------------------------------------------------ settings

  setSound(on: boolean) {
    if (on) this.audio.unlock()
    this.audio.setEnabled(on)
  }

  setQuality(q: QualitySetting) {
    this.quality = q
    const tier = q === 'auto' ? this.tier : q
    const spec = TIERS[tier]
    this.gl?.setTier(spec)
    this.scaler.reset(spec)
    this.particles?.setLimit(spec.particles)
    this.engine.configure(spec.shardCell, spec.particles / TIERS.high.particles)
    useStore.getState().set({ quality: q, tier })
  }

  get currentPhase() {
    return this.phase
  }

  private setPhase(p: Phase) {
    this.phase = p
    useStore.getState().setPhase(p)
  }

  private readonly onResize = () => this.resize()

  private resize() {
    const r = this.opts.stage.getBoundingClientRect()
    const w = Math.max(1, r.width)
    const h = Math.max(1, r.height)
    this.rig.setViewport(w, h)
    this.uniRig.setViewport(w, h)
    this.framing = observatoryFraming(w / h)
    this.uniTan = universeTanY(w / h)
    this.gl?.resize(w, h)
    this.updateCamera(0)
    this.writeCssVars(true)
  }

  /** HUD geometry (in CSS) follows the projected hole in its resting framing */
  private writeCssVars(force = false) {
    const f = this.framing
    const w = this.rig.width
    const h = this.rig.height
    const x = ((f.shiftX + 1) / 2) * w
    const y = ((1 - f.shiftY) / 2) * h
    const D = f.dist
    const B = 1.5 * Math.sqrt(3)
    const s = (B * Math.sqrt(1 - 1 / D)) / D
    const r = (s / Math.sqrt(1 - s * s) / f.tanY) * 0.5 * h
    const u = (0.5 * h) / (D * f.tanY)
    const key = `${x.toFixed(1)}|${y.toFixed(1)}|${r.toFixed(1)}`
    if (!force && key === this.cssKey) return
    this.cssKey = key
    const st = this.opts.stage.style
    st.setProperty('--bh-x', `${x.toFixed(2)}px`)
    st.setProperty('--bh-y', `${y.toFixed(2)}px`)
    st.setProperty('--bh-r', `${r.toFixed(2)}px`)
    st.setProperty('--bh-u', `${u.toFixed(3)}px`)
    st.setProperty('--bh-e', `${Math.sin(BASE_ELEV).toFixed(4)}`)
  }

  /** resting-framing position of the hole — used to rank bodies before the camera moves */
  private restingBh() {
    const f = this.framing
    return { x: ((f.shiftX + 1) / 2) * this.rig.width, y: ((1 - f.shiftY) / 2) * this.rig.height }
  }

  // ------------------------------------------------------------ frame

  private updateCamera(dt: number) {
    const P = this.P
    const f = this.framing
    const m = this.mouse
    const k = 1 - Math.exp(-dt * 2.2)
    m.sx += (m.x - m.sx) * k
    m.sy += (m.y - m.sy) * k
    const wantPar = this.reduced ? 0 : this.phase === 'IDLE' || this.phase === 'LOADING' ? 1 : 0
    this.parallax += (wantPar - this.parallax) * (1 - Math.exp(-dt * 1.5))
    const half = Math.min(Math.atan(f.tanY) * P.fovMul, 80 * DEG)
    this.rig.setLens(Math.tan(half), f.shiftX * P.frame, f.shiftY * P.frame)
    const elev = BASE_ELEV + P.elevAdd - m.sy * 2.4 * DEG * this.parallax
    const azim = m.sx * 5.5 * DEG * this.parallax
    this.rig.orbit(Math.max(0.2, f.dist * P.dolly), elev, azim)
    this.rig.targetScreen(this.bhPx)
    this.shadowPx = this.rig.shadowRadiusPx()

    // the magnetic hot-spot follows the cursor across the disk
    if (m.px >= 0) {
      const hit = this.rig.unprojectToDisk(m.px, m.py, new THREE.Vector3())
      if (hit) {
        const len = Math.hypot(hit.x, hit.z)
        const rr = Math.min(Math.max(len, 3), 11)
        const tx = (hit.x / (len || 1)) * rr
        const tz = (hit.z / (len || 1)) * rr
        this.hotPos.x += (tx - this.hotPos.x) * k
        this.hotPos.z += (tz - this.hotPos.z) * k
      }
    }
    m.act = Math.max(0, m.act - dt * 0.35)
    this.P.hot = this.phase === 'IDLE' ? 0.35 + m.act * 0.65 : 0.2
  }

  private updateUniverseCamera(dt: number) {
    const P = this.P
    if (this.phase === 'PARALLEL_UNIVERSE') this.uniDrift += dt * 2.2
    const t = this.time
    const travel = P.uniTravel
    this.uniPos.set(Math.sin(t * 0.05) * 7 + (1 - travel) * 18, 6 + Math.sin(t * 0.07) * 3, 300 * (1 - travel) - this.uniDrift)
    this.uniTarget.set(Math.sin(t * 0.031) * 25, 22 + Math.sin(t * 0.043) * 8, -900)
    this.uniRig.setLens(this.uniTan * (1 + (1 - travel) * 0.35))
    this.uniRig.lookAt(this.uniPos, this.uniTarget, (1 - travel) * 0.18 + Math.sin(t * 0.06) * 0.02)
  }

  private frame(rawDt: number) {
    const dt = Math.min(Math.max(rawDt, 0), 1 / 20)
    const P = this.P
    this.time += dt
    this.diskTime += dt * P.diskSpeed
    this.tunnelTravel += dt * P.tunnelSpeed
    this.skyAngle += dt * 0.013
    this.updateCamera(dt)
    if (P.uni > 0.001) this.updateUniverseCamera(dt)

    // screen shake (coherent noise, never random per frame)
    const amp = this.reduced ? 0 : (P.shake + P.kick) * 9
    const t = this.time
    this.shake.x = (Math.sin(t * 37.1) * 0.55 + Math.sin(t * 61.7 + 1.3) * 0.3 + Math.sin(t * 17.3 + 4.1) * 0.15) * amp
    this.shake.y = (Math.sin(t * 41.3 + 2.1) * 0.55 + Math.sin(t * 57.9 + 0.4) * 0.3 + Math.sin(t * 13.7 + 2.9) * 0.15) * amp
    const site = this.opts.getSite()
    if (site) site.style.transform = amp > 0.01 ? `translate3d(${this.shake.x.toFixed(2)}px,${this.shake.y.toFixed(2)}px,0)` : ''

    this.engine.update(dt, P, this.bhPx, this.shadowPx)
    if (this.engine.shatterEvents !== this.lastTears) {
      this.lastTears = this.engine.shatterEvents
      this.audio.cue('tear')
    }

    if (this.gl) {
      const s = this.state
      s.time = this.time
      s.dt = dt
      s.shadowPx = this.shadowPx
      s.diskTime = this.diskTime
      s.tunnelTravel = this.tunnelTravel
      s.skyAngle = this.skyAngle
      this.gl.render(s)
      if (this.quality === 'auto' && this.scaler.sample(rawDt)) this.gl.setWorldScale(this.scaler.scale)
    }
    this.audio.update(P, P.tunnelSpeed)
  }

  // ------------------------------------------------------------ sequences

  private kill() {
    this.tl?.kill()
    this.tl = null
    this.delayed?.kill()
    this.delayed = null
    gsap.killTweensOf(this.P)
  }

  private resetParams(except: (keyof Params)[] = []) {
    for (const k of Object.keys(IDLE_PARAMS) as (keyof Params)[]) if (!except.includes(k)) this.P[k] = IDLE_PARAMS[k]
  }

  /** DESTROY REALITY — the 26-second film */
  destroy() {
    const st = useStore.getState()
    if (this.phase !== 'IDLE' || !st.introDone) return
    const site = this.opts.getSite()
    if (!site) return
    if (st.sound) this.audio.unlock()
    this.kill()
    this.resetParams(['exposure'])
    this.P.exposure = 1

    this.engine.clearAll()
    this.engine.measure(site, this.restingBh())
    this.setPhase('ACTIVATING')
    const P = this.P
    const tl = gsap.timeline()
    this.tl = tl
    let snapReady = !this.gl
    const snapP: Promise<Snapshot | null> = this.gl ? captureSite(site, this.gl.dpr).catch(() => null) : Promise.resolve(null)
    snapP.then((s) => {
      if (this.tl !== tl) return s?.dispose()
      this.engine.setSnapshot(s)
      snapReady = true
    })

    const at = (time: number, fn: () => void) => tl.call(fn, [], time)
    const cue = (time: number, c: Parameters<AudioEngine['cue']>[0]) => at(time, () => this.audio.cue(c))
    const flashK = this.reduced ? 0.35 : 1

    // ---- ACTIVATING: the hole wakes up
    at(0, () => this.setPhase('ACTIVATING'))
    cue(0, 'shock')
    tl.set(P, { ripple: 1, rippleR: 0 }, 0)
    tl.to(P, { rippleR: 1.7, duration: 2.4, ease: 'power2.out' }, 0)
    tl.to(P, { ripple: 0, duration: 2.4, ease: 'power1.in' }, 0)
    tl.to(P, { flash: 0.2 * flashK, duration: 0.06 }, 0).to(P, { flash: 0, duration: 0.9, ease: 'power2.out' }, 0.06)
    tl.to(P, { shake: 0.55, duration: 0.08 }, 0).to(P, { shake: 0.1, duration: 0.8 }, 0.08)
    tl.to(P, { exposure: 1.2, duration: 0.12 }, 0).to(P, { exposure: 1.05, duration: 1.4 }, 0.12)
    tl.to(P, { diskSpeed: 2.4, diskBright: 1.28, ringBoost: 1.5, waves: 0.7, duration: 3, ease: 'power2.in' }, 0)
    tl.addPause(0.6, () => {
      const go = () => {
        if (this.tl !== tl) return
        site.classList.add('gravity')
        tl.resume()
      }
      if (snapReady) go()
      else snapP.then(go)
    })
    cue(0.6, 'activate')
    tl.to(P, { tremor: 1, duration: 2.4, ease: 'power1.in' }, 0.6)
    tl.to(P, { pull: 1, duration: 2.4, ease: 'power2.in' }, 0.6)
    tl.to(P, { shake: 0.26, duration: 2.4, ease: 'power1.in' }, 0.6)

    // ---- DISTORTING: elements are released into the field
    at(3.0, () => {
      this.setPhase('DISTORTING')
      this.engine.beginRelease()
    })
    tl.to(P, { gravity: 1, swirl: 1, duration: 2.2, ease: 'power2.in' }, 3.0)
    tl.to(P, { tidal: 1, duration: 3, ease: 'power1.inOut' }, 3.0)
    tl.to(P, { drag: 0.6, duration: 4 }, 3.0)
    tl.to(P, { tremor: 0.35, duration: 2 }, 3.4)
    tl.to(P, { diskSpeed: 3.2, diskBright: 1.45, beaming: 0.9, duration: 5 }, 3.0)

    // ---- FRAGMENTING: tidal disruption, lensing of the debris
    at(5.4, () => this.setPhase('FRAGMENTING'))
    tl.to(P, { lensMask: 1, duration: 0.6 }, 3.0)
    tl.to(P, { warp: 1, duration: 2.6, ease: 'power2.inOut' }, 4.4)
    tl.to(P, { gravity: 1.8, duration: 3, ease: 'power1.in' }, 6.0)
    tl.to(P, { roar: 0.6, duration: 3 }, 5.0)
    for (const b of [5.6, 6.7, 7.6, 8.4, 9.1, 9.7, 10.2, 10.6, 11.0]) {
      cue(b, 'boom')
      tl.to(P, { kick: 0.4, duration: 0.05 }, b).to(P, { kick: 0, duration: 0.55, ease: 'power2.out' }, b + 0.05)
    }

    // ---- ACCRETING: everything left is swallowed
    at(8.0, () => this.setPhase('ACCRETING'))
    tl.to(P, { consume: 1, duration: 3.2, ease: 'power2.in' }, 8.0)
    tl.to(P, { roar: 1, shake: 0.42, waves: 1, duration: 3 }, 8.0)
    at(11.3, () => this.engine.forceFinish())
    at(12.0, () => this.engine.drain(0.7))
    at(12.6, () => this.engine.finalize())

    // ---- the silence after
    cue(12.6, 'silence')
    tl.to(P, { shake: 0, roar: 0, tremor: 0, pull: 0, waves: 0.15, duration: 0.35 }, 12.6)
    tl.to(P, { diskSpeed: 1.5, duration: 1.2 }, 12.6)
    tl.to(P, { lensMask: 0, consume: 0, gravity: 0, warp: 0, tidal: 0, duration: 0.4 }, 13.0)

    // ---- CROSSING: the dive through the horizon
    at(13.4, () => this.setPhase('CROSSING'))
    cue(13.4, 'approach')
    tl.to(P, { dolly: 0.42, frame: 0, elevAdd: 3.5 * DEG, diskBright: 1.25, ringBoost: 2.0, exposure: 0.92, duration: 3.3, ease: 'sine.inOut' }, 13.4)
    tl.to(P, { dolly: 0.03, duration: 1.3, ease: 'expo.in' }, 16.7)
    tl.to(P, { fovMul: 1.9, duration: 1.3, ease: 'power2.in' }, 16.7)
    tl.to(P, { streak: 1, ca: 1, duration: 1.3, ease: 'power3.in' }, 16.7)
    tl.to(P, { shake: 0.5, duration: 1.1, ease: 'power2.in' }, 16.8)
    cue(16.7, 'cross')
    tl.to(P, { tunnel: 1, duration: 0.45, ease: 'power1.out' }, 17.65)
    tl.to(P, { flash: 0.5 * flashK, duration: 0.05 }, 17.8).to(P, { flash: 0, duration: 0.7 }, 17.85)
    tl.to(P, { bh: 0, streak: 0, duration: 0.5 }, 17.85)
    tl.to(P, { shake: 0.16, duration: 0.6 }, 17.9)
    tl.fromTo(P, { tunnelSpeed: 14 }, { tunnelSpeed: 6, duration: 3.0, ease: 'power1.out', immediateRender: false }, 17.7)
    tl.to(P, { hue: 1, duration: 3.4, ease: 'sine.inOut' }, 17.8)
    tl.to(P, { ca: 0.35, duration: 1 }, 17.9)

    // wormhole mouth opens onto the other side
    tl.set(P, { uni: 1, aperture: 0, uniTravel: 0 }, 20.4)
    tl.to(P, { aperture: 2.0, duration: 1.45, ease: 'expo.in' }, 20.55)
    tl.to(P, { tunnelSpeed: 18, duration: 1.4, ease: 'power2.in' }, 20.55)
    cue(21.8, 'arrive')
    tl.to(P, { flash: 0.55 * flashK, flashCool: 1, duration: 0.06 }, 21.9).to(P, { flash: 0, duration: 1.3, ease: 'power2.out' }, 21.96)

    // ---- PARALLEL UNIVERSE
    tl.set(P, { tunnel: 0, tunnelSpeed: 0, fovMul: 1, dolly: 1, frame: 1, elevAdd: 0, bh: 0, diskBright: 1, ringBoost: 1, exposure: 1.05 }, 22)
    at(22, () => {
      this.uniDrift = 0
      this.setPhase('PARALLEL_UNIVERSE')
    })
    tl.to(P, { uniTravel: 1, duration: 5.5, ease: 'expo.out' }, 21.95)
    tl.to(P, { shake: 0, ca: 0.1, duration: 1.5 }, 22)
    at(23.1, () => useStore.getState().set({ uniStage: 1 }))
    at(25.1, () => useStore.getState().set({ uniStage: 2 }))
    at(26.1, () => {
      useStore.getState().set({ uniStage: 3 })
      this.audio.cue('reveal')
    })
  }

  /** REBUILD REALITY — implode the universe, pull back, reassemble the page */
  rebuild() {
    if (this.phase !== 'PARALLEL_UNIVERSE') return
    const site = this.opts.getSite()
    if (!site) return
    this.kill()
    this.setPhase('REBUILDING')
    useStore.getState().set({ uniStage: 0 })
    this.audio.cue('rebuild')

    // re-measure and re-capture the pristine layout invisibly (it may have been resized)
    this.engine.clearAll()
    site.style.opacity = '0'
    this.engine.measure(site, this.restingBh())
    let snapReady = !this.gl
    const snapP: Promise<Snapshot | null> = this.gl ? captureSite(site, this.gl.dpr).catch(() => null) : Promise.resolve(null)
    snapP.then((s) => {
      if (this.phase !== 'REBUILDING') return s?.dispose()
      this.engine.setSnapshot(s)
      this.engine.hideAll()
      site.style.opacity = ''
      snapReady = true
    })

    const P = this.P
    const tl = gsap.timeline()
    this.tl = tl
    const at = (time: number, fn: () => void) => tl.call(fn, [], time)
    tl.to(P, { implode: 1, duration: 1.7, ease: 'power3.in' }, 0)
    tl.to(P, { ca: 0.6, shake: 0.2, duration: 1.6, ease: 'power2.in' }, 0)
    tl.addPause(1.6, () => {
      const go = () => {
        if (this.tl !== tl) return
        if (!this.gl) {
          this.engine.hideAll()
          site.style.opacity = ''
        }
        tl.resume()
      }
      if (snapReady) go()
      else snapP.then(go)
    })
    at(1.6, () => this.audio.cue('implode'))
    tl.set(P, { flash: this.reduced ? 0.4 : 1, flashCool: 0.4 }, 1.62)
    tl.to(P, { flash: 0, duration: 1.1, ease: 'power2.out' }, 1.65)
    tl.set(P, { uni: 0, implode: 0, bh: 1, dolly: 0.13, frame: 0, fovMul: 1.5, diskSpeed: 2.2, diskBright: 1.6, ringBoost: 2, ripple: 1, rippleR: 0, shake: 0.3, ca: 0.4 }, 1.62)
    tl.to(P, { dolly: 1, frame: 1, fovMul: 1, duration: 3.0, ease: 'expo.out' }, 1.62)
    tl.to(P, { rippleR: 1.6, duration: 2.2, ease: 'power2.out' }, 1.62)
    tl.to(P, { ripple: 0, duration: 2.2 }, 1.62)
    tl.to(P, { diskSpeed: 1, diskBright: 1, ringBoost: 1, exposure: 1, shake: 0, ca: 0, flashCool: 0, duration: 3.2 }, 1.8)
    at(2.0, () => {
      site.classList.add('gravity')
      this.engine.startRebuild()
    })
    at(3.6, () => this.audio.cue('land'))
    at(6.2, () => this.finishRebuild())
  }

  private finishRebuild() {
    const site = this.opts.getSite()
    this.engine.forceLandAll()
    this.engine.clearAll()
    this.engine.setSnapshot(null)
    site?.classList.remove('gravity')
    if (site) site.style.opacity = ''
    this.tl = null
    this.resetParams(['exposure'])
    gsap.to(this.P, { exposure: 1, duration: 0.6 })
    this.setPhase('IDLE')
  }

  /** instant, clean return to the observatory (used by REPLAY and on errors) */
  resetInstant() {
    this.kill()
    const site = this.opts.getSite()
    this.engine.clearAll()
    this.engine.setSnapshot(null)
    site?.classList.remove('gravity')
    if (site) {
      site.style.opacity = ''
      site.style.transform = ''
    }
    this.resetParams()
    this.P.exposure = 0
    gsap.to(this.P, { exposure: 1, duration: 1.0, ease: 'power2.out' })
    this.audio.scene('observatory', 1)
    const st = useStore.getState()
    st.set({ uniStage: 0, introDone: false, introKey: st.introKey + 1 })
    this.setPhase('IDLE')
    this.delayed = gsap.delayedCall(1.7, () => useStore.getState().set({ introDone: true }))
  }

  /** DEMO REPLAY — one click plays the whole film from a clean observatory */
  replay() {
    this.resetInstant()
    const tl = gsap.timeline()
    this.tl = tl
    tl.call(() => useStore.getState().set({ introDone: true }), [], 1.7)
    tl.call(
      () => {
        this.tl = null
        this.destroy()
      },
      [],
      3.0,
    )
  }
}
