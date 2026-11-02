import {
  ACESFilmicToneMapping, Color, PCFShadowMap, Quaternion, Scene, SRGBColorSpace, Vector3, Vector4, WebGLRenderer,
} from 'three'
import {
  CORE_HOME, GRAVITY_MODES, ROOM, WORLD_H, clamp, damp, rng, type CreationMode, type GravityMode,
} from '../core/config'
import { HeadTrackedCamera } from '../camera/HeadTrackedCamera'
import { ViewerRig, eyeWorldFromCm, worldPerCm, type ViewerSettings } from '../camera/Viewer'
import { PhysicsEngine, RAPIER, type PhysObj } from '../physics/PhysicsEngine'
import { installHoming, startHoming } from '../physics/Homing'
import { Lab } from '../world/Lab'
import { EnergyCore } from '../world/EnergyCore'
import { ObjectFactory } from '../world/ObjectFactory'
import { Creations } from '../world/Creations'
import { ScreenBoundary } from '../screen/ScreenBoundary'
import { FractureSystem, type Shard } from '../screen/FractureSystem'
import { Dust } from '../fx/Dust'
import { Shockwave } from '../fx/Shockwave'
import { Overflow } from '../fx/Overflow'
import { PostFX } from '../fx/PostFX'
import { Reticles } from '../fx/Reticles'
import { HandOverlay } from '../fx/HandOverlay'
import { SpatialInteraction } from '../interaction/SpatialInteraction'
import { MouseInput } from '../interaction/MouseInput'
import { TrackingEngine } from '../tracking/TrackingEngine'
import { HeadTracker } from '../tracking/HeadTracker'
import { GestureEngine, type GestureEvent, type Pointer } from '../tracking/GestureEngine'
import type { VisionResult } from '../tracking/visionRunner'
import { AudioEngine } from '../audio/AudioEngine'
import { CinematicDirector, type DirectorHost } from '../cinematic/CinematicDirector'
import { PerformanceManager, QUALITY, type QualityLevel, type QualityPreset } from './Quality'
import { saveSettings, toast, useUI, type WorldState } from '../state/store'

const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('debug')

/**
 * Owns the frame: input (camera tracking, mouse, demo) → head-coupled eye →
 * spatial interaction → fixed-step physics → glass / fracture / overflow →
 * render. Nothing here goes through React state per frame; the UI gets a
 * throttled status snapshot.
 */
export class Engine {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly view = new HeadTrackedCamera()
  readonly post: PostFX
  readonly lab: Lab
  readonly core: EnergyCore
  readonly factory: ObjectFactory
  readonly creations: Creations
  readonly screen = new ScreenBoundary()
  readonly fracture: FractureSystem
  readonly dust = new Dust()
  readonly shock: Shockwave
  readonly overflow: Overflow
  readonly reticles = new Reticles()
  readonly overlay = new HandOverlay()
  readonly interaction: SpatialInteraction
  readonly mouse: MouseInput
  readonly tracking = new TrackingEngine()
  readonly head: HeadTracker
  readonly gestures = new GestureEngine()
  readonly rig: ViewerRig
  readonly audio = new AudioEngine()
  readonly director: CinematicDirector
  readonly perf = new PerformanceManager()
  settings: ViewerSettings
  quality: QualityLevel = 'HIGH'
  preset: QualityPreset = QUALITY.HIGH
  labObjects: PhysObj[] = []
  creationsLive: PhysObj[] = []
  world: WorldState = 'INTACT'
  gravity: GravityMode = 'NORMAL'
  time = 0
  manualClock = false
  /** test harness: treat injected landmark results as a running camera */
  simTracking = false
  /** world units per cm of real head motion */
  scale = 0.5
  aspect = 16 / 9
  readonly vortex = { on: false, k: 0 }
  readonly fx = { shake: 0, flash: 0, radial: 0, ca: 0 }
  readonly eyeWorld = new Vector3(0, 0, 30)
  private readonly eyeShake = new Vector3()
  private rebuildT = 0
  private rebuildPhase: 'gather' | 'home' | null = null
  private rebuildWasBroken = false
  private overflowIn = -1
  private frontAlpha = 0
  private statusT = 0
  private lastFrame = performance.now()
  private raf = 0
  private canvasAspectKey = ''
  private contactBudget = 0
  private titleOn = false
  private pressPoint = new Vector3()
  private rnd = rng(77)
  private dissolving: { o: PhysObj; t: number; s: number }[] = []
  /** seconds the free core has been out of view; it drifts back if lost */
  private coreLostT = 0
  private coreRecall = false

