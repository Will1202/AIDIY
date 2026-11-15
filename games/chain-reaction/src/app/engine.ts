import { Color, Vector3 } from 'three'
import { DT, initRapier } from '../sim/physics'
import { Simulation, type SimEvent } from '../sim/simulation'
import { Recorder } from '../sim/recorder'
import type { SceneSpec } from '../sim/schema'
import { ZONE_NAMES } from '../sim/schema'
import { grandContraption } from '../sim/grandContraption'
import { World } from '../render/world'
import { defaultFx, type FxState } from '../render/pipeline'
import { guessQuality, type QualityLevel } from '../render/quality'
import { CameraRig, type CameraMode } from '../camera/rig'
import { Director } from '../camera/director'
import { AudioEngine } from '../audio/audio'
import { useUI, type Format, type TraceRow } from './store'
import type { Final } from '../sim/components/misc'
import type { Gear, Motor } from '../sim/components/clockwork'
import type { Lift } from '../sim/components/transport'

/** physics steps allowed per rendered frame; beyond that the simulation slows down instead of taking bigger steps */
const MAX_STEPS = 12
const REWIND_RATE = 1.6

/**
 * Owns the loop: fixed-step physics scheduling (speed = more or fewer fixed steps, never a bigger
 * step), history recording, rewind replay, camera direction, audio and HUD publishing.
 */
export class Engine {
  world!: World
  rig!: CameraRig
  director!: Director
  audio = new AudioEngine()
  sim!: Simulation
  recorder!: Recorder
  scene!: SceneSpec
  fx: FxState = defaultFx()
  private acc = 0
  private last = 0
  private raf = 0
  private fallback = 0
  private hudTimer = 0
  private frames = 0
  private fpsT = 0
  private stepsThisSec = 0
  private physMs = 0
  private rewindT = 0
  private prevShow = -1
  private unsub: (() => void) | null = null
  private cinemaT = -1
  private cinemaStarted = false
  private cinemaRate = 1
  private titleKey = 0
  private gearTeeth = 0
  onSceneChanged: (() => void) | null = null
  /** editor hook: per-frame update while building */
  onFrame: ((dt: number) => void) | null = null
  macroId: string | undefined

