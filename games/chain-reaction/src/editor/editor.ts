import {
  ACESFilmicToneMapping, Box3, Box3Helper, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera,
  Plane, PlaneGeometry, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, GridHelper,
} from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Engine } from '../app/engine'
import { useUI } from '../app/store'
import { REGISTRY } from '../sim/components'
import { createComponent } from '../sim/components'
import { Simulation } from '../sim/simulation'
import type { ComponentSpec, ComponentType, ConnectionSpec, Params, SceneSpec } from '../sim/schema'
import { emptyScene } from '../sim/schema'
import { parseScene, SceneError, serializeScene } from '../sim/serialize'
import { validateScene } from '../sim/validate'
import { grandContraption } from '../sim/grandContraption'
import { yawOf } from '../sim/builder'
import { buildVisual } from '../render/visuals'
import { createMaterials, studioEnvironment } from '../render/materials'
import { QUALITY } from '../render/quality'

export interface PaletteItem {
  key: string
  type: ComponentType
  name: string
  desc: string
  params: Params
  /** origin offset above the work plane */
  lift?: number
}

export const PALETTE: PaletteItem[] = [
  { key: 'straight', type: 'track', name: 'Straight track', desc: 'Half-pipe run, snaps end to end', params: { kind: 'straight', length: 3, drop: 0.24 } },
  { key: 'ramp', type: 'track', name: 'Drop ramp', desc: 'S-curve drop that builds speed', params: { kind: 'straight', length: 2.5, drop: 0.9, profile: 's-curve' } },
  { key: 'curve', type: 'track', name: 'Curved track', desc: 'Banked 90° bend', params: { kind: 'curve', radius: 1.2, angle: 90, drop: 0.12 } },
  { key: 'spiral', type: 'track', name: 'Spiral', desc: 'Banked helix descent', params: { kind: 'spiral', radius: 1.2, turns: 1.5, drop: 1.4 } },
  { key: 'jump', type: 'track', name: 'Jump ramp', desc: 'Launch lip — place a catcher ahead', params: { kind: 'jump', length: 2.4, drop: 0.5, lip: 18 } },
  { key: 'funnel', type: 'funnel', name: 'Funnel', desc: 'Catches wild arrivals', params: {} },
  { key: 'hopper', type: 'hopper', name: 'Gravity drop', desc: 'Latch releases N marbles', params: { count: 1, openOnStart: true } },
  { key: 'marble', type: 'marble', name: 'Marble', desc: 'A loose steel marble', params: {}, lift: 0.15 },
  { key: 'dominoes', type: 'dominoes', name: 'Domino array', desc: 'Real colliding dominoes', params: { count: 12, shape: 'line' } },
  { key: 'lever', type: 'lever', name: 'Lever', desc: 'Beam on a real pivot', params: {} },
  { key: 'button', type: 'button', name: 'Push switch', desc: 'Sprung cap sends a signal', params: {}, lift: 1 },
  { key: 'motor', type: 'motor', name: 'Motor', desc: 'Drives meshing gears', params: {}, lift: 1 },
  { key: 'gear', type: 'gear', name: 'Gear', desc: 'Meshes by geometry', params: { teeth: 36 }, lift: 1.4 },
  { key: 'pendulum', type: 'pendulum', name: 'Pendulum', desc: 'Latched heavy bob', params: { length: 2.4 }, lift: 3 },
  { key: 'launcher', type: 'launcher', name: 'Spring launcher', desc: 'Stored spring energy', params: { trigger: 'auto', preload: true } },
  { key: 'pulley', type: 'pulley', name: 'Pulley', desc: 'Bucket vs counterweight', params: {}, lift: 1.6 },
  { key: 'conveyor', type: 'conveyor', name: 'Conveyor', desc: 'Moving slat belt', params: { selfRpm: 60, length: 4 }, lift: 0.4 },
  { key: 'turntable', type: 'turntable', name: 'Rotating platform', desc: 'Sweeps balls to its gap', params: { selfRpm: 30 }, lift: 0.4 },
  { key: 'lift', type: 'lift', name: 'Mechanical lift', desc: 'Load-sensing winch car', params: { height: 4 } },
  { key: 'final', type: 'final', name: 'Final trigger', desc: 'The end of the chain', params: { scale: 0.6 } },
  { key: 'platform', type: 'platform', name: 'Platform', desc: 'Walnut deck', params: {} },
  { key: 'wall', type: 'wall', name: 'Backstop', desc: 'Felt wall / deflector', params: { material: 'felt' } },
]

