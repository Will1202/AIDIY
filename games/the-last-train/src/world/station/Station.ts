// 世界 0：午夜车站 / The Midnight Platform
// 暴雨、积水倒影、远处闪电、雨棚下的灯、移动的雾。开场电影镜头：列车从雨雾里驶入零号站台。
// 谜题：车票 → 故障电子钟（23:59 闪现）+ 告示 → 储物柜密码 → 检票钳 → 组合检票 → 列车长 → 登车。
import {
  AdditiveBlending, BackSide, BufferGeometry, Color, Float32BufferAttribute, Points, PointsMaterial, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Scene, ShaderMaterial, SphereGeometry, SpotLight, Vector3, Vector4,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three'
import { World, v3 } from '../World'
import { Batcher, boxGeo, glassMat, glowMat, std, trs, yieldFrame } from '../shared/kit'
import { TEX, makeTex } from '../shared/textures'
import { DigitScreen, textTexture, DISPLAY, MONO } from '../shared/text'
import { Rain } from '../shared/Rain'
import { PlanarReflection } from '../shared/Reflection'
import { makeWet, type WetUniforms } from '../shared/wet'
import { S } from '../../state/store'
import { setUI } from '../../state/ui'
import { FLOOR_Y, Train } from '../shared/Train'
import { bridges, type RadioBridge } from '../../systems/bridges'
import { RADIO_SECRET } from '../../content/archives'
import type { LoopHandle } from '../../audio/AudioEngine'
import type { Shot } from '../../game/api'

const PLAT_Y = 1.0
const PLAT_Z0 = 1.6
const PLAT_Z1 = 9.0
const PX = 64
const CANOPY = { x0: -38, x1: 38, z0: 2.5, z1: 9.4, y: 5.4 }
const WAIT = { x0: -21, x1: -8, z0: 9.4, z1: 16.5 }
const OFFICE = { x0: 4, x1: 12.6, z0: 9.4, z1: 14 }

export class Station extends World {
  readonly id = 'station' as const
  private rain!: Rain
  private refl: PlanarReflection | null = null
  private floor!: Mesh
  private wet: WetUniforms[] = []
  private sky!: ShaderMaterial
  private lightning!: DirectionalLight
  private nextBolt = 6
  private boltT = -1
  private clock!: DigitScreen
  private clockGlitch = 0
  private lampLights: PointLight[] = []
  private lockerDoor!: Group
  private lockerOpen = 0
  private lockerItems: Object3D[] = []
  private ticketMesh!: Mesh
  private fogCards: Mesh[] = []
  private doorBlocks: ReturnType<World['col']['slab']>[] = []
  private insideTimer = 0
  private radio: { static: LoopHandle | null; freq: number; played: boolean; playing: number } = { static: null, freq: 94.6, played: false, playing: 0 }
  private camLocal = new Vector3()
  private headV = new Vector4()
  private flashLevel = 0
  private bulbMats: MeshStandardMaterial[] = []
  private boardNag = 0
  private coneGeo = new CylinderGeometry(0.12, 1.9, 4.0, 24, 1, true)
  private coneMat = new ShaderMaterial({
    uniforms: { uI: { value: 0.32 } },
    vertexShader: `varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uI; varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ float along = clamp(0.5 - vL.y / 4.0, 0.0, 1.0); float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * uI * edge * pow(1.0 - along, 1.4) * smoothstep(0.0, 0.12, along), 1.0); }`,
    blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide,
  })

  constructor() {
    super()
    this.env.background = new Color(0x05070b)
    this.env.fogColor = new Color(0x0b1018)
    this.env.fogDensity = 0.026
    this.env.score = 'station'
    this.env.fx = {
      exposure: 1.15, bloom: 0.75, bloomThreshold: 1.0, vignette: 0.55, grain: 0.04, saturation: 0.92, contrast: 1.06,
      tint: new Color(0.97, 1.0, 1.05), lift: new Color(0.012, 0.018, 0.03),
    }
    this.spawn = { x: -6, y: PLAT_Y, z: 5.9, yaw: 0 }
    this.approachLength = 420
    this.approachTime = 22
    this.departLength = 560
    this.departTime = 14
  }

  conductorSpot() {
    if (S.num('travel.count') > 0) return null
    if (!S.is('station.introDone') && !S.is('station.intro')) return null
    return { x: 6.7, y: PLAT_Y, z: 2.45, yaw: -Math.PI / 2 }
  }

  envScene() {
    // 用于 PBR 反射的环境：暗蓝的天、暖色的灯带
    const s = new Scene()
    s.background = new Color(0x0a0f18)
    const m = new MeshBasicMaterial({ color: new Color(5, 3.4, 2) })
    for (let i = 0; i < 6; i++) {
      const b = new Mesh(new PlaneGeometry(6, 0.6), m)
      b.position.set(-15 + i * 6, 6, 4)
      b.rotation.x = Math.PI / 2
      s.add(b)
    }
    const cool = new Mesh(new PlaneGeometry(60, 6), new MeshBasicMaterial({ color: new Color(0.25, 0.32, 0.45) }))
    cool.position.set(0, 8, -20)
    s.add(cool)
    const sky = new Mesh(new SphereGeometry(50, 16, 8), new MeshBasicMaterial({ color: new Color(0.05, 0.07, 0.11), side: BackSide }))
    s.add(sky)
    return s
  }

  async build() {
    const R = this.root
    const q = this.q
    const B = new Batcher()
    // ---------- 材质 ----------
    const concrete = std({ color: 0x8a8682, map: TEX.concrete(), roughMap: TEX.concreteRough(), rough: 1, metal: 0 })
    const darkConcrete = std({ color: 0x4a4844, map: TEX.concrete(), rough: 0.95 })
    const tilesM = std({ color: 0xb8b2a6, map: TEX.tiles(), rough: 0.75 })
    const yellow = std({ color: 0xc89a2a, rough: 0.5 })
    const iron = std({ color: 0x23272c, rough: 0.55, metal: 0.8, map: TEX.grime() })
    const steel = std({ color: 0x6a6e72, rough: 0.35, metal: 1, map: TEX.brushed() })
    const rust = std({ color: 0x8a7464, map: TEX.rust(), rough: 0.8, metal: 0.4 })
    const brick = std({ color: 0xb89a88, map: TEX.brick(), normalMap: TEX.brickNormal(), rough: 0.88 })
    const plaster = std({ color: 0xcfc4ae, map: TEX.concrete(), rough: 0.9 })
    const woodM = std({ color: 0x7a5236, map: TEX.wood(), rough: 0.55 })
    const roofM = std({ color: 0x2c3036, rough: 0.6, metal: 0.6, map: TEX.grime() })
    const lockerM = std({ color: 0x4f6a72, rough: 0.45, metal: 0.7, map: TEX.brushed() })
    const ballast = std({ color: 0x55504a, map: TEX.stone(), normalMap: TEX.stoneNormal(), rough: 1 })
    const sleeperM = std({ color: 0x3a3028, map: TEX.wood(), rough: 0.9 })
    const glass = glassMat(0x8aa0b0, 0.2)

    // ---------- 站台 ----------
    // 站台侧面与端面
    B.box(concrete, 0, PLAT_Y / 2, PLAT_Z0 + 0.15, PX * 2, PLAT_Y, 0.3, 0, 1)
    B.box(darkConcrete, 0, 0.45, (PLAT_Z0 + PLAT_Z1) / 2 + 0.2, PX * 2, 0.9, PLAT_Z1 - PLAT_Z0, 0, 2)
    // 站台面：单独的湿地面（积水 + 反射）
    const floorMat = std({ color: 0x8e8a84, map: TEX.concrete(512), roughMap: TEX.concreteRough(), rough: 0.9 })
    if (q.reflections) this.refl = new PlanarReflection(PLAT_Y, q.reflectionScale)
    this.wet.push(makeWet(floorMat, TEX.puddles(), this.refl, { scale: 0.06, reflStrength: 1.1 }))
    const fg = new PlaneGeometry(PX * 2, PLAT_Z1 - PLAT_Z0 + 0.5, 1, 1)
    fg.rotateX(-Math.PI / 2)
    const uv = fg.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * PX * 2 / 3, uv.getY(i) * (PLAT_Z1 - PLAT_Z0) / 3)
    this.floor = new Mesh(fg, floorMat)
    this.floor.position.set(0, PLAT_Y, (PLAT_Z0 + PLAT_Z1) / 2 + 0.25)
    this.floor.receiveShadow = true
    R.add(this.floor)
    this.refl?.hide.push(this.floor)
    // 黄色安全线 + 盲道
    B.box(yellow, 0, PLAT_Y + 0.005, PLAT_Z0 + 0.55, PX * 2, 0.012, 0.32, 0, 1, false)
    B.box(std({ color: 0xdedad2, rough: 0.6 }), 0, PLAT_Y + 0.004, PLAT_Z0 + 0.1, PX * 2, 0.01, 0.12, 0, 1, false)
    this.col.slab(0, (PLAT_Z0 + PLAT_Z1) / 2 + 0.2, PX * 2, PLAT_Z1 - PLAT_Z0 + 0.4, -1, PLAT_Y, { surface: 'wet', tag: 'platform' })
    // 站台边缘的空气墙（列车车身以外的部分）
    this.col.slab(-47.5, PLAT_Z0 + 0.05, 33, 0.12, PLAT_Y, PLAT_Y + 3, { tag: 'edge', walkable: false })
    this.col.slab(46, PLAT_Z0 + 0.05, 36, 0.12, PLAT_Y, PLAT_Y + 3, { tag: 'edge', walkable: false })
    // 站台两端的栏杆
    for (const ex of [-1, 1]) {
      const x = ex * PX
      for (let z = PLAT_Z0 + 0.3; z < PLAT_Z1; z += 1.2) B.box(iron, x, PLAT_Y + 0.55, z, 0.06, 1.1, 0.06)
      B.box(iron, x, PLAT_Y + 1.1, (PLAT_Z0 + PLAT_Z1) / 2, 0.08, 0.06, PLAT_Z1 - PLAT_Z0)
      B.box(iron, x, PLAT_Y + 0.6, (PLAT_Z0 + PLAT_Z1) / 2, 0.05, 0.04, PLAT_Z1 - PLAT_Z0)
      this.col.slab(x, (PLAT_Z0 + PLAT_Z1) / 2, 0.3, PLAT_Z1 - PLAT_Z0, PLAT_Y, PLAT_Y + 3, { tag: 'fence', walkable: false })
    }

    // ---------- 轨道 ----------
    B.box(ballast, 0, -0.1, 0, 900, 0.3, 4.2, 0, 2)
    for (const z of [-0.72, 0.72]) {
      B.box(steel, 0, 0.06, z, 900, 0.12, 0.08, 0, 4)
      B.box(iron, 0, -0.02, z, 900, 0.06, 0.16, 0, 4)
    }
    const sleeperCount = Math.round(900 / 0.75)
    const sleepers = new InstancedMesh(boxGeo(0.26, 0.14, 2.6), sleeperM, sleeperCount)
    const m4 = new Matrix4()
    for (let i = 0; i < sleeperCount; i++) {
      m4.makeTranslation(-450 + i * 0.75 + (Math.random() - 0.5) * 0.04, -0.03, (Math.random() - 0.5) * 0.04)
      sleepers.setMatrixAt(i, m4)
    }
    sleepers.receiveShadow = true
    R.add(sleepers)
    this.col.slab(0, -2.5, 900, 3.0, -1, 0, { surface: 'stone', tag: 'bed', safe: false })
    // 对面挡土墙
    B.box(darkConcrete, 0, 1.4, -6.2, 900, 3.6, 0.8, 0, 3)
    // 挡土墙上的检修灯（只有自发光，给黑暗里一点节奏）
    const wallLamp = glowMat(0xffb070, 14)
    for (let x = -420; x <= 420; x += 28) B.add(new SphereGeometry(0.09, 8, 6), wallLamp, trs(x, 2.6, -5.75), false, false)
    B.box(rust, 0, 0.1, -4.6, 900, 0.4, 2.6, 0, 2)
    // 对面墙上的旧海报
    const posters = ['澄川北站 · 欢迎回家', '零号线 · 末班 23:59', '请勿在站台奔跑', '雨天路滑 · 注意安全', '寻人：如果你看见这张海报，请回家']
    posters.forEach((t, i) => {
      const tex = textTexture({ w: 512, h: 720, bg: ['#2a3a44', '#3a2a24', '#28302a', '#3a3424', '#2a2a2a'][i], grain: 0.15, lines: [{ text: t, size: 0.06, color: '#d8ccb0', y: 0.82 }, { text: 'CHENGCHUAN', size: 0.04, color: '#a89878', font: MONO, y: 0.9, spacing: 0.3 }] })
      const pm = new Mesh(new PlaneGeometry(1.4, 1.97), new MeshStandardMaterial({ map: tex, roughness: 0.85 }))
      pm.position.set(-24 + i * 12, 1.75, -5.78)
      R.add(pm)
    })

    // ---------- 雨棚 ----------
    const cw = CANOPY.x1 - CANOPY.x0
    B.box(roofM, 0, CANOPY.y + 0.12, (CANOPY.z0 + CANOPY.z1) / 2, cw, 0.08, CANOPY.z1 - CANOPY.z0)
    // 瓦楞底面
    for (let z = CANOPY.z0 + 0.2; z < CANOPY.z1; z += 0.4) B.box(roofM, 0, CANOPY.y + 0.06, z, cw, 0.05, 0.18, 0, 4, false)
    // 檐口
    B.box(iron, 0, CANOPY.y + 0.0, CANOPY.z0, cw, 0.35, 0.12)
    B.box(iron, 0, CANOPY.y - 0.2, CANOPY.z0 + 0.06, cw, 0.06, 0.06)
    // 桁架 + 铸铁柱
    const plateMat = new MeshStandardMaterial({ map: textTexture({ w: 256, h: 256, bg: '#e8e0cc', lines: [{ text: '0', size: 0.7, color: '#1a1e24', font: DISPLAY, y: 0.52, weight: '600' }] }), roughness: 0.5 })
    for (let x = CANOPY.x0 + 2; x <= CANOPY.x1 - 2; x += 8) {
      B.box(iron, x, CANOPY.y - 0.18, (CANOPY.z0 + CANOPY.z1) / 2, 0.14, 0.3, CANOPY.z1 - CANOPY.z0)
      B.boxR(iron, x, CANOPY.y - 0.75, 3.6, 0.1, 1.6, 0.1, 0.6, 0, 0)
      B.boxR(iron, x, CANOPY.y - 0.75, 4.8, 0.1, 1.6, 0.1, -0.6, 0, 0)
      B.cyl(iron, x, (PLAT_Y + CANOPY.y) / 2, 4.2, 0.13, CANOPY.y - PLAT_Y, 14)
      B.cyl(iron, x, PLAT_Y + 0.2, 4.2, 0.22, 0.4, 14)
      B.cyl(iron, x, CANOPY.y - 0.35, 4.2, 0.12, 0.3, 14, 0.24)
      this.col.cyl(x, 4.2, 0.24, PLAT_Y, CANOPY.y, { surface: 'metal' })
      // 柱上的站台号
      B.add(new PlaneGeometry(0.34, 0.34), plateMat, trs(x, PLAT_Y + 2.1, 4.2 - 0.14, 0, Math.PI, 0), false)
      B.add(new PlaneGeometry(0.34, 0.34), plateMat, trs(x, PLAT_Y + 2.1, 4.2 + 0.14), false)
    }
    await yieldFrame()

    // ---------- 站房立面 ----------
    const FZ = 9.4
    const facadeSegs: [number, number][] = [[-40, -15.2], [-12.8, 7.2], [8.8, 10.6], [11.8, 40]]
    for (const [a, b] of facadeSegs) {
      B.box(brick, (a + b) / 2, 4, FZ + 0.2, b - a, 8, 0.4, 0, 2.4)
      this.col.slab((a + b) / 2, FZ + 0.2, b - a, 0.4, PLAT_Y, 9, { tag: 'facade' })
    }
    // 门洞上方
    B.box(brick, -14, 5.25, FZ + 0.2, 2.4, 5.5, 0.4, 0, 2)
    B.box(brick, 8, 4.6, FZ + 0.2, 1.6, 6.8, 0.4, 0, 2)
    B.box(brick, 8, 1.25, FZ + 0.2, 1.6, 0.5, 0.4, 0, 2)
    this.col.slab(8, FZ + 0.2, 1.6, 0.4, PLAT_Y, 9, { tag: 'facade' })
    B.box(brick, 11.2, 5.5, FZ + 0.2, 1.2, 5.0, 0.4, 0, 2)
    // 售票窗口玻璃 + 栅格
    const tw = new Mesh(new PlaneGeometry(1.6, 1.1), glass)
    tw.position.set(8, PLAT_Y + 1.55, FZ + 0.02)
    tw.rotation.y = Math.PI
    R.add(tw)
    for (let i = 0; i < 6; i++) B.box(iron, 7.3 + i * 0.28, PLAT_Y + 1.55, FZ, 0.02, 1.1, 0.02)
    B.box(woodM, 8, PLAT_Y + 0.95, FZ - 0.15, 1.8, 0.06, 0.4)
    // 檐板与站名
    B.box(plaster, 0, 7.6, FZ - 0.05, 80, 0.5, 0.2)
    // 候车室窗户（暖光）
    // 窗里的夜灯：顶上一盏灯、越往下越暗（屋里的墙裙）、两侧窗帘褶皱（之前是一整块平涂的亮色）
    const nightWin = makeTex('nightWin', 64, (u, v) => {
      const lamp = Math.exp(-((u - 0.5) ** 2) * 10 - (v - 0.84) ** 2 * 26)
      const curtain = Math.max(0, 1 - Math.min(u, 1 - u) / 0.15)
      const fold = 0.8 + 0.2 * Math.sin(u * 70)
      const low = 0.7 + 0.3 * Math.min(1, Math.max(0, (v - 0.12) / 0.2))
      const k = (0.32 + v * 0.38 + lamp * 0.9) * (1 - curtain * 0.6 * fold) * low
      return [k, k * 0.8, k * 0.58]
    })
    const winGlow = glowMat(0xffb070, 1.5, nightWin)
    for (const x of [-19, -10]) {
      const wm = new Mesh(new PlaneGeometry(2.2, 2.4), winGlow)
      wm.position.set(x, 4.2, FZ - 0.01)
      wm.rotation.y = Math.PI
      R.add(wm)
      B.box(iron, x, 4.2, FZ - 0.03, 2.4, 0.06, 0.05)
      B.box(iron, x, 4.2, FZ - 0.03, 0.06, 2.6, 0.05)
    }
    // 远处二楼的窗（一盏亮，一盏暗）
    for (const [x, on] of [[20, 1], [26, 0.15], [32, 0.6], [-30, 0.25]] as [number, number][]) {
      const wm = new Mesh(new PlaneGeometry(1.6, 2.0), glowMat(0xffc080, on * 1.5, nightWin))
      wm.position.set(x, 5.2, FZ - 0.01)
      wm.rotation.y = Math.PI
      R.add(wm)
    }
    // 站名牌（悬挂在雨棚下）
    const nameTex = textTexture({ w: 1024, h: 256, bg: '#14202c', border: '#c8b080', lines: [{ text: '澄 川 北 站', size: 0.36, color: '#efe8d8', y: 0.4 }, { text: 'CHENGCHUAN NORTH · PLATFORM 0', size: 0.12, color: '#c8b080', font: MONO, y: 0.76, spacing: 0.25 }] })
    for (const x of [-26, 26]) {
      const n = new Mesh(boxGeo(3.2, 0.8, 0.06), [std({ color: 0x14202c }), std({ color: 0x14202c }), std({ color: 0x14202c }), std({ color: 0x14202c }), new MeshStandardMaterial({ map: nameTex, roughness: 0.5 }), new MeshStandardMaterial({ map: nameTex, roughness: 0.5 })])
      n.position.set(x, CANOPY.y - 1.0, 5.6)
      R.add(n)
      B.box(iron, x - 1.2, CANOPY.y - 0.5, 5.6, 0.02, 0.6, 0.02)
      B.box(iron, x + 1.2, CANOPY.y - 0.5, 5.6, 0.02, 0.6, 0.02)
    }

    // ---------- 时刻表 ----------
    const ttLines = [
      { text: '发 车 时 刻 · DEPARTURES', size: 0.07, color: '#d8c49a', y: 0.1, font: MONO },
      { text: '20:15   普通 1203 次   滨江        已发车', size: 0.065, color: '#8a8070', y: 0.25, font: MONO, align: 'left' as const },
      { text: '21:40   普通 1207 次   南港        已发车', size: 0.065, color: '#8a8070', y: 0.37, font: MONO, align: 'left' as const },
      { text: '22:55   快速  880 次   澄川东      已发车', size: 0.065, color: '#8a8070', y: 0.49, font: MONO, align: 'left' as const },
      { text: '■■:■■   末班 0000 次   ——————      零号站台', size: 0.065, color: '#ffcf80', y: 0.63, font: MONO, align: 'left' as const },
      { text: '（末班车发车时刻一栏被雨水晕开，看不清）', size: 0.05, color: '#8a7a60', y: 0.76 },
      { text: '零号线广播 · FM 88.0', size: 0.055, color: '#9fb6c4', y: 0.9, font: MONO },
    ]
    const ttTex = textTexture({ w: 1024, h: 512, bg: '#0c0f12', border: '#3a3428', lines: ttLines })
    const tt = new Mesh(new PlaneGeometry(4.4, 2.2), new MeshStandardMaterial({ map: ttTex, emissive: 0xffffff, emissiveMap: ttTex, emissiveIntensity: 0.55, roughness: 0.4 }))
    tt.position.set(0, 3.5, FZ - 0.02)
    tt.rotation.y = Math.PI
    R.add(tt)
    B.box(iron, 0, 3.5, FZ - 0.0, 4.6, 2.4, 0.05)

    // ---------- 故障的电子钟（悬挂，双面） ----------
    this.clock = new DigitScreen(512, 200)
    this.clock.draw('00:00')
    const clockG = new Group()
    const cbox = new Mesh(boxGeo(1.5, 0.62, 0.22), iron)
    clockG.add(cbox)
    for (const s of [-1, 1]) {
      const face = new Mesh(new PlaneGeometry(1.36, 0.5), new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: this.clock.texture, emissiveIntensity: 2.2 }))
      face.position.z = s * 0.112
      face.rotation.y = s > 0 ? 0 : Math.PI
      clockG.add(face)
    }
    B.box(iron, -2.6 - 0.5, CANOPY.y - 0.4, 5.2, 0.02, 0.8, 0.02)
    B.box(iron, -2.6 + 0.5, CANOPY.y - 0.4, 5.2, 0.02, 0.8, 0.02)
    clockG.position.set(-2.6, CANOPY.y - 1.1, 5.2)
    R.add(clockG)
    const clockLight = new PointLight(0xff4a2a, 6, 6, 1.8)
    clockLight.position.set(-2.6, CANOPY.y - 1.4, 5.2)
    R.add(clockLight)

    // ---------- 长椅 ----------
    const bench = (x: number, z: number, yaw: number) => {
      const g = new Batcher()
      for (const dx of [-0.8, 0.8]) {
        g.box(iron, dx, 0.22, 0, 0.06, 0.44, 0.5)
        g.box(iron, dx, 0.6, 0.22, 0.06, 0.6, 0.06)
      }
      for (let i = 0; i < 4; i++) g.box(woodM, 0, 0.46, -0.18 + i * 0.12, 1.9, 0.04, 0.09)
      for (let i = 0; i < 3; i++) g.box(woodM, 0, 0.66 + i * 0.13, 0.25, 1.9, 0.09, 0.03)
      const o = new Group()
      g.build(o, 'bench')
      o.position.set(x, PLAT_Y, z)
      o.rotation.y = yaw
      R.add(o)
      this.col.slab(x, z, yaw === 0 ? 1.95 : 0.6, yaw === 0 ? 0.6 : 1.95, PLAT_Y, PLAT_Y + 0.5, { surface: 'wood', tag: 'bench' })
      this.col.slab(x + (yaw === 0 ? 0 : 0.25 * Math.sin(yaw)), z + (yaw === 0 ? 0.25 : 0), yaw === 0 ? 1.95 : 0.1, yaw === 0 ? 0.1 : 1.95, PLAT_Y, PLAT_Y + 1.0, { tag: 'benchBack' })
    }
    bench(-6, 6.6, 0)
    bench(5, 6.6, 0)
    bench(-22, 6.6, 0)
    bench(22, 6.6, 0)

    // ---------- 自动售货机 ----------
    const vend = new Group()
    const vb = new Mesh(boxGeo(1.1, 1.9, 0.8), std({ color: 0x7a1e22, rough: 0.4, metal: 0.3 }))
    vb.position.y = 0.95
    vend.add(vb)
    const vtex = textTexture({ w: 256, h: 420, bg: '#0a1820', lines: [{ text: '售 罄', size: 0.08, color: '#ff6a5a', y: 0.15 }, { text: 'SOLD OUT', size: 0.05, color: '#ff6a5a', font: MONO, y: 0.22 }, ...[0, 1, 2, 3].map((i) => ({ text: '▯ ▯ ▯ ▯', size: 0.08, color: '#4a7890', y: 0.38 + i * 0.14 }))] })
    const vp = new Mesh(new PlaneGeometry(0.8, 1.3), new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: vtex, emissiveIntensity: 1.4 }))
    vp.position.set(0, 1.15, -0.41)
    vp.rotation.y = Math.PI
    vend.add(vp)
    vend.position.set(17, PLAT_Y, 8.75)
    R.add(vend)
    this.col.slab(17, 8.75, 1.15, 0.85, PLAT_Y, PLAT_Y + 1.95, { tag: 'vend', surface: 'metal' })

    // ---------- 雨棚下的吊灯 ----------
    const shadeMat = std({ color: 0x1a2a24, rough: 0.5, metal: 0.6, side: DoubleSide })
    const bulb = (x: number, y: number, z: number, light: boolean) => {
      B.add(new CylinderGeometry(0.12, 0.38, 0.28, 20, 1, true), shadeMat, trs(x, y + 0.1, z), false)
      const bm = glowMat(0xffd59a, 8)
      this.bulbMats.push(bm)
      const b = new Mesh(new SphereGeometry(0.09, 12, 8), bm)
      b.position.set(x, y - 0.02, z)
      R.add(b)
      B.box(iron, x, (y + CANOPY.y) / 2 + 0.1, z, 0.015, CANOPY.y - y - 0.1, 0.015)
      // 灯下的体积光锥（雨和雾里看得见的光）
      const cone = new Mesh(this.coneGeo, this.coneMat)
      cone.position.set(x, y - 2.0, z)
      R.add(cone)
      if (light) {
        const l = new PointLight(0xffcf90, 55, 20, 1.6)
        l.position.set(x, y - 0.15, z)
        R.add(l)
        this.lampLights.push(l)
      }
    }
    const lampXs = [-34, -26, -18, -10, -2, 6, 14, 22, 30]
    lampXs.forEach((x) => bulb(x, CANOPY.y - 1.0, 4.9, [-18, 6, 22].includes(x)))
    // 主光：长椅上方的投影聚光灯（唯一投射阴影的灯）
    const key = new SpotLight(0xffd8a0, 420, 24, 0.8, 0.6, 1.5)
    key.position.set(-6, CANOPY.y - 0.9, 4.9)
    key.target.position.set(-6, PLAT_Y, 5.6)
    key.castShadow = q.shadows
    key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
    key.shadow.bias = -0.0004
    key.shadow.radius = 4
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 22
    R.add(key, key.target)
    this.lampLights.push(key as unknown as PointLight)
    // 雨棚外的路灯
    for (const x of [-48, 48]) {
      B.cyl(iron, x, PLAT_Y + 2.4, 7.8, 0.07, 4.8, 10)
      B.box(iron, x, PLAT_Y + 4.8, 7.2, 0.06, 0.06, 1.2)
      const bm = glowMat(0xfff0d0, 10)
      const b = new Mesh(new SphereGeometry(0.14, 12, 8), bm)
      b.position.set(x, PLAT_Y + 4.65, 6.6)
      R.add(b)
      const l = new PointLight(0xe8f0ff, 70, 24, 1.5)
      l.position.set(x, PLAT_Y + 4.5, 6.6)
      R.add(l)
      this.lampLights.push(l)
      this.col.cyl(x, 7.8, 0.12, PLAT_Y, PLAT_Y + 5)
    }
    await yieldFrame()

    // ---------- 候车室 ----------
    const W = WAIT
    B.box(tilesM, (W.x0 + W.x1) / 2, PLAT_Y + 0.01, (W.z0 + W.z1) / 2, W.x1 - W.x0, 0.02, W.z1 - W.z0, 0, 1.5)
    B.box(plaster, (W.x0 + W.x1) / 2, 4.6, (W.z0 + W.z1) / 2, W.x1 - W.x0, 0.2, W.z1 - W.z0)
    B.box(plaster, (W.x0 + W.x1) / 2, 2.8, W.z1 + 0.1, W.x1 - W.x0, 3.6, 0.2)
    B.box(plaster, W.x0 - 0.1, 2.8, (W.z0 + W.z1) / 2, 0.2, 3.6, W.z1 - W.z0)
    B.box(plaster, W.x1 + 0.1, 2.8, (W.z0 + W.z1) / 2, 0.2, 3.6, W.z1 - W.z0)
    B.box(woodM, (W.x0 + W.x1) / 2, PLAT_Y + 0.5, W.z1 - 0.02, W.x1 - W.x0, 1.0, 0.04)
    this.col.slab((W.x0 + W.x1) / 2, (W.z0 + W.z1) / 2, W.x1 - W.x0, W.z1 - W.z0, -1, PLAT_Y, { surface: 'marble', tag: 'waitFloor' })
    this.col.slab((W.x0 + W.x1) / 2, W.z1 + 0.1, W.x1 - W.x0, 0.2, PLAT_Y, 5, { tag: 'wall' })
    this.col.slab(W.x0 - 0.1, (W.z0 + W.z1) / 2, 0.2, W.z1 - W.z0, PLAT_Y, 5, { tag: 'wall' })
    this.col.slab(W.x1 + 0.1, (W.z0 + W.z1) / 2, 0.2, W.z1 - W.z0, PLAT_Y, 5, { tag: 'wall' })
    this.col.slab((W.x0 + W.x1) / 2, (W.z0 + W.z1) / 2, W.x1 - W.x0, W.z1 - W.z0, 4.5, 5, { tag: 'ceil' })
    // 候车室长椅
    for (const [x, z] of [[-17, 12], [-12, 12]] as [number, number][]) {
      const o = new Batcher()
      o.box(woodM, 0, 0.45, 0, 2.6, 0.06, 0.55)
      o.box(woodM, 0, 0.8, 0.26, 2.6, 0.55, 0.05)
      for (const dx of [-1.1, 1.1]) o.box(iron, dx, 0.22, 0, 0.06, 0.44, 0.5)
      const g = new Group()
      o.build(g)
      g.position.set(x, PLAT_Y, z)
      R.add(g)
      this.col.slab(x, z, 2.6, 0.6, PLAT_Y, PLAT_Y + 0.5, { surface: 'wood', tag: 'bench' })
    }
    // 储物柜（3 行 × 4 列）
    const LX0 = -17.6, LZ = W.z1 - 0.35
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const n = r * 4 + c + 1
      const x = LX0 + c * 0.62, y = PLAT_Y + 0.5 + r * 0.66
      if (n !== 7) {
        const d = new Mesh(boxGeo(0.58, 0.62, 0.04), lockerM)
        d.position.set(x, y, LZ - 0.28)
        R.add(d)
      }
      const nt = textTexture({ w: 64, h: 32, bg: '#d8d0bc', lines: [{ text: String(n).padStart(2, '0'), size: 0.7, color: '#222', font: MONO, y: 0.55 }] })
      const np = new Mesh(new PlaneGeometry(0.12, 0.06), new MeshStandardMaterial({ map: nt }))
      np.position.set(x, y + 0.2, LZ - 0.305)
      np.rotation.y = Math.PI
      R.add(np)
    }
    // 柜体：每一格都是空的（打开 7 号柜能看见里面）
    {
      const bx0 = LX0 - 0.31, bx1 = LX0 + 3 * 0.62 + 0.31
      const by0 = PLAT_Y + 0.17, by1 = by0 + 3 * 0.66
      const zf = LZ - 0.26, zb = LZ + 0.27
      B.box(lockerM, (bx0 + bx1) / 2, (by0 + by1) / 2, zb, bx1 - bx0, by1 - by0, 0.03)
      for (let c = 0; c <= 4; c++) B.box(lockerM, bx0 + c * 0.62, (by0 + by1) / 2, (zf + zb) / 2, 0.025, by1 - by0, zb - zf)
      for (let r = 0; r <= 3; r++) B.box(lockerM, (bx0 + bx1) / 2, by0 + r * 0.66, (zf + zb) / 2, bx1 - bx0, 0.025, zb - zf)
      B.box(lockerM, (bx0 + bx1) / 2, (PLAT_Y + by0) / 2, (zf + zb) / 2, bx1 - bx0, by0 - PLAT_Y, zb - zf)
    }
    this.col.slab(LX0 + 0.93, LZ + 0.08, 2.6, 0.42, PLAT_Y, PLAT_Y + 2.2, { tag: 'lockers', surface: 'metal' })
    // 7 号柜门（可打开）
    this.lockerDoor = new Group()
    const ld = new Mesh(boxGeo(0.58, 0.62, 0.04), lockerM)
    ld.position.x = -0.29
    this.lockerDoor.add(ld)
    const dialM = new Mesh(new CylinderGeometry(0.05, 0.05, 0.03, 20), steel)
    dialM.rotation.x = Math.PI / 2
    dialM.position.set(-0.48, 0, -0.03)
    this.lockerDoor.add(dialM)
    const L7 = { x: LX0 + 2 * 0.62, y: PLAT_Y + 0.5 + 0.66 }
    this.lockerDoor.position.set(L7.x + 0.29, L7.y, LZ - 0.28)
    R.add(this.lockerDoor)
    // 柜内：档案袋 + 检票钳
    const folder = new Mesh(boxGeo(0.3, 0.02, 0.22), std({ color: 0x8a6a40, rough: 0.8 }))
    folder.position.set(L7.x - 0.08, L7.y - 0.31, LZ - 0.06)
    folder.rotation.y = 0.2
    R.add(folder)
    const punch = makePunch()
    punch.position.set(L7.x + 0.13, L7.y - 0.3, LZ - 0.08)
    R.add(punch)
    this.lockerItems = [folder, punch]
    // 候车室墙上的停走挂钟
    const wc = new Mesh(new CylinderGeometry(0.4, 0.4, 0.06, 32), std({ color: 0xe8e0cc, rough: 0.5 }))
    wc.rotation.x = Math.PI / 2
    wc.position.set(-11, 3.4, W.z1 - 0.05)
    R.add(wc)
    for (const [len, ang] of [[0.25, 0], [0.33, 0.02]] as [number, number][]) {
      const h = new Mesh(boxGeo(0.025, len, 0.01), std({ color: 0x111111 }))
      h.position.set(-11, 3.4 + len / 2, W.z1 - 0.1)
      h.rotation.z = ang
      R.add(h)
    }
    // 告示板
    const nb = textTexture({ w: 768, h: 512, bg: '#3a2a1c', grain: 0.1, lines: [{ text: '候 车 须 知', size: 0.1, color: '#efe2c4', y: 0.18 }, { text: '一、请保管好随身物品。', size: 0.06, color: '#d8c8a8', y: 0.42, align: 'left' }, { text: '二、遗失物品请至储物柜领取。', size: 0.06, color: '#d8c8a8', y: 0.56, align: 'left' }, { text: '三、末班车开出后，本站不再售票。', size: 0.06, color: '#d8c8a8', y: 0.7, align: 'left' }] })
    const nbm = new Mesh(new PlaneGeometry(1.5, 1.0), new MeshStandardMaterial({ map: nb, roughness: 0.85 }))
    nbm.position.set(W.x0 + 0.02, 2.6, 12.5)
    nbm.rotation.y = Math.PI / 2
    R.add(nbm)
    const wl = new PointLight(0xffc888, 40, 14, 1.6)
    wl.position.set(-14.5, 4.0, 12.8)
    R.add(wl)
    const wlb = new Mesh(new SphereGeometry(0.16, 12, 8), glowMat(0xffd8a0, 6))
    wlb.position.set(-14.5, 4.25, 12.8)
    R.add(wlb)

    // ---------- 售票室 ----------
    const O = OFFICE
    B.box(woodM, (O.x0 + O.x1) / 2, PLAT_Y + 0.01, (O.z0 + O.z1) / 2, O.x1 - O.x0, 0.02, O.z1 - O.z0)
    B.box(plaster, (O.x0 + O.x1) / 2, 4.2, (O.z0 + O.z1) / 2, O.x1 - O.x0, 0.2, O.z1 - O.z0)
    B.box(plaster, (O.x0 + O.x1) / 2, 2.6, O.z1 + 0.1, O.x1 - O.x0, 3.4, 0.2)
    B.box(plaster, O.x0 - 0.1, 2.6, (O.z0 + O.z1) / 2, 0.2, 3.4, O.z1 - O.z0)
    B.box(plaster, O.x1 + 0.1, 2.6, (O.z0 + O.z1) / 2, 0.2, 3.4, O.z1 - O.z0)
    this.col.slab((O.x0 + O.x1) / 2, (O.z0 + O.z1) / 2, O.x1 - O.x0, O.z1 - O.z0, -1, PLAT_Y, { surface: 'wood', tag: 'officeFloor' })
    this.col.slab((O.x0 + O.x1) / 2, O.z1 + 0.1, O.x1 - O.x0, 0.2, PLAT_Y, 5, { tag: 'wall' })
    this.col.slab(O.x0 - 0.1, (O.z0 + O.z1) / 2, 0.2, O.z1 - O.z0, PLAT_Y, 5, { tag: 'wall' })
    this.col.slab(O.x1 + 0.1, (O.z0 + O.z1) / 2, 0.2, O.z1 - O.z0, PLAT_Y, 5, { tag: 'wall' })
    // 售票台
    B.box(woodM, 8, PLAT_Y + 0.5, FZ + 0.7, 3.4, 1.0, 0.8)
    this.col.slab(8, FZ + 0.7, 3.4, 0.8, PLAT_Y, PLAT_Y + 1.0, { tag: 'desk', surface: 'wood' })
    // 收音机
    const radio = new Group()
    const rb = new Mesh(boxGeo(0.42, 0.26, 0.2), std({ color: 0x5a3a24, map: TEX.wood(), rough: 0.5 }))
    radio.add(rb)
    const rdial = new Mesh(new PlaneGeometry(0.26, 0.08), new MeshStandardMaterial({ color: 0x000000, emissive: 0xffb060, emissiveIntensity: 1.2 }))
    rdial.position.set(0.0, 0.05, -0.101)
    rdial.rotation.y = Math.PI
    radio.add(rdial)
    const rk = new Mesh(new CylinderGeometry(0.03, 0.03, 0.03, 16), steel)
    rk.rotation.x = Math.PI / 2
    rk.position.set(0.12, -0.06, -0.1)
    radio.add(rk)
    radio.position.set(9.0, PLAT_Y + 1.13, FZ + 0.85)
    R.add(radio)
    const ol = new PointLight(0xffb070, 18, 9, 1.8)
    ol.position.set(8, 3.6, 11.8)
    R.add(ol)

    // ---------- 天空、云、雾 ----------
    this.sky = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uFlash; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vP);
          float up = clamp(d.y, -0.2, 1.0);
          vec2 uv = d.xz / (d.y + 0.25) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
          float c = fbm(uv);
          vec3 base = mix(vec3(0.012, 0.016, 0.026), vec3(0.03, 0.04, 0.06), smoothstep(-0.1, 0.5, up));
          vec3 col = base + vec3(0.03, 0.035, 0.05) * c;
          col += vec3(0.5, 0.55, 0.75) * uFlash * (0.4 + c * 1.4) * smoothstep(-0.05, 0.3, up);
          // 远方城市的光污染（地平线暖光）
          col += vec3(0.08, 0.045, 0.02) * smoothstep(0.25, 0.0, abs(d.y - 0.02));
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: BackSide, depthWrite: false, fog: false,
    })
    const dome = new Mesh(new SphereGeometry(1200, 32, 16), this.sky)
    dome.renderOrder = -1
    R.add(dome)
    // 远处城市灯火：一次绘制的点精灵
    {
      const n = 120
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
      const c = new Color()
      for (let i = 0; i < n; i++) {
        const a = (Math.random() - 0.5) * Math.PI * 1.4 - Math.PI / 2
        const r = 280 + Math.random() * 300
        pos.set([Math.cos(a) * r, 2 + Math.random() * 30, Math.sin(a) * r - 50], i * 3)
        c.setHSL(0.07 + Math.random() * 0.06, 0.65, 0.35 + Math.random() * 0.3)
        col.set([c.r, c.g, c.b], i * 3)
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(pos, 3))
      g.setAttribute('color', new Float32BufferAttribute(col, 3))
      const pts = new Points(g, new PointsMaterial({ size: 3.2, map: TEX.glow(), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }))
      pts.frustumCulled = false
      R.add(pts)
    }
    // 信号灯
    for (const [x, col] of [[120, 0xff2a1a], [-150, 0x2aff6a], [260, 0xff2a1a]] as [number, number][]) {
      B.cyl(iron, x, 2.5, -2.4, 0.08, 5, 8)
      const sl = new Mesh(new SphereGeometry(0.16, 12, 8), glowMat(col, 25))
      sl.position.set(x, 4.8, -2.4)
      R.add(sl)
    }
    // 雾片：沿轨道缓慢漂移
    const fogMat = new MeshBasicMaterial({ map: TEX.cloud(), color: 0x2a3444, transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending })
    for (let i = 0; i < 18; i++) {
      const f = new Mesh(new PlaneGeometry(40, 10), fogMat)
      f.position.set(-200 + i * 26 + Math.random() * 10, 2 + Math.random() * 2.5, -3 + Math.random() * 3)
      f.userData.v = 0.6 + Math.random() * 0.8
      this.fogCards.push(f)
      R.add(f)
    }

    // ---------- 灯光 ----------
    const hemi = new HemisphereLight(0x3a4c66, 0x14100c, 0.9)
    R.add(hemi)
    this.lightning = new DirectionalLight(0xc8d8ff, 0)
    this.lightning.position.set(-40, 80, -60)
    R.add(this.lightning, this.lightning.target)

    // ---------- 雨 ----------
    const lightsForRain = this.lampLights.map((l) => l.position.clone())
    this.rain = new Rain({
      count: q.rain,
      roofs: [
        { x0: CANOPY.x0, z0: CANOPY.z0, x1: CANOPY.x1, z1: CANOPY.z1 + 8, y: CANOPY.y },
        { x0: -31.5, z0: -1.6, x1: 27.6, z1: 1.6, y: 4.2 },
        { x0: -42, z0: 9.2, x1: 42, z1: 30, y: 9 },
      ],
      ground: (_x, z) => (z > PLAT_Z0 && z < PLAT_Z1 ? PLAT_Y : 0),
      groundShader: `float groundY(float x, float z) { return (z > ${PLAT_Z0.toFixed(2)} && z < ${PLAT_Z1.toFixed(2)}) ? ${PLAT_Y.toFixed(2)} : 0.0; }`,
      lights: lightsForRain,
    })
    R.add(this.rain.group)
    if (this.refl) this.refl.hide.push(this.rain.group)
    // 雨棚檐口的滴水帘
    const drips = new Mesh(new PlaneGeometry(CANOPY.x1 - CANOPY.x0, CANOPY.y - PLAT_Y), new ShaderMaterial({
      uniforms: { uTime: this.wet[0].uTime },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying vec3 vW;
        float h(float n){ return fract(sin(n) * 43758.5453); }
        void main(){
          float col = floor(vW.x * 7.0);
          float r = h(col);
          if (r < 0.55) discard;
          float fx = fract(vW.x * 7.0) - 0.5;
          float line = smoothstep(0.12, 0.0, abs(fx));
          float y = fract(vUv.y * (2.0 + r * 3.0) + uTime * (1.6 + r * 1.4) + r * 10.0);
          float seg = smoothstep(0.0, 0.1, y) * smoothstep(0.5, 0.25, y);
          gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * line * seg * 0.35, 1.0);
        }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false,
    }))
    drips.position.set(0, (CANOPY.y + PLAT_Y) / 2, CANOPY.z0 - 0.02)
    R.add(drips)

    // ---------- 交互与谜题 ----------
    this.buildInteractions(punch, folder)
    // 列车车门前的“检票”阻挡（列车长没放行前进不去）
    for (const dx of [-5.5, 5.5]) {
      this.doorBlocks.push(this.col.slab(dx, 1.72, 1.4, 0.2, PLAT_Y, PLAT_Y + 3, { tag: 'doorBlock', walkable: false }))
    }
    // 车身外壳（机车、尾车）挡住站台边缘
    this.col.slab(19, 1.55, 17.2, 0.1, PLAT_Y, PLAT_Y + 3, { tag: 'hull', walkable: false })
    this.col.slab(-21, 1.55, 20.6, 0.1, PLAT_Y, PLAT_Y + 3, { tag: 'hull', walkable: false })
    this.trigger({
      id: 'board', min: v3(-10, 0.5, -1.4), max: v3(10, 3, 1.4),
      stay: (dt) => {
        if (S.is('station.boardOk') && S.num('travel.count') === 0 && this.game.docked) {
          this.insideTimer += dt
          if (this.insideTimer > 1.2 && !S.is('station.departing')) {
            S.set('station.departing')
            this.game.say('列车长', '欢迎乘坐末班 0000 次。列车即将出发，请勿在行驶中打开车门。', 4.5)
            setTimeout(() => this.game.requestDepart('city'), 2600)
          }
        }
      },
      exit: () => (this.insideTimer = 0),
    })
    this.trigger({
      id: 'nag', min: v3(-6.5, 0.5, 1.6), max: v3(6.5, 3, 2.4),
      enter: () => {
        if (!S.is('station.boardOk') && this.boardNag <= 0 && S.is('station.introDone')) {
          this.boardNag = 6
          this.game.say('列车长', S.has('ticket') ? (S.is('ticket.punched') ? '请把车票给我看看。' : '车票还没检过。') : '车票。', 2.5)
        }
      },
    })

    // 收音机桥
    const self = this
    const bridge: RadioBridge = {
      get freq() { return self.radio.freq },
      setFreq(f: number) { self.setRadio(f) },
      get signal() { return Math.max(0, 1 - Math.abs(self.radio.freq - 88.0) / 0.6) },
      get text() { return self.radioText() },
    }
    bridges.radio = bridge
    this.own(() => {
      if (bridges.radio === bridge) bridges.radio = null
      this.radio.static?.stop()
      this.refl?.dispose()
    })

    B.build(R, 'station')
    this.syncState()
  }

  private buildInteractions(punch: Object3D, folder: Object3D) {
    // 车票
    const ticket = makeTicket()
    ticket.position.set(-5.35, PLAT_Y + 0.485, 6.5)
    ticket.rotation.y = 0.35
    this.root.add(ticket)
    this.ticketMesh = ticket
    this.item({
      id: 'ticket', pos: v3(-5.35, PLAT_Y + 0.5, 6.5), radius: 0.3, label: '长椅上的车票', verb: '拾取',
      enabled: () => !S.has('ticket') && !S.is('ticket.got'),
      use: () => {
        S.set('ticket.got')
        this.game.pickup('ticket')
        ticket.visible = false
        this.game.say('', '末班 0000 次 · 零号站台 · 23:59 发车。目的地一栏是空的。', 4)
      },
      highlight: ticket,
    })
    // 电子钟
    this.item({
      id: 'clock', pos: v3(-2.6, CANOPY.y - 1.1, 5.2), radius: 0.8, range: 4.5, label: '故障的电子钟', verb: '检查',
      use: () => {
        S.set('station.clock')
        this.clockGlitch = 1.4
        this.game.fx.glitch = 0.6
        this.game.sfx('tick', v3(-2.6, CANOPY.y - 1.1, 5.2))
        setTimeout(() => this.game.say('', '有那么一瞬间，钟面跳成了 23:59——又立刻回到了 00:00。', 4.5), 700)
      },
    })
    // 时刻表
    this.item({
      id: 'timetable', pos: v3(0, 3.5, 9.3), radius: 1.4, range: 5, label: '发车时刻表', verb: '阅读',
      use: () => {
        S.set('station.timetable')
        this.game.read({
          title: '发车时刻 · DEPARTURES', sub: '澄川北站 · 零号站台', kind: 'note',
          body: ['20:15　普通 1203 次　滨江　　已发车', '21:40　普通 1207 次　南港　　已发车', '22:55　快速 880 次　 澄川东　已发车', '■■:■■　末班 0000 次　———— 　零号站台', '末班车的发车时刻被雨水晕开了，只剩下两道模糊的墨迹。', '底部印着一行小字：零号线广播 · FM 88.0'],
        })
      },
    })
    // 售票窗口告示
    this.item({
      id: 'notice', pos: v3(8, PLAT_Y + 1.55, 9.3), radius: 0.8, label: '售票窗口的告示', verb: '阅读',
      use: () => {
        S.set('station.notice')
        this.game.read({
          title: '失物招领', sub: '贴在售票窗口玻璃上的手写告示', kind: 'note',
          body: ['遗失物品已存放在候车室 7 号储物柜。', '柜门密码为末班车的发车时刻（四位数）。', '请自行领取，领取后请将柜门关好。', '——站务室　00:00'],
        })
      },
    })
    // 储物柜 7
    this.item({
      id: 'locker', pos: v3(-17.6 + 2 * 0.62, PLAT_Y + 1.16, WAIT.z1 - 0.6), radius: 0.4, label: '储物柜 07', verb: () => (S.is('station.locker') ? '已打开' : '输入密码'),
      enabled: () => !S.is('station.locker'),
      use: () => {
        this.game.keypad('locker', '储物柜 07 · 四位密码', 4, (d) => {
          if (d.join('') === '2359') {
            S.set('station.locker')
            this.game.sfx('locker', v3(-16.4, 2, 16))
            this.game.sfx('success')
            this.game.say('', '咔哒。柜门弹开了。', 2.5)
            return true
          }
          return false
        })
      },
    })
    this.item({
      id: 'archive1', pos: folder.position.clone(), radius: 0.22, label: '牛皮纸档案袋', verb: '阅读',
      enabled: () => S.is('station.locker') && !S.get().archives.includes('a1'),
      use: () => {
        folder.visible = false
        this.game.archive('a1')
      },
      highlight: folder,
    })
    this.item({
      id: 'punch', pos: punch.position.clone(), radius: 0.2, label: '检票钳', verb: '拾取',
      enabled: () => S.is('station.locker') && !S.is('punch.got'),
      use: () => {
        S.set('punch.got')
        punch.visible = false
        this.game.pickup('punch')
        this.game.say('', '一把黄铜检票钳。打开背包（Tab），把它和车票组合起来。', 4.5)
      },
      highlight: punch,
    })
    // 失落的车票：候车室长椅下
    const lost = makeTicket(0xd8c8a0)
    lost.position.set(-17.6, PLAT_Y + 0.02, 11.45)
    lost.rotation.y = 1.1
    this.root.add(lost)
    this.item({
      id: 'lost1', pos: lost.position.clone(), radius: 0.3, range: 2.2, label: '长椅下的旧车票', verb: '拾取',
      enabled: () => !S.get().collectibles.includes('t1'),
      use: () => {
        lost.visible = false
        this.game.collect('t1')
      },
      highlight: lost,
    })
    lost.visible = !S.get().collectibles.includes('t1')
    // 收音机
    this.item({
      id: 'radio', pos: v3(9.0, PLAT_Y + 1.13, 10.25), radius: 0.35, label: '旧收音机', verb: '调频',
      use: () => {
        S.set('station.radioSeen')
        this.ensureStatic()
        this.game.openRadio()
      },
    })
    // 售货机
    this.item({
      id: 'vend', pos: v3(17, PLAT_Y + 1.2, 8.3), radius: 0.6, label: '自动售货机', verb: '检查',
      use: () => {
        this.game.sfx('deny', v3(17, 2, 8.3))
        this.game.say('', '全部售罄。玻璃后面只剩一排排空格子，像被人一格一格地取走了。', 4)
      },
    })
    // 车站广播（站台中段，靠近立面的喇叭）
    this.item({
      id: 'speaker', pos: v3(-30, 6.6, 9.0), radius: 0.8, range: 6, label: '站台广播喇叭', verb: '倾听',
      use: () => {
        this.game.sfx('chime', v3(-30, 6.6, 9))
        this.game.audio.murmur(3.2, v3(-30, 6.6, 9))
        setTimeout(() => this.game.say('车站广播', '……开往终点站的末班 0000 次，即将从零号站台发车……', 4), 1500)
      },
    })
  }

  private ensureStatic() {
    if (!this.radio.static) this.radio.static = this.game.audio.noiseLoop('white', 'bandpass', 2200, 0.6, 0, v3(9.0, PLAT_Y + 1.13, 10.25))
  }

  private setRadio(f: number) {
    this.radio.freq = Math.round(f * 10) / 10
    this.ensureStatic()
    const sig = Math.max(0, 1 - Math.abs(this.radio.freq - 88.0) / 0.6)
    this.radio.static?.gain(0.07 * (1 - sig) + 0.01, 0.05)
    this.radio.static?.freq?.(1600 + this.radio.freq * 12)
    if (Math.abs(this.radio.freq - 88.0) < 0.05 && !this.radio.played) {
      this.radio.played = true
      this.radio.playing = 0.01
      this.game.sfx('chime', v3(9.0, PLAT_Y + 1.13, 10.25), 0.6)
      RADIO_SECRET.forEach((line, i) => setTimeout(() => {
        this.game.audio.murmur(3.0, v3(9.0, PLAT_Y + 1.13, 10.25), 0.08)
        this.game.say('零号线广播', line, 3.6)
      }, 1800 + i * 3900))
      setTimeout(() => {
        S.set('station.radio')
        this.game.toast('隐藏故事', '零号线广播')
        this.game.refresh()
      }, 1800 + RADIO_SECRET.length * 3900)
    }
  }

  private radioText() {
    const sig = Math.max(0, 1 - Math.abs(this.radio.freq - 88.0) / 0.6)
    if (sig > 0.9) return this.radio.played ? '零号线广播 · 正在播放' : '零号线广播'
    if (sig > 0.3) return '……隐约有人在说话……'
    return '沙沙的静电声'
  }

  /** 读档 / 状态变化后同步场景（柜门、车票、车门阻挡） */
  private syncState() {
    this.ticketMesh.visible = !S.is('ticket.got') && !S.has('ticket')
    this.lockerOpen = S.is('station.locker') ? 1 : 0
    this.lockerItems[0].visible = !S.get().archives.includes('a1')
    this.lockerItems[1].visible = !S.is('punch.got')
  }

  update(dt: number, t: number) {
    const g = this.game
    // 车门阻挡
    const ok = S.is('station.boardOk') || S.num('travel.count') > 0
    for (const c of this.doorBlocks) c.enabled = !ok
    this.boardNag -= dt
    // 柜门
    const lt = S.is('station.locker') ? 1 : 0
    this.lockerOpen += (lt - this.lockerOpen) * (1 - Math.exp(-dt * 4))
    this.lockerDoor.rotation.y = -this.lockerOpen * 1.9
    // 钟
    if (this.clockGlitch > 0) {
      this.clockGlitch -= dt
      const k = Math.floor(this.clockGlitch * 9) % 3
      this.clock.draw(this.clockGlitch > 0.9 ? (k === 0 ? '23:59' : '00:00') : this.clockGlitch > 0.4 ? '23:59' : '00:00', '', 0.8 + Math.random() * 0.2)
    } else {
      const blink = Math.sin(t * 3.1) > 0.97 ? 0.3 : 1
      this.clock.draw('00:00', '', blink)
    }
    // 闪电
    this.nextBolt -= dt
    if (this.nextBolt <= 0) {
      this.nextBolt = 12 + Math.random() * 22
      this.boltT = 0
      const s = 0.6 + Math.random() * 0.5
      g.flash(s, 1.2 + Math.random() * 2.8)
      this.flashLevel = s
    }
    if (this.boltT >= 0) {
      this.boltT += dt
      const k = this.boltT < 0.08 ? 1 : this.boltT < 0.18 ? 0.25 : this.boltT < 0.3 ? 0.8 : Math.exp(-(this.boltT - 0.3) * 8)
      this.flashLevel = k
      if (this.boltT > 1.5) this.boltT = -1
    } else this.flashLevel *= Math.exp(-dt * 5)
    this.lightning.intensity = this.flashLevel * 3.5
    this.sky.uniforms.uTime.value = t
    this.sky.uniforms.uFlash.value = this.flashLevel
    // 雾片
    for (const f of this.fogCards) {
      f.position.x += f.userData.v * dt
      if (f.position.x > 260) f.position.x -= 470
      f.quaternion.copy(g.camera.quaternion)
    }
    // 灯泡轻微闪烁
    this.bulbMats.forEach((m, i) => (m.emissiveIntensity = 8 * (i === 4 && Math.sin(t * 11) * Math.sin(t * 3.7) > 0.6 ? 0.2 : 1)))
    // 雨：相机位置换算到世界局部坐标
    this.camLocal.copy(g.camera.position)
    this.root.worldToLocal(this.camLocal)
    const head = g.train.group.position
    this.headV.set(head.x + 27.3, 1.65, 0, g.train.headlight.intensity > 100 ? 1 : 0)
    // 车头灯位置也要换算（列车出站时世界在移动）
    const hl = new Vector3(head.x + 27.3, 1.65, 0)
    this.root.worldToLocal(hl)
    this.headV.set(hl.x, hl.y, hl.z, this.headV.w)
    this.rain.update(t, this.camLocal, this.flashLevel, this.headV)
    for (const w of this.wet) w.uTime.value = t
    // 声音：雨棚下 / 室内 / 车厢里雨声变闷
    const b = g.player.body
    const inTrain = Train.inside(b.x, b.y, b.z) || !g.docked
    const indoors = (b.x > WAIT.x0 && b.x < WAIT.x1 && b.z > WAIT.z0) || (b.x > OFFICE.x0 && b.x < OFFICE.x1 && b.z > OFFICE.z0)
    const underRoof = b.x > CANOPY.x0 && b.x < CANOPY.x1 && b.z > CANOPY.z0
    g.audio.setRain(1, inTrain ? 0.85 : indoors ? 0.75 : underRoof ? 0.25 : 0)
    g.audio.setWind(inTrain || indoors ? 0.1 : 0.35, 0.3)
    g.audio.setOpenness(inTrain ? 0.55 : 1)
    if (this.radio.static) {
      const d = Math.hypot(b.x - 9, b.z - 10.2)
      if (d > 12) { this.radio.static.stop(); this.radio.static = null }
    }
  }

  preRender(renderer: WebGLRenderer, camera: PerspectiveCamera) {
    if (!this.refl) return
    const size = this.game.renderSize
    // 平面高度换算到场景坐标（列车出站时世界在移动）
    const p = new Vector3(0, PLAT_Y, 0).applyMatrix4(this.root.matrixWorld)
    if (Math.abs(camera.position.x - p.x) > 200) return
    const scene = this.root.parent as Scene | null
    if (!scene) return
    this.refl.render(renderer, scene, camera, size.w, size.h, p.y)
  }

  onDepart() {
    this.game.say('', '站台缓缓向后退去。雨打在车窗上。', 3.5)
  }

  // ---------------- 开场电影镜头 ----------------
  async intro() {
    const g = this.game
    const train = g.train
    const cond = g.conductor
    S.set('station.intro')
    g.player.teleport(-6, PLAT_Y, 5.9, 0, 0)
    cond.group.visible = false
    train.setDoors(false)
    train.door = 0
    const X0 = -440
    const trainX = (t: number) => (t >= 26 ? 0 : X0 * Math.pow(1 - Math.max(0, t) / 26, 2.3))
    const trainV = (t: number) => (t >= 26 ? 0 : (-X0 * 2.3 * Math.pow(1 - Math.max(0, t) / 26, 1.3)) / 26)
    let T = 0
    const drive = (dt: number) => {
      T += dt
      train.group.position.x = trainX(T)
      train.externalSpeed = trainV(T)
      train.externalBraking = T > 14
      train.setHeadlight(T > 2 ? Math.min(1, (T - 2) / 2) : 0)
    }
    train.group.position.x = X0
    g.setFade(1, true)
    g.setEyes(1)
    const nose = () => v3(train.group.position.x + 27.5, 2.0, 0)
    // 过场事件全部按镜头进度触发（不用 setTimeout），跳过时 tick(1) 会把它们补齐
    const once = new Set<string>()
    const at = (key: string, cond: boolean, fn: () => void) => {
      if (cond && !once.has(key)) {
        once.add(key)
        fn()
      }
    }
    const shots: Shot[] = [
      {
        dur: 7, from: [v3(-46, 3.0, 6.2), v3(-50, 2.6, 5.4)], look: [v3(-200, 1.2, 1.5), v3(-190, 1.8, 0.5)], fov: [44, 38], ease: 'linear',
        start: () => {
          g.setFade(0)
          g.say('', '00:00', 3)
        },
        tick: (p, dt) => {
          drive(dt)
          at('bolt', p > 0.55, () => g.flash(1.1, 1.6))
        },
      },
      {
        dur: 7, from: [v3(-40.5, 1.32, 2.35), v3(-40.8, 1.28, 2.3)], look: [v3(-150, 1.8, -0.4), v3(-95, 1.9, 0)], fov: [38, 34], ease: 'linear',
        tick: (p, dt) => {
          drive(dt)
          at('horn', p > 0.25, () => g.sfx('horn', nose(), 0.9))
        },
      },
      {
        dur: 5.5, from: [v3(-36, 1.55, 3.4), v3(-35, 1.6, 3.6)], look: [v3(-52, 2.3, 0), v3(-34, 2.2, 0), v3(-14, 2.0, 0)], fov: [46, 52], ease: 'linear',
        tick: (_p, dt) => drive(dt),
      },
      {
        dur: 6.5, from: [v3(-9, 2.3, 4.6), v3(-3, 2.2, 4.4), v3(2.6, 2.1, 4.2)], look: [v3(-6, 2.3, 0), v3(0, 2.2, 0), v3(5.5, 2.1, 0)], fov: [50, 46], ease: 'inOut',
        tick: (_p, dt) => drive(dt),
      },
      {
        dur: 5.5, from: [v3(7.6, 2.05, 4.9), v3(7.2, 1.95, 4.4)], look: [v3(5.6, 2.1, 1.4), v3(5.5, 2.0, 1.5)], fov: [42, 38], ease: 'out',
        start: () => {
          T = 26
          drive(0)
          train.externalSpeed = 0
        },
        tick: (p, dt) => {
          drive(dt)
          at('doors', p > 0.13, () => {
            train.setDoors(true)
            g.sfx('doorOpen', v3(5.5, 2, 1.5))
          })
          at('cond', p > 0.4, () => {
            cond.place(train.group, 5.5, FLOOR_Y, 0.7, 0)
            cond.group.visible = true
          })
        },
      },
      {
        dur: 1.6, from: [v3(7.2, 1.95, 4.4)], look: [v3(5.5, 2.0, 1.5)], fov: [38, 38],
        start: () => g.setFade(1),
      },
      {
        dur: 5.5, from: [v3(-6, PLAT_Y + 1.25, 6.45), v3(-6, PLAT_Y + 1.32, 6.35)], look: [v3(-5.5, PLAT_Y + 0.9, 4.0), v3(-3, PLAT_Y + 1.6, 1.5)], fov: [60, 70], ease: 'inOut',
        start: () => {
          cond.place(this.root, 6.7, PLAT_Y, 2.45, -Math.PI / 2)
          g.setFade(0, true)
          g.setEyes(0)
        },
        tick: (p) => {
          // 睁眼、闭上、再睁开
          const e = p < 0.25 ? p / 0.25 * 0.35 : p < 0.38 ? 0.35 - (p - 0.25) / 0.13 * 0.3 : Math.min(1, 0.05 + (p - 0.38) / 0.5)
          g.setEyes(e)
        },
      },
    ]
    await g.cinematic(shots, { letterbox: true, skippable: true })
    // 跳过或播完：保证最终状态一致
    T = 26
    drive(0)
    train.externalSpeed = 0
    train.externalBraking = false
    train.setDoors(true)
    train.door = Math.max(train.door, 0.99)
    train.setHeadlight(0.15)
    cond.place(this.root, 6.7, PLAT_Y, 2.45, -Math.PI / 2)
    cond.group.visible = true
    g.setFade(0, true)
    g.setEyes(1)
    g.player.teleport(-6, PLAT_Y, 5.9, 0.15, -0.08)
    S.set('station.introDone')
    g.moment('rain')
    g.say('', '你在长椅上醒来。雨很大。手边好像放着什么。', 4)
    if (!S.is('station.controlsShown')) {
      S.set('station.controlsShown')
      setUI({ controlsCard: true })
      setTimeout(() => setUI({ controlsCard: false }), 9000)
    }
    g.refresh()
  }
}

