import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector3, type Material,
} from 'three'
import type { Component, Status } from '../sim/component'
import type { Simulation } from '../sim/simulation'
import type { Track } from '../sim/components/track'
import type { Hopper } from '../sim/components/basic'
import type { Dominoes } from '../sim/components/dominoes'
import type { Lever, Button } from '../sim/components/switches'
import type { Gear, Motor } from '../sim/components/clockwork'
import type { Conveyor, Lift, Turntable } from '../sim/components/transport'
import type { Launcher, Pendulum, Pulley } from '../sim/components/gravity'
import type { Final } from '../sim/components/misc'
import { MARBLE_R } from '../sim/components/rails'
import type { Materials } from './materials'
import type { QualityPreset } from './quality'
import type { Interp } from './interp'
import { everyAlong, funnelGeometry, gearGeometry, lipCurves, troughMesh, tubeAlong } from './geometry'
import { FinalMachine } from './finalMachine'

export interface VisualCtx {
  sim: Simulation
  interp: Interp
  time: number
  dt: number
  editing: boolean
}

export interface BuildCtx {
  mats: Materials
  q: QualityPreset
  /** scene root for body-driven objects (world space) */
  world: Group
}

export interface Visual {
  comp: Component
  /** static parts, posed at the component origin / yaw */
  root: Group
  /** body-driven parts living in world space */
  movers: Object3D[]
  lamp?: Lamp
  update(v: VisualCtx): void
  dispose(): void
}

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z)
const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()
const _p = new Vector3()

function mesh(geo: BufferGeometry, mat: Material, shadows = true): Mesh {
  const m = new Mesh(geo, mat)
  m.castShadow = shadows
  m.receiveShadow = true
  return m
}
const box = (w: number, h: number, d: number, mat: Material) => mesh(new BoxGeometry(w, h, d), mat)
const cyl = (r: number, h: number, mat: Material, seg = 24, r2 = r) => mesh(new CylinderGeometry(r, r2, h, seg), mat)

/** status lamp: dark → orange glow when the part fires, red pulse when it is blamed for a failure */
export class Lamp {
  readonly mesh: Mesh
  private mat: MeshStandardMaterial
  private level = 0
  constructor(mats: Materials, radius = 0.06) {
    this.mat = mats.lampOff.clone()
    this.mesh = mesh(new SphereGeometry(radius, 14, 10), this.mat, false)
    const bezel = mesh(new CylinderGeometry(radius * 1.5, radius * 1.7, radius * 0.9, 16), mats.brassDark)
    bezel.position.y = -radius * 0.55
    this.mesh.add(bezel)
  }
  update(status: Status, time: number, dt: number) {
    const on = status === 'ACTIVATED' || status === 'RUNNING' || status === 'COMPLETED'
    const target = on ? 1 : 0
    this.level += (target - this.level) * Math.min(1, dt * 6)
    if (status === 'FAILED') {
      this.mat.emissive.setRGB(1, 0.08, 0.04)
      this.mat.emissiveIntensity = 2 + Math.sin(time * 9) * 1.8
    } else {
      this.mat.emissive.setRGB(1, 0.35, 0.08)
      this.mat.emissiveIntensity = 0.05 + this.level * 7
    }
  }
  dispose() {
    this.mat.dispose()
  }
}

function base(c: Component): Group {
  const g = new Group()
  g.position.set(c.origin.x, c.origin.y, c.origin.z)
  g.rotation.y = c.yaw
  g.name = c.id
  g.userData.compId = c.id
  return g
}

function finish(c: Component, root: Group, movers: Object3D[], update: (v: VisualCtx) => void, lamp?: Lamp, extraDispose?: () => void): Visual {
  for (const m of movers) m.userData.compId = c.id
  return {
    comp: c, root, movers, lamp,
    update: (v) => {
      update(v)
      lamp?.update(c.status, v.time, v.dt)
    },
    dispose: () => {
      const geos = new Set<BufferGeometry>()
      for (const o of [root, ...movers]) o.traverse((x) => { if (x instanceof Mesh && !x.userData.shared) geos.add(x.geometry) })
      for (const g of geos) g.dispose()
      lamp?.dispose()
      extraDispose?.()
    },
  }
}

/** body-driven object (world space) */
function bodyBound(obj: Object3D, body: { handle: number } & Parameters<Interp['apply']>[1], list: Object3D[], updates: ((v: VisualCtx) => void)[]) {
  list.push(obj)
  updates.push((v) => v.interp.apply(obj, body))
}

// ---------------------------------------------------------------------------------------------

