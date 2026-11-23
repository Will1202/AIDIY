// 游戏总控：渲染循环、世界加载 / 卸载、列车行驶状态机、玩家与交互、过场、存档、UI 同步。
import {
  Color, FogExp2, Matrix4, Mesh, Object3D, PerspectiveCamera, PMREMGenerator, Scene, Vector3, WebGLRenderer, type Texture,
} from 'three'
import { Pipeline, defaultFx, lerpFx, type FxState } from '../engine/pipeline'
import { QUALITY, guessQuality, isTouchDevice, type QualityLevel, type QualityPreset } from '../engine/quality'
import { audio, type Sfx } from '../audio/AudioEngine'
import { Input } from '../player/Input'
import { Player } from '../player/Player'
import { raycast, type CollisionWorld } from '../physics/collision'
import { Director } from './Director'
import type { GameApi, Note, Shot } from './api'
import { WORLDS, type EndingId, type MomentId, type WorldId } from './types'
import { World, type Interactable } from '../world/World'
import { Train, CAR_HALF, FLOOR_Y, DOOR_X } from '../world/shared/Train'
import { Conductor } from '../world/shared/Conductor'
import { Transit } from '../world/Transit'
import { rimMaterial, yieldFrame } from '../world/shared/kit'
import {
  S, Meta, gameStore, metaStore, settingsStore, newGameData, loadAll, saveNow, setAutosave, setBeforeSave, markDirty, saveSettings,
  resetEverything, onStateChange, type GameData,
} from '../state/store'
import { setUI, ui, toast, subtitle, uiStore } from '../state/ui'
import { ITEMS, FRAGMENTS, findRecipe } from '../content/items'
import { ARCHIVES, LOST_TICKETS } from '../content/archives'
import { DIALOGUES } from '../content/dialogue'
import { DialogueRun } from '../systems/dialogue'
import { activeObjective, currentStep, QUESTS } from '../content/quests'
import { epilogue } from '../systems/endings'

export type TravelPhase = 'docked' | 'closing' | 'departing' | 'transit' | 'arriving' | 'opening'

const DEV = import.meta.env?.DEV ?? false

/** 世界工厂：动态 import，按需加载（代码分包 = 资源流式加载） */
async function createWorld(id: WorldId): Promise<World> {
  switch (id) {
    case 'station': return new (await import('../world/station/Station')).Station()
    case 'city': return new (await import('../world/city/InvertedCity')).InvertedCity()
    case 'abyss': return new (await import('../world/abyss/AbyssStation')).AbyssStation()
    case 'desert': return new (await import('../world/desert/FrozenHour')).FrozenHour()
    case 'museum': return new (await import('../world/museum/Museum')).Museum()
    case 'terminus': return new (await import('../world/terminus/Terminus')).Terminus()
  }
}

/** 路线解锁：放入碎片后下一站亮起 */
export function unlockedRoutes(): WorldId[] {
  const out: WorldId[] = ['station', 'city']
  if (S.is('console.fragment_city')) out.push('abyss')
  if (S.is('console.fragment_abyss')) out.push('desert')
  if (S.is('console.fragment_desert')) out.push('museum')
  if (S.is('console.fragment_museum')) out.push('terminus')
  return out
}

const tmpV = new Vector3()
const tmpM = new Matrix4()
const ORDER: WorldId[] = ['station', 'city', 'abyss', 'desert', 'museum', 'terminus']

export class Game implements GameApi {
  renderer!: WebGLRenderer
  pipeline!: Pipeline
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(72, 16 / 9, 0.05, 3000)
  readonly fx: FxState = defaultFx()
  private fxTarget: FxState = defaultFx()
  readonly audio = audio
  readonly input = new Input()
  readonly player = new Player()
  train!: Train
  readonly conductor = new Conductor()
  readonly director = new Director()
  transit!: Transit
  world: World | null = null
  private next: World | null = null
  private nextBuild: Promise<World> | null = null
  qLevel: QualityLevel = 'MEDIUM'
  q: QualityPreset = QUALITY.MEDIUM
  time = 0
  phase: TravelPhase = 'docked'
  private phaseT = 0
  travelTo: WorldId | null = null
  private s = 0
  trainSpeed = 0
  mode: 'boot' | 'menu' | 'loading' | 'play' | 'ending' = 'boot'
  paused = false
  private dialogueRun: DialogueRun | null = null
  private manip: { label: string; onMove: (dx: number, dy: number) => void; onEnd?: () => void } | null = null
  private target: Interactable | null = null
  private trainItems: Interactable[] = []
  private rim = rimMaterial()
  private rimFor: Object3D | null = null
  private rimMeshes: Mesh[] = []
  private keypadCheck: ((d: number[]) => boolean) | null = null
  private lastObjective = ''
  private stepAcc = 0
  private stepId = ''
  private fpsAcc = 0
  private fpsN = 0
  private flashes: { t: number; s: number; thunder: boolean }[] = []
  private envTex: Texture | null = null
  private pmrem: PMREMGenerator | null = null
  private fade = 0
  private fadeTarget = 0
  private eyes = 1
  private seated: { x: number; z: number; yaw: number } | null = null
  private suppressPause = false
  private lastFrame = 0
  private running = false
  private capture: ((url: string) => void) | null = null
  photo = { active: false, pos: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 60, exposure: 0, letterbox: false }
  showcaseActive = false
  private showcaseRestore: GameData | null = null
  private respawning = false
  /** 测试 / 截图时手动驱动帧 */
  manualClock = false
  private canvas!: HTMLCanvasElement
  private unsub: (() => void)[] = []

  // ---------------- GameApi ----------------
  get docked() {
    return this.phase === 'docked' || this.phase === 'opening'
  }
  get inCinematic() {
    return this.director.active
  }
  get keys() {
    return this.input
  }

