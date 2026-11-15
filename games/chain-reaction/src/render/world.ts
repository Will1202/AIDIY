import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DirectionalLight, DynamicDrawUsage, FogExp2, Group,
  HemisphereLight, Mesh, PerspectiveCamera, PointLight, SpotLight, Points, Scene, ShaderMaterial, SphereGeometry, TubeGeometry, Vector3, WebGLRenderer,
  type Texture,
} from 'three'
import type { Simulation } from '../sim/simulation'
import type { ImpactEvent } from '../sim/physics'
import { createMaterials, studioEnvironment, type Materials } from './materials'
import { Pipeline, type FxState } from './pipeline'
import { QUALITY, type QualityLevel, type QualityPreset } from './quality'
import { Interp } from './interp'
import { buildVisual, type Visual, type VisualCtx } from './visuals'
import { buildTower } from './tower'

const WIRE_VERT = /* glsl */ `
varying float vU;
void main() { vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const WIRE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uPulse; uniform float uLit; uniform float uDash; uniform float uTime; uniform float uMech;
varying float vU;
void main() {
  float pulse = uPulse >= 0.0 ? exp(-pow((vU - uPulse) * 14.0, 2.0)) * 6.0 : 0.0;
  float dash = uMech > 0.5 ? step(0.5, fract(vU * uDash - uTime * 1.5)) * 0.8 : 0.0;
  vec3 c = uColor * (0.05 + uLit * 0.9 + pulse + dash * uLit);
  gl_FragColor = vec4(c, 1.0);
}
`

interface Wire {
  mesh: Mesh
  mat: ShaderMaterial
  from: string
  to: string
  output: string
  pulse: number
  lit: number
  mech: boolean
}

/** Owns the three.js scene, renderer pipeline and every visual of the loaded machine. */
export class World {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(40, 1, 0.1, 400)
  readonly renderer: WebGLRenderer
  readonly pipeline: Pipeline
  readonly mats: Materials
  readonly fxRoot = new Group()
  q: QualityPreset
  level: QualityLevel
  sim!: Simulation
  interp!: Interp
  visuals: Visual[] = []
  private machineRoot = new Group()
  private tower: { group: Group; dispose(): void } | null = null
  private env: Texture
  private key: DirectionalLight
  private wires: Wire[] = []
  private sparks: Points
  private sparkData: Float32Array
  private sparkVel: Float32Array
  private sparkLife: Float32Array
  private sparkHead = 0
  private dust: Points | null = null
  private time = 0