function trackVisual(c: Track, b: BuildCtx): Visual {
  const root = base(c)
  const trough = mesh(troughMesh(c.trough), b.mats.brass)
  root.add(trough)
  for (const lip of lipCurves(c.trough)) root.add(mesh(tubeAlong(lip, 0.022, b.q.detail), b.mats.steel))
  // cradle brackets every ~0.9 m, with a support post down / hanger up when requested
  const sup = c.num('support')
  for (const f of everyAlong(c.path, 0.9)) {
    const p = V(f.p.x, f.p.y, f.p.z)
    const ring = mesh(new TorusGeometry(0.235, 0.018, 6, 18, Math.PI * 1.1), b.mats.steelDark)
    const t = V(f.t.x, f.t.y, f.t.z)
    const u = V(f.u.x, f.u.y, f.u.z)
    const l = V(f.l.x, f.l.y, f.l.z)
    // torus lies in its x–y plane: align its normal with the path tangent, opening upwards
    const m = new Matrix4().makeBasis(l, u.clone().negate(), t)
    ring.quaternion.setFromRotationMatrix(m)
    ring.rotateZ(-Math.PI * 0.05)
    ring.position.copy(p).addScaledVector(u, 0.07)
    root.add(ring)
    if (sup > 0) {
      const post = cyl(0.025, sup, b.mats.steelDark, 8)
      post.position.set(p.x, p.y - 0.3 - sup / 2, p.z)
      root.add(post)
    }
  }
  return finish(c, root, [], () => {})
}

function hopperVisual(c: Hopper, b: BuildCtx): Visual {
  const root = base(c)
  root.add(mesh(troughMesh(c.trough), b.mats.copper))
  for (const lip of lipCurves(c.trough)) root.add(mesh(tubeAlong(lip, 0.022, b.q.detail), b.mats.steel))
  const L = c.chuteLength()
  const sl = (c.num('slope') * Math.PI) / 180
  // magazine side plates
  for (const z of [-0.27, 0.27]) {
    const plate = box(L + 0.2, 0.36, 0.03, b.mats.enamel)
    plate.position.set(-L / 2, Math.tan(sl) * L / 2 + 0.05, z)
    plate.rotation.z = -sl
    root.add(plate)
  }
  const stop = box(0.08, 0.44, 0.48, b.mats.iron)
  stop.position.set(-L - 0.05, Math.tan(sl) * L, 0)
  root.add(stop)
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  const gate = new Group()
  const bar = box(0.07, 0.4, 0.52, b.mats.steel)
  gate.add(bar)
  const tip = box(0.075, 0.08, 0.53, b.mats.lampOn)
  tip.position.y = -0.16
  gate.add(tip)
  bodyBound(gate, c.gate, movers, ups)
  // cam disc (the mechanical trip) when the hopper is chain-driven
  const cam = new Group()
  const disc = cyl(0.24, 0.06, b.mats.brass, 28)
  disc.rotation.x = Math.PI / 2
  cam.add(disc)
  const lobe = box(0.18, 0.12, 0.06, b.mats.brass)
  lobe.position.x = 0.24
  cam.add(lobe)
  cam.position.set(-L * 0.5, 0.5, -0.36)
  root.add(cam)
  const lamp = new Lamp(b.mats)
  lamp.mesh.position.set(-L - 0.05, Math.tan(sl) * L + 0.3, 0)
  root.add(lamp.mesh)
  return finish(c, root, movers, (v) => {
    for (const u of ups) u(v)
    cam.rotation.z = c.rotor.angle
  }, lamp)
}

function marbleMesh(b: BuildCtx, brass = false) {
  const m = mesh(new SphereGeometry(MARBLE_R, Math.round(36 * b.q.detail), Math.round(24 * b.q.detail)), brass ? b.mats.gold : b.mats.chrome)
  return m
}

/** marbles owned by any component */
function marbleSet(c: Component & { marbleBodies?: import('../sim/physics').RigidBody[] }, b: BuildCtx, movers: Object3D[], ups: ((v: VisualCtx) => void)[]) {
  const brass = c.str('material') === 'brass'
  for (const body of c.marbleBodies ?? []) {
    const m = marbleMesh(b, brass)
    m.userData.marble = true
    bodyBound(m, body, movers, ups)
  }
}

function platformVisual(c: Component, b: BuildCtx): Visual {
  const root = base(c)
  const w = c.num('width')
  const d = c.num('depth')
  const t = c.num('thickness')
  const mat = c.str('material') === 'steel' ? b.mats.steelDark : c.str('material') === 'copper' ? b.mats.copper : b.mats.walnut
  const deck = box(w, t, d, mat)
  deck.position.y = -t / 2
  root.add(deck)
  // brass edge trim + steel under-frame
  for (const z of [-d / 2, d / 2]) {
    const trim = box(w + 0.04, 0.05, 0.05, b.mats.brass)
    trim.position.set(0, -0.02, z)
    root.add(trim)
  }
  for (const x of [-w / 2, w / 2]) {
    const trim = box(0.05, 0.05, d + 0.04, b.mats.brass)
    trim.position.set(x, -0.02, 0)
    root.add(trim)
  }
  const r = c.num('rim')
  if (r > 0) {
    for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) {
      const rim = box(w, r, 0.04, b.mats.walnutDark)
      rim.position.set(0, r / 2, z)
      root.add(rim)
    }
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) {
      const rim = box(0.04, r, d, b.mats.walnutDark)
      rim.position.set(x, r / 2, 0)
      root.add(rim)
    }
  }
  const beams = Math.max(2, Math.round(w / 2))
  for (let i = 0; i <= beams; i++) {
    const beam = box(0.12, 0.22, d - 0.1, b.mats.steelDark)
    beam.position.set(-w / 2 + 0.1 + ((w - 0.2) * i) / beams, -t - 0.11, 0)
    root.add(beam)
  }
  return finish(c, root, [], () => {})
}