/** 车票模型 */
export function makeTicket(color = 0xe9dfc6) {
  const tex = textTexture({ w: 512, h: 256, bg: '#' + color.toString(16).padStart(6, '0'), border: '#8a6a3a', lines: [{ text: '末班 0000 次', size: 0.16, color: '#3a2a1a', y: 0.3 }, { text: '零号站台 · 23:59', size: 0.11, color: '#5a4a3a', y: 0.55 }, { text: '目的地 ________', size: 0.1, color: '#5a4a3a', y: 0.78 }] })
  const m = new Mesh(boxGeo(0.16, 0.003, 0.08), [std({ color }), std({ color }), new MeshStandardMaterial({ map: tex, roughness: 0.8 }), std({ color }), std({ color }), std({ color })])
  return m
}

/** 检票钳模型 */
export function makePunch() {
  const g = new Group()
  const brass = std({ color: 0xc29a56, rough: 0.3, metal: 1 })
  const a = new Mesh(boxGeo(0.14, 0.02, 0.025), brass)
  a.rotation.y = 0.12
  g.add(a)
  const b = new Mesh(boxGeo(0.14, 0.02, 0.025), brass)
  b.rotation.y = -0.12
  b.position.z = 0.03
  g.add(b)
  const h = new Mesh(new CylinderGeometry(0.012, 0.012, 0.03, 10), brass)
  h.position.set(0.07, 0, 0.015)
  g.add(h)
  return g
}