  say(who: string, text: string, seconds = 4) {
    subtitle(who, text, seconds * (settingsStore.getState().subtitleSize > 1.1 ? 1.1 : 1))
  }
  toast(title: string, text?: string) {
    toast('info', title, text)
  }
  read(note: Note) {
    this.modal(true)
    setUI({ reading: { title: note.title, sub: note.sub, body: note.body, kind: note.kind ?? 'note' } })
    this.sfx('paper')
  }
  pickup(item: string) {
    if (S.give(item)) {
      toast('item', ITEMS[item]?.name ?? item, '已放入背包 · Tab 查看')
      this.sfx('pickup')
    }
    this.refresh()
  }
  archive(id: string) {
    const a = ARCHIVES[id]
    if (!a) return
    const isNew = S.addArchive(id)
    if (isNew) toast('archive', `异常档案 ${a.no}`, a.title)
    S.markRead(id)
    this.read({ title: `${a.no} · ${a.title}`, sub: a.world, body: a.body, kind: 'archive' })
  }
  collect(id: string) {
    const t = LOST_TICKETS[id]
    if (!t) return
    if (S.collect(id)) {
      toast('collect', `失落的车票 · ${t.night}`, `${S.get().collectibles.length} / ${Object.keys(LOST_TICKETS).length} · ${t.note}`)
      this.sfx('pickup')
    }
  }
  dialogue(id: string) {
    const d = DIALOGUES[id]
    if (!d) return
    this.dialogueRun = new DialogueRun(d)
    this.modal(true)
    setUI({ dialogue: this.dialogueRun.view() })
    if (!this.dialogueRun.view()) this.endDialogue()
  }
  keypad(id: string, title: string, length: number, check: (digits: number[]) => boolean) {
    this.keypadCheck = check
    this.modal(true)
    setUI({ keypad: { id, title, digits: new Array(length).fill(0) } })
    this.sfx('open')
  }
  openSonar() {
    this.modal(true)
    setUI({ sonar: true })
    this.sfx('open')
  }
  openRadio() {
    this.modal(true)
    setUI({ radio: true })
    this.sfx('open')
  }
  manipulate(label: string, onMove: (dx: number, dy: number) => void, onEnd?: () => void) {
    this.manip = { label, onMove, onEnd }
    this.player.locked = true
    this.input.manipulating = true
    setUI({ manipulate: label, prompt: null })
  }
  sfx(name: Sfx, at?: Vector3, gain = 1) {
    this.audio.play(name, at, gain)
  }
  cinematic(shots: Shot[], opts?: { letterbox?: boolean; skippable?: boolean; keepControl?: boolean }) {
    if (!opts?.keepControl) {
      this.target = null
      setUI({ prompt: null })
    }
    return this.director.play(shots, opts)
  }
  moment(id: MomentId) {
    Meta.seeMoment(id)
  }
  flash(strength: number, delay = 2) {
    this.fx.flash.setRGB(0.5 * strength, 0.55 * strength, 0.7 * strength)
    this.flashes.push({ t: delay, s: strength, thunder: true })
  }
  save() {
    void saveNow()
  }
  refresh() {
    this.lastObjective = ''
  }
  requestDepart(to: WorldId) {
    S.set('route', to)
    this.depart(to)
  }
  get renderSize() {
    return this.pipeline.renderSize
  }