function wallVisual(c: Component, b: BuildCtx): Visual {
  const root = base(c)
  const h = c.num('height')
  const tilt = (c.num('tilt') * Math.PI) / 180
  const g = new Group()
  g.rotation.z = -tilt
  const mat = c.str('material') === 'felt' ? b.mats.felt : c.str('material') === 'wood' ? b.mats.walnut : c.str('material') === 'acrylic' ? b.mats.glass : b.mats.steelDark
  const panel = box(c.num('thickness'), h, c.num('width'), mat)
  panel.position.y = h / 2
  g.add(panel)
  for (const y of [0.01, h - 0.01]) {
    const rail = box(c.num('thickness') + 0.03, 0.04, c.num('width') + 0.04, b.mats.brassDark)
    rail.position.y = y
    g.add(rail)
  }
  root.add(g)
  return finish(c, root, [], () => {})
}

function funnelVisual(c: Component, b: BuildCtx): Visual {
  const root = base(c)
  const f = mesh(funnelGeometry(c.num('top'), c.num('bottom'), c.num('height'), c.num('neck'), b.q.detail), b.mats.copper)
  ;(f.material as Material).side = 2
  root.add(f)
  const rim = mesh(new TorusGeometry(c.num('top') + 0.05, 0.03, 8, 48), b.mats.brass)
  rim.rotation.x = Math.PI / 2
  rim.position.y = c.num('height') + 0.18
  root.add(rim)
  return finish(c, root, [], () => {})
}

function dominoVisual(c: Dominoes, b: BuildCtx): Visual {
  const root = new Group()
  const n = c.pieces.length
  const bodyMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), b.mats.walnut, n)
  const face = new InstancedMesh(new BoxGeometry(1, 1, 1), b.mats.brass, n * 2)
  bodyMesh.castShadow = face.castShadow = true
  bodyMesh.receiveShadow = face.receiveShadow = true
  bodyMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  face.instanceMatrix.setUsage(DynamicDrawUsage)
  bodyMesh.frustumCulled = face.frustumCulled = false
  const obj = new Object3D()
  const plate = new Matrix4()
  const update = (v: VisualCtx) => {
    for (let i = 0; i < n; i++) {
      const p = c.pieces[i]
      v.interp.apply(obj, p.body)
      _s.set(p.hx * 2, p.hy * 2, p.hz * 2)
      _m.compose(obj.position, obj.quaternion, _s)
      bodyMesh.setMatrixAt(i, _m)
      // brass bands across both faces
      for (const side of [-1, 1]) {
        plate.compose(_p.set(side * p.hx, p.hy * 0.62, 0), _q.identity(), _s.set(0.006, p.hy * 0.12, p.hz * 2.02))
        face.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), _m.clone().multiply(plate.multiply(new Matrix4().makeScale(1 / (p.hx * 2), 1 / (p.hy * 2), 1 / (p.hz * 2)))))
      }
    }
    bodyMesh.instanceMatrix.needsUpdate = true
    face.instanceMatrix.needsUpdate = true
  }
  const lamp = new Lamp(b.mats)
  const first = c.layout()[0]
  const lp = c.w(first.x - 0.3, 0.05, first.z + 0.35)
  lamp.mesh.position.set(lp.x, lp.y, lp.z)
  root.add(lamp.mesh)
  return finish(c, root, [bodyMesh, face], update, lamp)
}

function leverVisual(c: Lever, b: BuildCtx): Visual {
  const root = base(c)
  const L = c.num('length')
  const h = c.num('pivot')
  const r = c.num('ratio')
  // A-frame pivot stand
  for (const z of [-0.26, 0.26]) {
    const post = box(0.1, h, 0.08, b.mats.iron)
    post.position.set(0, h / 2, z)
    root.add(post)
  }
  const axle = cyl(0.04, 0.62, b.mats.steel, 16)
  axle.rotation.x = Math.PI / 2
  axle.position.y = h
  root.add(axle)
  const beam = new Group()
  const plank = box(L, 0.08, 0.32, b.mats.walnut)
  plank.position.x = L * (0.5 - r)
  beam.add(plank)
  for (const x of [-L * r, L * (1 - r)]) {
    const cap = box(0.05, 0.1, 0.34, b.mats.brass)
    cap.position.x = x
    beam.add(cap)
  }
  const striker = box(0.36, 0.1, 0.56, b.mats.steel)
  striker.position.set(-L * r + 0.18, 0.06, 0)
  beam.add(striker)
  if (c.num('weight') > 0) {
    const hammer = box(0.2, 0.18, 0.28, b.mats.iron)
    hammer.position.set(L * (1 - r) - 0.1, 0.1, 0)
    beam.add(hammer)
    const face = box(0.21, 0.03, 0.29, b.mats.brass)
    face.position.set(L * (1 - r) - 0.1, 0.2, 0)
    beam.add(face)
  }
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  bodyBound(beam, c.beam, movers, ups)
  const lamp = new Lamp(b.mats)
  lamp.mesh.position.set(0, h + 0.12, 0.3)
  root.add(lamp.mesh)
  return finish(c, root, movers, (v) => { for (const u of ups) u(v) }, lamp)
}