const SNAP_GRID = 0.1
const PORT_SNAP = 0.8

/** build-mode controller; the React panels talk to it, it talks to the engine */
export class Editor {
  engine!: Engine
  spec: SceneSpec = grandContraption()
  private undo: string[] = []
  private redo: string[] = []
  private gizmo!: TransformControls
  private proxy = new Object3D()
  private ray = new Raycaster()
  private plane = new Plane(new Vector3(0, 1, 0), 0)
  private ghost: Group | null = null
  private ghostSpec: ComponentSpec | null = null
  private ghostSim: Simulation | null = null
  private grid: GridHelper
  private selBox: Box3Helper
  private dragStart = new Vector3()
  private dragging = false
  workHeight = 4
  thumbs: Record<string, string> = {}
  private moved: Object3D[] = []
  private linkFrom: string | null = null

  constructor() {
    this.grid = new GridHelper(40, 80, 0x8a6a30, 0x2a3436)
    const gm = this.grid.material as unknown as { transparent: boolean; opacity: number }
    gm.transparent = true
    gm.opacity = 0.35
    this.selBox = new Box3Helper(new Box3(), new Color('#7fe0ff'))
  }

  attach(engine: Engine) {
    this.engine = engine
    this.spec = engine.scene
    const cam = engine.world.camera
    this.gizmo = new TransformControls(cam, engine.world.renderer.domElement)
    this.gizmo.setSize(0.9)
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const d = (e as unknown as { value: boolean }).value
      engine.rig.inputEnabled = !d
      if (d) this.beginDrag()
      else this.endDrag()
    })
    this.gizmo.addEventListener('objectChange', () => this.onDrag())
    const helper = this.gizmo.getHelper()
    helper.visible = false
    engine.world.scene.add(helper, this.proxy)
    engine.world.scene.add(this.grid, this.selBox)
    this.grid.visible = false
    this.selBox.visible = false
    const el = engine.world.renderer.domElement
    el.addEventListener('pointermove', this.pointerMove)
    el.addEventListener('pointerdown', this.pointerDown)
    window.addEventListener('keydown', this.key)
    engine.onSceneChanged = () => this.refreshSelection()
  }

  get active() { return useUI.getState().mode === 'build' }

  // ---- mode -------------------------------------------------------------------------------
  enter() {
    const e = this.engine
    this.spec = JSON.parse(JSON.stringify(e.scene))
    useUI.getState().set({ mode: 'build', screen: 'experience', cinematic: false, camera: 'free', selected: null, placing: null })
    e.exitCinematic()
    e.load(this.spec)
    e.rig.syncOrbit()
    this.grid.visible = true
    this.grid.position.y = this.workHeight
    this.gizmo.getHelper().visible = false
    this.validate()
    this.syncHistory()
    if (!Object.keys(this.thumbs).length) setTimeout(() => this.renderThumbs(), 30)
  }

  /** START SIMULATION from the editor: run the machine exactly as built */
  test() {
    this.cancelPlace()
    this.select(null)
    this.grid.visible = false
    useUI.getState().set({ mode: 'demo', camera: 'director' })
    this.engine.load(this.spec)
    void this.engine.start()
  }

  exit() {
    this.cancelPlace()
    this.select(null)
    this.grid.visible = false
    useUI.getState().set({ mode: 'demo', camera: 'director' })
    this.engine.load(this.spec)
  }

  // ---- history ----------------------------------------------------------------------------
  private snapshot() { return JSON.stringify(this.spec) }
  private syncHistory() { useUI.getState().set({ canUndo: this.undo.length > 0, canRedo: this.redo.length > 0, sceneName: this.spec.name }) }

  /** apply a change: record undo, rebuild the world, revalidate */
  commit(mut: (s: SceneSpec) => void, keepSelection = true) {
    this.undo.push(this.snapshot())
    if (this.undo.length > 120) this.undo.shift()
    this.redo = []
    mut(this.spec)
    this.rebuild(keepSelection)
  }
  undoAction() {
    const s = this.undo.pop()
    if (!s) return
    this.redo.push(this.snapshot())
    this.spec = JSON.parse(s)
    this.rebuild(true)
  }
  redoAction() {
    const s = this.redo.pop()
    if (!s) return
    this.undo.push(this.snapshot())
    this.spec = JSON.parse(s)
    this.rebuild(true)
  }
  private rebuild(keepSelection: boolean) {
    const sel = useUI.getState().selected
    this.engine.load(this.spec)
    if (!keepSelection || !sel || !this.spec.components.some((c) => c.id === sel)) this.select(null)
    else this.select(sel)
    this.validate()
    this.syncHistory()
  }
  validate() {
    useUI.getState().set({ issues: validateScene(this.spec) })
  }

  // ---- selection & gizmo --------------------------------------------------------------------
  select(id: string | null) {
    useUI.getState().set({ selected: id })
    this.refreshSelection()
  }
  private refreshSelection() {
    const id = useUI.getState().selected
    const c = id ? this.engine.sim.byId.get(id) : undefined
    if (!c || !this.active) {
      this.gizmo.detach()
      this.gizmo.getHelper().visible = false
      this.selBox.visible = false
      return
    }
    this.proxy.position.set(c.origin.x, c.origin.y, c.origin.z)
    this.proxy.rotation.set(0, c.yaw, 0)
    this.gizmo.attach(this.proxy)
    this.gizmo.getHelper().visible = true
    const b = c.bounds()
    this.selBox.box.set(new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z))
    this.selBox.visible = true
  }
  setGizmoMode(m: 'translate' | 'rotate') {
    this.gizmo.setMode(m)
    this.gizmo.showX = m === 'translate'
    this.gizmo.showZ = m === 'translate'
    this.gizmo.showY = true
  }

  private beginDrag() {
    this.dragging = true
    this.dragStart.copy(this.proxy.position)
    const id = useUI.getState().selected
    const v = this.engine.world.visuals.find((x) => x.comp.id === id)
    this.moved = v ? [v.root, ...v.movers] : []
    for (const o of this.moved) o.userData.p0 = o.position.clone()
    for (const o of this.moved) o.userData.r0 = o.rotation.y
  }
  private onDrag() {
    if (!this.dragging) return
    const id = useUI.getState().selected
    const spec = this.spec.components.find((c) => c.id === id)
    if (!spec) return
    if (useUI.getState().snap) {
      const p = this.snapPos(spec, this.proxy.position, this.proxy.rotation.y)
      this.proxy.position.copy(p.pos)
      if (this.gizmo.mode === 'translate') this.proxy.rotation.y = p.yaw
      else this.proxy.rotation.y = Math.round(this.proxy.rotation.y / (Math.PI / 24)) * (Math.PI / 24)
    }
    // live preview: move the existing visuals rigidly (a rebuild happens on release)
    const d = this.proxy.position.clone().sub(this.dragStart)
    for (const o of this.moved) {
      o.position.copy(o.userData.p0 as Vector3).add(d)
      if (o === this.moved[0]) o.rotation.y = this.proxy.rotation.y
    }
  }
  private endDrag() {
    this.dragging = false
    const id = useUI.getState().selected
    if (!id) return
    const p = this.proxy.position
    const yaw = this.proxy.rotation.y
    this.commit((s) => {
      const c = s.components.find((x) => x.id === id)
      if (c) { c.pos = [p.x, p.y, p.z]; c.rot = yaw }
    })
  }

  /** grid snap, plus port snap: a track's "in" port locks onto a nearby free "out" port */
  snapPos(spec: ComponentSpec, pos: Vector3, yaw: number): { pos: Vector3; yaw: number; snapped: boolean } {
    const out = new Vector3(Math.round(pos.x / SNAP_GRID) * SNAP_GRID, Math.round(pos.y / (SNAP_GRID / 2)) * (SNAP_GRID / 2), Math.round(pos.z / SNAP_GRID) * SNAP_GRID)
    if (spec.type === 'track' || spec.type === 'conveyor') {
      // where would this piece's in-port be at this pose?
      const probe = createComponent({ ...spec, pos: [pos.x, pos.y, pos.z], rot: yaw })
      const myIn = probe?.ports().find((q) => q.kind === 'in')
      if (myIn) {
        let best: { pos: Vector3; yaw: number } | null = null
        let bd = PORT_SNAP
        for (const c of this.engine.sim.components) {
          if (c.id === spec.id) continue
          for (const p of c.ports()) {
            if (p.kind !== 'out' || p.dir.y < -0.9) continue
            const d = Math.hypot(p.pos.x - myIn.pos.x, p.pos.y - myIn.pos.y, p.pos.z - myIn.pos.z)
            if (d < bd) {
              bd = d
              // offset between this component's origin and its in-port is zero for tracks
              const off = new Vector3(myIn.pos.x - pos.x, myIn.pos.y - pos.y, myIn.pos.z - pos.z)
              best = { pos: new Vector3(p.pos.x, p.pos.y, p.pos.z).sub(off), yaw: yawOf(p.dir) }
            }
          }
        }
        if (best) return { ...best, snapped: true }
      }
    }
    return { pos: out, yaw, snapped: false }
  }

  // ---- placing ------------------------------------------------------------------------------
  startPlace(key: string) {
    this.cancelPlace()
    const item = PALETTE.find((p) => p.key === key)
    if (!item) return
    this.select(null)
    useUI.getState().set({ placing: key })
    const id = this.uniqueId(item.type)
    this.ghostSpec = { id, type: item.type, pos: [0, this.workHeight + (item.lift ?? 0), 0], rot: 0, params: { ...item.params }, label: item.name }
    this.ghostSim = new Simulation({ ...emptyScene('ghost'), components: [this.ghostSpec] })
    const c = this.ghostSim.components[0]
    const v = buildVisual(c, { mats: this.engine.world.mats, q: QUALITY.LOW, world: new Group() })
    // ghost (at the cursor, turned by yaw) → inner group shifts the spec origin to the ghost origin
    this.ghost = new Group()
    const inner = new Group()
    inner.position.set(-this.ghostSpec.pos[0], -this.ghostSpec.pos[1], -this.ghostSpec.pos[2])
    inner.add(v.root, ...v.movers)
    this.ghost.add(inner)
    v.update({ sim: this.ghostSim, interp: { apply: (o: Object3D, b: { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } }) => { const t = b.translation(); const r = b.rotation(); o.position.set(t.x, t.y, t.z); o.quaternion.set(r.x, r.y, r.z, r.w) }, position: (b: { translation(): { x: number; y: number; z: number } }, out: Vector3) => { const t = b.translation(); return out.set(t.x, t.y, t.z) } } as never, time: 0, dt: 0, editing: true })
    this.ghost.userData.target = new Vector3(...this.ghostSpec.pos)
    this.ghost.userData.yaw = 0
    this.ghost.position.copy(this.ghost.userData.target as Vector3)
    this.engine.world.scene.add(this.ghost)
  }
  cancelPlace() {
    if (this.ghost) {
      this.engine.world.scene.remove(this.ghost)
      this.ghost.traverse((o) => { if (o instanceof Mesh && !o.userData.shared) o.geometry.dispose() })
      this.ghost = null
    }
    this.ghostSim?.free()
    this.ghostSim = null
    this.ghostSpec = null
    useUI.getState().set({ placing: null })
  }
  private placeAt(): { pos: Vector3; yaw: number } | null {
    if (!this.ghostSpec) return null
    return { pos: this.ghost!.userData.target as Vector3, yaw: (this.ghost!.userData.yaw as number) ?? 0 }
  }

  private uniqueId(type: string) {
    let i = 1
    while (this.spec.components.some((c) => c.id === `${type}-${i}`)) i++
    return `${type}-${i}`
  }

  private rayFrom(e: PointerEvent) {
    const r = this.engine.world.renderer.domElement.getBoundingClientRect()
    const v = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(v, this.engine.world.camera)
  }

  private pointerMove = (e: PointerEvent) => {
    if (!this.active || !this.ghost || !this.ghostSpec) return
    this.rayFrom(e)
    const item = PALETTE.find((p) => p.key === useUI.getState().placing)
    this.plane.constant = -this.workHeight
    const hit = new Vector3()
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return
    hit.y += item?.lift ?? 0
    const yaw = (this.ghost.userData.yaw as number) ?? 0
    const s = useUI.getState().snap ? this.snapPos(this.ghostSpec, hit, yaw) : { pos: hit, yaw, snapped: false }
    this.ghost.userData.target = s.pos
    this.ghost.userData.yaw = s.yaw
    this.ghost.position.copy(s.pos)
    this.ghost.rotation.y = s.yaw
  }

  private pointerDown = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return
    if (this.ghost && this.ghostSpec) {
      const p = this.placeAt()
      if (!p) return
      const spec: ComponentSpec = { ...this.ghostSpec, pos: [p.pos.x, p.pos.y, p.pos.z], rot: p.yaw }
      this.cancelPlace()
      this.commit((s) => { s.components.push(spec) })
      this.select(spec.id)
      return
    }
    if ((this.gizmo as unknown as { axis: string | null }).axis) return
    this.rayFrom(e)
    const hits = this.ray.intersectObjects(this.engine.world.visuals.flatMap((v) => [v.root, ...v.movers]), true)
    for (const h of hits) {
      let o: Object3D | null = h.object
      while (o && !o.userData.compId) o = o.parent
      if (o) {
        const id = o.userData.compId as string
        if (this.linkFrom) {
          this.finishLink(id)
          return
        }
        this.select(id)
        return
      }
    }
  }

  private key = (e: KeyboardEvent) => {
    if (!this.active) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const sel = useUI.getState().selected
    if (e.key === 'Escape') { this.cancelPlace(); this.select(null); this.linkFrom = null }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redoAction(); else this.undoAction() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redoAction() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); this.duplicate(sel) }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) this.remove(sel)
    if (e.key === 'q' || e.key === 'e') {
      const d = (e.key === 'q' ? 1 : -1) * (Math.PI / 12)
      if (this.ghost) { this.ghost.userData.yaw = ((this.ghost.userData.yaw as number) ?? 0) + d; this.ghost.rotation.y = this.ghost.userData.yaw as number; return }
      if (sel) this.commit((s) => { const c = s.components.find((x) => x.id === sel); if (c) c.rot += d })
    }
    if (e.key === 'g' || e.key === 'G') this.setGizmoMode('translate')
    if (e.key === 'r' || e.key === 'R') this.setGizmoMode('rotate')
    if (e.key === 'PageUp' || e.key === ']') this.setWorkHeight(this.workHeight + 0.5)
    if (e.key === 'PageDown' || e.key === '[') this.setWorkHeight(this.workHeight - 0.5)
  }

  setWorkHeight(h: number) {
    this.workHeight = Math.max(0, Math.min(40, h))
    this.grid.position.y = this.workHeight
    useUI.getState().set({ toast: `Work plane ${this.workHeight.toFixed(1)} m` })
  }

  // ---- edits --------------------------------------------------------------------------------
  remove(id: string) {
    this.commit((s) => {
      s.components = s.components.filter((c) => c.id !== id)
      s.connections = s.connections.filter((k) => k.from !== id && k.to !== id)
      if (s.finalId === id) s.finalId = undefined
    }, false)
  }
  duplicate(id: string) {
    const c = this.spec.components.find((x) => x.id === id)
    if (!c) return
    const copy: ComponentSpec = JSON.parse(JSON.stringify(c))
    copy.id = this.uniqueId(c.type)
    copy.pos = [c.pos[0] + 0.6, c.pos[1], c.pos[2] + 0.6]
    this.commit((s) => { s.components.push(copy) })
    this.select(copy.id)
  }
  setParam(id: string, key: string, value: number | boolean | string) {
    this.commit((s) => {
      const c = s.components.find((x) => x.id === id)
      if (c) c.params = { ...c.params, [key]: value }
    })
  }
  setTransform(id: string, pos: [number, number, number], rot: number) {
    this.commit((s) => {
      const c = s.components.find((x) => x.id === id)
      if (c) { c.pos = pos; c.rot = rot }
    })
  }
  setLabel(id: string, label: string) {
    this.commit((s) => { const c = s.components.find((x) => x.id === id); if (c) c.label = label })
  }
  addConnection(k: Omit<ConnectionSpec, 'id'>) {
    this.commit((s) => {
      let i = 1
      while (s.connections.some((x) => x.id === `k${i}`)) i++
      s.connections.push({ ...k, id: `k${i}` })
    })
  }
  removeConnection(id: string) {
    this.commit((s) => { s.connections = s.connections.filter((k) => k.id !== id) })
  }
  /** click-to-link: next viewport click picks the target */
  beginLink(from: string) {
    this.linkFrom = from
    useUI.getState().set({ toast: 'Click the component to connect to (Esc cancels)' })
  }
  private finishLink(to: string) {
    const from = this.linkFrom!
    this.linkFrom = null
    if (from === to) return
    const a = this.engine.sim.byId.get(from)
    const b = this.engine.sim.byId.get(to)
    if (!a || !b) return
    if (a.rotors().length && b.rotors().length && !a.signalOutputs.length) {
      this.addConnection({ kind: 'mechanical', from, output: 'shaft', to, input: 'drive', ratio: 1 })
    } else if (a.signalOutputs.length && b.signalInputs.length) {
      this.addConnection({ kind: 'signal', from, output: a.signalOutputs[0], to, input: b.signalInputs[0] })
    } else {
      useUI.getState().set({ toast: `${a.spec.label ?? a.id} cannot drive ${b.spec.label ?? b.id}` })
      return
    }
    useUI.getState().set({ toast: `Connected ${a.spec.label ?? a.id} → ${b.spec.label ?? b.id}` })
  }
  setFinal(id: string) {
    this.commit((s) => { s.finalId = id })
  }

  // ---- files --------------------------------------------------------------------------------
  newScene() {
    this.commit((s) => {
      const fresh = emptyScene('My Machine')
      fresh.components.push(
        { id: 'deck-1', type: 'platform', pos: [0, 2, 0], rot: 0, params: { width: 8, depth: 3 }, label: 'Deck' },
        { id: 'hopper-1', type: 'hopper', pos: [-3, 3.2, 0], rot: 0, params: { count: 1, openOnStart: true }, label: 'Start Gate' },
      )
      replaceScene(s, fresh)
    }, false)
  }
  loadDemo() {
    this.commit((s) => replaceScene(s, grandContraption()), false)
  }
  saveLocal(name: string) {
    const all = this.listLocal()
    this.spec.name = name || this.spec.name
    all[this.spec.name] = serializeScene(this.spec)
    try {
      localStorage.setItem('cr.machines', JSON.stringify(all))
      useUI.getState().set({ toast: `Saved "${this.spec.name}"`, sceneName: this.spec.name })
    } catch {
      useUI.getState().set({ toast: 'Could not save (storage unavailable)' })
    }
  }
  listLocal(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem('cr.machines') ?? '{}') } catch { return {} }
  }
  loadLocal(name: string) {
    const json = this.listLocal()[name]
    if (json) this.importJson(json)
  }
  deleteLocal(name: string) {
    const all = this.listLocal()
    delete all[name]
    try { localStorage.setItem('cr.machines', JSON.stringify(all)) } catch { /* ignore */ }
  }
  exportJson() {
    const blob = new Blob([serializeScene(this.spec)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${this.spec.name.replace(/[^\w-]+/g, '_') || 'machine'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  importJson(json: string) {
    try {
      const scene = parseScene(json)
      this.commit((s) => replaceScene(s, scene), false)
      useUI.getState().set({ toast: `Loaded "${scene.name}" · ${scene.components.length} components` })
    } catch (err) {
      useUI.getState().set({ toast: err instanceof SceneError ? `Import rejected: ${err.message}` : 'Import failed' })
    }
  }

  // ---- thumbnails ---------------------------------------------------------------------------
  /** real 3D thumbnails of every palette part, rendered once in a small offscreen context */
  renderThumbs() {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 150
    let r: WebGLRenderer
    try {
      r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false })
    } catch {
      return
    }
    r.toneMapping = ACESFilmicToneMapping
    r.outputColorSpace = SRGBColorSpace
    const mats = createMaterials()
    const env = studioEnvironment(r, 64)
    const out: Record<string, string> = {}
    for (const item of PALETTE) {
      const scene = new Scene()
      scene.background = new Color('#0e1618')
      scene.environment = env
      scene.add(new HemisphereLight('#6a8488', '#101010', 1.2))
      const d = new DirectionalLight('#ffe3c0', 2.6)
      d.position.set(-3, 6, 5)
      scene.add(d)
      const spec: ComponentSpec = { id: 'thumb', type: item.type, pos: [0, 0, 0], rot: 0, params: { ...item.params } }
      let sim: Simulation | null = null
      try {
        sim = new Simulation({ ...emptyScene('thumb'), components: [spec] })
        const c = sim.components[0]
        const v = buildVisual(c, { mats, q: QUALITY.LOW, world: new Group() })
        scene.add(v.root, ...v.movers)
        v.update({ sim, interp: { apply: (o: Object3D, b: { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } }) => { const t = b.translation(); const q = b.rotation(); o.position.set(t.x, t.y, t.z); o.quaternion.set(q.x, q.y, q.z, q.w) }, position: (b: { translation(): { x: number; y: number; z: number } }, o: Vector3) => { const t = b.translation(); return o.set(t.x, t.y, t.z) } } as never, time: 0, dt: 0, editing: true })
        const b = c.bounds()
        const center = new Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
        const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 0.5)
        const cam = new PerspectiveCamera(32, 4 / 3, 0.05, 200)
        cam.position.copy(center).add(new Vector3(size * 0.9, size * 0.6, size * 1.5))
        cam.lookAt(center)
        const floor = new Mesh(new PlaneGeometry(60, 60), new MeshBasicMaterial({ color: '#0b1113' }))
        floor.rotation.x = -Math.PI / 2
        floor.position.y = b.min.y - 0.02
        scene.add(floor)
        r.render(scene, cam)
        out[item.key] = canvas.toDataURL('image/jpeg', 0.85)
        v.dispose()
      } catch {
        /* a failed thumbnail just shows the placeholder */
      } finally {
        sim?.free()
      }
    }
    env.dispose()
    r.dispose()
    this.thumbs = out
    useUI.getState().set({ toast: null })
  }
}

/** swap the whole scene in place (Object.assign alone would keep stale keys such as finalId) */
function replaceScene(s: SceneSpec, next: SceneSpec) {
  for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k]
  Object.assign(s, JSON.parse(JSON.stringify(next)))
}

export const editor = new Editor()
export { REGISTRY }