  // ---------------- 启动 ----------------
  async boot(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const settings = settingsStore.getState()
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: DEV, stencil: false })
    } catch (e) {
      setUI({ screen: 'boot', loadingText: '这台设备不支持 WebGL 2，无法运行。' })
      throw e
    }
    this.renderer = renderer
    this.qLevel = settings.quality ?? guessQuality(renderer.getContext() as WebGL2RenderingContext)
    this.q = QUALITY[this.qLevel]
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.maxPixelRatio))
    this.pipeline = new Pipeline(renderer, this.q)
    // 阴影贴图总是开启：大多数灯只在中高档位投影，但“等待”厅的影子谜题在任何档位都必须有影子
    renderer.shadowMap.enabled = true
    this.pmrem = new PMREMGenerator(renderer)
    this.scene.name = 'scene'
    this.train = new Train(this.q)
    this.train.build()
    this.scene.add(this.train.group)
    this.transit = new Transit(Math.round(1400 * this.q.particles + 300))
    this.scene.add(this.transit.group)
    this.conductor.place(this.train.group, 8.7, FLOOR_Y, -0.85, -Math.PI / 2)
    this.input.attach(canvas)
    this.input.onKey = (code, e) => this.onKey(code, e)
    this.setupTrainItems()
    this.player.onStep = (s, k) => this.audio.step(s, k)
    this.player.onLand = (v) => { if (v > 7) this.sfx('deny', undefined, 0.3) }
    const resize = () => this.resize()
    window.addEventListener('resize', resize)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement ?? canvas)
    this.unsub.push(() => { window.removeEventListener('resize', resize); ro.disconnect() })
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('beforeunload', this.onUnload)
    this.unsub.push(onStateChange(() => this.syncConsole()))
    setUI({ touch: isTouchDevice() })
    this.resize()
    setBeforeSave(() => this.fillSave())
    const { hasSave, save } = await loadAll()
    if (save) gameStore.setState(save, true)
    setUI({ hasSave, loadingText: '' })
    this.applySettings()
    this.start()
    // 主菜单背景：实时渲染的午夜车站
    await this.loadWorld('station', true)
    // 启动期间玩家可能已经开始了游戏（测试脚本），只有仍在启动状态时才进入菜单
    if (this.mode === 'boot') this.enterMenu()
    this.booted = true
  }

  booted = false

  private start() {
    if (this.running) return
    this.running = true
    this.lastFrame = performance.now()
    const tick = () => {
      if (!this.running) return
      if (!this.manualClock) {
        const now = performance.now()
        const dt = Math.min(0.05, Math.max(0.0005, (now - this.lastFrame) / 1000))
        this.lastFrame = now
        this.frame(dt)
      }
      if (document.hidden) setTimeout(tick, 100)
      else requestAnimationFrame(tick)
    }
    // rAF 在隐藏的标签页里不会触发，用 setTimeout 兜底
    requestAnimationFrame(tick)
  }

  applySettings() {
    const s = settingsStore.getState()
    this.audio.setVolumes(s)
    this.camera.fov = s.fov
    this.camera.updateProjectionMatrix()
    setUI({})
  }

  setQuality(level: QualityLevel) {
    this.qLevel = level
    this.q = QUALITY[level]
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.maxPixelRatio))
    this.pipeline.setQuality(this.q)
    this.resize()
    settingsStore.setState({ quality: level })
    void saveSettings()
    // 已加载材质需要重新编译阴影开关
    this.scene.traverse((o) => {
      const m = (o as Mesh).material as { needsUpdate?: boolean } | undefined
      if (m && 'needsUpdate' in m) m.needsUpdate = true
    })
    toast('info', '画质已切换', `${level}（雨量、粒子数量等在重新进入世界后完全生效）`)
  }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas
    const w = Math.max(2, el.clientWidth || window.innerWidth)
    const h = Math.max(2, el.clientHeight || window.innerHeight)
    this.renderer.setSize(w, h, false)
    const pr = this.renderer.getPixelRatio()
    this.pipeline.setSize(Math.round(w * pr), Math.round(h * pr))
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ---------------- 世界 ----------------
  private apiForWorld(): GameApi {
    return this
  }

  async buildWorld(id: WorldId): Promise<World> {
    const w = await createWorld(id)
    w.init(this.apiForWorld(), this.q)
    await w.build()
    w.built = true
    return w
  }

  private loadLock: Promise<unknown> = Promise.resolve()

  /** 立即切换到某个世界（停靠状态），用于读档 / 新游戏 / 菜单。多次调用会串行执行，避免两个世界同时挂进场景 */
  loadWorld(id: WorldId, menu = false): Promise<World> {
    const run = this.loadLock.then(() => this.loadWorldNow(id, menu))
    this.loadLock = run.catch(() => {})
    return run
  }

  private async loadWorldNow(id: WorldId, menu = false) {
    setUI({ screen: menu ? ui().screen : 'loading', loadingText: `${WORLDS[id].name} · ${WORLDS[id].en}` })
    this.mode = menu ? this.mode : 'loading'
    this.director.skip(this.camera)
    if (this.world) this.unloadWorld(this.world)
    if (this.next) { this.unloadWorld(this.next); this.next = null }
    await yieldFrame()
    const w = await this.buildWorld(id)
    // 防御：场景里不应再有其他世界的根节点
    for (const c of [...this.scene.children]) if (c.name.startsWith('world:') && c !== w.root) c.removeFromParent()
    this.world = w
    this.scene.add(w.root)
    w.root.matrixAutoUpdate = false
    w.root.matrix.identity()
    w.root.updateMatrixWorld(true)
    this.applyEnv(w, true)
    this.phase = 'docked'
    this.s = 0
    this.trainSpeed = 0
    this.train.group.position.set(0, 0, 0)
    this.train.setDoors(true)
    this.train.door = 1
    this.train.setHeadlight(0.15)
    this.transit.visible = 0
    w.col.enabled = true
    try {
      await this.renderer.compileAsync(this.scene, this.camera)
    } catch { /* 部分驱动不支持并行编译 */ }
    w.onDocked()
    this.conductor.group.visible = true
    this.placeConductor()
    this.syncConsole()
    gameStore.setState({ world: id })
    setUI({ world: id })
    return w
  }

  private unloadWorld(w: World) {
    w.dispose()
    if (this.world === w) this.world = null
  }

  private applyEnv(w: World, instant: boolean) {
    const e = w.env
    this.scene.background = e.background.clone()
    this.scene.fog = new FogExp2(e.fogColor.getHex(), e.fogDensity)
    const fx = { ...defaultFx(), ...e.fx }
    this.fxTarget = { ...defaultFx(), ...fx, flash: new Color(), tint: (e.fx.tint ?? new Color(1, 1, 1)).clone(), lift: (e.fx.lift ?? new Color(0, 0, 0)).clone() }
    if (instant) lerpFx(this.fx, this.fx, this.fxTarget, 1)
    // 环境贴图
    const es = w.envScene()
    if (this.envTex) { this.envTex.dispose(); this.envTex = null }
    if (es && this.pmrem) {
      this.envTex = this.pmrem.fromScene(es, 0.02).texture
      es.traverse((o) => {
        const m = o as Mesh
        m.geometry?.dispose()
        ;(m.material as { dispose?: () => void } | undefined)?.dispose?.()
      })
    }
    this.scene.environment = this.envTex
    this.audio.setScore(e.score)
    this.transit.setColor(WORLDS[w.id].accent)
  }

  private placeConductor() {
    const spot = this.world && 'conductorSpot' in this.world ? (this.world as unknown as { conductorSpot(): { x: number; y: number; z: number; yaw: number } | null }).conductorSpot() : null
    if (spot && this.world) {
      this.conductor.place(this.world.root, spot.x, spot.y, spot.z, spot.yaw)
    } else {
      this.conductor.place(this.train.group, 8.7, FLOOR_Y, -0.85, -Math.PI / 2)
    }
  }

  // ---------------- 列车上的交互：控制台、列车长、座位、驾驶室 ----------------
  private setupTrainItems() {
    const t = this.train
    const cpos = new Vector3(CAR_HALF - 0.55, FLOOR_Y + 1.25, 1.0)
    this.trainItems.push({
      id: 'console.place', pos: cpos.clone().add(new Vector3(0, 0, 0)), radius: 0.45, range: 2.4,
      label: () => {
        const f = FRAGMENTS.find((x) => S.has(x))
        return f ? `路线控制台 · ${ITEMS[f].name}` : '路线控制台'
      },
      verb: () => (FRAGMENTS.some((x) => S.has(x)) ? '放入碎片' : '转动旋钮 · 选择目的地'),
      enabled: () => this.phase === 'docked',
      use: () => {
        const f = FRAGMENTS.find((x) => S.has(x))
        if (f) {
          S.take(f)
          S.set(`console.${f}`)
          this.sfx('insert', cpos)
          this.sfx('success')
          const next = unlockedRoutes()
          const w = next[next.length - 1]
          S.set('route', w)
          this.say('', `碎片嵌进了凹槽。控制台上「${WORLDS[w].name}」亮了起来。`, 4.5)
          this.syncConsole()
          this.refresh()
          this.save()
          return
        }
        this.cycleRoute()
      },
      highlight: t.console,
    })
    this.trainItems.push({
      id: 'console.lever', pos: new Vector3(CAR_HALF - 0.55, FLOOR_Y + 1.35, 0.72), radius: 0.18, range: 2.2,
      label: () => {
        const r = S.flag('route') as WorldId | undefined
        return r ? `发车拉杆 · 前往${WORLDS[r].name}` : '发车拉杆'
      },
      verb: '拉下',
      enabled: () => this.phase === 'docked' && S.num('travel.count') > 0,
      blocked: () => {
        const r = S.flag('route') as WorldId | undefined
        if (!r || r === this.world?.id) return '先转动旋钮选择目的地'
        if (!Train.inside(this.player.body.x, this.player.body.y, this.player.body.z)) return '请在车厢内'
        if (this.player.g < 0) return '请先恢复重力'
        return null
      },
      use: () => {
        const r = S.flag('route') as WorldId
        this.sfx('lever', this.train.lever.getWorldPosition(new Vector3()))
        this.train.lever.rotation.x = 0.5
        setTimeout(() => (this.train.lever.rotation.x = -0.5), 1500)
        this.depart(r)
      },
      highlight: t.lever,
    })
    // 列车长
    this.trainItems.push({
      id: 'conductor', pos: new Vector3(), radius: 0.45, range: 2.6,
      label: '列车长', verb: '交谈',
      enabled: () => this.conductor.group.visible && !!this.conductor.group.parent,
      use: () => {
        const w = this.world?.id
        const onPlatform = this.conductor.group.parent !== this.train.group
        if (w === 'station' && onPlatform) this.dialogue('cs')
        else if (w === 'terminus' && onPlatform) this.dialogue('cf')
        else this.dialogue('ct')
      },
      highlight: this.conductor.group,
    })
    // 靠窗的座位
    const seats = [
      { x: 2.1, z: 0.92, yaw: Math.PI / 2 + 0.0 }, { x: -2.1, z: -0.92, yaw: -Math.PI / 2 }, { x: 0.8, z: -0.92, yaw: Math.PI / 2 }, { x: -3.4, z: 0.92, yaw: -Math.PI / 2 },
    ]
    for (const s of seats) {
      this.trainItems.push({
        id: `seat.${s.x}`, pos: new Vector3(s.x, FLOOR_Y + 0.55, s.z), radius: 0.35, range: 2.0, label: '靠窗的座位', verb: '坐下',
        enabled: () => !this.seated && this.player.g > 0,
        use: () => this.sit(s.x, s.z, s.z > 0 ? 0 : Math.PI),
      })
    }
    // 尾端门
    this.trainItems.push({
      id: 'rearDoor', pos: new Vector3(-CAR_HALF, FLOOR_Y + 1.3, 0), radius: 0.5, range: 2.2, label: '通往后一节车厢的门', verb: '检查',
      use: () => {
        this.sfx('deny', new Vector3(-CAR_HALF, FLOOR_Y + 1.3, 0))
        this.say('', S.is('knowTruth') ? '门的另一边很暗。你知道那里坐满了以前的“你”，都睡着了。' : '锁着。玻璃那边的车厢没有灯，隐约能看见一排排空座位。', 4)
      },
    })
    // 驾驶室门（终点世界里由世界打开）
    this.trainItems.push({
      id: 'cabDoor', pos: new Vector3(CAR_HALF, FLOOR_Y + 1.3, 0), radius: 0.5, range: 2.2, label: '驾驶室', verb: () => (this.train.cabOpen ? '进入' : '检查'),
      enabled: () => !this.train.cabOpen,
      use: () => {
        this.sfx('deny', new Vector3(CAR_HALF, FLOOR_Y + 1.3, 0))
        this.say('', '「驾驶室 · 乘客止步」。门把手是冰的。', 3)
      },
    })
  }

  private cycleRoute() {
    const opts = unlockedRoutes().filter((w) => w !== this.world?.id)
    if (!opts.length) return
    const cur = S.flag('route') as WorldId | undefined
    const i = cur ? opts.indexOf(cur) : -1
    const nx = opts[(i + 1) % opts.length]
    S.set('route', nx)
    this.sfx('dial', this.train.console.getWorldPosition(new Vector3()))
    this.say('', `目的地：${WORLDS[nx].name} · ${WORLDS[nx].en}`, 2.5)
    this.syncConsole()
  }

  /** 控制台灯与碎片凹槽的显示 */
  syncConsole() {
    if (!this.train) return
    const un = unlockedRoutes()
    const route = S.flag('route') as WorldId | undefined
    ORDER.forEach((w, i) => {
      const st = w === route ? 2 : w === this.world?.id ? 3 : un.includes(w) ? 1 : 0
      this.train.setConsoleLamp(i, st)
    })
    FRAGMENTS.forEach((f, i) => this.train.setSlot(i, S.is(`console.${f}`) ? ITEMS[f].color : null))
    const idx = route ? ORDER.indexOf(route) : 0
    this.train.dial.rotation.z = -(idx / 6) * Math.PI * 2
  }

  private sit(x: number, z: number, yaw: number) {
    this.seated = { x, z, yaw }
    this.player.teleport(x, FLOOR_Y + 0.5, z, yaw, -0.05)
    this.player.body.height = 1.0
    this.say('', '你坐了下来。（移动或按 E 起身）', 2.5)
  }

  private stand() {
    if (!this.seated) return
    const s = this.seated
    this.seated = null
    this.player.body.height = 1.72
    this.player.teleport(s.x, FLOOR_Y, 0, this.player.yaw, this.player.pitch)
  }

  // ---------------- 列车行驶 ----------------
  depart(to: WorldId) {
    if (this.phase !== 'docked' || !this.world) return
    if (to === this.world.id) return
    this.stand()
    this.travelTo = to
    this.phase = 'closing'
    this.phaseT = 0
    this.train.setDoors(false)
    this.sfx('doorClose', new Vector3(DOOR_X[1], FLOOR_Y + 1, 1.5))
    // 车门口的玩家往车厢里推一点，避免被门夹住
    const b = this.player.body
    if (Train.nearDoor(b.x, b.z)) this.player.teleport(b.x, b.y, 0.4)
    if (this.conductor.group.parent !== this.train.group) this.conductor.place(this.train.group, 8.7, FLOOR_Y, -0.85, -Math.PI / 2)
    // 下一个世界在车门关闭、出站时就开始构建
    this.nextBuild = this.buildWorld(to).then((w) => (this.next = w))
    this.target = null
    setUI({ prompt: null })
  }

  private updateTravel(dt: number) {
    const w = this.world
    this.phaseT += dt
    switch (this.phase) {
      case 'docked':
      case 'opening': {
        this.trainSpeed = 0
        if (this.phase === 'opening' && this.train.doorsOpen) {
          this.phase = 'docked'
        }
        break
      }
      case 'closing': {
        if (this.train.doorsClosed && this.phaseT > 1.4) {
          this.phase = 'departing'
          this.phaseT = 0
          S.set('travel.count', S.num('travel.count') + 1)
          w?.onDepart()
          if (w) w.col.enabled = false
          this.sfx('horn', new Vector3(26, 3, 0), 0.7)
          this.train.setHeadlight(1)
        }
        break
      }
      case 'departing': {
        if (!w) break
        const T = w.departTime, L = w.departLength
        const u = Math.min(1, this.phaseT / T)
        this.s = L * u * u
        this.trainSpeed = (2 * L * u) / T
        this.placeRoot(w, this.s)
        w.onDepartProgress(u, dt)
        const fogK = Math.max(0, (u - 0.55) / 0.45)
        const fog = this.scene.fog as FogExp2
        fog.density = w.env.fogDensity + (0.045 - w.env.fogDensity) * fogK * fogK
        this.transit.visible = fogK * 0.8
        this.transit.speed = this.trainSpeed
        if (u >= 1) this.enterTransit()
        break
      }
      case 'transit': {
        this.trainSpeed = 60
        this.transit.speed = 60
        this.transit.visible = Math.min(1, this.transit.visible + dt)
        if (this.next && this.phaseT > 6.5 && !this.compiling) this.beginArrival()
        break
      }
      case 'arriving': {
        if (!w) break
        const T = w.approachTime, L = w.approachLength
        const u = Math.min(1, this.phaseT / T)
        const p = 2.2
        this.s = -L * Math.pow(1 - u, p)
        this.trainSpeed = (L * p * Math.pow(1 - u, p - 1)) / T
        this.placeRoot(w, this.s)
        const fog = this.scene.fog as FogExp2
        const k = Math.min(1, u / 0.45)
        fog.density = 0.045 + (w.env.fogDensity - 0.045) * (1 - Math.pow(1 - k, 2))
        this.transit.visible = Math.max(0, 1 - u * 3)
        this.transit.speed = this.trainSpeed
        w.onApproach(u, dt)
        if (u >= 1) this.dock()
        break
      }
    }
    const ext = this.train.externalSpeed
    const sp = this.trainSpeed > 0 ? this.trainSpeed : ext
    this.train.speed = sp
    const braking = this.phase === 'arriving' || (ext > 0 && this.train.externalBraking)
    const inside = this.director.active && ext > 0 ? false : Train.inside(this.player.body.x, this.player.body.y, this.player.body.z) || this.phase !== 'docked'
    this.audio.setTrain(sp, inside, braking)
  }

  private compiling = false

  private placeRoot(w: World, s: number) {
    w.trackPose(s, tmpM)
    w.root.matrix.copy(tmpM).invert()
    w.root.matrixWorldNeedsUpdate = true
  }

  private enterTransit() {
    const old = this.world
    this.phase = 'transit'
    this.phaseT = 0
    this.fx.flash.setRGB(0.35, 0.33, 0.3)
    this.audio.setScore('transit')
    if (old) {
      this.scene.remove(old.root)
      // 下一帧再释放，避免本帧还在引用
      setTimeout(() => old.dispose(), 50)
      this.world = null
    }
    this.scene.background = new Color(0x020305)
    ;(this.scene.fog as FogExp2).color.setHex(0x020305)
    void this.nextBuild?.then(async (nw) => {
      this.compiling = true
      // 新世界放在驶入起点（远在雾里），编译着色器（新世界的灯光已经在场景里）
      this.scene.add(nw.root)
      nw.root.matrixAutoUpdate = false
      nw.col.enabled = false
      this.placeRoot(nw, -nw.approachLength)
      nw.root.updateMatrixWorld(true)
      try {
        await this.renderer.compileAsync(this.scene, this.camera)
      } catch { /* ignore */ }
      this.compiling = false
    })
  }

  private beginArrival() {
    const nw = this.next!
    this.next = null
    this.nextBuild = null
    this.world = nw
    this.applyEnv(nw, false)
    ;(this.scene.fog as FogExp2).density = 0.045
    this.phase = 'arriving'
    this.phaseT = 0
    this.fx.flash.setRGB(0.3, 0.3, 0.3)
    gameStore.setState({ world: nw.id })
    setUI({ world: nw.id })
    this.placeConductor()
    this.syncConsole()
    this.save()
  }

  /** 展映：把当前世界重新放到驶入起点，按真实的驶入流程再开进来一次 */
  replayArrival() {
    const w = this.world
    if (!w) return
    this.phase = 'arriving'
    this.phaseT = 0
    w.col.enabled = false
    this.train.setDoors(false)
    this.train.door = 0
    this.train.setHeadlight(1)
    this.placeRoot(w, -w.approachLength)
    ;(this.scene.fog as FogExp2).density = 0.045
    this.placeConductor()
  }

  private dock() {
    const w = this.world!
    this.s = 0
    this.trainSpeed = 0
    w.root.matrix.identity()
    w.root.matrixWorldNeedsUpdate = true
    w.col.enabled = true
    this.phase = 'opening'
    this.phaseT = 0
    this.train.setDoors(true)
    this.train.setHeadlight(0.15)
    this.sfx('doorOpen', new Vector3(DOOR_X[1], FLOOR_Y + 1, 1.5))
    this.transit.visible = 0
    const first = !gameStore.getState().visited.includes(w.id)
    if (this.showcaseActive) {
      w.onDocked()
      return
    }
    S.visit(w.id)
    if (first || !metaStore.getState().checkpoints[w.id]) {
      this.fillSave()
      Meta.checkpoint(w.id, gameStore.getState())
    }
    w.onDocked()
    this.placeConductor()
    const m = WORLDS[w.id]
    setUI({ chapterCard: { index: m.index, name: m.name, en: m.en } })
    setTimeout(() => setUI({ chapterCard: null }), 5200)
    this.refresh()
    this.save()
  }

  // ---------------- 新游戏 / 继续 / 章节 ----------------
  async newGame() {
    await this.audio.start()
    setAutosave(false)
    const meta = metaStore.getState()
    gameStore.setState(newGameData(), true)
    S.set('game.started')
    metaStore.setState(meta)
    this.player.setGravity(1)
    await this.loadWorld('station')
    setAutosave(true)
    this.mode = 'play'
    setUI({ screen: 'play', menuPanel: null, hasSave: true })
    this.lock()
    const st = this.world as unknown as { intro(): Promise<void> }
    await st.intro()
    this.save()
  }

  async continueGame() {
    await this.audio.start()
    setAutosave(false)
    const s = gameStore.getState()
    const w = s.world
    await this.loadWorld(w)
    this.restorePlayer(s)
    setAutosave(true)
    this.mode = 'play'
    setUI({ screen: 'play', menuPanel: null })
    this.lock()
    this.refresh()
  }

  private restorePlayer(s: GameData) {
    const p = s.player
    if (p && !s.aboard) {
      this.player.setGravity(p.g)
      this.player.teleport(p.x, p.y, p.z, p.yaw, p.pitch)
    } else if (p && s.aboard) {
      this.player.setGravity(1)
      this.player.teleport(Math.max(-9, Math.min(9, p.x)), FLOOR_Y, Math.max(-1, Math.min(1, p.z)), p.yaw, p.pitch)
    } else {
      const sp = this.world!.spawn
      this.player.setGravity(1)
      this.player.teleport(sp.x, sp.y, sp.z, sp.yaw, 0)
    }
    this.player.lastSafe = { x: this.player.body.x, y: this.player.body.y, z: this.player.body.z, g: this.player.g }
  }

  async loadChapter(w: WorldId) {
    const cp = metaStore.getState().checkpoints[w]
    if (!cp) return
    await this.audio.start()
    setAutosave(false)
    gameStore.setState(JSON.parse(JSON.stringify(cp)) as GameData, true)
    gameStore.setState({ aboard: true, player: null })
    await this.loadWorld(w)
    this.player.setGravity(1)
    this.player.teleport(3.8, FLOOR_Y, 0.2, -Math.PI / 2, 0)
    setAutosave(true)
    this.mode = 'play'
    this.paused = false
    setUI({ screen: 'play', menuPanel: null, pauseTab: 'journal' })
    this.lock()
    this.refresh()
    this.save()
  }

  restartChapter() {
    const w = this.world?.id ?? 'station'
    if (w === 'station' || !metaStore.getState().checkpoints[w]) {
      void this.newGame()
      return
    }
    void this.loadChapter(w)
  }

  async toMenu() {
    await saveNow()
    this.mode = 'menu'
    this.paused = false
    this.director.skip(this.camera)
    this.endDialogue()
    this.closeModals()
    setAutosave(false)
    document.exitPointerLock?.()
    const { hasSave, save } = await loadAll()
    if (save) gameStore.setState(save, true)
    setUI({ hasSave })
    if (this.world?.id !== 'station' || this.phase !== 'docked') await this.loadWorld('station', true)
    this.enterMenu()
  }

  private enterMenu() {
    this.mode = 'menu'
    this.paused = false
    this.player.setGravity(1)
    this.train.setDoors(false)
    this.train.door = 0
    this.train.setHeadlight(0.3)
    this.conductor.group.visible = false
    setUI({ screen: 'menu', prompt: null, dialogue: null })
    this.audio.setScore('menu')
  }

  async resetAll() {
    await resetEverything()
    setUI({ hasSave: false, menuPanel: null })
    toast('info', '存档已重置', '所有进度与章节记录都已清除。')
  }

  // ---------------- 结局 ----------------
  ending(id: EndingId) {
    Meta.reachEnding(id)
    gameStore.setState({ ending: id })
    this.save()
    this.mode = 'ending'
    document.exitPointerLock?.()
    this.suppressPause = true
    setUI({ screen: 'ending', ending: id, endingLines: epilogue(id), prompt: null })
  }

  /** 结局后回到终点站台（可以继续尝试其他结局） */
  async afterEnding() {
    gameStore.setState({ ending: null })
    S.set('ticket.final', S.is('ticket.final'))
    setUI({ screen: 'credits' })
  }

  // ---------------- Showcase ----------------
  async showcase(id: MomentId) {
    await this.audio.start()
    this.showcaseActive = true
    this.showcaseRestore = JSON.parse(JSON.stringify(gameStore.getState())) as GameData
    setAutosave(false)
    const mod = await import('./showcase')
    await mod.playMoment(this, id)
    // 还原
    gameStore.setState(this.showcaseRestore, true)
    this.showcaseRestore = null
    this.showcaseActive = false
    setUI({ showcase: null })
    await this.loadWorld('station', true)
    this.enterMenu()
  }

  // ---------------- 输入 / 模态界面 ----------------
  lock() {
    if (ui().touch) return
    try {
      const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined
      if (r && typeof r.catch === 'function') r.catch(() => {})
    } catch { /* 需要用户手势 */ }
  }

  /** 打开 / 关闭需要鼠标的界面：释放指针但不触发暂停 */
  modal(open: boolean) {
    if (open) {
      this.input.clear()
      if (document.pointerLockElement) {
        this.suppressPause = true
        document.exitPointerLock()
      }
    } else {
      this.input.clear()
      if (this.mode === 'play' && !this.paused) this.lock()
    }
  }

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas
    setUI({ pointerLocked: locked })
    if (!locked) {
      if (this.suppressPause) {
        this.suppressPause = false
        return
      }
      if (this.autoPause && this.mode === 'play' && !this.anyModal() && !this.photo.active) this.pause(true)
    }
  }

  /** 测试脚本可以关闭“切到后台自动暂停” */
  autoPause = true

  private onVisibility = () => {
    if (document.hidden) {
      void saveNow()
      if (this.autoPause && this.mode === 'play' && !this.anyModal()) this.pause(true)
    }
  }

  private onUnload = () => {
    this.fillSave()
    void saveNow()
  }

  anyModal() {
    const u = ui()
    return !!(u.dialogue || u.reading || u.keypad || u.sonar || u.radio || u.inspecting)
  }

  pause(on: boolean, tab?: typeof ui extends () => infer U ? U extends { pauseTab: infer T } ? T : never : never) {
    if (this.mode !== 'play') return
    this.paused = on
    if (on) {
      this.input.clear()
      if (document.pointerLockElement) {
        this.suppressPause = true
        document.exitPointerLock()
      }
      setUI({ screen: 'pause', prompt: null, ...(tab ? { pauseTab: tab } : {}) })
      this.sfx('open')
      void saveNow()
    } else {
      setUI({ screen: 'play' })
      this.sfx('close')
      this.lock()
    }
  }

  private onKey(code: string, e: KeyboardEvent) {
    if (this.mode !== 'play') return
    const u = ui()
    if (u.keypad || u.sonar || u.radio) {
      if (code === 'Escape') this.closeModals()
      return
    }
    if (u.dialogue) {
      if (code === 'KeyE' || code === 'Space' || code === 'Enter') this.advanceDialogue()
      const n = Number(e.key)
      if (n >= 1 && n <= 4 && u.dialogue.choices) {
        const c = u.dialogue.choices[n - 1]
        if (c) this.chooseDialogue(c.id)
      }
      return
    }
    if (u.reading) {
      if (code === 'KeyE' || code === 'Escape' || code === 'Space' || code === 'Enter') this.closeModals()
      return
    }
    if (u.inspecting) {
      if (code === 'Escape' || code === 'KeyE') this.closeModals()
      return
    }
    if (this.photo.active) {
      if (code === 'KeyP' || code === 'Escape') this.setPhoto(false)
      if (code === 'Enter') void this.takePhoto()
      return
    }
    if (this.paused) {
      if (code === 'Escape' || code === 'Tab') this.pause(false)
      return
    }
    if (code === 'Tab' || code === 'KeyI') this.pause(true, 'inventory')
    else if (code === 'KeyJ') this.pause(true, 'journal')
    else if (code === 'KeyM') this.pause(true, 'map')
    else if (code === 'Escape' && !document.pointerLockElement) this.pause(true)
    else if (code === 'KeyC') {
      setUI({ cinema: !u.cinema })
      toast('info', !u.cinema ? '电影模式 · 开' : '电影模式 · 关', !u.cinema ? 'HUD 已隐藏，再按 C 恢复' : undefined)
    } else if (code === 'KeyP') this.setPhoto(true)
    else if (code === 'F3') settingsStore.setState({ showFps: !settingsStore.getState().showFps })
    else if (code === 'KeyH') this.showHint()
  }

  showHint() {
    const o = this.world ? activeObjective(this.world.id) : null
    if (!o) return
    const step = o.step
    const t = gameStore.getState().stepTime[step.id] ?? 0
    const n = step.hints.filter((_, i) => t >= [45, 120, 210, 300][i]).length
    if (n === 0) {
      setUI({ hint: '再四处看看。提示会在你停留一段时间后出现。' })
    } else {
      setUI({ hint: step.hints[n - 1] })
      gameStore.setState({ hintsUsed: gameStore.getState().hintsUsed + 1 })
    }
    setTimeout(() => setUI({ hint: null }), 6000)
  }

  advanceDialogue() {
    const r = this.dialogueRun
    if (!r) return
    const v = r.view()
    if (v?.choices) return
    r.advance()
    this.sfx('click', undefined, 0.5)
    if (r.done) this.endDialogue()
    else setUI({ dialogue: r.view() })
  }

  chooseDialogue(id: string) {
    const r = this.dialogueRun
    if (!r) return
    r.choose(id)
    this.sfx('click')
    if (r.done) this.endDialogue()
    else setUI({ dialogue: r.view() })
  }

  private endDialogue() {
    if (!this.dialogueRun && !ui().dialogue) return
    this.dialogueRun = null
    setUI({ dialogue: null })
    this.modal(false)
    this.refresh()
    this.save()
  }

  keypadSubmit(digits: number[]) {
    const ok = this.keypadCheck?.(digits) ?? false
    if (ok) {
      this.keypadCheck = null
      setUI({ keypad: null })
      this.modal(false)
    } else {
      this.sfx('deny')
    }
    return ok
  }

  closeModals() {
    const u = ui()
    if (u.dialogue) return
    const was = !!(u.reading || u.keypad || u.sonar || u.radio || u.inspecting)
    setUI({ reading: null, keypad: null, sonar: false, radio: false, inspecting: null })
    this.keypadCheck = null
    if (was) {
      this.sfx('close')
      this.modal(false)
      this.refresh()
    }
  }

  inspect(item: string | null) {
    setUI({ inspecting: item })
  }

  /** 背包组合 */
  combine(a: string, b: string): string | null {
    const r = findRecipe(a, b)
    if (!r || !r.ok() || !S.has(a) || !S.has(b)) {
      this.sfx('deny')
      return null
    }
    this.sfx('punch')
    const msg = r.apply()
    this.refresh()
    this.save()
    return msg
  }

  // ---------------- 拍照模式 ----------------
  setPhoto(on: boolean) {
    if (on === this.photo.active) return
    this.photo.active = on
    if (on) {
      this.photo.pos.copy(this.camera.position)
      const f = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
      this.photo.yaw = Math.atan2(-f.x, -f.z)
      this.photo.pitch = Math.asin(Math.max(-1, Math.min(1, f.y)))
      this.photo.roll = 0
      this.photo.fov = this.camera.fov
      this.photo.exposure = 0
      setUI({ photo: true, prompt: null })
    } else {
      this.camera.fov = settingsStore.getState().fov
      this.camera.updateProjectionMatrix()
      setUI({ photo: false })
    }
  }

  takePhoto(): Promise<string> {
    return new Promise((res) => {
      this.capture = (url) => {
        const a = document.createElement('a')
        a.href = url
        a.download = `the-last-train-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
        a.click()
        this.sfx('glass', undefined, 0.6)
        res(url)
      }
    })
  }

  // ---------------- 存档 ----------------
  private fillSave() {
    const b = this.player.body
    const aboard = this.phase !== 'docked' || Train.inside(b.x, b.y, b.z) || Train.inCab(b.x, b.y, b.z)
    const world = this.phase === 'transit' || this.phase === 'arriving' || this.phase === 'departing' ? this.travelTo ?? this.world?.id ?? 'station' : this.world?.id ?? 'station'
    if (this.mode !== 'play' || this.showcaseActive) return
    gameStore.setState({
      world, aboard, player: { x: b.x, y: b.y, z: b.z, yaw: this.player.yaw, pitch: this.player.pitch, g: this.player.g },
    })
    if (this.stepId && this.stepAcc > 0) this.flushStepTime()
  }

  private flushStepTime() {
    const st = gameStore.getState().stepTime
    gameStore.setState({ stepTime: { ...st, [this.stepId]: (st[this.stepId] ?? 0) + this.stepAcc } })
    this.stepAcc = 0
  }

  // ---------------- 主循环 ----------------
  frame(dt: number) {
    if (!this.renderer) return
    this.time += dt
    const playing = this.mode === 'play' && !this.paused
    const frozen = this.photo.active
    const wdt = frozen ? 0 : dt
    if (this.mode === 'menu') this.menuCamera(dt)
    if (playing && !frozen) this.updatePlay(dt)
    else if (this.photo.active) this.updatePhoto(dt)
    if (this.mode === 'loading' || this.mode === 'ending') { /* 保持画面 */ }
    if (!this.paused || this.mode !== 'play') {
      if (this.mode === 'play' || this.mode === 'menu') {
        this.world?.update(wdt, this.time)
        if (this.next && this.phase === 'transit') this.next.update(wdt, this.time)
      }
      this.train.update(wdt, this.time)
      this.transit.update(wdt)
      this.conductor.update(wdt, this.mode === 'play' ? this.player.eye : null)
    }
    this.updateFx(dt)
    this.audio.update(dt)
    if (this.audio.ready) {
      const f = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
      const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
      this.audio.setListener(this.camera.position, f, up)
    }
    if (this.world && this.mode !== 'loading') this.world.preRender(this.renderer, this.camera)
    this.pipeline.render(this.scene, this.camera, this.fx, this.time)
    if (this.capture) {
      const url = this.renderer.domElement.toDataURL('image/png')
      const c = this.capture
      this.capture = null
      c(url)
    }
    this.input.endFrame()
    // FPS
    this.fpsAcc += dt
    this.fpsN++
    if (this.fpsAcc > 0.5) {
      setUI({ fps: Math.round(this.fpsN / this.fpsAcc) })
      this.fpsAcc = 0
      this.fpsN = 0
    }
  }

  private menuCamera(_dt: number) {
    // 主菜单：低机位沿站台缓慢推移，列车停在远处
    const t = this.time * 0.03
    const x = -30 + Math.sin(t) * 5
    this.camera.position.set(x, 1.75 + Math.sin(t * 1.7) * 0.12, 5.2 + Math.cos(t * 0.8) * 0.4)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(x + 30, 2.6, 0.9)
    this.camera.fov = 46
    this.camera.updateProjectionMatrix()
    if (Math.random() < 0.0015) this.flash(0.9, 2.5)
  }

  private updatePlay(dt: number) {
    const u = ui()
    const settings = settingsStore.getState()
    const worlds: CollisionWorld[] = [this.train.col]
    if (this.world && this.world.col.enabled) worlds.push(this.world.col)
    // ---- 过场 ----
    if (this.director.active) {
      if (this.director.skippable && (this.input.hit('Escape') || this.input.hit('Enter'))) this.director.skip(this.camera)
      else this.director.update(dt, this.camera)
      if (!this.director.active) {
        this.camera.fov = settings.fov
        this.camera.updateProjectionMatrix()
        this.player.syncFromCamera(this.camera)
      }
      if (!this.director.keepControl) {
        this.updateTravel(dt)
        return
      }
    }
    const modal = this.anyModal()
    this.input.enabled = !modal
    // ---- 操纵模式 ----
    if (this.manip) {
      this.manip.onMove(this.input.lookDX, this.input.lookDY)
      if (this.input.hit('KeyE') || this.input.hit('Escape') || this.input.hit('Mouse2') || this.input.hit('KeyQ')) {
        const m = this.manip
        this.manip = null
        this.player.locked = false
        this.input.manipulating = false
        setUI({ manipulate: null })
        m.onEnd?.()
        this.input.endFrame()
      }
    }
    // ---- 坐下 ----
    if (this.seated && !modal) {
      const leave = this.input.hit('KeyE') || this.input.hit('Space') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => this.input.down(k)) || Math.hypot(this.input.moveX, this.input.moveY) > 0.3
      if (leave && this.phaseT > 0.3) {
        this.stand()
        this.input.endFrame()
      }
    }
    // ---- 玩家 ----
    const allowMove = !modal && !this.manip && !this.seated && !this.respawning
    if (this.seated) {
      this.player.body.vu = 0
      this.player.update(dt, this.input, [], settings, false)
      this.player.teleport(this.seated.x, FLOOR_Y + 0.5, this.seated.z, this.player.yaw, this.player.pitch)
    } else this.player.update(dt, this.input, worlds, settings, allowMove)
    this.player.applyCamera(this.camera)
    // ---- 行驶 ----
    this.updateTravel(dt)
    // ---- 掉落复活 ----
    const b = this.player.body
    if (!this.respawning && (b.y < -45 || b.y > 160)) this.respawn()
    // ---- 触发区 ----
    if (this.world && this.docked) {
      for (const t of this.world.triggers) {
        const inside = b.x >= t.min.x && b.x <= t.max.x && b.y >= t.min.y && b.y <= t.max.y && b.z >= t.min.z && b.z <= t.max.z
        if (inside && !t.inside) {
          t.inside = true
          if (!(t.once && t.fired)) {
            t.fired = true
            t.enter?.()
          }
        } else if (!inside && t.inside) {
          t.inside = false
          t.exit?.()
        }
        if (inside) t.stay?.(dt)
      }
    }
    // ---- 交互 ----
    if (!modal && !this.manip && !this.seated) this.updateInteraction(worlds)
    else if (this.target) {
      this.target = null
      this.setRim(null)
      setUI({ prompt: null })
    }
    // ---- 任务目标 ----
    this.updateObjective(dt)
    gameStore.setState({ playTime: gameStore.getState().playTime + dt })
    void u
  }

  private respawn() {
    this.respawning = true
    this.fadeTarget = 1
    setTimeout(() => {
      const s = this.player.lastSafe
      this.player.setGravity(s.g)
      this.player.teleport(s.x, s.y + 0.05, s.z)
      this.fadeTarget = 0
      this.respawning = false
      this.say('', '……你又站回了原地。', 2.5)
    }, 650)
  }

  private updateInteraction(worlds: CollisionWorld[]) {
    const eye = this.player.eye
    const fwd = this.player.forward
    let best: Interactable | null = null
    let bestT = Infinity
    const consider = (it: Interactable, pos: Vector3) => {
      if (it.enabled && !it.enabled()) return
      if (it.gravity && it.gravity !== this.player.g) return
      const range = it.range ?? 2.6
      tmpV.copy(pos).sub(eye)
      const dist = tmpV.length()
      if (dist > range + it.radius) return
      const tc = tmpV.dot(fwd)
      if (tc < 0) return
      const d2 = tmpV.lengthSq() - tc * tc
      const r = it.radius
      if (d2 > r * r) return
      const t = tc - Math.sqrt(Math.max(0, r * r - d2))
      if (t > range) return
      // 遮挡：视线上有墙就不能交互
      const block = raycast(worlds, eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, Math.max(0, t - 0.05), it.id)
      if (block < t - 0.05) return
      if (t < bestT) {
        bestT = t
        best = it
      }
    }
    if (this.world && this.docked) for (const it of this.world.items) consider(it, it.pos)
    for (const it of this.trainItems) {
      if (it.id === 'conductor') {
        this.conductor.group.getWorldPosition(it.pos)
        it.pos.y += 1.35
      }
      consider(it, it.pos)
    }
    const target = best as Interactable | null
    if (target !== this.target) {
      this.target = target
      this.setRim(target?.highlight ?? null)
      if (target) this.sfx('hover')
    }
    if (target) {
      const blocked = target.blocked?.() ?? null
      const label = typeof target.label === 'function' ? target.label() : target.label
      const verb = typeof target.verb === 'function' ? target.verb() : target.verb
      const p = ui().prompt
      if (!p || p.label !== label || p.verb !== verb || p.note !== (blocked ?? undefined)) {
        setUI({ prompt: { key: target.key ?? 'E', verb, label, note: blocked ?? undefined, disabled: !!blocked } })
      }
      if (this.input.hit('KeyE') || (ui().touch && this.input.hit('Touch'))) {
        if (blocked) {
          this.sfx('deny')
          this.say('', blocked, 2.5)
        } else {
          target.use()
          this.lastObjective = ''
        }
      }
    } else if (ui().prompt) setUI({ prompt: null })
    // 交互高亮
    this.rim.uniforms.uTime.value = this.time
    const k = this.rim.uniforms.uStrength
    k.value += ((this.rimFor ? 0.55 : 0) - k.value) * 0.2
  }

  private setRim(o: Object3D | null) {
    for (const m of this.rimMeshes) m.removeFromParent()
    this.rimMeshes = []
    this.rimFor = o
    if (!o) return
    o.traverse((c) => {
      const m = c as Mesh
      if (m.isMesh && m.geometry && !(m.material as { transparent?: boolean }).transparent && this.rimMeshes.length < 24) {
        const r = new Mesh(m.geometry, this.rim)
        r.renderOrder = 10
        r.raycast = () => {}
        this.rimMeshes.push(r)
      }
    })
    let i = 0
    o.traverse((c) => {
      const m = c as Mesh
      if (m.isMesh && m.geometry && !(m.material as { transparent?: boolean }).transparent && i < this.rimMeshes.length && !this.rimMeshes.includes(m)) {
        m.add(this.rimMeshes[i++])
      }
    })
  }

  private updateObjective(dt: number) {
    if (!this.world) return
    const o = activeObjective(this.world.id)
    const id = o ? o.step.id : 'none'
    if (o) {
      if (this.stepId !== o.step.id) {
        if (this.stepId) this.flushStepTime()
        this.stepId = o.step.id
      }
      this.stepAcc += dt
      if (this.stepAcc > 5) this.flushStepTime()
    }
    if (id !== this.lastObjective) {
      const prev = this.lastObjective
      this.lastObjective = id
      if (o && prev && prev !== id && !prev.startsWith('force')) {
        toast('objective', o.quest.title, o.step.text)
        this.sfx('objective')
      }
      markDirty()
    }
  }

  private updateFx(dt: number) {
    const k = 1 - Math.exp(-dt * 1.5)
    lerpFx(this.fx, this.fx, this.fxTarget, k)
    this.fx.freeze += ((this.fxTarget.freeze ?? 0) - this.fx.freeze) * (1 - Math.exp(-dt * 3))
    this.fx.flash.multiplyScalar(Math.exp(-dt * 5))
    this.fx.glitch *= Math.exp(-dt * 3)
    // 雷声排队
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      f.t -= dt
      if (f.t <= 0) {
        if (f.thunder) this.sfx(f.s > 0.8 ? 'thunderNear' : 'thunder', undefined, Math.min(1, f.s))
        this.flashes.splice(i, 1)
      }
    }
    this.fade += (this.fadeTarget - this.fade) * (1 - Math.exp(-dt * 6))
    this.fx.fade = Math.max(this.fade, this.mode === 'loading' ? 1 : 0)
    const u = ui()
    const lb = (this.director.active && this.director.letterbox) || u.cinema || (this.photo.active && this.photo.letterbox)
    this.fx.letterbox += ((lb ? 1 : 0) - this.fx.letterbox) * (1 - Math.exp(-dt * 3))
    this.fx.eyes = this.eyes
    if (this.photo.active) this.fx.exposure = this.fxTarget.exposure * Math.pow(2, this.photo.exposure)
  }

  setEyes(v: number) {
    this.eyes = v
  }
  setFade(v: number, instant = false) {
    this.fadeTarget = v
    if (instant) this.fade = v
  }

  private updatePhoto(dt: number) {
    const p = this.photo
    p.yaw -= this.input.lookDX * 0.002
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - this.input.lookDY * 0.002))
    const sp = (this.input.down('ShiftLeft') ? 6 : 2) * dt
    const f = new Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch))
    const r = new Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw))
    const d = new Vector3()
    if (this.input.down('KeyW')) d.add(f)
    if (this.input.down('KeyS')) d.sub(f)
    if (this.input.down('KeyD')) d.add(r)
    if (this.input.down('KeyA')) d.sub(r)
    if (this.input.down('KeyE')) d.y += 1
    if (this.input.down('KeyQ')) d.y -= 1
    if (d.lengthSq() > 0) p.pos.addScaledVector(d.normalize(), sp)
    // 拍照相机不能离开玩家太远，也不能穿墙
    const eye = this.player.eye
    const off = p.pos.clone().sub(eye)
    if (off.length() > 8) p.pos.copy(eye).addScaledVector(off.normalize(), 8)
    const worlds: CollisionWorld[] = [this.train.col]
    if (this.world?.col.enabled) worlds.push(this.world.col)
    const dir = p.pos.clone().sub(eye)
    const len = dir.length()
    if (len > 0.01) {
      dir.divideScalar(len)
      const hit = raycast(worlds, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, len + 0.2)
      if (hit < len + 0.2) p.pos.copy(eye).addScaledVector(dir, Math.max(0, hit - 0.2))
    }
    if (this.input.down('BracketLeft')) p.roll -= dt
    if (this.input.down('BracketRight')) p.roll += dt
    this.camera.position.copy(p.pos)
    this.camera.up.set(0, this.player.g, 0)
    this.camera.lookAt(tmpV.copy(p.pos).add(f.multiplyScalar(this.player.g)))
    this.camera.rotateZ(p.roll)
    this.camera.fov = p.fov
    this.camera.updateProjectionMatrix()
  }

  /** 当前世界（UI / 测试） */
  get worldId(): WorldId {
    return this.world?.id ?? 'station'
  }

  questsSnapshot() {
    return QUESTS.filter((q) => q.visible()).map((q) => ({ q, step: currentStep(q) }))
  }

  dispose() {
    this.running = false
    this.input.dispose()
    for (const u of this.unsub) u()
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('beforeunload', this.onUnload)
    this.world?.dispose()
    this.pipeline.dispose()
    this.renderer.dispose()
  }
}

export const game = new Game()
export const _uiStore = uiStore