function buttonVisual(c: Button, b: BuildCtx): Visual {
  const root = base(c)
  const s = c.num('size') / 2
  const dir = c.str('facing') === 'down' ? 1 : -1
  const housing = box(s * 2 + 0.14, 0.12, s * 2 + 0.14, b.mats.enamel)
  housing.position.y = dir * 0.06
  root.add(housing)
  const bracket = box(0.06, 0.9, 0.06, b.mats.steelDark)
  bracket.position.set(-s - 0.1, dir * 0.5, 0)
  root.add(bracket)
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  const capMat = b.mats.lampOff.clone()
  const cap = mesh(new CylinderGeometry(s, s, 0.1, 28), capMat)
  bodyBound(cap, c.cap, movers, ups)
  return finish(c, root, movers, (v) => {
    for (const u of ups) u(v)
    const on = c.status !== 'ARMED' && c.status !== 'IDLE'
    capMat.emissiveIntensity = on ? 5 : 0.15
  }, undefined, () => capMat.dispose())
}

function motorVisual(c: Motor, b: BuildCtx): Visual {
  const root = base(c)
  const housing = cyl(0.34, 0.7, b.mats.enamel, 32)
  housing.rotation.x = Math.PI / 2
  housing.position.z = -0.45
  root.add(housing)
  const fins = Math.round(9 * b.q.detail)
  for (let i = 0; i < fins; i++) {
    const fin = mesh(new TorusGeometry(0.345, 0.018, 6, 32), b.mats.steelDark)
    fin.position.z = -0.75 + (i / (fins - 1)) * 0.6
    root.add(fin)
  }
  const cap = cyl(0.3, 0.08, b.mats.brass, 32)
  cap.rotation.x = Math.PI / 2
  cap.position.z = -0.08
  root.add(cap)
  const teeth = Math.round(c.num('teeth'))
  const pinion = mesh(gearGeometry(teeth, c.num('module'), 0.12, 'solid', b.q.detail), b.mats.steel)
  pinion.userData.shared = true
  root.add(pinion)
  const lamp = new Lamp(b.mats, 0.07)
  lamp.mesh.position.set(0, 0.42, -0.45)
  root.add(lamp.mesh)
  return finish(c, root, [], () => { pinion.rotation.z = c.rotor.angle + c.rotor.phase }, lamp)
}

function gearVisual(c: Gear, b: BuildCtx): Visual {
  const root = base(c)
  const teeth = Math.round(c.num('teeth'))
  const spin = new Group()
  const g = mesh(gearGeometry(teeth, c.num('module'), c.num('thickness'), c.str('style'), b.q.detail), teeth % 2 ? b.mats.brass : b.mats.brassDark)
  g.userData.shared = true
  spin.add(g)
  const pt = Math.round(c.num('pinion'))
  if (pt > 0) {
    const p = mesh(gearGeometry(pt, c.num('module'), c.num('thickness') * 0.9, 'solid', b.q.detail), b.mats.steel)
    p.userData.shared = true
    p.position.z = c.num('pinionOffset')
    spin.add(p)
  }
  const hub = cyl(Math.max(0.07, c.radius * 0.12), Math.abs(c.num('pinionOffset')) + c.num('thickness') + 0.12, b.mats.steel, 20)
  hub.rotation.x = Math.PI / 2
  hub.position.z = pt > 0 ? c.num('pinionOffset') / 2 : 0
  spin.add(hub)
  // bolt circle
  const bolts = 6
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2
    const bolt = cyl(0.025, c.num('thickness') + 0.04, b.mats.steelDark, 6)
    bolt.rotation.x = Math.PI / 2
    bolt.position.set(Math.cos(a) * c.radius * 0.2, Math.sin(a) * c.radius * 0.2, 0)
    spin.add(bolt)
  }
  root.add(spin)
  // axle back to the gear wall
  const axle = cyl(0.045, 0.6, b.mats.steelDark, 12)
  axle.rotation.x = Math.PI / 2
  axle.position.z = -0.3
  root.add(axle)
  return finish(c, root, [], () => { spin.rotation.z = c.rotor.angle + c.rotor.phase })
}

