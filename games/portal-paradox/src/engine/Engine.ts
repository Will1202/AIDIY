import { Color, MathUtils, PerspectiveCamera, PMREMGenerator, Quaternion, Vector3, WebGLRenderer, type Scene } from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { Input, type Action } from './Input'
import { QUALITY, guessQuality, type QualityLevel, type QualityPreset } from './Quality'
import { Pipeline, defaultFx, type FxState } from '../render/Pipeline'
import { PhysicsWorld, RAPIER, GROUPS } from '../physics/PhysicsWorld'
import { PropSystem, type Prop } from '../physics/Props'
import { TimeRecorder } from '../physics/TimeRecorder'
import { Portal, GATE_DEPTH, GATE_OUTER_H, OPENING_H, OPENING_W, WORLD_NAMES, type WorldId } from '../portal/Portal'
import { PlayerController } from '../player/PlayerController'
import { Interaction } from '../player/Interaction'
import { buildLab, LAB, coilCharge, type LabWorld } from '../world/Lab'
import { buildOtherSide, OTHER, OTHER_ORIGIN, type OtherWorld } from '../world/OtherSide'
import { SUN_SLIT } from '../world/materials'
import { metalTexture } from '../world/textures'
import { useStore, type FrameMode } from '../state/store'
import type { Director } from '../cinematic/Director'
import type { AudioEngine } from '../audio/AudioEngine'

export type Layout = 'gateway' | 'mirror'

const PORTAL_COLORS = [new Color(0.55, 0.9, 1.0), new Color(1.0, 0.42, 0.85)]

export class Engine {
  readonly renderer: WebGLRenderer
  readonly camera = new PerspectiveCamera(72, 1, 0.08, 2600)
  readonly input: Input
  pipeline!: Pipeline
  phys!: PhysicsWorld
  lab!: LabWorld
  other!: OtherWorld
  scenes: Scene[] = []
  portals: Portal[] = []
  props!: PropSystem
  player!: PlayerController
  interaction!: Interaction
  recorder = new TimeRecorder(10)
  director: Director | null = null
  audio: AudioEngine | null = null
  fx: FxState = defaultFx()