  async init(canvas: HTMLCanvasElement) {
    await initRapier()
    const gl = document.createElement('canvas').getContext('webgl2')
    const q: QualityLevel = (localStorageGet('cr.quality') as QualityLevel) || (gl ? guessQuality(gl) : 'MEDIUM')
    useUI.getState().set({ quality: q })
    this.world = new World(canvas, q)
    this.rig = new CameraRig(this.world.camera, canvas)
    this.rig.onUserInput = () => {
      const s = useUI.getState()
      if (s.camera !== 'free') {
        this.rig.syncOrbit()
        s.set({ camera: 'free' })
      }
    }
    this.load(grandContraption())
    this.rig.snap(this.director.overview())
    this.rig.syncOrbit()
    window.addEventListener('resize', this.resize)
    this.resize()
    this.last = performance.now()
    // rAF can be throttled in background panes; a timer fallback keeps first frames coming
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      this.frame(now)
    }
    this.raf = requestAnimationFrame(tick)
    this.fallback = window.setInterval(() => {
      const now = performance.now()
      if (now - this.last > 150) this.frame(now)
    }, 100)
  }

  resize = () => {
    this.world.resize()
    this.director.aspect = this.world.camera.aspect
  }

  // ---------------------------------------------------------------------------------------------
  /** load a machine: fresh simulation, fresh recorder, fresh visuals */
  load(scene: SceneSpec) {
    this.unsub?.()
    this.sim?.free()
    this.scene = scene
    this.sim = new Simulation(scene)
    this.recorder = new Recorder(this.sim, 2, 90)
    this.recorder.afterStep(true)
    this.director = new Director(this.sim)
    this.director.aspect = this.world.camera.aspect
    this.world.load(this.sim)
    this.unsub = this.sim.on(this.onEvent)
    this.acc = 0
    this.prevShow = -1
    useUI.getState().set({ run: 'ready', phase: 'READY', failReason: '', sceneName: scene.name })
    this.publish(true)
    this.onSceneChanged?.()
  }

  reset() {
    this.audio.stopLoops()
    this.load(this.scene)
    this.fx = defaultFx()
    this.cinemaT = -1
    this.cinemaStarted = false
    this.cinemaRate = 1
    useUI.getState().set({ title: null })
  }

  async start() {
    await this.audio.start()
    const s = useUI.getState()
    if (this.sim.phase !== 'READY') {
      if (s.run === 'paused') s.set({ run: 'running' })
      return
    }
    this.sim.start()
    this.audio.event('start')
    s.set({ run: 'running' })
  }

  pause() {
    const s = useUI.getState()
    if (s.run === 'running') s.set({ run: 'paused' })
    else if (s.run === 'rewinding') this.stopRewind()
  }

  resume() {
    const s = useUI.getState()
    if (s.run === 'paused') {
      // resuming after a rewind: the future we rewound over is discarded and re-simulated
      this.recorder.truncateAfter(this.sim.time)
      s.set({ run: this.sim.phase === 'READY' ? 'ready' : 'running' })
      if (this.sim.phase === 'READY') void this.start()
    } else if (s.run === 'ready') void this.start()
  }

  toggleRewind() {
    const s = useUI.getState()
    if (s.run === 'rewinding') this.stopRewind()
    else if (this.recorder.length > 1 && this.sim.time > this.recorder.firstTime + 0.05) {
      this.rewindT = this.sim.time
      this.audio.event('rewind')
      this.audio.stopLoops()
      s.set({ run: 'rewinding' })
    }
  }

  private stopRewind() {
    const t = this.recorder.seek(this.rewindT)
    this.world.interp.snap()
    this.director.reset()
    this.director.focus = { kind: 'marble', body: null }
    useUI.getState().set({ run: 'paused', phase: this.sim.phase, failReason: this.sim.failReason })
    void t
  }

  setSpeed(v: number) { useUI.getState().set({ speed: v }) }
  setCamera(m: CameraMode) {
    if (m === 'free') this.rig.syncOrbit()
    useUI.getState().set({ camera: m })
  }
  setQuality(q: QualityLevel) {
    this.world.setQuality(q)
    localStorageSet('cr.quality', q)
    useUI.getState().set({ quality: q })
    this.world.load(this.sim)
  }
  setFormat(f: Format) {
    useUI.getState().set({ format: f })
    requestAnimationFrame(() => this.resize())
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m)
    useUI.getState().set({ muted: m })
  }

  /** WATCH THE CHAIN REACTION: verified machine, director camera, event-driven titles and pacing */
  async cinematic() {
    await this.audio.start()
    useUI.getState().set({ cinematic: true, camera: 'director', mode: 'demo', screen: 'experience', speed: 1 })
    if (this.scene.name !== 'The Grand Contraption') this.load(grandContraption())
    else this.reset()
    useUI.getState().set({ cinematic: true })
    this.cinemaT = 0
    this.cinemaStarted = false
    this.fx.fade = 1
    const o = this.director.overview()
    // open close on the crown in darkness, then drift back
    this.rig.snap({ pos: o.target.clone().add(new Vector3(-3, 6, 9)), target: o.target.clone().add(new Vector3(-4, 7.5, 0)), fov: 34, rate: 1 })
    this.title('THE MACHINE', '')
  }

  exitCinematic() {
    useUI.getState().set({ cinematic: false, title: null })
    this.cinemaT = -1
    this.cinemaRate = 1
    this.fx.fade = 0
  }

  private title(big: string, small: string) {
    useUI.getState().set({ title: { big, small, key: ++this.titleKey } })
  }

  // ---------------------------------------------------------------------------------------------
  private onEvent = (e: SimEvent) => {
    this.director.onEvent(e)
    const c = e.id ? this.sim.byId.get(e.id) : undefined
    const pos = c ? c.origin : undefined
    if (e.type === 'signal' && e.id && e.to) this.world.onSignal(e.id, e.to)
    if (e.type === 'status' && c) {
      if (c.type === 'pendulum' && e.status === 'ACTIVATED') this.audio.event('latch', pos)
      if (c.type === 'button' && e.status === 'ACTIVATED') this.audio.event('button', pos)
      if (c.type === 'launcher' && e.status === 'ACTIVATED') { this.audio.event('spring', pos); this.rig.shake = 0.6 }
      if (c.type === 'hopper' && e.status === 'ACTIVATED') this.audio.event('gate', pos)
      if (c.type === 'motor' && e.status === 'ACTIVATED') this.audio.event('motor', pos)
      if (c.type === 'lift' && e.status === 'COMPLETED') this.audio.event('lift', pos)
      if (useUI.getState().cinematic && (e.status === 'ACTIVATED' || e.status === 'RUNNING')) this.cinemaCue(c.type, c.spec.zone ?? 0, e.status)
    }
    if (e.type === 'complete') {
      this.audio.event('final')
      this.rig.shake = 1.2
      this.fx.flash.setRGB(0.5, 0.35, 0.15)
    }
    if (e.type === 'fail') this.audio.event('fail')
  }

  /** event-driven pacing for the film: titles and speed ramps follow real activations */
  private cinemaCue(type: string, zone: number, status: string) {
    if (status !== 'ACTIVATED') return
    const z = (n: number) => `${String(n).padStart(2, '0')} — ${ZONE_NAMES[n]}`
    switch (type) {
      case 'dominoes': this.title('', z(2)); this.cinemaRate = 1; break
      case 'motor': this.title('', z(3)); this.cinemaRate = 1; break
      case 'hopper': if (zone === 3) { this.cinemaRate = 1.8 } break
      case 'pulley': this.title('', z(4)); this.cinemaRate = 1; break
      case 'pendulum': this.title('', z(5)); this.cinemaRate = 1; break
      case 'launcher': this.title('', z(6)); this.cinemaRate = 0.55; break
      case 'lift': this.title('', z(7)); this.cinemaRate = 1.5; break
      case 'final': this.title('', z(8)); this.cinemaRate = 1; break
    }
  }

  private frame(now: number) {
    const dtReal = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.step(dtReal)
  }

  /** one rendered frame (also callable from the test harness with a manual dt) */
  step(dtReal: number) {
    const ui = useUI.getState()
    const cinema = ui.cinematic && this.cinemaT >= 0
    if (cinema) this.cinema(dtReal)
    const t0 = performance.now()
    let steps = 0
    if (ui.run === 'running') {
      const rate = ui.speed * (cinema ? this.cinemaRate : 1)
      this.acc += dtReal * rate
      while (this.acc >= DT && steps < MAX_STEPS) {
        this.world.interp.beforeStep()
        this.sim.step()
        this.world.interp.afterStep()
        this.recorder.afterStep()
        if (this.sim.impacts.length) {
          this.audio.impacts(this.sim.impacts)
          this.world.impacts(this.sim.impacts)
          for (const im of this.sim.impacts) if (im.speed > 3 && (im.a.material === 'iron' || im.b.material === 'iron')) this.rig.shake = Math.max(this.rig.shake, 0.4)
        }
        this.acc -= DT
        steps++
      }
      if (steps === MAX_STEPS) this.acc = Math.min(this.acc, DT)
      this.world.interp.alpha = Math.min(1, this.acc / DT)
    } else if (ui.run === 'rewinding') {
      this.rewindT = Math.max(this.recorder.firstTime, this.rewindT - dtReal * REWIND_RATE)
      this.recorder.seek(this.rewindT)
      this.world.interp.snap()
      this.world.interp.alpha = 1
      if (this.rewindT <= this.recorder.firstTime + 1e-6) this.stopRewind()
    } else {
      this.world.interp.alpha = 1
      if (ui.mode === 'build') this.world.interp.snap()
    }
    this.physMs = this.physMs * 0.9 + (performance.now() - t0) * 0.1
    this.stepsThisSec += steps
    // visuals, camera, audio
    this.world.update(dtReal, ui.mode === 'build')
    this.onFrame?.(dtReal)
    const fin = this.sim.final as Final | undefined
    if (fin) {
      if (fin.showTime >= 0) this.audio.finaleClock(this.prevShow, fin.showTime)
      this.prevShow = fin.showTime
    }
    if (ui.mode !== 'build' || ui.camera !== 'free') {
      const shot = ui.screen === 'landing' && !ui.cinematic ? this.director.hero() : ui.camera === 'free' ? this.rig.freeShot() : this.director.shot(ui.camera, dtReal, this.world.interp, this.macroId)
      if (this.director.justCut && ui.camera === 'director') this.rig.cutTo(shot)
      else this.rig.set(shot)
      this.director.justCut = false
    } else this.rig.set(this.rig.freeShot())
    this.rig.update(dtReal)
    this.audioFrame(dtReal, ui.run === 'running')
    // look
    this.fx.rewind += ((ui.run === 'rewinding' ? 1 : 0) - this.fx.rewind) * Math.min(1, dtReal * 6)
    this.fx.flash.multiplyScalar(Math.exp(-dtReal * 3))
    const gold = fin && fin.showTime > 0 ? Math.min(1, fin.showTime / 6) * 0.55 : 0
    this.fx.gold += (gold - this.fx.gold) * Math.min(1, dtReal * 2)
    this.fx.bloom = 0.6 + this.fx.gold * 0.2
    this.world.render(this.fx)
    // HUD at ~8 Hz
    this.frames++
    this.fpsT += dtReal
    this.hudTimer += dtReal
    if (this.hudTimer > 0.12) {
      this.hudTimer = 0
      this.publish(false)
    }
  }

  private cinema(dt: number) {
    this.cinemaT += dt
    const t = this.cinemaT
    // 0–3 s: the machine fades up out of the dark, then the first marble is released
    this.fx.fade = Math.max(0, 1 - t / 2.2)
    if (!this.cinemaStarted && t > 3.0) {
      this.cinemaStarted = true
      this.title('', 'THE FIRST MARBLE')
      void this.start()
    }
    const fin = this.sim.final as Final | undefined
    if (fin && fin.showTime > 6.5 && fin.showTime - 1 / 60 <= 6.5 + dt) this.title('CHAIN REACTION', 'ONE MARBLE. A THOUSAND CONSEQUENCES.')
  }

  private audioFrame(dt: number, running: boolean) {
    this.audio.setListener(this.world.camera.position)
    if (!this.audio.ctx) return
    const marbles = this.sim.marbles().map((m) => {
      const v = m.body.linvel()
      let contact = false
      const col = m.body.collider(0)
      this.sim.physics.world.contactPairsWith(col, () => { contact = true })
      return { pos: m.body.translation(), speed: running ? Math.hypot(v.x, v.y, v.z) : 0, contact }
    })
    const motor = this.sim.components.find((c) => c.type === 'motor') as Motor | undefined
    const g1 = this.sim.components.find((c) => c.type === 'gear') as Gear | undefined
    if (g1) this.gearTeeth = Math.floor(Math.abs(g1.rotor.angle) / ((Math.PI * 2) / g1.num('teeth')))
    const lift = this.sim.components.find((c) => c.type === 'lift') as Lift | undefined
    this.audio.frame(dt, marbles, running && motor ? motor.speed : 0, this.gearTeeth, lift && running ? { v: lift.v, pos: lift.origin } : null)
  }

  /** push HUD / trace into the UI store */
  publish(force: boolean) {
    const s = this.sim
    const ui = useUI.getState()
    const trace: TraceRow[] = s.components
      .filter((c) => c.drive !== 'passive' && c.type !== 'gear')
      .map((c) => ({ id: c.id, label: c.spec.label ?? c.id, zone: c.spec.zone ?? 0, type: c.type, status: c.status, progress: c.progress(), drive: c.drive }))
    const fired = trace.filter((r) => r.status === 'ACTIVATED' || r.status === 'RUNNING' || r.status === 'COMPLETED').length
    let zone = 1
    for (let i = s.log.length - 1; i >= 0; i--) {
      const e = s.log[i]
      if (e.type === 'status' && e.id) {
        const z = s.byId.get(e.id)?.spec.zone
        if (z) { zone = z; break }
      }
    }
    const lastE = [...s.log].reverse().find((e) => e.type === 'status' || e.type === 'fail' || e.type === 'complete')
    const last = lastE ? `${lastE.id ? (s.byId.get(lastE.id)?.spec.label ?? lastE.id) : ''} ${lastE.status ?? (lastE.type === 'complete' ? 'COMPLETE' : 'FAILED')}` : '—'
    const fps = this.fpsT > 0 ? this.frames / this.fpsT : 0
    if (this.fpsT > 1) {
      this.frames = 0
      this.fpsT = 0
    }
    ui.set({
      phase: s.phase,
      failReason: s.failReason,
      trace,
      hud: {
        time: s.time, fired, total: trace.length, zone, last, bodies: s.bodies.length,
        stepsPerSec: ui.hud.stepsPerSec * 0.8 + (force ? 0 : this.stepsThisSec / 0.12) * 0.2,
        fps: fps || ui.hud.fps, physicsMs: this.physMs, recorded: this.recorder.duration, rewindAt: this.rewindT, shot: this.director.shotName,
      },
    })
    this.stepsThisSec = 0
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    clearInterval(this.fallback)
    window.removeEventListener('resize', this.resize)
    this.unsub?.()
    this.rig.dispose()
    this.world.dispose()
    this.sim.free()
  }
}

function localStorageGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
function localStorageSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* private mode */ }
}

export const engine = new Engine()
export { Color }