function conveyorVisual(c: Conveyor, b: BuildCtx): Visual {
  const root = new Group()
  const n = c.slats.length
  const pitch = c.num('pitch')
  const W = c.num('width')
  const slats = new InstancedMesh(new BoxGeometry(pitch * 0.92, 0.04, W), b.mats.rubber, n)
  const cleats = new InstancedMesh(new BoxGeometry(0.036, 0.12, W - 0.04), b.mats.steel, n)
  slats.instanceMatrix.setUsage(DynamicDrawUsage)
  cleats.instanceMatrix.setUsage(DynamicDrawUsage)
  slats.castShadow = cleats.castShadow = true
  slats.receiveShadow = true
  slats.frustumCulled = cleats.frustumCulled = false
  const obj = new Object3D()
  const off = new Matrix4().makeTranslation(0, -0.02, 0)
  const coff = new Matrix4().makeTranslation(-pitch * 0.3, 0.06, 0)
  const zero = new Matrix4().makeScale(0, 0, 0)
  // static frame in the belt frame
  const frame = new Group()
  frame.position.set(c.origin.x, c.origin.y, c.origin.z)
  frame.quaternion.set(c.frame.x, c.frame.y, c.frame.z, c.frame.w)
  const L = c.L
  const R = c.R
  const drums: Mesh[] = []
  for (const x of [0, L]) {
    const d = cyl(R - 0.03, W + 0.06, b.mats.steel, 24)
    d.rotation.x = Math.PI / 2
    d.position.set(x, -R, 0)
    frame.add(d)
    drums.push(d)
  }
  for (const z of [-W / 2 - 0.05, W / 2 + 0.05]) {
    const side = box(L + R * 2 + 0.1, R * 2 + 0.12, 0.03, b.mats.enamel)
    side.position.set(L / 2, -R, z)
    frame.add(side)
    const guard = box(L + R * 2, 0.04, 0.04, b.mats.brass)
    guard.position.set(L / 2, 0.27, z + Math.sign(z) * 0.0)
    frame.add(guard)
  }
  root.add(frame)
  const update = (v: VisualCtx) => {
    for (let i = 0; i < n; i++) {
      v.interp.apply(obj, c.slats[i].body)
      obj.updateMatrix()
      slats.setMatrixAt(i, _m.multiplyMatrices(obj.matrix, off))
      cleats.setMatrixAt(i, c.slats[i].cleat ? _m.multiplyMatrices(obj.matrix, coff) : zero)
    }
    slats.instanceMatrix.needsUpdate = true
    cleats.instanceMatrix.needsUpdate = true
    for (const d of drums) d.rotation.y = c.travel / R
  }
  const lamp = new Lamp(b.mats)
  const lp = c.beltToWorld(-0.3, 0.1, W / 2 + 0.12)
  lamp.mesh.position.set(lp.x, lp.y, lp.z)
  root.add(lamp.mesh)
  return finish(c, root, [slats, cleats], update, lamp)
}

function turntableVisual(c: Turntable, b: BuildCtx): Visual {
  const root = base(c)
  const R = c.R
  const spin = new Group()
  const disc = cyl(R, 0.1, b.mats.brass, 64)
  disc.position.y = -0.05
  spin.add(disc)
  const inlay = mesh(new TorusGeometry(R * 0.7, 0.012, 6, 64), b.mats.steelDark)
  inlay.rotation.x = Math.PI / 2
  spin.add(inlay)
  const hub = cyl(0.22, 0.32, b.mats.steel, 32)
  hub.position.y = 0.16
  spin.add(hub)
  const n = Math.round(c.num('paddles'))
  const sweep = (c.num('sweep') * Math.PI) / 180 * c.sense
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    for (const [r0, r1, da] of [[0.22, R * 0.58, 0], [R * 0.56, R - 0.07, -sweep]] as const) {
      const mid = (r0 + r1) / 2
      const vane = box(r1 - r0 + 0.04, 0.24, 0.06, b.mats.steel)
      if (da) vane.position.set(Math.cos(a) * (r0 + 0.01) + Math.cos(a + da) * (mid - r0), 0.12, -Math.sin(a) * (r0 + 0.01) - Math.sin(a + da) * (mid - r0))
      else vane.position.set(Math.cos(a) * mid, 0.12, -Math.sin(a) * mid)
      vane.rotation.y = da ? a + da : a
      spin.add(vane)
    }
  }
  root.add(spin)
  // fence segments (fixed), with the gap left open
  const fh = c.num('fence')
  const gapAt = (c.num('gapAt') * Math.PI) / 180
  const gapW = (c.num('gapWidth') * Math.PI) / 180
  const segs = 40
  const rf = R + 0.04
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const da = Math.atan2(Math.sin(a - gapAt), Math.cos(a - gapAt))
    if (Math.abs(da) < gapW / 2) continue
    const segLen = (2 * Math.PI * rf) / segs
    const s = box(0.05, fh, segLen + 0.02, b.mats.copper)
    s.position.set(Math.cos(a) * rf, fh / 2 - 0.08, -Math.sin(a) * rf)
    s.rotation.y = a
    root.add(s)
  }
  const shaft = cyl(0.08, 1.2, b.mats.steelDark, 12)
  shaft.position.y = -0.7
  root.add(shaft)
  const box2 = box(0.4, 0.3, 0.4, b.mats.enamel)
  box2.position.y = -1.35
  root.add(box2)
  const lamp = new Lamp(b.mats)
  lamp.mesh.position.set(0, -1.15, 0.25)
  root.add(lamp.mesh)
  return finish(c, root, [], () => { spin.rotation.y = c.rotor.angle * c.sense }, lamp)
}