  constructor(
    readonly host: HTMLElement,
    readonly physics: PhysicsEngine,
  ) {
    const st = useUI.getState()
    this.settings = { ...st.settings }
    this.quality = st.quality
    this.preset = QUALITY[this.quality]

    const r = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: DEV, stencil: false })
    r.outputColorSpace = SRGBColorSpace
    r.toneMapping = ACESFilmicToneMapping
    r.toneMappingExposure = 1.0
    r.shadowMap.enabled = this.preset.shadows > 0
    r.shadowMap.type = PCFShadowMap
    r.setClearColor(0x000000, 1)
    this.renderer = r
    r.domElement.className = 'gl'
    host.appendChild(r.domElement)
    host.appendChild(this.overlay.canvas)
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      toast('GPU CONTEXT LOST — RESTORING')
    })
    r.domElement.addEventListener('webglcontextrestored', () => location.reload())

    this.scene.background = new Color(0x000000)
    this.scene.environment = Lab.environment(r)
    this.scene.environmentIntensity = 0.42

    this.post = new PostFX(r, this.scene, this.view.camera, this.preset.msaa)
    this.lab = new Lab(this.scene, physics)
    this.scene.add(this.screen.group)
    this.core = new EnergyCore(physics, this.preset.halo)
    this.scene.add(this.core.group, this.core.trailMesh)
    this.factory = new ObjectFactory(physics)
    this.creations = new Creations(physics, { galaxy: this.preset.galaxy, liquidDetail: this.preset.liquidDetail })
    this.fracture = new FractureSystem(physics, this.screen)
    this.fracture.shardCount = this.preset.shards
    this.scene.add(this.fracture.group)
    this.scene.add(this.dust.points, this.dust.front)
    this.dust.setCount(this.preset.dust)
    this.shock = new Shockwave()
    this.scene.add(this.shock.group)
    this.overflow = new Overflow(physics)
    this.overflow.setCounts({ streaks: this.preset.streaks, debris: this.preset.debris, heroes: this.preset.heroes })
    this.scene.add(this.overflow.group)
    this.scene.add(this.reticles.group)

    this.head = new HeadTracker(this.settings)
    this.rig = new ViewerRig(this.settings)

    this.interaction = new SpatialInteraction(physics, this.view, {
      onGrab: (_g, o) => {
        this.audio.grab()
        if (o.kind === 'core') this.core.flash()
      },
      onRelease: (_g, _o, v) => this.audio.whoosh(v.length()),
      onCreate: (mode, at, s) => this.create(mode, at, s),
      onBurst: (o) => this.burstPlanet(o),
    })
    installHoming(physics, () => {})
    physics.preStep.push((h) => this.forces(h))
    physics.onContact = (a, b, ca, cb, force) => this.contact(a, b, ca, cb, force)

    this.mouse = new MouseInput(r.domElement)
    this.mouse.onPulse = () => this.pulse(this.mouse.pointer)
    this.mouse.onScale = (f) => {
      const o = this.interaction.grips.get('mouse')?.held
      if (o?.setScale) o.setScale(clamp(o.scale * f, 0.35, 3.2))
    }
    this.mouse.onRoll = (rad) => {
      const o = this.interaction.grips.get('mouse')?.held
      if (!o) return
      const q = o.body.rotation()
      const nq = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rad).multiply(new Quaternion(q.x, q.y, q.z, q.w))
      o.body.setRotation({ x: nq.x, y: nq.y, z: nq.z, w: nq.w }, true)
    }

    this.tracking.onResult = (res) => this.ingest(res)
    this.tracking.onStatus = () =>
      useUI.setState({ camera: this.tracking.status, cameraMsg: this.tracking.message, trackingMode: this.tracking.mode ? `${this.tracking.mode.toUpperCase()} · ${this.tracking.delegate}` : '' })

    this.director = new CinematicDirector(this.hostForDirector())

    this.resize()
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(host)
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('keydown', (e) => this.key(e))
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = performance.now()
    })

    this.populate(this.preset.labObjects)
    this.loop()
  }

  static async create(host: HTMLElement) {
    useUI.setState({ loadingMsg: 'LOADING PHYSICS' })
    const physics = await PhysicsEngine.create()
    useUI.setState({ loadingMsg: 'BUILDING THE LAB' })
    await new Promise((r) => setTimeout(r, 0))
    return new Engine(host, physics)
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  private populate(n: number) {
    for (const o of this.labObjects) this.physics.remove(o)
    this.labObjects = this.factory.populate(n)
    for (const o of this.labObjects) this.scene.add(o.object)
    // let them settle, then remember where they came to rest (REBUILD returns them here)
    for (let i = 0; i < 200; i++) this.physics.step(this.physics.h)
    for (const o of this.labObjects) o.home = { p: o.currP.clone(), q: o.currQ.clone() }
    this.physics.sync(0)
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.manualClock) return
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.frame(dt)
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.perf.scale
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = `${w}px`
    this.renderer.domElement.style.height = `${h}px`
    this.post.setSize(w, h, pr)
    this.post.bloom.resolution.set(w * this.preset.bloomScale, h * this.preset.bloomScale)
    this.overlay.resize(w, h, Math.min(2, window.devicePixelRatio || 1))
    this.lab.setPixelRatio(pr)
    this.core.setPixelRatio(pr)
    this.aspect = w / h
    const key = this.aspect.toFixed(3)
    if (key !== this.canvasAspectKey) {
      this.canvasAspectKey = key
      this.screen.layout(this.aspect)
      this.physics.setAperture({ halfW: this.screen.halfW, halfH: this.screen.halfH })
      this.physics.setGlassSolid(this.screen.intact)
    }
    this.view.setScreen(WORLD_H * this.aspect, WORLD_H)
    this.interaction.apertureHalf.set(this.screen.halfW, this.screen.halfH)
    this.interaction.canvasHalf.set((WORLD_H * this.aspect) / 2, WORLD_H / 2)
    this.interaction.viewport.set(w, h)
    this.scale = worldPerCm(this.settings, h, screen.width || 1920)
  }

  // ── per frame ─────────────────────────────────────────────────────

  frame(dt: number) {
    this.time += dt
    if (this.perf.tick(dt) && useUI.getState().autoRes) this.resize()
    this.mouse.update(dt)
    this.tracking.pump()

    // inputs → pointers
    const pointers: Pointer[] = []
    if (this.director.active) {
      this.director.update(dt)
      pointers.push(this.director.pointer)
    } else {
      if (this.tracking.running || this.simTracking) pointers.push(...this.gestures.pointers)
      if (this.mouse.pointer.present || this.mouse.pointer.pinch) pointers.push(this.mouse.pointer)
    }

    // head → eye → off-axis frustum
    const hs = this.head.state
    this.rig.update(dt, {
      tracked: (this.tracking.running || this.simTracking) && hs.present ? hs.cm : null,
      simulated: this.director.active ? null : this.mouse.simulated,
      demo: this.director.active ? this.director.head : null,
    })
    eyeWorldFromCm(this.rig.cm, this.settings, this.scale, this.eyeWorld)
    const sh = this.fx.shake
    this.eyeShake.set((this.rnd() - 0.5) * sh * 0.5, (this.rnd() - 0.5) * sh * 0.5, 0)
    this.view.setEye(this.eyeWorld.clone().add(this.eyeShake))

    // interaction (sets spring targets used by the fixed steps)
    this.interaction.glassIntact = this.screen.intact
    this.interaction.update(pointers, dt)
    this.glassLogic(dt)

    // simulate
    this.physics.step(dt)
    this.physics.sync(dt)

    // a thrown core that ends up out of view drifts back into the window
    const co = this.core.obj
    if (this.core.free && !co.held && !co.homing) {
      const n = co.object.position.clone().project(this.view.camera)
      const off = Math.abs(n.x) > 1.02 || Math.abs(n.y) > 1.02 || n.z > 1
      this.coreLostT = off ? this.coreLostT + dt : 0
      if (this.coreLostT > 2.5) this.coreRecall = true
      if (!off && this.coreLostT === 0 && this.coreRecall && co.currP.distanceTo(this.recallTarget()) < 2) this.coreRecall = false
    } else {
      this.coreRecall = false
      this.coreLostT = 0
    }

    // systems
    this.core.update(dt, this.time)
    this.core.updateTrail(this.view.eye)
    this.lab.update(this.time, dt, this.core.energy)
    const stress = this.screen.intact ? clamp(this.screen.damage * 0.85 + this.interaction.maxPress * 0.05, 0, 1) : 0
    this.screen.update(dt, this.time, this.view.eye, stress)
    this.fracture.update(dt)
    this.shock.update(dt, this.renderer.getPixelRatio())
    if (this.overflowIn > 0) {
      this.overflowIn -= dt
      if (this.overflowIn <= 0) {
        this.overflow.start(this.screen.halfW, this.screen.halfH, this.view.eye, this.core.group.position)
        this.audio.rush()
      }
    }
    this.overflow.update(dt, this.time)
    this.frontAlpha += ((this.screen.intact && this.world !== 'REBUILDING' ? 0 : 1) - this.frontAlpha) * damp(1.5, dt)
    this.vortex.k += ((this.vortex.on ? 1 : 0) - this.vortex.k) * damp(2.5, dt)
    const c = this.core.group.position
    this.dust.update(this.time, this.renderer.getPixelRatio(), new Vector4(c.x, c.y, c.z, this.vortex.k * 0.6), this.frontAlpha)
    this.updateRebuild(dt)
    this.updateCreations(dt)

    // audio
    const near = clamp((c.z + 12) / 24, 0, 1)
    this.audio.setCore(this.core.energy, near)

    // overlays
    const ui = useUI.getState()
    const showUI = !ui.uiHidden || this.director.active
    this.reticles.update(this.interaction.grips.values(), this.view.eye, this.time, showUI && !this.titleOn)
    this.overlay.visible = showUI && !this.titleOn
    this.overlay.draw(pointers)

    // camera feel
    const ov = this.overflow.intensity
    this.fx.shake = Math.max(0, this.fx.shake - dt * 1.6) + ov * 0.02
    this.fx.flash *= Math.exp(-dt * 6)
    const u = this.post.u
    u.uRadial.value += (ov * 0.32 - u.uRadial.value) * damp(6, dt)
    u.uCA.value = 0.00015 + stress * 0.0015 + ov * 0.0025 + this.fx.shake * 0.002
    u.uFlash.value = this.fx.flash
    u.uSamples.value = this.preset.blurSamples
    this.post.frame(dt)

    this.statusT -= dt
    if (this.statusT <= 0) {
      this.statusT = 0.15
      this.pushStatus()
    }
  }

  // ── glass ─────────────────────────────────────────────────────────

  private glassLogic(dt: number) {
    if (!this.screen.intact) {
      this.screen.glassMat.uniforms.uPress.value.set(0, 0, 0)
      return
    }
    let press = 0
    let src: PhysObj | null = null
    for (const g of this.interaction.grips.values()) {
      if (g.press > press && g.held) {
        press = g.press
        src = g.held
      }
    }
    const u = this.screen.glassMat.uniforms.uPress.value
    if (src && press > 0.6) {
      this.pressPoint.copy(src.object.position)
      this.fracture.ensurePattern(this.pressPoint.x, this.pressPoint.y)
      const before = this.screen.damage
      this.screen.addDamage(dt * (0.03 + 0.07 * Math.min(press, 9)))
      if (Math.floor(this.screen.damage * 12) !== Math.floor(before * 12)) this.audio.crack(0.4 + this.screen.damage)
      if (this.world === 'INTACT') this.world = 'CRACKING'
      u.x += (this.pressPoint.x - u.x) * damp(10, dt)
      u.y += (this.pressPoint.y - u.y) * damp(10, dt)
    }
    u.z += (Math.min(0.32, press * 0.035) - u.z) * damp(8, dt)
    if (this.screen.damage >= 1) {
      const v = src ? src.body.linvel() : { x: 0, y: 0, z: 0 }
      const imp = this.fracture.pattern?.impact ?? [this.pressPoint.x, this.pressPoint.y]
      this.shatter(imp[0], imp[1], new Vector3(v.x, v.y, Math.max(8, v.z + 8)))
    }
  }

  private contact(a: PhysObj | null, b: PhysObj | null, ca: RAPIER.Collider, cb: RAPIER.Collider, force: number) {
    const glass = this.physics.glassCollider
    if (ca.handle === glass.handle || cb.handle === glass.handle) {
      const o = ca.handle === glass.handle ? b : a
      if (!o || o.held || !this.screen.intact) return
      const p = o.object.position
      const dmg = clamp((force - 500) / 9000, 0, 0.45)
      this.screen.ripple(p.x, p.y, clamp(force / 3000, 0.2, 1.6), this.time)
      if (this.contactBudget <= this.time) {
        this.audio.glassHit(clamp(force / 2500, 0.2, 1.5))
        this.contactBudget = this.time + 0.06
      }
      if (dmg > 0) {
        this.fracture.ensurePattern(p.x, p.y)
        this.screen.addDamage(dmg)
        this.audio.crack(0.5 + dmg * 2)
        if (this.world === 'INTACT') this.world = 'CRACKING'
        if (this.screen.damage >= 1) {
          const v = o.body.linvel()
          this.shatter(p.x, p.y, new Vector3(v.x, v.y, Math.max(6, -v.z * 0.4 + 6)))
        }
      }
      return
    }
    const o = a ?? b
    if (o && force > 60) this.audio.clink(force, o.kind !== 'shard')
  }

  /** break the pane at (x, y) on the screen plane */
  shatter(x: number, y: number, push = new Vector3(0, 0, 10)) {
    if (!this.screen.intact) return
    this.fracture.ensurePattern(x, y)
    this.fracture.shatter(push, this.view.eye)
    this.world = 'SHATTERED'
    this.interaction.glassIntact = false
    this.audio.shatter()
    const at = new Vector3(x, y, 0.4)
    this.shock.fire(at, 15, { light: 2.6, facing: new Vector3(0, 0, 1) })
    this.dust.pulse(at, this.time)
    this.fx.shake = 1.3
    this.fx.flash = 0.32
    this.core.flash()
    this.physics.explode(new Vector3(x, y, -1.5), 14, 6, 0.1, (o) => o.kind !== 'shard' && o.kind !== 'core')
    this.overflowIn = 0.3
    toast('SCREEN BREACHED')
  }

  breakGlass() {
    if (!this.screen.intact) return
    const g = this.interaction.grips.get('mouse')
    let x = this.core.group.position.x
    let y = this.core.group.position.y
    if (g && this.mouse.pointer.present) {
      const p = g.ray.origin.clone().addScaledVector(g.ray.direction, -g.ray.origin.z / Math.min(-1e-3, g.ray.direction.z))
      x = p.x
      y = p.y
    }
    this.fracture.ensurePattern(x, y)
    this.shatter(x, y, new Vector3(0, 0, 10))
  }

  // ── forces: vortex + rebuild gathering ────────────────────────────

  private recallTarget() {
    return this.screen.intact ? CORE_HOME : new Vector3(0, 0.6, 4)
  }

  private forces(h: number) {
    if (this.coreRecall) {
      const o = this.core.obj
      const d = this.recallTarget().sub(o.currP)
      const v = o.body.linvel()
      const want = d.clone().multiplyScalar(1.6)
      if (want.length() > 9) want.setLength(9)
      const s = Math.min(1, h * 3)
      o.body.setLinvel({ x: v.x + (want.x - v.x) * s, y: v.y + (want.y - v.y) * s, z: v.z + (want.z - v.z) * s }, true)
    }
    if (this.vortex.k > 0.01) {
      const c = this.core.obj.currP
      const k = this.vortex.k
      for (const o of this.physics.objs) {
        if (!o.body.isDynamic() || o.held || o.noForces || o.homing) continue
        if (o.currP.z < -1.2 && o.kind !== 'shard') continue // lab objects inside stay inside
        const dx = o.currP.x - c.x
        const dy = o.currP.y - c.y
        const r = Math.max(0.5, Math.hypot(dx, dy))
        // orbit radii chosen to stay inside the view at the core's depth
        const rt = 2.2 + (o.id % 9) * 0.42
        const zt = Math.max(1.2, c.z + ((o.id * 37) % 7) * 0.5 - 1.5)
        const vt = 9 / (1 + r * 0.04)
        const tx = -dy / r
        const ty = dx / r
        const radial = (rt - r) * 1.6
        const v = o.body.linvel()
        const wx = tx * vt + (dx / r) * radial
        const wy = ty * vt + (dy / r) * radial
        const wz = (zt - o.currP.z) * 1.2
        const s = Math.min(1, h * 3.5) * k
        o.body.setLinvel({ x: v.x + (wx - v.x) * s, y: v.y + (wy - v.y) * s, z: v.z + (wz - v.z) * s }, true)
      }
    }
    if (this.rebuildPhase === 'gather') {
      const c = new Vector3(0, 1, -4)
      for (const o of this.physics.objs) {
        if (!o.body.isDynamic() || o.held || o.homing) continue
        const v = o.body.linvel()
        const d = c.clone().sub(o.currP)
        const dist = d.length()
        d.normalize().multiplyScalar(Math.min(14, dist * 1.8))
        // a little swirl so the pull reads as a field, not a tween
        d.x += -(o.currP.y - c.y) * 0.6
        d.y += (o.currP.x - c.x) * 0.6
        const s = Math.min(1, h * 3)
        o.body.setLinvel({ x: v.x + (d.x - v.x) * s, y: v.y + (d.y - v.y) * s, z: v.z + (d.z - v.z) * s }, true)
      }
    }
  }

  // ── rebuild ───────────────────────────────────────────────────────

  rebuild() {
    if (this.world === 'REBUILDING') return
    this.interaction.releaseAll()
    this.vortex.on = false
    this.overflow.stop()
    this.overflowIn = -1
    this.rebuildWasBroken = !this.screen.intact
    this.world = 'REBUILDING'
    this.rebuildT = 0
    this.rebuildPhase = 'gather'
    this.physics.world.gravity = { x: 0, y: 0, z: 0 }
    for (const o of [...this.creationsLive]) this.dissolve(o)
    this.audio.rebuild()
    toast('REBUILDING REALITY')
  }

  private updateRebuild(dt: number) {
    if (!this.rebuildPhase) return
    this.rebuildT += dt
    if (this.rebuildPhase === 'gather' && this.rebuildT > 0.75) {
      this.rebuildPhase = 'home'
      const r = rng(Math.floor(this.time * 1000))
      const hw = this.screen.halfW
      const hh = this.screen.halfH
      const impact = this.fracture.pattern?.impact ?? [0, 0]
      for (const s of this.fracture.shards as Shard[]) {
        const dist = Math.hypot(s.slot.x - impact[0], s.slot.y - impact[1])
        const near = 1 - clamp(dist / 14, 0, 1)
        startHoming(s, s.slot, new Quaternion(), {
          delay: (1 - near) * 0.15 + near * 0.55 + r() * 0.15,
          duration: 1.2 + r() * 0.45,
          via: s.currP.z < -0.4 ? new Vector3(s.slot.x, s.slot.y, -2.5) : null,
          after: 'fixed',
        })
      }
      const through = (p: Vector3) => new Vector3(clamp(p.x, -hw * 0.75, hw * 0.75), clamp(p.y, -hh * 0.75, hh * 0.75), -1.6)
      for (const o of this.labObjects) {
        if (!o.home) continue
        const far = o.currP.distanceTo(o.home.p) > 0.08
        if (!far && o.body.isSleeping()) continue
        const via = o.currP.z > -0.6 ? through(o.currP) : o.currP.clone().lerp(o.home.p, 0.5).add(new Vector3(0, 2 + r() * 2, 0))
        // land as kinematic: stacked objects must not wake before the ones under them arrive
        startHoming(o, o.home.p, o.home.q, { delay: r() * 0.45, duration: 1.5 + r() * 0.6, via, after: 'fixed' })
      }
      const core = this.core.obj
      startHoming(core, CORE_HOME, new Quaternion(), {
        delay: 0.35,
        duration: 2.0,
        via: core.currP.z > -0.6 ? new Vector3(clamp(core.currP.x, -hw * 0.6, hw * 0.6) * 0.5, 0.3, -1.8) : null,
        after: 'fixed',
      })
      for (const o of this.overflow.heroes) {
        const to = new Vector3((r() - 0.5) * 10, 4.3 + (r() - 0.5) * 8, ROOM.back + 2)
        startHoming(o, to, o.currQ, { delay: r() * 0.4, duration: 1.4 + r() * 0.5, via: o.currP.z > -0.6 ? through(o.currP) : null, after: 'remove' })
      }
    }
    if (this.rebuildPhase === 'home') {
      const busy = this.physics.objs.some((o) => o.homing && !o.homing.done)
      if (!busy || this.rebuildT > 6) this.finishRebuild()
    }
  }

  private finishRebuild() {
    for (const o of this.physics.objs) {
      const m = o.homing
      if (!m || o.kind === 'shard' || o.tag === 'overflow') continue
      // everything wakes together, exactly home (also covers a timeout)
      o.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      o.body.setTranslation({ x: m.to.x, y: m.to.y, z: m.to.z }, true)
      o.body.setRotation({ x: m.toQ.x, y: m.toQ.y, z: m.toQ.z, w: m.toQ.w }, true)
      o.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      o.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      o.homing = null
    }
    if (this.rebuildWasBroken) this.fracture.restore()
    else if (this.fracture.pattern) {
      // cracked but never broken: the cracks heal away
      this.fracture.pattern = null
      this.screen.restore()
    }
    this.overflow.clearHeroes()
    this.rebuildPhase = null
    this.core.free = false
    this.world = 'INTACT'
    this.setGravity('NORMAL', true)
    this.screen.damage = 0
  }

  /** instant reset (start of the demo) */
  resetWorld() {
    this.interaction.releaseAll()
    this.vortex.on = false
    this.vortex.k = 0
    this.overflow.stop()
    this.overflow.clearHeroes()
    this.overflowIn = -1
    for (const o of [...this.creationsLive]) this.removeCreation(o)
    for (const o of this.dissolving) this.physics.remove(o.o)
    this.dissolving = []
    if (!this.screen.intact) this.fracture.restore()
    this.fracture.pattern = null
    this.screen.damage = 0
    this.screen.restore()
    this.rebuildPhase = null
    this.world = 'INTACT'
    const reset = (o: PhysObj) => {
      if (!o.home) return
      o.homing = null
      o.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      o.body.setTranslation({ x: o.home.p.x, y: o.home.p.y, z: o.home.p.z }, true)
      o.body.setRotation({ x: o.home.q.x, y: o.home.q.y, z: o.home.q.z, w: o.home.q.w }, true)
      o.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      o.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      o.currP.copy(o.home.p)
      o.prevP.copy(o.home.p)
      o.currQ.copy(o.home.q)
      o.prevQ.copy(o.home.q)
      if (o.setScale && o.scale !== 1) o.setScale(1)
    }
    for (const o of this.labObjects) reset(o)
    reset(this.core.obj)
    this.core.free = false
    this.setGravity('NORMAL', true)
    this.fx.shake = 0
    this.frontAlpha = 0
  }

  // ── gravity ───────────────────────────────────────────────────────

  setGravity(mode: GravityMode, silent = false, sideways?: number) {
    const side = sideways ?? (mode === 'SIDEWAYS' && this.gravity === 'SIDEWAYS' ? -this.physics.sideways : this.physics.sideways)
    this.gravity = mode
    this.physics.setGravity(mode, side)
    if (!silent) {
      this.audio.gravity(mode === 'REVERSE')
      toast(`GRAVITY · ${mode === 'SIDEWAYS' ? (side > 0 ? 'SIDEWAYS →' : '← SIDEWAYS') : mode}`)
    }
    useUI.setState({ gravity: mode, sideways: side })
  }

  cycleGravity() {
    const i = GRAVITY_MODES.indexOf(this.gravity)
    this.setGravity(GRAVITY_MODES[(i + 1) % GRAVITY_MODES.length])
  }

  // ── pulses / creation ─────────────────────────────────────────────

  pulse(p: Pointer) {
    const g = this.interaction.grips.get(p.id)
    if (!g) return
    const z = this.screen.intact ? -3.5 : 2.5
    const o = g.ray.origin
    const d = g.ray.direction
    const at = o.clone().addScaledVector(d, (z - o.z) / Math.min(-1e-3, d.z))
    this.pulseAt(at, 13)
    if (this.screen.intact) {
      this.fracture.ensurePattern(at.x, at.y)
      this.screen.addDamage(0.16)
      this.screen.ripple(at.x, at.y, 1.4, this.time)
      this.audio.crack(0.8)
      if (this.world === 'INTACT') this.world = 'CRACKING'
      if (this.screen.damage >= 1) this.shatter(at.x, at.y, new Vector3(0, 0, 12))
    }
  }

  pulseAt(at: Vector3, radius: number) {
    this.shock.fire(at, radius, { light: 1.4 })
    this.dust.pulse(at, this.time)
    this.physics.explode(at, radius, 9, 0.2)
    this.audio.pulse()
    this.fx.shake = Math.max(this.fx.shake, 0.45)
    this.fx.flash = Math.max(this.fx.flash, 0.15)
    for (const c of this.creationsLive) c.creation?.disturb?.(at, 1.2)
  }

  create(mode: CreationMode, at: Vector3, scale: number) {
    if (this.world === 'REBUILDING') return null
    while (this.creationsLive.length >= 8) this.dissolve(this.creationsLive[0])
    const o = this.creations.create(mode, at, scale)
    this.scene.add(o.object)
    this.creationsLive.push(o)
    this.audio.grab()
    return o
  }

  /** create the current mode at the mouse (keyboard C / UI button) */
  createAtPointer() {
    const mode = useUI.getState().mode
    const g = this.interaction.grips.get('mouse')
    let at = new Vector3(0, 0.5, -5)
    if (g) {
      const z = this.screen.intact ? -5 : 3
      at = g.ray.origin.clone().addScaledVector(g.ray.direction, (z - g.ray.origin.z) / Math.min(-1e-3, g.ray.direction.z))
    }
    at.x = clamp(at.x, -ROOM.halfX + 2, ROOM.halfX - 2)
    at.y = clamp(at.y, ROOM.floor + 1.5, ROOM.ceil - 2)
    this.create(mode, at, mode === 'GALAXY' ? 1.3 : 1)
  }

  private burstPlanet(o: PhysObj) {
    const at = o.object.position.clone()
    this.interaction.releaseAll()
    this.shock.fire(at, 11, { light: 2, color: 0xffd2a0 })
    this.dust.pulse(at, this.time)
    this.physics.explode(at, 11, 10, 0.15)
    this.audio.pulse()
    this.fx.shake = Math.max(this.fx.shake, 0.7)
    this.fx.flash = Math.max(this.fx.flash, 0.3)
    this.removeCreation(o)
    toast('PLANET COLLAPSED')
  }

  private removeCreation(o: PhysObj) {
    const i = this.creationsLive.indexOf(o)
    if (i >= 0) this.creationsLive.splice(i, 1)
    for (const g of this.interaction.grips.values()) if (g.held === o) g.held = null
    if (this.interaction.two?.obj === o) this.interaction.two = null
    this.physics.remove(o)
  }

  private dissolve(o: PhysObj) {
    const i = this.creationsLive.indexOf(o)
    if (i >= 0) this.creationsLive.splice(i, 1)
    for (const g of this.interaction.grips.values()) if (g.held === o) g.held = null
    o.grabbable = false
    this.dissolving.push({ o, t: 0, s: o.object.scale.x })
  }

  private updateCreations(dt: number) {
    for (const o of [...this.creationsLive]) if (o.creation?.dead && !o.held) this.removeCreation(o)
    for (const d of [...this.dissolving]) {
      d.t += dt
      const k = clamp(1 - d.t / 0.6, 0, 1)
      d.o.object.scale.setScalar(Math.max(0.001, d.s * k * k))
      d.o.onFrame = undefined
      if (k <= 0) {
        this.physics.remove(d.o)
        this.dissolving.splice(this.dissolving.indexOf(d), 1)
      }
    }
  }

  // ── tracking ──────────────────────────────────────────────────────

  async startCamera(stream?: MediaStream) {
    this.audio.start()
    await this.tracking.start(stream)
  }

  stopCamera() {
    this.tracking.stop()
    this.head.reset()
    this.gestures.reset()
  }

  recalibrate() {
    this.head.recalibrate()
    toast('CALIBRATING — LOOK AT THE CENTRE OF THE SCREEN')
  }

  /** one frame of landmark results (from the camera pipeline, or injected by tests) */
  ingest(r: VisionResult) {
    const t = r.t / 1000
    this.head.update(r.faces, r.w, r.h, t)
    const events = this.gestures.update(r.hands, r.w / r.h, t)
    for (const e of events) this.gesture(e)
  }

  private gesture(e: GestureEvent) {
    if (this.director.active) return
    if (e.type === 'pulse') this.pulse(e.pointer)
    else if (e.type === 'clap') this.rebuild()
    else if (e.type === 'swipe') {
      // a swipe only shifts gravity when the hand isn't holding anything
      const g = this.interaction.grips.get(e.pointer.id)
      if (g?.held) return
      if (e.dir === 'up') this.setGravity('REVERSE')
      else if (e.dir === 'down') this.setGravity('NORMAL')
      else this.setGravity('SIDEWAYS', false, e.dir === 'right' ? 1 : -1)
    }
  }

  updateSettings(s: Partial<ViewerSettings>) {
    Object.assign(this.settings, s)
    this.rig.settings = this.settings
    useUI.setState({ settings: { ...this.settings } })
    saveSettings(this.settings)
    this.resize()
  }

  // ── quality ───────────────────────────────────────────────────────

  setQuality(q: QualityLevel) {
    const old = this.preset
    this.quality = q
    this.preset = QUALITY[q]
    const p = this.preset
    if (old.shadows !== p.shadows) {
      const on = p.shadows > 0
      if (on !== this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.enabled = on
        this.scene.traverse((o) => {
          const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material
          if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true))
          else if (m) m.needsUpdate = true
        })
      }
      if (on) {
        this.lab.spot.shadow.mapSize.set(p.shadows, p.shadows)
        this.lab.spot.shadow.map?.dispose()
        this.lab.spot.shadow.map = null
      }
    }
    this.post.setMSAA(p.msaa)
    this.post.bloom.enabled = p.bloom
    this.dust.setCount(p.dust)
    this.fracture.shardCount = p.shards
    this.overflow.setCounts({ streaks: p.streaks, debris: p.debris, heroes: p.heroes })
    this.creations.setCounts({ galaxy: p.galaxy, liquidDetail: p.liquidDetail })
    if (old.labObjects !== p.labObjects && this.world === 'INTACT' && !this.director.active) {
      this.interaction.releaseAll()
      this.populate(p.labObjects)
    }
    this.perf.reset()
    this.resize()
    useUI.setState({ quality: q })
  }

  // ── demo ──────────────────────────────────────────────────────────

  playDemo() {
    this.audio.start()
    this.director.start()
    useUI.setState({ demo: true, uiHidden: true })
  }

  stopDemo() {
    this.director.stop()
    useUI.setState({ demo: false, uiHidden: false, caption: null, title: false })
    this.titleOn = false
  }

  private hostForDirector(): DirectorHost {
    return {
      resetWorld: () => this.resetWorld(),
      corePosition: () => this.core.group.position,
      coreScreen: () => {
        const p = this.core.group.position.clone().project(this.view.camera)
        return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 }
      },
      glassIntact: () => this.screen.intact,
      breakGlassAtCore: () => {
        const p = this.core.group.position
        this.fracture.ensurePattern(p.x, p.y)
        const v = this.core.obj.body.linvel()
        this.shatter(clamp(p.x, -this.screen.halfW + 0.5, this.screen.halfW - 0.5), clamp(p.y, -this.screen.halfH + 0.5, this.screen.halfH - 0.5), new Vector3(v.x, v.y, Math.max(10, v.z)))
      },
      pulseAt: (p, r) => this.pulseAt(p, r),
      setGravity: (m) => this.setGravity(m),
      setVortex: (on) => {
        this.vortex.on = on
        if (on) this.physics.world.gravity = { x: 0, y: 0, z: 0 }
      },
      rebuild: () => this.rebuild(),
      caption: (text) => useUI.setState({ caption: text }),
      title: (on) => {
        this.titleOn = on
        useUI.setState({ title: on })
        if (on) this.audio.title()
      },
      shake: (a) => (this.fx.shake = Math.max(this.fx.shake, a)),
      aspect: () => this.aspect,
      end: () => this.stopDemo(),
    }
  }

  // ── keys ──────────────────────────────────────────────────────────

  private key(e: KeyboardEvent) {
    if (useUI.getState().phase !== 'experience') return
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    const k = e.code
    if (this.director.active) {
      if (k === 'Escape' || k === 'KeyD') this.stopDemo()
      return
    }
    if (k === 'KeyG') this.cycleGravity()
    else if (k === 'KeyR') this.rebuild()
    else if (k === 'KeyB') this.breakGlass()
    else if (k === 'KeyC') this.createAtPointer()
    else if (k === 'Space') {
      e.preventDefault()
      this.pulse(this.mouse.pointer)
    } else if (k === 'KeyH') useUI.setState((s) => ({ uiHidden: !s.uiHidden }))
    else if (k === 'KeyF') {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen?.()
    } else if (k === 'KeyD') this.playDemo()
    else if (k === 'KeyM') {
      this.audio.setMuted(!this.audio.muted)
      useUI.setState({ muted: this.audio.muted })
    } else if (k === 'KeyZ') this.setGravity('ZERO')
    else if (k === 'Digit0') this.mouse.resetHead()
    else if (k.startsWith('Digit')) {
      const i = Number(k.slice(5)) - 1
      const modes: CreationMode[] = ['PLANET', 'LIQUID', 'GALAXY', 'CUBE']
      if (modes[i]) this.setMode(modes[i])
    }
  }

  setMode(m: CreationMode) {
    this.interaction.creationMode = m
    useUI.setState({ mode: m })
  }

  // ── status ────────────────────────────────────────────────────────

  private pushStatus() {
    const hs = this.head.state
    const hands = this.gestures.pointers.filter((p) => p.present)
    const grips = [...this.interaction.grips.values()].map((g) => `${g.kind === 'hand' ? 'HAND' : g.kind.toUpperCase()} ${g.state}`)
    useUI.setState({
      headSource: this.rig.source,
      headConf: this.tracking.running ? hs.confidence : 0,
      calibrated: hs.calibrated,
      calibrating: this.head.isCalibrating,
      faces: hs.faces,
      hands: hands.length,
      handConf: hands.length ? hands.reduce((a, p) => a + p.confidence, 0) / hands.length : 0,
      gripStates: grips,
      fps: Math.round(this.perf.fps),
      renderScale: this.perf.scale,
      physMs: +this.physics.stepMs.toFixed(2),
      bodies: this.physics.dynamicCount(),
      inferFps: Math.round(this.tracking.fps),
      inferMs: +this.tracking.inferMs.toFixed(1),
      glass: this.screen.intact ? 1 - this.screen.damage : 0,
      world: this.world,
      demo: this.director.active,
      demoT: this.director.t,
      pose: { ...hs.pose },
      eyeCm: [+this.rig.cm.x.toFixed(1), +this.rig.cm.y.toFixed(1), +this.rig.cm.z.toFixed(1)],
    })
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.stopCamera()
    this.post.dispose()
    this.renderer.dispose()
  }
}