  qualityLevel: QualityLevel = 'MEDIUM'
  q: QualityPreset = QUALITY.MEDIUM
  /** world the main camera is in */
  viewWorld: WorldId = 0
  time = 0
  private acc = 0
  gravityDir = 1
  layout: Layout = 'gateway'
  /** true while the user is playing (pointer locked or touch) */
  playing = false
  paused = true
  running = false
  manualClock = false
  private lastT = 0
  private fpsAcc = 0
  private fpsFrames = 0
  private uiAcc = 0
  private rewindHeld = false
  private rewindT = 0
  private portalAnim: { target: number; speed: number; energyTarget: number }[] = []
  private contextLost = false
  frameMode: FrameMode = 'full'
  baseFov = 72
  readonly stats = { fps: 0, frameMs: 0, renders: 0, drawCalls: 0, triangles: 0 }
  /** demo cube used by the showcase */
  demoCube: Prop | null = null

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
      preserveDrawingBuffer: import.meta.env.DEV || location.search.includes('capture'),
    })
    this.renderer.setPixelRatio(1)
    this.input = new Input(canvas)
    canvas.addEventListener('webglcontextlost', this.onContextLost, false)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false)
  }

  async init(progress: (p: number, label: string) => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    const saved = (() => { try { return localStorage.getItem('pp.quality') as QualityLevel | null } catch { return null } })()
    this.qualityLevel = saved && QUALITY[saved] ? saved : guessQuality(gl)
    this.q = QUALITY[this.qualityLevel]
    useStore.getState().set({ quality: this.qualityLevel })
    RectAreaLightUniformsLib.init()

    progress(0.05, 'PHYSICS CORE')
    this.phys = await PhysicsWorld.create()
    await tick()
    progress(0.15, 'POURING CONCRETE')
    this.lab = buildLab(this.phys, this.q)
    await tick()
    progress(0.4, 'FOLDING SPACE')
    this.other = buildOtherSide(this.renderer, this.phys, this.q)
    this.scenes = [this.lab.scene, this.other.scene]
    await tick()

    progress(0.55, 'ANCHORING PORTALS')
    const metal = metalTexture(512, 61)
    const A = new Portal(0, 'α', PORTAL_COLORS[0], metal)
    const B = new Portal(1, 'Ω', PORTAL_COLORS[1], metal)
    A.partner = B
    B.partner = A
    this.portals = [A, B]
    for (const p of this.portals) {
      const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
      p.bodyHandle = body.handle
      const hw = OPENING_W / 2, post = 0.95
      const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
        this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(GROUPS.static).setFriction(0.6), body)
      add(post / 2, GATE_OUTER_H / 2, GATE_DEPTH / 2, -hw - post / 2, GATE_OUTER_H / 2, 0)
      add(post / 2, GATE_OUTER_H / 2, GATE_DEPTH / 2, hw + post / 2, GATE_OUTER_H / 2, 0)
      add(hw, (GATE_OUTER_H - OPENING_H) / 2, GATE_DEPTH / 2, 0, (GATE_OUTER_H + OPENING_H) / 2, 0)
      this.portalAnim.push({ target: 1, speed: 1.6, energyTarget: 1 })
    }
    this.setLayout('gateway', true)

    progress(0.65, 'SPAWNING MATTER')
    this.props = new PropSystem(this.phys, this.scenes)
    this.spawnProps()
    this.player = new PlayerController(this.phys)
    this.player.teleport(0, LAB.spawn.pos, LAB.spawn.yaw)
    this.interaction = new Interaction(this.phys, this.props, this.portals, this.scenes)
    this.pipeline = new Pipeline(this.renderer, this.portals, this.q)
    this.applyFrame()
    window.addEventListener('resize', this.onResize)

    // let the authored piles settle, then make the settled state the canonical one
    progress(0.75, 'SETTLING')
    for (let i = 0; i < 240; i++) {
      this.phys.step()
      this.props.afterStep(this.portals, this.phys.dt)
    }
    for (const p of this.props.props) {
      p.spawnP.copy(p.currP)
      p.spawnQ.copy(p.currQ)
      p.prevP.copy(p.currP)
      p.prevQ.copy(p.currQ)
      p.body.sleep()
    }
    await tick()

    progress(0.85, 'BAKING LIGHT')
    this.bakeLabEnvironment()

    progress(0.92, 'COMPILING SHADERS')
    this.updatePortalLights()
    this.applyCamera()
    await this.precompile()
    progress(1, 'READY')
    this.publish(true)
  }

  /** lab reflections: a PMREM capture of the lit hall (with the gates glowing) */
  private bakeLabEnvironment() {
    const pmrem = new PMREMGenerator(this.renderer)
    const saved = this.portals.map((p) => [p.open, p.energy])
    for (const p of this.portals) { p.open = 1; p.energy = 1; p.syncVisuals(0) }
    SUN_SLIT.uSunOn.value = 1
    this.lab.scene.updateMatrixWorld()
    const old = this.lab.scene.environment
    const env = pmrem.fromScene(this.lab.scene, 0.02, 0.1, 300, { size: 256, position: new Vector3(0, 7, -8) })
    this.lab.scene.environment = env.texture
    old?.dispose()
    pmrem.dispose()
    this.portals.forEach((p, i) => { p.open = saved[i][0]; p.energy = saved[i][1] })
  }

  private async precompile() {
    // render every scene once from a few places so no shader compiles mid-flight
    const r = this.renderer
    for (const p of this.portals) { p.open = 1; p.energy = 1 }
    for (let w = 0 as WorldId; w < 2; w = (w + 1) as WorldId) {
      SUN_SLIT.uSunOn.value = w === 0 ? 1 : 0
      try {
        await r.compileAsync(this.scenes[w], this.camera)
      } catch {
        /* compileAsync is best-effort */
      }
    }
    this.frame(1 / 60)
    for (const p of this.portals) { p.open = 0; p.energy = 0 }
  }

  private spawnProps() {
    const P = this.props
    const q = (x: number, y: number, z: number) => new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), Math.hypot(x, y, z))
    // pyramid of mass samples
    for (let i = 0; i < 3; i++) P.spawn('cube', 0, new Vector3(4.6 + i * 0.74, 0.36, 3.2))
    for (let i = 0; i < 2; i++) P.spawn('cube', 0, new Vector3(4.97 + i * 0.74, 1.08, 3.2))
    P.spawn('cube', 0, new Vector3(5.34, 1.8, 3.2), q(0, 0.3, 0))
    // a leaning stack near the consoles
    P.spawn('cube', 0, new Vector3(-6.2, 0.36, -1.8), q(0, 0.4, 0))
    P.spawn('cube', 0, new Vector3(-6.1, 1.08, -1.75), q(0, 0.9, 0))
    for (const [x, z, a] of [[3.2, -13, 0.5], [-2.8, 13.5, 1.2], [8.4, -19, 2.1], [-8.6, 9, 0.2]] as const) P.spawn('cube', 0, new Vector3(x, 0.36, z), q(0, a, 0))
    // the showcase cube rests in the mass driver's cradle
    const L = LAB.launcher
    this.demoCube = P.spawn('cube', 0, new Vector3(L.pos.x, 1.27, L.pos.z + 0.35))
    // chrome spheres in a row behind the gate
    for (let i = 0; i < 6; i++) P.spawn('sphere', 0, new Vector3(-4 + i * 1.6, 0.34, -16.5))
    for (let i = 0; i < 3; i++) P.spawn('ceramic', 0, new Vector3(-6.8 + i * 0.9, 0.42, -16.8 - i * 0.7), undefined, { size: 0.4 })
    // glass polyhedra
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      P.spawn('glass', 0, new Vector3(-5.5 + Math.cos(a) * 1.4, 0.5, 4.8 + Math.sin(a) * 1.4), q(Math.random(), Math.random(), Math.random()), { size: 0.42, seed: i })
    }
    // a specimen tray of glass shards on a plinth: the fragments the rewind puts back in place
    this.phys.box(null, 1.3, 0.41, 1.0, 7, 0.4, -10)
    let k = 0
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 6; c++) {
        P.spawn('shard', 0, new Vector3(7 - 1.0 + c * 0.4, 0.95, -10 - 0.6 + r * 0.4), q(Math.PI / 2, 0, 0).multiply(q(0, 0, (k % 3) * 0.4)), { seed: 100 + k++, size: 0.22 })
      }
    }
    // canisters
    for (let i = 0; i < 5; i++) P.spawn('canister', 0, new Vector3(-7.4 + (i % 3) * 0.66, 0.48, 1.2 + Math.floor(i / 3) * 0.66))
    // a few things on the other side too
    const O = OTHER_ORIGIN
    for (let i = 0; i < 3; i++) P.spawn('ceramic', 1, new Vector3(O.x - 4 + i * 1.2, 0.5, O.z - 3), undefined, { size: 0.45 })
    P.spawn('cube', 1, new Vector3(O.x + 5, 0.4, O.z - 1), q(0, 0.6, 0))
  }

  // ── portals ──────────────────────────────────────────────────────────────

  setLayout(layout: Layout, instant = false) {
    this.layout = layout
    const [A, B] = this.portals
    const sa = LAB.stationA
    A.setPose(0, sa.pos, sa.yaw)
    if (layout === 'gateway') {
      B.setPose(1, OTHER_ORIGIN.clone().add(OTHER.stationB.pos), OTHER.stationB.yaw)
    } else {
      B.setPose(0, new Vector3(0, 0, 6), Math.PI)
    }
    this.afterPortalMove(instant)
  }

  /** user-facing layout switch: re-opens both gates and never leaves the player stranded */
  switchLayout(layout: Layout) {
    this.interaction.drop()
    this.setLayout(layout)
    if (this.player.world !== 0 && layout === 'mirror') {
      this.player.teleport(0, LAB.spawn.pos, LAB.spawn.yaw)
      this.viewWorld = 0
    }
    for (const p of this.portals) p.open = 0
    this.setPortalTargets(1)
    useStore.getState().set({ toast: layout === 'mirror' ? 'LAYOUT · MIRROR — PORTALS FACE EACH OTHER' : 'LAYOUT · GATEWAY — LAB ⇄ THE OTHER SIDE' })
    this.publish(true)
  }

  movePortal(p: Portal, world: WorldId, pos: Vector3, yaw: number) {
    p.setPose(world, pos, yaw)
    p.open = 0
    this.afterPortalMove(false, p)
  }

  private afterPortalMove(instant: boolean, only?: Portal) {
    for (const p of this.portals) {
      p.updateLink()
      if (this.scenes.length) {
        const s = this.scenes[p.world]
        if (p.group.parent !== s) s.add(p.group)
      }
      const body = this.phys.world.getRigidBody(p.bodyHandle)
      if (body) {
        body.setTranslation({ x: p.position.x, y: p.position.y, z: p.position.z }, false)
        body.setRotation({ x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w }, false)
      }
      if (instant && (!only || only === p)) { p.open = 1; p.energy = 1 }
    }
    this.phys.world.propagateModifiedBodyPositionsToColliders()
    this.updatePortalLights()
    if (this.props) for (const pr of this.props.props) pr.body.wakeUp()
  }

  /** the glow a portal casts takes on the mood of the world you see through it */
  updatePortalLights() {
    if (!this.lab) return
    const amb = [this.lab.ambient, this.other.ambient]
    for (const p of this.portals) {
      p.lightColor.copy(amb[p.partner.world]).lerp(p.color, 0.45)
      p.lightIntensity = p.partner.world === p.world ? 2.2 : 3.4
      const deep = p.surfaceMat.uniforms.uDeep.value as Color
      deep.copy(p.partner.world === 0 ? new Color(0.03, 0.045, 0.06) : new Color(0.12, 0.05, 0.08))
    }
  }

  setPortalTargets(open: number, energy = open, speed = 1.6) {
    for (const a of this.portalAnim) { a.target = open; a.energyTarget = energy; a.speed = speed }
  }

  setPortalTarget(i: number, open: number, energy = open, speed = 1.6) {
    const a = this.portalAnim[i]
    a.target = open; a.energyTarget = energy; a.speed = speed
  }

  // ── gameplay actions ─────────────────────────────────────────────────────

  toggleGravity() {
    this.setGravity(-this.gravityDir as 1 | -1)
  }

  setGravity(dir: number) {
    if (dir === this.gravityDir) return
    this.gravityDir = dir
    this.props.applyGravity(dir)
    this.fx.shock.set(0.5, 0.5, 0.02, 1)
    this.fx.flash.setRGB(0.18, 0.2, 0.24)
    this.audio?.gravity(dir)
    this.publish(true)
  }

  startRewind() {
    if (this.recorder.rewinding) return false
    this.interaction.drop()
    if (!this.recorder.begin()) return false
    this.rewindT = 0
    this.audio?.rewind(true)
    this.publish(true)
    return true
  }

  endRewind() {
    if (!this.recorder.rewinding) return
    const g = this.recorder.end(this.props)
    if (g !== 0) this.gravityDir = g
    this.props.applyGravity(this.gravityDir)
    this.phys.world.propagateModifiedBodyPositionsToColliders()
    this.audio?.rewind(false)
    this.publish(true)
  }

  resetWorld() {
    if (this.recorder.rewinding) this.recorder.rewinding = false
    this.interaction.drop()
    this.gravityDir = 1
    this.props.applyGravity(1)
    this.props.resetAll()
    this.recorder.clear()
    this.setLayout('gateway', true)
    this.player.teleport(0, LAB.spawn.pos, LAB.spawn.yaw)
    this.viewWorld = 0
    this.publish(true)
  }

  private handle(a: Action) {
    const st = useStore.getState()
    const cine = !!this.director?.active
    switch (a) {
      case 'cinematic':
        if (cine) this.director!.stop()
        else this.director?.start()
        return
      case 'hud': st.set({ hud: !st.hud }); return
      case 'frame': this.cycleFrame(); return
      case 'quality': this.setQuality(nextQuality(this.qualityLevel)); return
      case 'fullscreen': toggleFullscreen(); return
      case 'mute': this.audio?.setMuted(!st.muted); st.set({ muted: !st.muted }); return
      case 'help': st.set({ help: !st.help }); return
    }
    if (cine || !this.playing) return
    const eye = this.camera.position
    const fwd = this.player.forward(_fwd)
    switch (a) {
      case 'jump': if (this.player.jump()) this.audio?.step(0.6); break
      case 'grab': {
        const p = this.interaction.grab(this.player, eye, fwd)
        if (p) this.audio?.grab(true)
        break
      }
      case 'fire': {
        const it = this.interaction
        if (it.tool !== 'hand') {
          const pose = it.takePlacement()
          const portal = this.portals[it.tool === 'portalA' ? 0 : 1]
          if (pose) {
            this.movePortal(portal, pose.world, pose.pos, pose.yaw)
            this.audio?.place(true)
            this.layout = 'gateway'
            st.set({ toast: `PORTAL ${portal.label} RE-ANCHORED` })
          } else this.audio?.place(false)
          break
        }
        if (it.held) { it.throw(this.player, fwd); this.audio?.throw() }
        else { const r = it.pulse(this.player, eye, fwd); this.audio?.pulse(!!r?.prop); this.fx.shock.set(0.5, 0.5, 0.0, 0.25) }
        break
      }
      case 'tool1': this.interaction.setTool('portalA'); break
      case 'tool2': this.interaction.setTool('portalB'); break
      case 'rotateL': this.interaction.placeYaw += Math.PI / 12; break
      case 'rotateR': this.interaction.placeYaw -= Math.PI / 12; break
      case 'gravity': this.toggleGravity(); break
      case 'rewindStart': this.rewindHeld = true; this.startRewind(); break
      case 'rewindEnd': this.rewindHeld = false; this.endRewind(); break
      case 'layout': this.switchLayout(this.layout === 'gateway' ? 'mirror' : 'gateway'); break
      case 'reset': this.resetWorld(); st.set({ toast: 'WORLD RESET' }); break
    }
    this.publish(true)
  }

  // ── main loop ────────────────────────────────────────────────────────────

  start() {
    if (this.running) return
    this.running = true
    this.lastT = performance.now()
    this.renderer.setAnimationLoop(this.loop)
  }

  private loop = (t: number) => {
    if (this.manualClock || this.contextLost) return
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000))
    this.lastT = t
    this.frame(dt)
  }

  /** advance everything by dt and render one frame (also driven by the dev harness) */
  frame(dt: number) {
    const t0 = performance.now()
    this.renderer.info.autoReset = false
    this.renderer.info.reset()
    this.time += dt
    for (const a of this.input.drain()) this.handle(a)
    const cine = !!this.director?.active

    // ── camera owner ─────────────────────────────────────────────────────
    if (cine) {
      this.director!.update(dt)
    } else if (this.playing && !this.paused) {
      this.player.look(this.input)
      const crossed = this.player.update(dt, this.input, this.portals, this.interaction.held?.collider)
      if (crossed) {
        this.player.yaw = Math.atan2(Math.sin(this.player.yaw), Math.cos(this.player.yaw))
        this.onPlayerCrossed(crossed.from.partner.world)
      }
      if (this.player.world === 1 && this.player.needsRespawn(OTHER.voidY)) {
        this.player.respawn()
        this.fx.flash.setRGB(0.5, 0.3, 0.4)
      }
      this.player.applyToCamera(this.camera)
      this.viewWorld = this.player.world
    }
    if (!cine && this.paused && !this.playing) {
      // menu backdrop: slow drift in front of the gate
      this.menuCamera(dt)
    }

    // ── physics (fixed 60 Hz) ─────────────────────────────────────────────
    const step = this.phys.dt
    if (this.recorder.rewinding) {
      this.rewindT += dt
      const rate = this.director?.active ? this.director.rewindRate() : Math.min(2.2, 0.5 + this.rewindT * 2)
      const exhausted = this.recorder.advance(dt, rate)
      this.recorder.apply(this.props)
      this.phys.world.propagateModifiedBodyPositionsToColliders()
      this.props.updateVisuals(0, this.portals, false)
      if (exhausted && !this.rewindHeld && !this.director?.active) this.endRewind()
    } else {
      this.acc += dt
      let n = 0
      const fwd = this.player.forward(_fwd)
      while (this.acc >= step && n < 4) {
        this.interaction.stepHeld(this.player, this.player.eye, fwd, step)
        this.director?.fixedStep(step)
        this.phys.step(this.audio ? this.onContact : undefined)
        this.props.afterStep(this.portals, step, (p, from) => this.audio?.propCross(p, from))
        this.recorder.record(this.props.props, this.gravityDir)
        this.acc -= step
        n++
      }
      if (n === 4) this.acc = 0
      this.props.recycleFallen(OTHER.voidY - 40)
      this.props.updateVisuals(this.acc / step, this.portals)
    }

    // ── portals / tools ───────────────────────────────────────────────────
    for (let i = 0; i < this.portals.length; i++) {
      const p = this.portals[i], a = this.portalAnim[i]
      p.open = approach(p.open, a.target, dt * a.speed)
      p.energy = approach(p.energy, a.energyTarget, dt * a.speed * 1.4)
      p.syncVisuals(this.time)
    }
    if (!cine && this.playing) {
      const fwd = this.player.forward(_fwd)
      const it = this.interaction
      const moving = it.tool === 'portalA' ? this.portals[0] : it.tool === 'portalB' ? this.portals[1] : null
      it.updateGhost(this.player, this.camera.position, fwd, moving)
      if (this.fpsFrames % 3 === 0) it.updateAim(this.player, this.camera.position, fwd)
    } else this.interaction.ghost.visible = false

    // ── worlds & FX ───────────────────────────────────────────────────────
    this.lab.update(this.time, dt)
    this.other.update(this.time, dt)
    coilCharge.value = Math.max(0, coilCharge.value - dt * 0.6)
    const fx = this.fx
    if (fx.shock.w > 0) {
      fx.shock.z += dt * 0.9
      fx.shock.w = Math.max(0, fx.shock.w - dt * 0.9)
    }
    fx.flash.multiplyScalar(Math.exp(-dt * 5))
    fx.rewind = approach(fx.rewind, this.recorder.rewinding ? 1 : 0, dt * 5)
    this.audio?.update(this, dt)

    // ── render ────────────────────────────────────────────────────────────
    this.pipeline.render(this.camera, this.viewWorld, this.scenes, this.portals, fx, this.time, (w) => {
      SUN_SLIT.uSunOn.value = w === 0 ? 1 : 0
    })

    // ── stats / UI ────────────────────────────────────────────────────────
    const info = this.renderer.info
    this.stats.drawCalls = info.render.calls
    this.stats.triangles = info.render.triangles
    this.stats.renders = this.pipeline.portalRenderer.stats.renders + 1
    this.stats.frameMs = performance.now() - t0
    this.fpsAcc += dt
    this.fpsFrames++
    if (this.fpsAcc >= 0.5) {
      this.stats.fps = Math.round(this.fpsFrames / this.fpsAcc)
      this.fpsAcc = 0
      this.fpsFrames = 0
    }
    this.uiAcc += dt
    if (this.uiAcc > 0.1) { this.uiAcc = 0; this.publish(false) }
  }

  private onContact = (h1: number, h2: number, force: number) => {
    const p = this.props.byHandle(h1) ?? this.props.byHandle(h2)
    if (p) this.audio?.impact(p, force)
  }

  private onPlayerCrossed(world: WorldId) {
    this.audio?.cross(world)
    useStore.getState().set({ world, crossings: useStore.getState().crossings + 1 })
  }

  private menuT = 0
  private menuCamera(dt: number) {
    this.menuT += dt
    const t = this.menuT
    this.viewWorld = 0
    // slow drift on the right of the hall, clear of the mass driver, looking past α down the sunbeam
    this.camera.position.set(3.6 + Math.sin(t * 0.07) * 1.6, 1.7 + Math.sin(t * 0.11) * 0.2, 11.5 + Math.cos(t * 0.05) * 1.2)
    this.camera.lookAt(-0.8, 2.6, -8)
  }

  // ── session state ────────────────────────────────────────────────────────

  enterPlay() {
    this.playing = true
    this.paused = false
    this.input.requestLock()
    this.setPortalTargets(1)
    this.lab.setPower(1)
    this.audio?.resume()
    useStore.getState().set({ phase: 'play' })
  }

  pause() {
    this.paused = true
    useStore.getState().set({ phase: this.playing ? 'paused' : 'menu' })
  }

  resume() {
    this.paused = false
    this.input.requestLock()
    useStore.getState().set({ phase: 'play' })
  }

  setQuality(level: QualityLevel) {
    this.qualityLevel = level
    this.q = QUALITY[level]
    try { localStorage.setItem('pp.quality', level) } catch { /* private mode */ }
    this.pipeline.setQuality(this.q)
    this.lab.setQuality(this.q)
    this.other.setQuality(this.q)
    this.applyFrame()
    useStore.getState().set({ quality: level, toast: `QUALITY · ${level}` })
  }

  cycleFrame() {
    const order: FrameMode[] = ['full', '16:9', '9:16']
    this.frameMode = order[(order.indexOf(this.frameMode) + 1) % order.length]
    useStore.getState().set({ frame: this.frameMode, toast: `FRAME · ${this.frameMode.toUpperCase()}` })
    this.applyFrame()
  }

  private onResize = () => this.applyFrame()

  /** size the canvas to the window or to a recording frame (16:9 / 9:16), letterboxed */
  applyFrame() {
    const ww = Math.max(2, window.innerWidth), wh = Math.max(2, window.innerHeight)
    let w = ww, h = wh
    if (this.frameMode !== 'full') {
      const target = this.frameMode === '16:9' ? 16 / 9 : 9 / 16
      if (ww / wh > target) { h = wh; w = Math.round(wh * target) } else { w = ww; h = Math.round(ww / target) }
    }
    const c = this.canvas
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    c.style.left = `${Math.round((ww - w) / 2)}px`
    c.style.top = `${Math.round((wh - h) / 2)}px`
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.pipeline?.setSize(Math.round(w * dpr), Math.round(h * dpr))
    this.camera.aspect = w / h
    this.applyCamera()
  }

  applyCamera(fov = this.baseFov) {
    const aspect = this.camera.aspect
    // portrait frames: widen the vertical field so the horizontal one stays usable
    const minH = MathUtils.degToRad(58)
    const vForH = MathUtils.radToDeg(2 * Math.atan(Math.tan(minH / 2) / aspect))
    this.camera.fov = Math.min(105, Math.max(fov, aspect < 1 ? vForH : fov))
    this.camera.updateProjectionMatrix()
  }

  publish(force: boolean) {
    const st = useStore.getState()
    const it = this.interaction
    const next = {
      tool: it?.tool ?? 'hand',
      gravity: this.gravityDir,
      rewinding: this.recorder.rewinding,
      history: this.recorder.seconds,
      world: this.viewWorld,
      held: it?.held?.kind ?? null,
      aim: it?.aim ?? 'none',
      fps: this.stats.fps,
      layout: this.layout,
      renders: this.stats.renders,
      levels: this.pipeline ? [...this.pipeline.portalRenderer.stats.levels] : [0, 0],
    }
    if (force || Object.entries(next).some(([k, v]) => JSON.stringify((st as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v))) st.set(next)
  }

  get worldName() {
    return WORLD_NAMES[this.viewWorld]
  }

  // ── context loss ─────────────────────────────────────────────────────────

  private onContextLost = (e: Event) => {
    e.preventDefault()
    this.contextLost = true
    useStore.getState().set({ contextLost: true })
  }

  private onContextRestored = () => {
    // three re-creates programs and textures lazily; render targets are re-sized to force re-allocation
    this.contextLost = false
    this.pipeline.setQuality(this.q)
    this.applyFrame()
    this.other.rebake()
    this.bakeLabEnvironment()
    useStore.getState().set({ contextLost: false })
    this.lastT = performance.now()
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.input.dispose()
    this.pipeline.dispose()
    this.renderer.dispose()
  }
}

const _fwd = new Vector3()

function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step)
}

function nextQuality(l: QualityLevel): QualityLevel {
  const order: QualityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']
  return order[(order.indexOf(l) + 1) % order.length]
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => {})
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