function pulleyVisual(c: Pulley, b: BuildCtx): Visual {
  const root = base(c)
  const cup = c.num('cup')
  const span = c.num('span')
  const wheelY = c.num('wheel')
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  const bucket = new Group()
  const floor = box(cup, 0.06, cup, b.mats.copper)
  floor.position.y = -0.03
  bucket.add(floor)
  for (const [w, d, x, z] of [[0.05, cup, cup / 2, 0], [0.05, cup, -cup / 2, 0], [cup, 0.05, 0, cup / 2], [cup, 0.05, 0, -cup / 2]] as const) {
    const wall = box(w, 0.36, d, b.mats.copper)
    wall.position.set(x, 0.18, z)
    bucket.add(wall)
  }
  const bail = mesh(new TorusGeometry(cup / 2, 0.015, 6, 24, Math.PI), b.mats.steel)
  bail.position.y = 0.36
  bucket.add(bail)
  bodyBound(bucket, c.bucket, movers, ups)
  const cw = new Group()
  const weight = cyl(0.2, 0.56, b.mats.iron, 24)
  cw.add(weight)
  const band = cyl(0.205, 0.06, b.mats.brass, 24)
  cw.add(band)
  bodyBound(cw, c.counter, movers, ups)
  // pulley wheels and the rope over them
  const wheel = new Group()
  const wr = 0.28
  const wm = mesh(new TorusGeometry(wr, 0.05, 10, 32), b.mats.brass)
  wheel.add(wm)
  const spokes = cyl(0.04, 0.12, b.mats.steel, 12)
  spokes.rotation.x = Math.PI / 2
  wheel.add(spokes)
  for (const x of [0, span]) {
    const w = wheel.clone()
    w.position.set(x, wheelY, 0)
    root.add(w)
  }
  const beam = box(span + 0.6, 0.12, 0.12, b.mats.steelDark)
  beam.position.set(span / 2, wheelY + 0.34, 0)
  root.add(beam)
  const ropeMat = b.mats.steelDark
  const ropes = [cyl(0.012, 1, ropeMat, 6), cyl(0.012, 1, ropeMat, 6), cyl(0.012, span, ropeMat, 6)]
  ropes[2].rotation.z = Math.PI / 2
  ropes[2].position.set(span / 2, wheelY + wr, 0)
  for (const r of ropes) root.add(r)
  const lamp = new Lamp(b.mats)
  lamp.mesh.position.set(span / 2, wheelY + 0.46, 0)
  root.add(lamp.mesh)
  return finish(c, root, movers, (v) => {
    for (const u of ups) u(v)
    // rope lengths follow the bodies (local frame of the pulley)
    const bucketTop = bucket.position.y - c.origin.y + 0.36
    const cwTop = cw.position.y - c.origin.y + 0.28
    const l1 = Math.max(0.05, wheelY - bucketTop)
    ropes[0].scale.y = l1
    ropes[0].position.set(0 - wr * 0, bucketTop + l1 / 2, 0)
    const l2 = Math.max(0.05, wheelY - cwTop)
    ropes[1].scale.y = l2
    ropes[1].position.set(span, cwTop + l2 / 2, 0)
    for (const w of root.children) if (w.type === 'Group') w.rotation.z = -c.lowered / wr
  }, lamp)
}

function pendulumVisual(c: Pendulum, b: BuildCtx): Visual {
  const root = base(c)
  const L = c.num('length')
  const r = c.num('bob')
  const bearing = cyl(0.12, 0.5, b.mats.brass, 24)
  bearing.rotation.x = Math.PI / 2
  root.add(bearing)
  const hangers = box(0.9, 0.14, 0.14, b.mats.steelDark)
  hangers.position.y = 0.16
  root.add(hangers)
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  const arm = new Group()
  const rod = box(0.07, L, 0.07, b.mats.steel)
  rod.position.y = -L / 2
  arm.add(rod)
  const bob = cyl(r, r * 1.1, b.mats.brass, 48)
  bob.rotation.x = Math.PI / 2
  bob.position.y = -L
  arm.add(bob)
  for (const z of [-r * 0.56, r * 0.56]) {
    const face = cyl(r * 0.78, 0.02, b.mats.chrome, 40)
    face.rotation.x = Math.PI / 2
    face.position.set(0, -L, z)
    arm.add(face)
  }
  bodyBound(arm, c.rod, movers, ups)
  const pin = new Group()
  pin.add(box(0.16, 0.16, r * 1.4, b.mats.felt))
  const pinTip = box(0.17, 0.05, r * 1.42, b.mats.lampOn)
  pinTip.position.y = 0.06
  pin.add(pinTip)
  bodyBound(pin, c.pin, movers, ups)
  const lamp = new Lamp(b.mats, 0.08)
  lamp.mesh.position.set(0, 0.32, 0.2)
  root.add(lamp.mesh)
  return finish(c, root, movers, (v) => { for (const u of ups) u(v) }, lamp)
}