  constructor(canvas: HTMLCanvasElement, level: QualityLevel) {
    this.level = level
    this.q = QUALITY[level]
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: import.meta.env.DEV })
    this.pipeline = new Pipeline(this.renderer, this.q)
    this.mats = createMaterials()
    this.env = studioEnvironment(this.renderer, this.q.envSize)
    this.scene.environment = this.env
    this.scene.environmentIntensity = 1.15
    this.scene.background = new Color('#0c1214')
    this.scene.fog = new FogExp2('#0f181a', 0.0068)
    // backdrop: teal-grey gradient dome so the tower reads against depth, not a flat colour
    const dome = new Mesh(new SphereGeometry(180, 32, 16), new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 lo = vec3(0.03,0.042,0.046); vec3 mid = vec3(0.075,0.105,0.11); vec3 hi = vec3(0.02,0.03,0.035);
        vec3 c = h < 0.15 ? mix(lo, mid, smoothstep(-0.2, 0.15, h)) : mix(mid, hi, smoothstep(0.15, 0.8, h)); gl_FragColor = vec4(c, 1.0); }`,
    }))
    this.scene.add(dome)
    const hemi = new HemisphereLight('#4a646a', '#141210', 1.6)
    this.scene.add(hemi)
    // key light low enough that the big domino deck does not shadow the whole clockwork below it
    this.key = new DirectionalLight('#ffe2bf', 3.4)
    this.key.position.set(-14, 27, 36)
    this.key.castShadow = true
    this.key.shadow.radius = 3
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.03
    const sc = this.key.shadow.camera
    sc.left = -17; sc.right = 17; sc.top = 20; sc.bottom = -16; sc.near = 1; sc.far = 90
    this.key.target.position.set(0, 13, 0)
    this.scene.add(this.key, this.key.target)
    const rim = new DirectionalLight('#9cd2ff', 1.5)
    rim.position.set(18, 16, -22)
    this.scene.add(rim)
    const warm = new DirectionalLight('#ff9c5a', 0.9)
    warm.position.set(20, 4, 14)
    this.scene.add(warm)
    const fill = new DirectionalLight('#cfe2e6', 1.1)
    fill.position.set(6, 9, 30)
    this.scene.add(fill)
    // architectural uplights at the plinth, washing the tower from below
    for (const x of [-4.5, 4.5]) {
      const up = new SpotLight('#ffbf80', 260, 40, 0.42, 0.7, 1.5)
      up.position.set(x, 0.6, 9)
      up.target.position.set(x * 0.4, 13, 0)
      this.scene.add(up, up.target)
    }
    // practical work lamps hanging in the zones: warm pools of light inside the tower
    for (const [x, y, z, i] of [[-3.5, 20.6, 2.6, 26], [2.5, 16.4, 2.8, 30], [0.5, 12.6, 2.8, 28], [-2.5, 9.6, 3.0, 40], [-4.5, 6.6, 2.8, 34], [-6.2, 21.6, 2.4, 14], [2.8, 6.8, 3.2, 22], [-8.6, 7.5, 2.6, 26], [-8.8, 16, 2.8, 20], [-1.0, 6.0, -1.0, 18]] as const) {
      const lamp = new PointLight('#ffb070', i, 11, 1.6)
      lamp.position.set(x, y, z)
      this.scene.add(lamp)
    }
    this.applyShadowQuality()
    this.scene.add(this.machineRoot, this.fxRoot)
    // impact sparks
    const n = 600
    this.sparkData = new Float32Array(n * 3)
    this.sparkVel = new Float32Array(n * 3)
    this.sparkLife = new Float32Array(n)
    const sg = new BufferGeometry()
    sg.setAttribute('position', new BufferAttribute(this.sparkData, 3).setUsage(DynamicDrawUsage))
    sg.setAttribute('life', new BufferAttribute(this.sparkLife, 1).setUsage(DynamicDrawUsage))
    this.sparks = new Points(sg, new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      vertexShader: 'attribute float life; varying float vL; void main(){ vL = life; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = life > 0.0 ? (2.0 + life*5.0) * (18.0 / -mv.z) : 0.0; }',
      fragmentShader: 'varying float vL; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d)*vL; gl_FragColor = vec4(vec3(1.0,0.62,0.25)*a*4.0, a); }',
    }))
    this.sparks.frustumCulled = false
    this.fxRoot.add(this.sparks)
    this.buildDust()
  }

  private applyShadowQuality() {
    this.key.castShadow = this.q.shadows
    this.key.shadow.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize)
    this.key.shadow.map?.dispose()
    this.key.shadow.map = null
  }

  private buildDust() {
    if (this.dust) {
      this.fxRoot.remove(this.dust)
      this.dust.geometry.dispose()
      ;(this.dust.material as ShaderMaterial).dispose()
    }
    const n = this.q.dust
    const p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) p.set([(Math.random() - 0.5) * 30, Math.random() * 32, (Math.random() - 0.5) * 16], i * 3)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(p, 3))
    this.dust = new Points(g, new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uT: { value: 0 } },
      vertexShader: 'uniform float uT; varying float vA; void main(){ vec3 q = position; q.y = mod(q.y + uT*0.08, 32.0); q.x += sin(uT*0.1 + position.z)*0.4; vec4 mv = modelViewMatrix*vec4(q,1.0); gl_Position = projectionMatrix*mv; vA = 0.5 + 0.5*sin(uT*0.7 + position.x*3.0); gl_PointSize = 30.0 / -mv.z; }',
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d)*0.12*vA; gl_FragColor = vec4(vec3(1.0,0.9,0.75)*a, a); }',
    }))
    this.dust.frustumCulled = false
    this.fxRoot.add(this.dust)
  }

  setQuality(level: QualityLevel) {
    this.level = level
    this.q = QUALITY[level]
    this.pipeline.setQuality(this.q)
    this.applyShadowQuality()
    this.buildDust()
    this.resize()
  }

  /** (re)build every visual from a simulation */
  load(sim: Simulation) {
    this.clearMachine()
    this.sim = sim
    this.interp = new Interp(sim)
    this.tower = buildTower(sim, this.mats, this.q)
    this.machineRoot.add(this.tower.group)
    const b = { mats: this.mats, q: this.q, world: this.machineRoot }
    for (const c of sim.components) {
      const v = buildVisual(c, b)
      this.visuals.push(v)
      this.machineRoot.add(v.root)
      for (const m of v.movers) this.machineRoot.add(m)
    }
    this.buildWires()
    this.update(0)
  }

  private clearMachine() {
    for (const v of this.visuals) {
      this.machineRoot.remove(v.root)
      for (const m of v.movers) this.machineRoot.remove(m)
      v.dispose()
    }
    this.visuals = []
    for (const w of this.wires) {
      this.machineRoot.remove(w.mesh)
      w.mesh.geometry.dispose()
      w.mat.dispose()
    }
    this.wires = []
    if (this.tower) {
      this.machineRoot.remove(this.tower.group)
      this.tower.group.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose() })
      this.tower.dispose()
      this.tower = null
    }
  }

  /** signal cables and chain drives, drawn as cables that light up when their signal travels */
  private buildWires() {
    for (const k of this.sim.connections) {
      if (k.from === '@start') continue
      const a = this.sim.byId.get(k.from)
      const b = this.sim.byId.get(k.to)
      if (!a || !b) continue
      const mech = k.kind === 'mechanical'
      const pa = mech ? toV(a.rotors()[0]?.center ?? a.origin) : anchorOf(a)
      const pb = mech ? toV(b.rotors()[0]?.center ?? b.origin) : anchorOf(b)
      const mid = pa.clone().lerp(pb, 0.5)
      mid.y -= mech ? 0 : Math.min(1.2, pa.distanceTo(pb) * 0.12)
      if (!mech) mid.z = Math.min(pa.z, pb.z) - 0.4
      const curve = new CatmullRomCurve3(mech ? [pa, pb] : [pa, pa.clone().lerp(mid, 0.5).setZ(mid.z), mid, pb.clone().lerp(mid, 0.5).setZ(mid.z), pb])
      const mat = new ShaderMaterial({
        vertexShader: WIRE_VERT, fragmentShader: WIRE_FRAG, fog: false,
        uniforms: { uColor: { value: new Color(mech ? '#e0a64e' : '#ff6a2a') }, uPulse: { value: -1 }, uLit: { value: 0 }, uDash: { value: curve.getLength() * 4 }, uTime: { value: 0 }, uMech: { value: mech ? 1 : 0 } },
      })
      const mesh = new Mesh(new TubeGeometry(curve, Math.max(8, Math.round(curve.getLength() * 6)), mech ? 0.028 : 0.022, 6, false), mat)
      this.machineRoot.add(mesh)
      this.wires.push({ mesh, mat, from: k.from, to: k.to, output: k.output, pulse: -1, lit: 0, mech })
    }
  }

  /** a signal fired: start the pulse travelling down matching wires */
  onSignal(from: string, to?: string) {
    for (const w of this.wires) if (w.from === from && (!to || w.to === to) && !w.mech) w.pulse = 0
  }

  impacts(list: ImpactEvent[]) {
    for (const e of list) {
      if (e.speed < 1.2) continue
      const metal = e.a.material !== 'wood' && e.b.material !== 'wood' && e.a.material !== 'felt' && e.b.material !== 'felt'
      if (!metal) continue
      const count = Math.min(24, Math.round(e.speed * 4))
      for (let i = 0; i < count; i++) this.spawnSpark(e.pos, e.speed)
    }
  }

  private spawnSpark(p: { x: number; y: number; z: number }, speed: number) {
    const n = this.sparkLife.length
    const i = this.sparkHead
    this.sparkHead = (this.sparkHead + 1) % Math.min(n, this.q.sparks)
    this.sparkData.set([p.x, p.y, p.z], i * 3)
    const s = 0.6 + Math.random() * speed * 0.6
    const th = Math.random() * Math.PI * 2
    const u = Math.random()
    this.sparkVel.set([Math.cos(th) * s, u * s * 1.2 + 0.4, Math.sin(th) * s], i * 3)
    this.sparkLife[i] = 1
  }

  update(dt: number, editing = false) {
    this.time += dt
    const v: VisualCtx = { sim: this.sim, interp: this.interp, time: this.time, dt, editing }
    for (const x of this.visuals) x.update(v)
    for (const w of this.wires) {
      const from = this.sim.byId.get(w.from)
      const lit = w.mech ? (from && from.rotors()[0]?.powered && Math.abs(from.rotors()[0].omega) > 0.01 ? 1 : 0) : w.pulse >= 0 || w.lit > 0 ? 1 : 0
      w.lit += (lit - w.lit) * Math.min(1, dt * 4)
      if (w.pulse >= 0) {
        w.pulse += dt * 1.6
        if (w.pulse > 1.2) w.pulse = -1
      }
      w.mat.uniforms.uPulse.value = w.pulse
      w.mat.uniforms.uLit.value = w.lit
      w.mat.uniforms.uTime.value = this.time
    }
    // sparks
    const n = this.sparkLife.length
    for (let i = 0; i < n; i++) {
      if (this.sparkLife[i] <= 0) continue
      this.sparkLife[i] -= dt * 2.2
      const o = i * 3
      this.sparkVel[o + 1] -= 9.8 * dt
      this.sparkData[o] += this.sparkVel[o] * dt
      this.sparkData[o + 1] += this.sparkVel[o + 1] * dt
      this.sparkData[o + 2] += this.sparkVel[o + 2] * dt
    }
    this.sparks.geometry.attributes.position.needsUpdate = true
    this.sparks.geometry.attributes.life.needsUpdate = true
    if (this.dust) (this.dust.material as ShaderMaterial).uniforms.uT.value = this.time
  }

  resetWires() {
    for (const w of this.wires) { w.pulse = -1; w.lit = 0 }
  }

  resize() {
    const c = this.renderer.domElement
    const w = c.clientWidth || 2
    const h = c.clientHeight || 2
    const pr = Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.pipeline.setSize(Math.round(w * pr), Math.round(h * pr))
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  render(fx: FxState) {
    this.pipeline.render(this.scene, this.camera, fx, this.time, this.q.shadows)
  }

  dispose() {
    this.clearMachine()
    this.pipeline.dispose()
    this.env.dispose()
    this.renderer.dispose()
  }
}

const toV = (p: { x: number; y: number; z: number }) => new Vector3(p.x, p.y, p.z)
function anchorOf(c: { bounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }; origin: { x: number; y: number; z: number } }) {
  const b = c.bounds()
  return new Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.min.z)
}
