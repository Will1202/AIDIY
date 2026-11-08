import { Color, LinearSRGBColorSpace, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { BASE_LEVEL, HALF, PAPER_SCALE_Y, type BrushKind } from '../core/constants'
import { CameraRig } from '../camera/CameraRig'
import { InkRenderer } from '../ink/InkRenderer'
import { createPaperTexture } from '../ink/paper'
import { BrushInputSystem } from '../input/BrushInputSystem'
import { Pipeline } from '../render/Pipeline'
import { PlanarReflection } from '../render/Reflection'
import { U } from '../render/uniforms'
import { toast, useUI, type Mode, type TimeOfDay } from '../state/store'
import { BrushCursor } from '../ui/BrushCursor'
import { clamp, damp } from '../util/math'
import type { StrokePoint } from '../util/path'
import { World } from '../world/World'
import { WorldTransition } from '../world/WorldTransition'
import { WeatherSystem } from '../weather/WeatherSystem'
import { AudioEngine } from '../audio/AudioEngine'
import { CharacterController, type MoveInput } from '../character/CharacterController'
import { CinematicDirector } from '../cinematic/CinematicDirector'
import { defaultQuality, QUALITY, QUALITY_LEVELS, type QualityLevel, type QualitySettings } from './Quality'

const INK_COLOR: Record<BrushKind, string> = { mountain: '#151311', river: '#3c4f5c', life: '#151311', bridge: '#3a2a1c' }

/**
 * Wires every system together and owns the frame loop and the mode machine:
 *   intro → draw ⇄ (awakening →) world ⇄ explore,   cinematic from anywhere.
 * Drawing, orbiting and walking never share a mouse gesture: the mode decides who
 * receives the pointer.
 */
export class Engine {
  readonly renderer: WebGLRenderer
  readonly canvas: HTMLCanvasElement
  readonly scene = new Scene()
  readonly rig = new CameraRig()
  readonly ink: InkRenderer
  readonly world: World
  readonly pipeline: Pipeline
  readonly brush: BrushInputSystem
  readonly cursor: BrushCursor
  readonly transition: WorldTransition
  readonly reflection: PlanarReflection
  readonly weather: WeatherSystem
  readonly audio = new AudioEngine()
  readonly director: CinematicDirector
  character: CharacterController | null = null
  quality: QualitySettings
  mode: Mode = 'loading'
  manualClock = false
  paused = false
  /** pressure shown on the brush cursor when the director rests the brush */
  brushPressure = 0
  private raf = 0
  private last = performance.now()
  private ray = new Raycaster()
  private ndc = new Vector2()
  private pointer = { x: -100, y: -100, inside: false }
  private drag: { id: number; x: number; y: number; button: number } | null = null
  readonly keys = new Set<string>()
  private fogK = 0.0009
  private mistK = 0.25
  readonly stats = { fps: 60, frame: 0, ms: 0 }
  private fpsAcc = 0
  private fpsN = 0
  private lowFor = 0
  private userQuality = false
  private width = 1
  private height = 1
  private stepAcc = 0
  private tmpV = new Vector3()

  constructor(private container: HTMLElement) {
    const dev = import.meta.env.DEV || new URLSearchParams(location.search).has('debug')
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: dev, alpha: false })
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setClearColor(new Color(0.93, 0.9, 0.84), 1)
    this.canvas = this.renderer.domElement
    this.canvas.className = 'gl'
    container.appendChild(this.canvas)

    const level = defaultQuality()
    this.quality = QUALITY[level]
    useUI.setState({ quality: level })
    this.userQuality = new URLSearchParams(location.search).has('q')

    U.uPaperTex.value = createPaperTexture(1024)
    this.ink = new InkRenderer(this.renderer, this.quality)
    this.reflection = new PlanarReflection(this.quality.reflection)
    this.world = new World(this.inkTextures(), this.quality, { texture: this.reflection.rt.texture, matrix: this.reflection.textureMatrix })
    this.scene.add(this.world.group)
    this.scene.add(this.world.props)
    this.scene.add(this.world.backdrop.group)
    this.weather = new WeatherSystem(this.quality.rain)
    this.scene.add(this.weather.rainLines)
    this.pipeline = new Pipeline(this.renderer, this.quality)
    this.brush = new BrushInputSystem(this.ink, (k, p) => this.onStroke(k, p))
    this.cursor = new BrushCursor(document.body)
    this.transition = new WorldTransition(this.world, this.rig)
    this.director = new CinematicDirector(this)

    this.world.events = {
      onMountainRise: (m) => this.audio.mountain(m.height),
      onTreeSprout: () => this.audio.tree(this.world.trees.length),
      onBridgeStart: (b) => this.audio.bridge(b.spec.span),
      onRiverFlow: () => this.audio.river(),
    }

    this.bindInput()
    this.resize()
    window.addEventListener('resize', () => this.resize())
    new ResizeObserver(() => this.resize()).observe(container)
  }

  private inkTextures() {
    return { crisp: this.ink.crispTexture, wet: this.ink.wetTexture, dry: this.ink.dryTexture }
  }

  // ───────────────────────────── lifecycle
  start() {
    this.setMode('intro')
    // ?showcase: skip the title and play the 30 s film straight away (for recording)
    if (new URLSearchParams(location.search).has('showcase')) {
      this.setMode('draw')
      this.playCinematic()
    }
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      if (this.manualClock) return
      const now = performance.now()
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      if (!this.paused) this.frame(dt)
    }
    this.raf = requestAnimationFrame(loop)
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth)
    const h = Math.max(1, this.container.clientHeight || window.innerHeight)
    if (w === this.width && h === this.height && this.stats.frame > 0) return
    this.width = w
    this.height = h
    const pr = Math.min(this.quality.pixelCap, Math.max(0.5, (window.devicePixelRatio || 1) * this.quality.pixelRatio))
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.pipeline.setSize(w, h, pr)
    this.reflection.setSize(w * pr, h * pr)
    this.rig.setAspect(w / h)
    this.rig.computePaperFraming(BASE_LEVEL * this.world.scaleY)
  }

  setQuality(level: QualityLevel, byUser = true) {
    if (byUser) this.userQuality = true
    const prevRain = this.quality.rain
    this.quality = QUALITY[level]
    this.ink.allocate(this.quality, true)
    this.world.setQuality(this.quality)
    this.pipeline.setQuality(this.quality)
    this.reflection.scale = this.quality.reflection
    if (prevRain !== this.quality.rain) this.weather.setRainCount(this.quality.rain)
    this.width = 0
    this.resize()
    this.world.terrain.setInk(this.inkTextures())
    useUI.setState({ quality: level })
  }

  // ───────────────────────────── modes
  setMode(mode: Mode) {
    const prev = this.mode
    this.mode = mode
    useUI.setState({ mode })
    this.brush.enabled = mode === 'draw'
    if (mode !== 'draw' && mode !== 'cinematic' && this.brush.down) this.brush.cancel()
    switch (mode) {
      case 'intro':
      case 'draw':
        this.rig.computePaperFraming(BASE_LEVEL * this.world.scaleY)
        this.rig.setMode('paper', prev === 'intro' || prev === 'loading' ? 0.0001 : 1.8)
        break
      case 'world':
        if (this.rig.mode !== 'orbit') {
          this.rig.syncOrbitFromCamera()
          this.rig.setMode('orbit', 0)
        }
        break
    }
    if (mode !== 'explore' && this.character) {
      this.scene.remove(this.character.body.root, this.character.body.shadow, this.character.body.ring)
    }
    document.body.classList.toggle('drawing', mode === 'draw' || mode === 'intro' || mode === 'cinematic')
  }

  enter() {
    if (this.mode !== 'intro') return
    this.audio.init()
    this.audio.setEnabled(useUI.getState().sound)
    this.setMode('draw')
  }

  setBrush(kind: BrushKind) {
    if (this.brush.down || this.mode === 'cinematic' || this.mode === 'awakening') return
    this.brush.kind = kind
    useUI.setState({ brush: kind })
    if (this.mode !== 'draw') this.draw()
  }

  /** DRAW: back to the sheet (the world keeps its height once awakened) */
  draw() {
    if (this.mode === 'awakening' || this.mode === 'cinematic') return
    this.setMode('draw')
  }

  /** AWAKEN THE WORLD */
  awaken(onDone?: () => void, speed = 1) {
    if (this.mode === 'awakening' || this.mode === 'cinematic') return
    this.audio.init()
    if (this.mode === 'intro') this.setMode('draw')
    this.setMode('awakening')
    this.audio.awaken()
    this.transition.onDone = () => {
      useUI.setState({ awakened: true })
      this.setMode('world')
      onDone?.()
    }
    this.transition.start(this.focusPoint(), speed)
  }

  /** EXPLORE: walk into the painting as the swordsman */
  explore() {
    if (this.mode === 'cinematic' || this.mode === 'awakening') return
    if (this.mode === 'explore') return
    if (this.world.scaleY < 0.999) {
      // the world must be awake to be walked: awaken quickly, then step in
      this.awaken(() => this.enterExplore(), 1.6)
      return
    }
    this.enterExplore()
  }

  ensureCharacter() {
    if (!this.character) this.character = new CharacterController(this.world)
    const b = this.character.body
    this.scene.add(b.root, b.shadow, b.ring)
    return this.character
  }

  private enterExplore() {
    const c = this.ensureCharacter()
    // start near the first bridge if there is one, otherwise where the camera looks
    const b = this.world.bridges[0]
    let x = this.rig.orbitTarget.x
    let z = this.rig.orbitTarget.z
    let yaw = 0
    if (b) {
      const s = b.spec
      x = s.ax - s.dx * 6
      z = s.az - s.dz * 6
      yaw = Math.atan2(s.dx, s.dz)
    }
    c.spawn(clamp(x, -HALF + 6, HALF - 6), clamp(z, -HALF + 6, HALF - 6), yaw)
    this.setMode('explore')
    this.scene.add(c.body.root, c.body.shadow, c.body.ring)
    this.rig.followYaw = yaw + Math.PI
    this.rig.followPitch = 0.28
    this.rig.followDist = 9
    this.rig.setMode('follow', 1.6)
    useUI.setState({ pose: 'walk' })
  }

  setPose(p: 'meditate' | 'observe') {
    if (this.mode !== 'explore' || !this.character) return
    const ch = this.character
    if (ch.pose !== p && this.world.waterDepth(ch.pos.x, ch.pos.z) > 0.1 && !this.world.groundAt(ch.pos.x, ch.pos.z, ch.pos.y + 0.1).bridge) {
      toast('水中不宜' + (p === 'meditate' ? '打坐' : '久立'), 'Step out of the river first')
      return
    }
    ch.setPose(p)
    const pose = this.character.pose
    useUI.setState({ pose })
    this.rig.followBoost = pose === 'observe' ? 14 : pose === 'meditate' ? 2.5 : 0
    if (pose === 'meditate') toast('打坐', 'Meditating — the world breathes around you')
    if (pose === 'observe') toast('观景', 'Gazing over the land you painted')
  }

  playCinematic() {
    if (this.mode === 'cinematic') return
    this.audio.init()
    if (this.transition.active) this.transition.active = false
    useUI.setState({ uiHidden: false })
    this.setMode('cinematic')
    this.director.start()
  }

  /** called by the director when the film ends (or Esc) */
  endCinematic() {
    this.brush.cancel()
    if (this.character) {
      this.character.path = null
      this.scene.remove(this.character.body.root, this.character.body.shadow, this.character.body.ring)
    }
    const awake = this.world.scaleY > 0.99
    if (awake) {
      this.world.setScaleY(1)
      U.uAwaken.value = 1
      U.uTremble.value = 0
      this.world.backdrop.setRise(1)
      useUI.setState({ awakened: true })
      this.rig.syncOrbitFromCamera(new Vector3(0, 8, -20))
      this.rig.setMode('orbit', 0)
      this.setMode('world')
    } else this.setMode('draw')
  }

  /** centre of what has been drawn, for camera framing */
  focusPoint() {
    const p = new Vector3()
    let n = 0
    for (const m of this.world.mountains) {
      for (const pk of m.spec.peaks) {
        p.x += pk.x
        p.z += pk.z
        n++
      }
    }
    for (const b of this.world.bridges) {
      p.x += (b.spec.ax + b.spec.bx) * 1.5
      p.z += (b.spec.az + b.spec.bz) * 1.5
      n += 3
    }
    if (n) p.divideScalar(n)
    p.y = 6
    return p
  }

  /** clear the sheet: dispose generated content, wipe the ink, back to paper scale */
  resetWorld(silent = false) {
    if (this.transition.active) this.transition.active = false
    this.brush.cancel()
    this.world.reset()
    this.ink.clear()
    this.world.setScaleY(PAPER_SCALE_Y)
    U.uAwaken.value = 0
    U.uTremble.value = 0
    this.world.backdrop.setRise(0)
    if (this.character) {
      this.scene.remove(this.character.body.root, this.character.body.shadow, this.character.body.ring)
      this.character.path = null
    }
    useUI.setState({ awakened: false, counts: this.world.counts, title: false })
    if (!silent) toast('白纸一张', 'A blank sheet — paint a new world')
  }

  reset() {
    if (this.mode === 'cinematic') this.director.stop()
    this.resetWorld()
    this.setMode('draw')
  }

  setSound(on: boolean) {
    useUI.setState({ sound: on })
    this.audio.init()
    this.audio.setEnabled(on)
  }
  setTime(t: TimeOfDay) {
    this.weather.time = t
    useUI.setState({ time: t })
  }
  setRain(on: boolean) {
    this.weather.rain = on
    useUI.setState({ rain: on })
  }
  setWind(on: boolean) {
    this.weather.wind = on
    useUI.setState({ wind: on })
  }

  // ───────────────────────────── strokes
  private onStroke(kind: BrushKind, pts: StrokePoint[]) {
    const r = this.world.addStroke(kind, pts)
    if (!r.ok && r.message) {
      toast(r.message, r.sub, 'warn')
      this.audio.reject()
    }
    if (r.erase) this.eraseStroke(pts)
    useUI.setState({ counts: this.world.counts })
  }

  /** a rejected stroke is washed off the paper (subtractive stamps along its path) */
  private eraseStroke(pts: StrokePoint[]) {
    let arc = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[Math.min(pts.length - 1, i + 1)]
      const d = Math.hypot(q.x - p.x, q.z - p.z) || 1
      arc += d
      this.ink.erase({ x: p.x, z: p.z, dx: (q.x - p.x) / d, dz: (q.z - p.z) / d, halfLen: 1.7, halfWidth: 1.7, black: 0.85, indigo: 0.85, water: 0, dryness: 0, bleed: 0, arc, seed: 3, round: 1 })
    }
  }

  // ───────────────────────────── input
  private pickAt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.rig.camera)
    const hit = this.world.pick(this.ray.ray)
    return hit ? { x: hit.x, z: hit.z } : null
  }

  private bindInput() {
    const c = this.canvas
    const capture = (id: number) => {
      try {
        c.setPointerCapture(id)
      } catch {
        /* synthetic or already-released pointer */
      }
    }
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    c.addEventListener('pointerdown', (e) => {
      this.pointer.x = e.clientX
      this.pointer.y = e.clientY
      if (this.mode === 'draw' && e.button === 0) {
        if (this.rig.blending) return
        capture(e.pointerId)
        this.brush.pointerDown(this.pickAt(e.clientX, e.clientY), e.pointerType, e.pressure)
        return
      }
      if (this.mode === 'world' || this.mode === 'explore') {
        capture(e.pointerId)
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button }
      }
    })
    c.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX
      this.pointer.y = e.clientY
      this.pointer.inside = true
      if (this.brush.down) {
        const evs = e.getCoalescedEvents?.() ?? [e]
        const last = evs[evs.length - 1] ?? e
        this.brush.pointerMove(this.pickAt(last.clientX, last.clientY), last.pressure)
      }
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x
        const dy = e.clientY - this.drag.y
        this.drag.x = e.clientX
        this.drag.y = e.clientY
        if (this.mode === 'world') {
          if (this.drag.button === 2 || e.shiftKey) this.rig.orbitPan(dx, dy)
          else this.rig.orbitDrag(dx, dy)
        } else if (this.mode === 'explore') this.rig.followDrag(dx, dy)
      }
    })
    const up = (e: PointerEvent) => {
      if (this.brush.down) this.brush.pointerUp()
      if (this.drag?.id === e.pointerId) this.drag = null
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('pointerleave', () => (this.pointer.inside = false))
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        if (this.mode === 'world') this.rig.orbitZoom(e.deltaY)
        else if (this.mode === 'explore') this.rig.followZoom(e.deltaY)
      },
      { passive: false },
    )
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      this.keys.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.mode === 'explore') e.preventDefault()
      this.onKey(e)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    // browsers start audio only after a gesture (e.g. when ?showcase skipped the title)
    window.addEventListener('pointerdown', () => {
      if (this.mode !== 'intro' && useUI.getState().sound) this.audio.init()
    })
    window.addEventListener('blur', () => this.keys.clear())
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return
    const brushes: Record<string, BrushKind> = { Digit1: 'mountain', Digit2: 'river', Digit3: 'life', Digit4: 'bridge' }
    if (brushes[e.code] && (this.mode === 'draw' || this.mode === 'world')) this.setBrush(brushes[e.code])
    if (e.code === 'KeyH') useUI.setState((s) => ({ uiHidden: !s.uiHidden }))
    if (e.code === 'KeyC' && this.mode !== 'intro') {
      if (this.mode === 'cinematic') this.director.stop()
      else this.playCinematic()
    }
    if (e.code === 'Escape') {
      if (this.mode === 'cinematic') this.director.stop()
      else if (this.mode === 'explore') this.setMode('world')
    }
    if (this.mode === 'explore') {
      if (e.code === 'KeyE') this.setPose('meditate')
      if (e.code === 'KeyQ') this.setPose('observe')
    }
  }

  private moveInput(): MoveInput {
    const k = this.keys
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    return { forward: f, right: r, run: k.has('ShiftLeft') || k.has('ShiftRight'), jump: k.has('Space') }
  }

  // ───────────────────────────── frame
  frame(dt: number) {
    const t0 = performance.now()
    U.uTime.value += dt
    this.stats.frame++

    this.director.update(dt)
    this.brush.update(dt)
    this.ink.update(dt)
    this.world.update(dt)
    this.transition.update(dt)
    this.weather.update(dt, this.rig.camera)

    // the character (explore, or running in the film)
    const c = this.character
    const charActive = !!c && (this.mode === 'explore' || (this.mode === 'cinematic' && !!c.body.root.parent))
    if (c && charActive) {
      const input: MoveInput = this.mode === 'explore' ? this.moveInput() : { forward: 0, right: 0, run: false, jump: false }
      const prevPose = c.pose
      c.update(dt, input, this.rig.followYaw)
      if (c.pose !== prevPose) {
        useUI.setState({ pose: c.pose })
        this.rig.followBoost = 0
      }
      // footsteps
      if (c.onGround && c.speed > 0.5) {
        this.stepAcc += c.speed * dt
        if (this.stepAcc > (c.speed > 6 ? 1.6 : 1.1)) {
          this.stepAcc = 0
          const g = this.world.groundAt(c.pos.x, c.pos.z, c.pos.y + 0.1)
          this.audio.step(!!g.bridge)
        }
      }
      // standing still for a while: the swordsman takes in the view
      if (this.mode === 'explore' && c.idle > 9 && c.pose === 'walk') {
        c.pose = 'observe'
        useUI.setState({ pose: 'observe' })
        c.idle = -20
      }
    }

    // drawing views keep the paper clean; the world views get full atmosphere
    const drawView = this.mode === 'draw' || this.mode === 'intro'
    this.fogK = damp(this.fogK, (drawView ? 0.0009 : 0.0026) * this.weather.fogMul, 2, dt)
    this.mistK = damp(this.mistK, (drawView ? 0.25 : 1) * (1 + this.weather.rainK * 0.5), 2, dt)
    this.pipeline.mat.uniforms.uFog.value = this.fogK
    this.pipeline.mat.uniforms.uMistAmount.value = this.mistK

    this.rig.update(dt, {
      heightAt: (x, z) => this.world.heightAt(x, z),
      scaleY: this.world.scaleY,
      followTarget: c && this.mode === 'explore' ? c.head : null,
      followHeading: c?.yaw ?? 0,
    })

    // the sim ping-pongs: point the materials at this frame's buffers
    this.world.terrain.setInk(this.inkTextures())
    U.uScaleY.value = this.world.scaleY

    // planar mirror for the rivers (3D views only)
    let reflOn = false
    if (this.world.rivers.length && this.quality.reflection > 0 && U.uAwaken.value > 0.05) {
      this.renderer.setClearColor(U.uMist.value, 1)
      reflOn = this.reflection.update(this.renderer, this.scene, this.rig.camera, 0, [...this.world.rivers.map((r) => r.mesh), this.weather.rainLines])
    }
    this.world.setReflectionOn(reflOn)
    this.renderer.setClearColor(U.uPaper.value, 1)

    this.pipeline.render(this.scene, this.rig.camera)

    // audio beds follow the world
    const camH = this.rig.camera.position.y
    this.audio.update(dt, {
      wind: U.uWind.value,
      rain: U.uRain.value,
      water: this.world.rivers.length ? clamp(1.2 - camH / 160) * (0.4 + U.uAwaken.value * 0.6) : 0,
      night: U.uNight.value,
      brush: this.brush.down && this.brush.inking ? clamp(this.brush.speed / 80) * (0.4 + this.brush.pressure * 0.6) : 0,
      awaken: U.uAwaken.value,
    })

    this.updateCursor(dt)
    document.querySelector('.app')?.classList.toggle('night', U.uNight.value > 0.5)

    const ms = performance.now() - t0
    this.stats.ms = ms
    this.fpsAcc += dt
    this.fpsN++
    if (this.fpsAcc > 0.5) {
      this.stats.fps = Math.round(this.fpsN / this.fpsAcc)
      this.autoQuality(this.fpsAcc)
      this.fpsAcc = 0
      this.fpsN = 0
      useUI.setState({ fps: this.stats.fps })
    }
  }

  /** PerformanceManager: step down once if a weak GPU cannot hold ~30 fps */
  private autoQuality(window: number) {
    if (this.userQuality || this.manualClock || this.mode === 'cinematic' || this.mode === 'intro' || document.hidden) {
      this.lowFor = 0
      return
    }
    if (this.stats.fps < 32) this.lowFor += window
    else this.lowFor = Math.max(0, this.lowFor - window)
    if (this.lowFor > 4) {
      this.lowFor = 0
      const i = QUALITY_LEVELS.indexOf(this.quality.level)
      if (i > 0) {
        const next = QUALITY_LEVELS[i - 1]
        this.setQuality(next, false)
        toast('画质已调整', `Quality lowered to ${next} to keep the brush smooth`)
      }
    }
  }

  private updateCursor(dt: number) {
    const showBrush = this.mode === 'draw' || this.mode === 'intro' || (this.mode === 'cinematic' && this.director.showBrush)
    this.cursor.visible = showBrush
    const rect = this.canvas.getBoundingClientRect()
    const project = (x: number, z: number) => {
      const v = this.tmpV.set(x, this.world.heightAt(x, z), z).project(this.rig.camera)
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
    }
    if (this.brush.down) {
      const p = project(this.brush.tip.x, this.brush.tip.z)
      this.cursor.setTarget(p.x, p.y)
    } else if (this.mode === 'cinematic' && this.director.hover) {
      const p = project(this.director.hover.x, this.director.hover.z)
      this.cursor.setTarget(p.x, p.y - 30)
    } else if (this.mode !== 'cinematic') this.cursor.setTarget(this.pointer.x, this.pointer.y)
    this.cursor.setInk(INK_COLOR[this.brush.kind])
    const pressure = this.brush.down ? this.brush.pressure : this.brushPressure
    this.cursor.update(dt, pressure, this.brush.down || this.brushPressure > 0)
    this.brushPressure = Math.max(0, this.brushPressure - dt * 3)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.world.dispose()
    this.ink.dispose()
    this.pipeline.dispose()
    this.weather.dispose()
    this.character?.dispose()
    this.audio.dispose()
    this.cursor.el.remove()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