function launcherVisual(c: Launcher, b: BuildCtx): Visual {
  const root = base(c)
  const barrel = new Group()
  barrel.rotation.z = c.elev
  root.add(barrel)
  const comp = c.num('compression')
  const len = c.num('barrel')
  const x0 = -comp - 0.3
  for (const [lat, vert] of [[0.105, -0.142], [-0.105, -0.142], [0.198, 0.02], [-0.198, 0.02]] as const) {
    const rail = cyl(0.028, len - x0, b.mats.steel, 10)
    rail.rotation.z = Math.PI / 2
    rail.position.set((x0 + len) / 2, vert, lat)
    barrel.add(rail)
  }
  for (let i = 0; i < 5; i++) {
    const ring = mesh(new TorusGeometry(0.235, 0.02, 6, 20), b.mats.brass)
    ring.rotation.y = Math.PI / 2
    ring.position.x = x0 + ((len - x0) * i) / 4
    barrel.add(ring)
  }
  const breech = box(0.12, 0.34, 0.34, b.mats.iron)
  breech.position.x = x0 - 0.12
  barrel.add(breech)
  // the spring: a helix stretched between breech and plunger each frame
  const turns = 9
  const pts: Vector3[] = []
  for (let i = 0; i <= turns * 16; i++) {
    const a = (i / 16) * Math.PI * 2
    pts.push(V(i / (turns * 16), Math.cos(a) * 0.08, Math.sin(a) * 0.08))
  }
  const spring = mesh(tubeAlong(pts, 0.014, b.q.detail), b.mats.steel)
  barrel.add(spring)
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  const plunger = new Group()
  const head = box(0.24, 0.2, 0.2, b.mats.steel)
  head.quaternion.setFromAxisAngle(V(0, 0, 1), c.elev)
  plunger.add(head)
  bodyBound(plunger, c.plunger, movers, ups)
  marbleSet(c, b, movers, ups)
  if (c.paddle) {
    const paddle = new Group()
    const plate = box(0.08, 0.64, 0.5, b.mats.brass)
    plate.position.y = -0.32
    paddle.add(plate)
    bodyBound(paddle, c.paddle, movers, ups)
    const hinge = cyl(0.04, 0.6, b.mats.steelDark, 10)
    hinge.rotation.x = Math.PI / 2
    hinge.position.set(c.num('paddleX'), c.num('paddleY'), 0)
    root.add(hinge)
    const strut = box(0.05, 0.05, 0.05, b.mats.steelDark)
    strut.position.set(c.num('paddleX'), c.num('paddleY') + 0.6, 0)
    strut.scale.y = 24
    root.add(strut)
  }
  const lamp = new Lamp(b.mats, 0.07)
  lamp.mesh.position.set(-0.2, -0.12, 0.3)
  root.add(lamp.mesh)
  const inv = new Quaternion()
  return finish(c, root, movers, (v) => {
    for (const u of ups) u(v)
    // spring from breech to plunger in barrel coordinates
    inv.copy(root.quaternion).multiply(barrel.quaternion).invert()
    const local = plunger.position.clone().sub(root.position).applyQuaternion(inv)
    const start = x0 - 0.06
    const end = local.x - 0.12
    spring.position.x = start
    spring.scale.x = Math.max(0.02, end - start)
  }, lamp)
}

function liftVisual(c: Lift, b: BuildCtx): Visual {
  const root = base(c)
  const s = c.num('size') / 2
  const H = c.H
  // guide rails & shaft frame
  for (const z of [-s - 0.12, s + 0.12]) {
    const rail = box(0.1, H + 1.6, 0.1, b.mats.steelDark)
    rail.position.set(-s - 0.1, H / 2 + 0.4, z)
    root.add(rail)
    const rail2 = box(0.06, H + 1.6, 0.06, b.mats.brassDark)
    rail2.position.set(s + 0.25, H / 2 + 0.4, z)
    root.add(rail2)
  }
  const ties = Math.round(H / 1.5)
  for (let i = 0; i <= ties; i++) {
    const tie = box(0.06, 0.06, s * 2 + 0.36, b.mats.steelDark)
    tie.position.set(-s - 0.1, (H * i) / ties, 0)
    root.add(tie)
  }
  const headFrame = box(s * 2 + 0.6, 0.18, s * 2 + 0.5, b.mats.enamel)
  headFrame.position.set(0, H + 1.3, 0)
  root.add(headFrame)
  const winch = cyl(0.22, s * 2, b.mats.brass, 24)
  winch.rotation.x = Math.PI / 2
  winch.position.set(0, H + 1.05, 0)
  root.add(winch)
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  const car = new Group()
  const tilt = (c.num('tilt') * Math.PI) / 180
  const floor = box(s * 2, 0.06, s * 2, b.mats.iron)
  floor.rotation.z = -tilt
  floor.position.y = -0.04
  car.add(floor)
  const back = box(0.05, 0.48, s * 2, b.mats.felt)
  back.position.set(-s, 0.22, 0)
  car.add(back)
  for (const z of [-s, s]) {
    const side = box(s * 2, 0.44, 0.04, b.mats.brass)
    side.position.set(0, 0.2, z)
    car.add(side)
  }
  const hanger = box(0.06, 0.6, 0.06, b.mats.steel)
  hanger.position.set(0, 0.7, 0)
  car.add(hanger)
  bodyBound(car, c.car, movers, ups)
  const gate = new Group()
  gate.add(box(0.06, 0.4, s * 2, b.mats.felt))
  bodyBound(gate, c.gate, movers, ups)
  const cable = cyl(0.015, 1, b.mats.steelDark, 6)
  root.add(cable)
  const lamp = new Lamp(b.mats, 0.08)
  lamp.mesh.position.set(-s - 0.1, 0.4, s + 0.22)
  root.add(lamp.mesh)
  const lamp2 = new Lamp(b.mats, 0.08)
  lamp2.mesh.position.set(-s - 0.1, H + 0.6, s + 0.22)
  root.add(lamp2.mesh)
  return finish(c, root, movers, (v) => {
    for (const u of ups) u(v)
    const top = H + 1.05
    const carTop = car.position.y - c.origin.y + 1.0
    const l = Math.max(0.05, top - carTop)
    cable.scale.y = l
    cable.position.set(0, carTop + l / 2, 0)
    winch.rotation.y = c.y * 3
    lamp2.update(c.state >= 2 ? 'COMPLETED' : 'ARMED', v.time, v.dt)
  }, lamp, () => lamp2.dispose())
}

function finalVisual(c: Final, b: BuildCtx): Visual {
  const root = base(c)
  const r = c.num('cup')
  const cup = cyl(r + 0.06, 0.08, b.mats.gold, 40)
  cup.position.y = -0.04
  root.add(cup)
  const wall = mesh(new CylinderGeometry(r + 0.05, r + 0.05, c.num('wall'), 40, 1, true, Math.PI / 2 + ((c.num('opening') / 2) * Math.PI) / 180, Math.PI * 2 - (c.num('opening') * Math.PI) / 180), b.mats.felt)
  ;(wall.material as Material).side = 2
  wall.position.y = c.num('wall') / 2
  root.add(wall)
  const machine = new FinalMachine(b.mats, b.q, c.num('scale'))
  root.add(machine.group)
  return finish(c, root, [], (v) => machine.update(c.showTime, v.time, v.dt), undefined, () => machine.dispose())
}

function genericMarbleVisual(c: Component, b: BuildCtx): Visual {
  const root = base(c)
  const movers: Object3D[] = []
  const ups: ((v: VisualCtx) => void)[] = []
  marbleSet(c as Component & { marbleBodies?: import('../sim/physics').RigidBody[] }, b, movers, ups)
  return finish(c, root, movers, (v) => { for (const u of ups) u(v) })
}

export function buildVisual(c: Component, b: BuildCtx): Visual {
  let v: Visual
  switch (c.type) {
    case 'track': v = trackVisual(c as Track, b); break
    case 'hopper': {
      v = hopperVisual(c as Hopper, b)
      const ups: ((v: VisualCtx) => void)[] = []
      marbleSet(c as Hopper, b, v.movers, ups)
      const inner = v.update
      v.update = (x) => { inner(x); for (const u of ups) u(x) }
      break
    }
    case 'marble': v = genericMarbleVisual(c, b); break
    case 'platform': v = platformVisual(c, b); break
    case 'wall': v = wallVisual(c, b); break
    case 'funnel': v = funnelVisual(c, b); break
    case 'dominoes': v = dominoVisual(c as Dominoes, b); break
    case 'lever': v = leverVisual(c as Lever, b); break
    case 'button': v = buttonVisual(c as Button, b); break
    case 'motor': v = motorVisual(c as Motor, b); break
    case 'gear': v = gearVisual(c as Gear, b); break
    case 'conveyor': v = conveyorVisual(c as Conveyor, b); break
    case 'turntable': v = turntableVisual(c as Turntable, b); break
    case 'pulley': v = pulleyVisual(c as Pulley, b); break
    case 'pendulum': v = pendulumVisual(c as Pendulum, b); break
    case 'launcher': v = launcherVisual(c as Launcher, b); break
    case 'lift': v = liftVisual(c as Lift, b); break
    case 'final': v = finalVisual(c as Final, b); break
    default: v = finish(c, base(c), [], () => {})
  }
  return v
}

export { Color }
