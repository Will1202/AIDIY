// 世界 1：倒悬都市 / The Inverted City
// 黄昏的天空城。头顶 34 米处，另一座城市倒挂在天上。两座城之间靠断桥与反重力塔相连。
// 核心机制：重力翻转（站进光柱）+ 绕桥轴旋转的桥段（桥面必须朝向你的脚）。
// 谜题链：电车站找到重力电池 → 方位仪 C1 转正下层桥段 → 取出电池（桥段锁定）→ 重力塔翻转到上层
//        → 方位仪 C2 把上层桥段转到 180° → 进入核心塔取得碎片 → 翻转回下层 → 回到列车。
import {
  AdditiveBlending, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, IcosahedronGeometry, Matrix4, Mesh,
  MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Scene, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3, InstancedMesh,
} from 'three'
import { World, v3 } from '../World'
import { Batcher, boxGeo, glassMat, glowMat, std, trs, yieldFrame } from '../shared/kit'
import { TEX } from '../shared/textures'
import { textTexture, MONO, signBoard } from '../shared/text'
import { makeCloudSea, makeSky, windowize } from '../shared/sky'
import { itemModel } from '../shared/itemModels'
import { segmentBoxes, type SegmentDef } from '../../puzzles/bridge'
import { S } from '../../state/store'
import type { Collider } from '../../physics/collision'
import type { Shot } from '../../game/api'

const Y = 1.0 // 下层地面
const H = 34 // 上层地面（倒悬：玩家站在楼板底面）
const SEG_A: SegmentDef = { cx: 0, cy: Y - 0.2, cz: 40, halfW: 1.6, halfL: 6, thick: 0.4, finH: 2.4, railH: 1.1 }
const SEG_B: SegmentDef = { cx: 0, cy: H + 0.2, cz: 83, halfW: 1.6, halfL: 6, thick: 0.4, finH: 2.4, railH: 1.1 }
const PYLON = { x: 0, z: 63, r: 2.0 }
const C1 = v3(2.9, Y, 27.2)
const C2 = v3(2.9, H, 73.0)

export class InvertedCity extends World {
  readonly id = 'city' as const
  private sky!: ReturnType<typeof makeSky>
  private clouds!: ReturnType<typeof makeCloudSea>
  private upperPivot = new Group()
  private upper = new Group()
  private segA = new Group()
  private segB = new Group()
  private colA: Collider[] = []
  private colB: Collider[] = []
  private visA = 1
  private visB = 0
  private cellMesh!: Object3D
  private cellSpots: { tram: Vector3; C1: Vector3; C2: Vector3 } = { tram: v3(-11.5, Y + 1.25, 22), C1: v3(C1.x, Y + 1.25, C1.z), C2: v3(C2.x, H - 1.25, C2.z) }
  private beam!: Mesh
  private rings: Mesh[] = []
  private fragment!: Object3D
  private crane!: Mesh
  private flipCool = 0
  private sun!: DirectionalLight
  private darkM = std({ color: 0x1c2224, rough: 0.5, metal: 0.5 })
  private dialLamps: { A: MeshStandardMaterial; B: MeshStandardMaterial } = { A: glowMat(0x204040, 1), B: glowMat(0x204040, 1) }
  private arrivalT = 0
  private firstArrival = false

  constructor() {
    super()
    this.env.background = new Color(0xe8b89a)
    this.env.fogColor = new Color(0xd9b8a4)
    this.env.fogDensity = 0.0045
    this.env.score = 'city'
    this.env.interior = 0.35
    this.env.fx = { exposure: 1.0, bloom: 0.5, bloomThreshold: 1.25, vignette: 0.38, grain: 0.02, saturation: 1.05, contrast: 1.04, tint: new Color(1.02, 1.0, 0.98), lift: new Color(0.02, 0.015, 0.03) }
    this.spawn = { x: 0, y: Y, z: 6, yaw: 0 }
    this.approachLength = 620
    this.approachTime = 26
    this.departLength = 600
    this.departTime = 13
  }

  envScene() {
    const s = new Scene()
    const sky = makeSky({ top: new Color(0.35, 0.55, 0.7), mid: new Color(1.4, 1.0, 0.75), bottom: new Color(0.9, 0.7, 0.6), sun: new Vector3(-0.8, 0.25, 0.3), sunColor: new Color(3, 2.2, 1.4), sunSize: 0.05, radius: 50, disk: 'wide' })
    s.add(sky.mesh)
    return s
  }

  async build() {
    const R = this.root
    const q = this.q
    const B = new Batcher()
    const UB = new Batcher()
    // ---------- 材质 ----------
    const ivory = std({ color: 0xe8e0d0, map: TEX.concrete(), rough: 0.7 })
    const stone = std({ color: 0xcfc6b4, map: TEX.tiles(), rough: 0.6 })
    const brass = std({ color: 0xc9a35a, rough: 0.28, metal: 1, map: TEX.brushed() })
    const teal = std({ color: 0x2f6f6c, rough: 0.35, metal: 0.6 })
    const dark = std({ color: 0x2a2a30, rough: 0.6, metal: 0.4 })
    const rock = std({ color: 0x8a7464, map: TEX.stone(), normalMap: TEX.stoneNormal(), rough: 0.95 })
    const towerA = windowize(std({ color: 0xe6dccb, map: TEX.concrete(), rough: 0.6 }), new Color(1.1, 0.75, 0.4), 0.3)
    const towerB = windowize(std({ color: 0x9fb7b4, rough: 0.35, metal: 0.4 }), new Color(0.5, 0.9, 1.0), 0.25)
    const towerC = windowize(std({ color: 0xc8a888, map: TEX.concrete(), rough: 0.7 }), new Color(1.2, 0.7, 0.35), 0.4, 3.6, 2.6)
    const glass = glassMat(0x9fd8d4, 0.22)

    // ---------- 天空与云海 ----------
    this.sky = makeSky({ top: new Color(0.18, 0.32, 0.46), mid: new Color(1.15, 0.72, 0.52), bottom: new Color(0.55, 0.4, 0.42), sun: new Vector3(-0.85, 0.16, 0.25), sunColor: new Color(2.4, 1.6, 0.9), sunSize: 0.035 })
    R.add(this.sky.mesh)
    this.clouds = makeCloudSea(-70, new Color(1.25, 0.95, 0.82), new Color(0.45, 0.35, 0.42))
    ;(this.clouds.mat.uniforms.uFogCol.value as Color).copy(this.env.fogColor)
    R.add(this.clouds.mesh)

    // ---------- 高架轨道（向两端延伸进云里） ----------
    B.box(dark, 0, -0.35, 0, 1300, 0.5, 4.4, 0, 3)
    for (const z of [-0.72, 0.72]) B.box(brass, 0, 0.06, z, 1300, 0.12, 0.08, 0, 4)
    const sl = new InstancedMesh(boxGeo(0.26, 0.14, 2.6), std({ color: 0x3a3430, rough: 0.8 }), 1700)
    const m4 = new Matrix4()
    for (let i = 0; i < 1700; i++) { m4.makeTranslation(-650 + i * 0.765, -0.04, 0); sl.setMatrixAt(i, m4) }
    R.add(sl)
    for (let x = -640; x <= 640; x += 46) {
      B.cyl(ivory, x, -38, 0, 1.1, 75, 12, 0.8)
      B.box(ivory, x, -1.0, 0, 3.2, 1.2, 5)
    }
    this.col.slab(0, -0.1, 1300, 4.4, -1, 0, { surface: 'stone', tag: 'track', safe: false })

    // ---------- 站台 ----------
    B.box(stone, 0, Y - 0.5, 4.85, 66, 1.0, 6.5, 0, 2)
    B.box(brass, 0, Y + 0.01, 1.75, 66, 0.02, 0.18, 0, 1, false)
    this.col.slab(0, 4.85, 66, 6.5, -2, Y, { surface: 'marble', tag: 'platform' })
    // 玻璃雨棚 + 黄铜骨架
    for (let x = -30; x <= 30; x += 6) {
      B.cyl(brass, x, Y + 2.2, 7.4, 0.08, 4.4, 10)
      B.boxR(brass, x, Y + 4.25, 5.2, 0.06, 0.06, 5.0, 0.12, 0, 0)
      this.col.cyl(x, 7.4, 0.12, Y, Y + 4.4, { surface: 'metal' })
    }
    const canopy = new Mesh(new PlaneGeometry(64, 5.2), glass)
    canopy.rotation.x = -Math.PI / 2 + 0.12
    canopy.position.set(0, Y + 4.3, 5.2)
    R.add(canopy)
    // 站名
    const nameTex = textTexture({ w: 1024, h: 200, bg: '#1d3a3a', border: '#c9a35a', lines: [{ text: '倒 悬 都 市', size: 0.38, color: '#efe8d8', y: 0.42 }, { text: 'THE INVERTED CITY · ELEV 3,400 M', size: 0.13, color: '#c9a35a', font: MONO, y: 0.8, spacing: 0.25 }] })
    for (const x of [-18, 18]) {
      const n = signBoard(new MeshStandardMaterial({ map: nameTex, roughness: 0.4 }), 4, 0.8)
      n.position.set(x, Y + 3.2, 7.35)
      R.add(n)
    }
    // 站台两端栏杆（广场开口以外）
    for (const [a, b] of [[-33, -16], [16, 33]] as [number, number][]) {
      this.rail(B, brass, (a + b) / 2, 8.05, b - a, 0.1, Y)
    }
    this.rail(B, brass, -33, 4.85, 0.1, 6.5, Y)
    this.rail(B, brass, 33, 4.85, 0.1, 6.5, Y)
    await yieldFrame()

    // ---------- 广场 L1 ----------
    B.box(stone, 0, Y - 0.6, 18, 32, 1.2, 20, 0, 3)
    this.col.slab(0, 18, 32, 20, -3, Y, { surface: 'marble', tag: 'L1' })
    this.island(B, rock, 0, 18, 30, 20, Y - 1.2, 40)
    // 广场边缘栏杆（桥头留口）
    this.rail(B, brass, -16, 18, 0.1, 20, Y)
    this.rail(B, brass, 16, 18, 0.1, 20, Y)
    this.rail(B, brass, -8.85, 28, 14.3, 0.1, Y)
    this.rail(B, brass, 8.85, 28, 14.3, 0.1, Y)
    // 广场中央的倒影池（向上的城市映在水里）
    const pool = new Mesh(new CylinderGeometry(3.2, 3.2, 0.05, 48), std({ color: 0x1a3a40, rough: 0.05, metal: 0.8, env: 2 }))
    pool.position.set(0, Y + 0.03, 15)
    R.add(pool)
    B.cyl(ivory, 0, Y + 0.15, 15, 3.45, 0.3, 48)
    this.col.cyl(0, 15, 3.45, Y, Y + 0.3, { tag: 'poolRim', surface: 'marble' })
    // 电车站（重力电池在这里）
    B.box(teal, -11.5, Y + 2.9, 22, 5.5, 0.15, 4.2)
    for (const [x, z] of [[-14, 20.2], [-9, 20.2], [-14, 23.8], [-9, 23.8]] as [number, number][]) {
      B.cyl(brass, x, Y + 1.45, z, 0.07, 2.9, 8)
      this.col.cyl(x, z, 0.1, Y, Y + 2.9)
    }
    B.box(ivory, -13.8, Y + 0.45, 22, 0.5, 0.06, 3.0)
    const tramSign = signBoard(new MeshStandardMaterial({ map: textTexture({ w: 512, h: 160, bg: '#0e2a2a', lines: [{ text: '电车 · 上城方向', size: 0.3, color: '#efe8d8', y: 0.4 }, { text: 'TRAM · UPPER CITY', size: 0.14, color: '#8fd8d2', font: MONO, y: 0.78 }] }) }), 1.6, 0.5)
    tramSign.position.set(-11.5, Y + 2.55, 20.1)
    R.add(tramSign)
    // 一节停摆的电车（翻倒在站旁，车顶朝下，转向架朝天）
    const tram = new Group()
    const TB = new Batcher()
    const tealBody = std({ color: 0x2f6f6c, rough: 0.4, metal: 0.4 })
    const cream = std({ color: 0xe9dfc6, rough: 0.5 })
    const tramWin = glowMat(0xffb070, 0.22)
    const tramGlass = std({ color: 0x10181a, rough: 0.15, metal: 0.6, env: 1.6 })
    TB.box(tealBody, 0, 0, 0, 2.2, 2.4, 6)
    TB.box(cream, 0, -0.42, 0, 2.24, 0.34, 6.02)
    TB.box(cream, 0, 1.08, 0, 2.24, 0.1, 6.02)
    TB.box(tealBody, 0, 1.32, 0, 1.3, 0.24, 4.6)
    TB.box(dark, 0, -1.26, 0, 1.9, 0.14, 5.4)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = -2.1 + i * 1.4
        if (sx < 0 && i === 1) continue
        TB.add(new PlaneGeometry(1.0, 0.82), sx > 0 ? tramWin : tramGlass, trs(sx * 1.112, 0.36, z, 0, sx * Math.PI / 2, 0), false)
        TB.box(cream, sx * 1.1, 0.36, z, 0.05, 0.9, 1.1)
      }
    }
    TB.box(dark, -1.105, -0.05, -0.7, 0.04, 2.0, 0.9) // 车门（-x 侧）
    for (const sz of [-1, 1]) {
      TB.add(new PlaneGeometry(1.5, 0.8), tramGlass, trs(0, 0.42, sz * 3.012, 0, sz > 0 ? 0 : Math.PI, 0), false)
      TB.box(dark, 0, -1.0, sz * 3.08, 2.0, 0.22, 0.16)
      TB.box(dark, 0, 0.98, sz * 3.03, 1.4, 0.24, 0.06)
      // 转向架与车轮（翻倒后朝天）
      TB.box(dark, 0, -1.48, sz * 1.9, 1.7, 0.3, 1.9)
      for (const wx of [-0.86, 0.86]) for (const wz of [-0.6, 0.6]) {
        TB.add(new CylinderGeometry(0.34, 0.34, 0.12, 18), brass, trs(wx, -1.62, sz * 1.9 + wz, 0, 0, Math.PI / 2))
      }
    }
    TB.build(tram, 'tram')
    for (const sz of [-1, 1]) {
      const hl = new Mesh(new SphereGeometry(0.11, 12, 8), glowMat(0xffe0b0, sz > 0 ? 0.0 : 1.4))
      hl.position.set(0.7, -0.7, sz * 3.04)
      tram.add(hl)
    }
    const dest = new Mesh(new PlaneGeometry(1.3, 0.22), new MeshStandardMaterial({ map: textTexture({ w: 512, h: 88, bg: '#0a1414', lines: [{ text: '7 路 · 上城', size: 0.55, color: '#ffb84a', y: 0.52 }] }) }))
    dest.position.set(0, 0.98, 3.065)
    tram.add(dest)
    tram.position.set(-11.5, Y + 1.2, 11.5)
    tram.rotation.set(0, 0.3, Math.PI)
    R.add(tram)
    // 从车顶掉下来的受电弓，斜躺在地上
    const panto = new Group()
    const PB = new Batcher()
    PB.box(brass, 0, 0, -0.6, 0.05, 0.05, 1.3, 0)
    PB.boxR(brass, 0, 0.35, -0.3, 0.05, 0.05, 0.9, 0.8, 0, 0)
    PB.boxR(brass, 0, 0.35, 0.3, 0.05, 0.05, 0.9, -0.8, 0, 0)
    PB.box(dark, 0, 0.62, 0, 1.4, 0.06, 0.12)
    PB.build(panto, 'panto')
    panto.position.set(-8.4, Y + 0.03, 13.6)
    panto.rotation.set(0, 0.9, 1.35)
    R.add(panto)
    this.col.box(-11.5, Y + 1.2, 11.5, 2.4, 2.4, 6.2, { yaw: 0.3, tag: 'tram', surface: 'metal' })
    // 城市档案馆
    this.room(B, ivory, 12.5, 22.5, 6.5, 8, Y, 4.2, 'w')
    const desk = new Mesh(boxGeo(1.6, 0.8, 0.8), std({ color: 0x5a3a24, map: TEX.wood(), rough: 0.5 }))
    desk.position.set(13.2, Y + 0.4, 24.5)
    R.add(desk)
    this.col.slab(13.2, 24.5, 1.6, 0.8, Y, Y + 0.8, { tag: 'desk', surface: 'wood' })
    const doc = new Mesh(boxGeo(0.3, 0.02, 0.22), std({ color: 0xe8dcc0, rough: 0.9 }))
    doc.position.set(13.1, Y + 0.82, 24.4)
    R.add(doc)
    const archSign = new Mesh(new PlaneGeometry(2.2, 0.5), new MeshStandardMaterial({ map: textTexture({ w: 640, h: 150, bg: '#e8e0d0', lines: [{ text: '城市档案馆', size: 0.42, color: '#2a3a3a', y: 0.45 }, { text: 'CITY ARCHIVES', size: 0.16, color: '#6a7a78', font: MONO, y: 0.82 }] }) }))
    archSign.position.set(9.18, Y + 3.5, 22.5)
    archSign.rotation.y = -Math.PI / 2
    R.add(archSign)
    const archLight = new PointLight(0xffc890, 20, 9, 1.6)
    archLight.position.set(12.8, Y + 3.2, 22.5)
    R.add(archLight)
    // 广场陈设：花坛里的树、路灯、面向倒影池的长椅（都避开了通往桥头、电车站和档案馆的路线）
    this.props = {
      ivory, brass, dark,
      soil: std({ color: 0x3a2c22, rough: 1 }),
      bark: std({ color: 0x5a4030, map: TEX.wood(), rough: 0.8 }),
      leaves: new MeshStandardMaterial({ color: 0x7d8f58, roughness: 0.85, flatShading: true }),
      blossom: new MeshStandardMaterial({ color: 0xe6b4a4, roughness: 0.8, flatShading: true }),
      globe: glowMat(0xffd8a0, 3.2),
      seat: std({ color: 0x6a4a30, map: TEX.wood(), rough: 0.6 }),
    }
    const P = this.props
    ;([[-6.5, 9.5, P.leaves], [6.5, 9.5, P.blossom], [6.2, 12.8, P.leaves], [-5.6, 26.2, P.blossom]] as [number, number, MeshStandardMaterial][])
      .forEach(([x, z, m], i) => this.planterTree(B, x, z, Y, 1, m, i))
    for (const [x, z] of [[-4.5, 8.5], [4.5, 8.5], [4.5, 21.5], [-4.5, 20.5]] as [number, number][]) this.lampPost(B, x, z, Y, 1)
    for (const sx of [-1, 1] as const) this.parkBench(B, sx * 5.3, 15, Y, 1, sx)
    // 广场周围的塔楼（装饰 + 碰撞）
    const towers: [number, number, number, number, number, MeshStandardMaterial][] = [
      [-24, 12, 7, 7, 26, towerA], [-23, 26, 6, 8, 38, towerC], [24, 11, 7, 6, 30, towerA], [24, 27, 8, 8, 44, towerB],
      [-34, 40, 9, 9, 52, towerB], [34, 46, 8, 8, 34, towerA], [-30, 70, 10, 10, 60, towerC], [30, 72, 9, 9, 48, towerB],
    ]
    for (const [x, z, w, d, h, m] of towers) {
      B.box(m, x, Y + h / 2, z, w, h, d, 0, 4)
      B.box(brass, x, Y + h + 0.6, z, w * 0.7, 1.2, d * 0.7)
      B.cyl(brass, x, Y + h + 4, z, 0.25, 6, 8, 0.05)
      if (Math.abs(x) < 26) this.col.slab(x, z, w, d, Y - 2, Y + h, { tag: 'tower' })
      this.island(B, rock, x, z, w + 4, d + 4, Y - 1.0, 26)
    }
    await yieldFrame()

    // ---------- 下层桥 B1：F1 + 旋转桥段 S + F2 ----------
    for (const [z0, z1] of [[28, 34], [46, 52]] as [number, number][]) {
      B.box(stone, 0, Y - 0.2, (z0 + z1) / 2, 3.2, 0.4, z1 - z0)
      this.col.slab(0, (z0 + z1) / 2, 3.2, z1 - z0, Y - 0.4, Y, { surface: 'stone', tag: 'bridgeFixed' })
      this.rail(B, brass, -1.55, (z0 + z1) / 2, 0.1, z1 - z0, Y)
      this.rail(B, brass, 1.55, (z0 + z1) / 2, 0.1, z1 - z0, Y)
    }
    this.buildSegment(this.segA, SEG_A, stone, brass, dark)
    R.add(this.segA)
    for (let i = 0; i < 5; i++) this.colA.push(this.col.box(0, 0, 0, 1, 1, 1, { tag: 'segA', surface: i === 0 ? 'stone' : 'metal' }))
    // 桥头方位仪 C1
    this.controlPillar(B, brass, teal, C1, 1, this.dialLamps.A)

    // ---------- 中央岛 L2 + 重力塔 ----------
    B.box(stone, 0, Y - 0.6, 63, 24, 1.2, 22, 0, 3)
    this.col.slab(0, 63, 24, 22, -3, Y, { surface: 'marble', tag: 'L2' })
    this.island(B, rock, 0, 63, 22, 20, Y - 1.2, 46)
    this.rail(B, brass, -12, 63, 0.1, 22, Y)
    this.rail(B, brass, 12, 63, 0.1, 22, Y)
    this.rail(B, brass, -6.85, 52, 10.3, 0.1, Y)
    this.rail(B, brass, 6.85, 52, 10.3, 0.1, Y)
    this.rail(B, brass, 0, 74, 24, 0.1, Y)
    this.pylon(B, brass, teal, Y, 1)
    await yieldFrame()

    // ---------- 上层倒悬城市（放在可旋转的枢轴组里：驶入时它从云海下翻上来） ----------
    // 枢轴放在地平线高度、城市后方：驶入开始时上城被“扶正”立在远处（从车窗平视就能看见），
    // 随后整座城向上翻起、越过头顶，最终倒挂在 34 米高的天上
    this.upperPivot.position.set(0, 17, 120)
    this.upper.position.set(0, -17, -120)
    this.upperPivot.add(this.upper)
    R.add(this.upperPivot)
    const U = this.upper
    // U2（重力塔正上方）
    UB.box(stone, 0, H + 0.6, 63, 24, 1.2, 22, 0, 3)
    this.col.slab(0, 63, 24, 22, H, H + 3, { surface: 'marble', tag: 'U2' })
    this.island(UB, rock, 0, 63, 22, 20, H + 1.2, 40, true)
    this.urail(UB, brass, -12, 63, 0.1, 22)
    this.urail(UB, brass, 12, 63, 0.1, 22)
    this.urail(UB, brass, 0, 52, 24, 0.1)
    this.urail(UB, brass, -6.85, 74, 10.3, 0.1)
    this.urail(UB, brass, 6.85, 74, 10.3, 0.1)
    this.pylon(UB, brass, teal, H, -1)
    // U2 上倒挂的楼（倒悬玩家眼中是“立着”的楼）
    const hang: [number, number, number, number, number, MeshStandardMaterial][] = [
      [-8.5, 56.5, 5, 5, 9, towerB], [8.5, 57, 5, 6, 12, towerA], [-9, 70.5, 4, 5, 7, towerC], [9, 69.5, 4.5, 4.5, 10, towerB],
    ]
    for (const [x, z, w, d, h, m] of hang) {
      UB.box(m, x, H - h / 2, z, w, h, d, 0, 4)
      this.col.slab(x, z, w, d, H - h, H, { tag: 'hangTower' })
    }
    // 倒写的字（只有倒过来才读得懂）
    const muralTex = textTexture({ w: 1024, h: 512, bg: '#e8e0d0', grain: 0.05, flip: false, lines: [
      { text: '脚 下 即 天 空', size: 0.16, color: '#2a3a3a', y: 0.32 },
      { text: '让桥面朝向你的脚', size: 0.09, color: '#4a5a58', y: 0.6 },
      { text: 'WHERE YOU STAND IS THE SKY', size: 0.05, color: '#7a8a88', font: MONO, y: 0.8, spacing: 0.2 },
    ] })
    const mural = new Mesh(new PlaneGeometry(4.2, 2.1), new MeshStandardMaterial({ map: muralTex, roughness: 0.7 }))
    // 贴在倒挂楼 (-8.5, 56.5) 朝向 +x 的墙面上；整体倒置（rotation.z = π）
    mural.position.set(-5.99, H - 2.2, 56.5)
    mural.rotation.set(Math.PI, Math.PI / 2, 0)
    U.add(mural)
    // 失落的车票（倒悬的矮台上）
    UB.box(ivory, -9.5, H - 0.3, 64, 1.6, 0.6, 1.6)
    this.col.slab(-9.5, 64, 1.6, 1.6, H - 0.6, H, { tag: 'ledge', surface: 'stone' })
    const crane = new Mesh(new IcosahedronGeometry(0.12, 0), std({ color: 0xe9dfc6, rough: 0.8 }))
    crane.scale.set(1.4, 0.5, 0.8)
    crane.position.set(-9.5, H - 0.66, 64)
    U.add(crane)
    this.crane = crane
    // 上层桥 B2：F3 + 旋转桥段 S2 + F4
    for (const [z0, z1] of [[74, 77], [89, 91]] as [number, number][]) {
      UB.box(stone, 0, H + 0.2, (z0 + z1) / 2, 3.2, 0.4, z1 - z0)
      this.col.slab(0, (z0 + z1) / 2, 3.2, z1 - z0, H, H + 0.4, { surface: 'stone', tag: 'bridgeFixedU' })
      this.urail(UB, brass, -1.55, (z0 + z1) / 2, 0.1, z1 - z0)
      this.urail(UB, brass, 1.55, (z0 + z1) / 2, 0.1, z1 - z0)
    }
    this.buildSegment(this.segB, SEG_B, stone, brass, dark)
    U.add(this.segB)
    for (let i = 0; i < 5; i++) this.colB.push(this.col.box(0, 0, 0, 1, 1, 1, { tag: 'segB', surface: i === 0 ? 'stone' : 'metal' }))
    this.controlPillar(UB, brass, teal, C2, -1, this.dialLamps.B)
    // U3 + 倒悬的核心塔
    UB.box(stone, 0, H + 0.6, 101, 20, 1.2, 20, 0, 3)
    this.col.slab(0, 101, 20, 20, H, H + 3, { surface: 'marble', tag: 'U3' })
    this.island(UB, rock, 0, 101, 18, 18, H + 1.2, 36, true)
    this.urail(UB, brass, -10, 101, 0.1, 20)
    this.urail(UB, brass, 10, 101, 0.1, 20)
    this.urail(UB, brass, 0, 111, 20, 0.1)
    this.urail(UB, brass, -5.85, 91, 8.3, 0.1)
    this.urail(UB, brass, 5.85, 91, 8.3, 0.1)
    // 核心塔：从 U3 底面垂下 30 米，塔根处有入口（朝 -z）
    const tz = 102
    // 入口门洞与内部房间（倒悬玩家的“地板”是 y = H）
    const room = { x0: -3, x1: 3, z0: 99, z1: 105, ceil: H - 5 }
    UB.box(towerB, 0, (H - 30 + room.ceil) / 2, tz, 7, room.ceil - (H - 30), 7, 0, 4)
    UB.box(towerB, -3.25, (room.ceil + H) / 2, tz, 0.5, H - room.ceil, 7, 0, 4)
    UB.box(towerB, 3.25, (room.ceil + H) / 2, tz, 0.5, H - room.ceil, 7, 0, 4)
    UB.box(towerB, 0, (room.ceil + H) / 2, room.z1 + 0.25, 6, H - room.ceil, 0.5, 0, 4)
    UB.box(towerB, -2.25, (room.ceil + H) / 2, room.z0 - 0.25, 1.5, H - room.ceil, 0.5, 0, 4)
    UB.box(towerB, 2.25, (room.ceil + H) / 2, room.z0 - 0.25, 1.5, H - room.ceil, 0.5, 0, 4)
    UB.box(towerB, 0, (room.ceil + H - 2.4) / 2, room.z0 - 0.25, 1.5, H - 2.4 - room.ceil, 0.5, 0, 4)
    UB.box(brass, 0, room.ceil + 0.05, tz, 5.8, 0.1, 5.8)
    UB.box(brass, 0, H - 30.5, tz, 4, 1, 4)
    UB.cyl(brass, 0, H - 34, tz, 0.4, 7, 10, 0.05)
    this.col.slab(-2.25, room.z0 - 0.1, 1.5, 0.2, room.ceil, H, { tag: 'coreWall' })
    this.col.slab(2.25, room.z0 - 0.1, 1.5, 0.2, room.ceil, H, { tag: 'coreWall' })
    this.col.slab(0, room.z0 - 0.1, 1.5, 0.2, room.ceil, H - 2.4, { tag: 'coreWall' })
    this.col.slab(-3.5, tz, 0.4, 7, room.ceil, H, { tag: 'coreWall' })
    this.col.slab(3.5, tz, 0.4, 7, room.ceil, H, { tag: 'coreWall' })
    this.col.slab(0, room.z1 + 0.1, 7, 0.2, room.ceil, H, { tag: 'coreWall' })
    this.col.slab(0, tz, 7, 7, room.ceil - 25, room.ceil, { tag: 'coreBody' })
    // 塔身外侧的碰撞（门洞两侧）
    this.col.slab(-3.3, 98.3, 0.8, 0.6, H - 30, H, { tag: 'coreOuter' })
    this.col.slab(3.3, 98.3, 0.8, 0.6, H - 30, H, { tag: 'coreOuter' })
    // 碎片：悬在塔心，三道旋转的环
    this.fragment = itemModel('fragment', '#9fe6df')
    this.fragment.position.set(0, H - 1.7, tz + 0.5)
    this.fragment.scale.setScalar(0.5)
    U.add(this.fragment)
    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(new TorusGeometry(0.9 + i * 0.32, 0.03, 8, 48), brass)
      ring.position.copy(this.fragment.position)
      ring.userData.speed = 0.6 + i * 0.35
      ring.userData.axis = i
      U.add(ring)
      this.rings.push(ring)
    }
    const coreLight = new PointLight(0x8fffe8, 18, 10, 1.6)
    coreLight.position.set(0, H - 2.5, tz)
    U.add(coreLight)
    // 更远处装饰性的倒悬城区
    const farUpper: [number, number, number, number, number, MeshStandardMaterial][] = [
      [-36, 60, 12, 12, 40, towerA], [36, 66, 10, 12, 30, towerC], [-30, 104, 10, 10, 34, towerB], [30, 100, 12, 10, 46, towerA],
      [0, 140, 18, 12, 50, towerC], [-50, 130, 10, 10, 26, towerB], [52, 132, 12, 10, 38, towerA], [-18, 30, 8, 8, 22, towerB], [20, 24, 8, 8, 28, towerC],
    ]
    for (const [x, z, w, d, h, m] of farUpper) {
      UB.box(m, x, H + 4 - h / 2, z, w, h, d, 0, 4)
      UB.box(brass, x, H + 4 - h - 0.6, z, w * 0.6, 1.2, d * 0.6)
      this.island(UB, rock, x, z, w + 5, d + 5, H + 4, 22, true)
    }
    // 上城广场的陈设：和下城一样的花坛、路灯、长椅，只是全部倒挂在楼板底面
    this.lampPost(UB, -4.5, 56, H, -1)
    this.lampPost(UB, 4.5, 56, H, -1)
    this.lampPost(UB, -4.5, 70, H, -1)
    this.lampPost(UB, 4.5, 69.5, H, -1)
    this.planterTree(UB, -5, 59.6, H, -1, P.leaves, 5)
    this.planterTree(UB, 5, 66, H, -1, P.blossom, 6)
    this.parkBench(UB, 5.3, 62.6, H, -1, 1)
    this.parkBench(UB, -5.3, 68, H, -1, -1)
    for (const [x, z] of [[-5.5, 94], [5.5, 94], [-6.5, 108.5], [6.5, 108.5]] as [number, number][]) this.lampPost(UB, x, z, H, -1)
    this.planterTree(UB, -7, 101, H, -1, P.blossom, 7)
    this.planterTree(UB, 7, 101, H, -1, P.leaves, 8)
    UB.build(U, 'upper')
    await yieldFrame()

    // ---------- 反重力环（两城之间缓慢旋转） ----------
    const ringMat = std({ color: 0xc9a35a, rough: 0.25, metal: 1 })
    const coreM = glowMat(0x8fffe8, 3)
    for (const [x, y, z, r] of [[-20, 17, 40, 4], [22, 14, 60, 5], [-26, 20, 88, 3.5], [16, 22, 104, 3]] as [number, number, number, number][]) {
      const g = new Group()
      const t1 = new Mesh(new TorusGeometry(r, 0.18, 10, 64), ringMat)
      const t2 = new Mesh(new TorusGeometry(r * 0.72, 0.12, 10, 48), ringMat)
      t2.rotation.x = Math.PI / 2
      const c = new Mesh(new SphereGeometry(r * 0.12, 16, 12), coreM)
      g.add(t1, t2, c)
      g.position.set(x, y, z)
      R.add(g)
      this.rings.push(t1, t2)
      t1.userData.speed = 0.2
      t1.userData.axis = 1
      t2.userData.speed = 0.35
      t2.userData.axis = 0
    }
    // 远处的下层城区（装饰）
    const farLower: [number, number, number, number, number, MeshStandardMaterial][] = [
      [-60, 30, 14, 12, 30, towerA], [-70, 80, 12, 14, 46, towerB], [64, 34, 12, 12, 36, towerC], [70, 90, 14, 10, 28, towerA], [0, 250, 20, 14, 40, towerB], [-60, 240, 12, 12, 52, towerA], [64, 245, 10, 12, 34, towerC],
    ]
    for (const [x, z, w, d, h, m] of farLower) {
      B.box(m, x, Y + h / 2, z, w, h, d, 0, 4)
      this.island(B, rock, x, z, w + 6, d + 6, Y - 1, 30)
    }

    // ---------- 灯光 ----------
    const hemi = new HemisphereLight(0x9fc4d8, 0xffb48a, 1.1)
    R.add(hemi)
    this.sun = new DirectionalLight(0xffd2a0, 3.2)
    this.sun.position.set(-90, 34, 40)
    this.sun.target.position.set(0, 10, 55)
    this.sun.castShadow = q.shadows
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
    const sc = this.sun.shadow.camera
    sc.left = -70; sc.right = 70; sc.top = 60; sc.bottom = -50; sc.near = 10; sc.far = 260
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.04
    this.sun.shadow.radius = 3
    R.add(this.sun, this.sun.target)
    // 云海反射上来的暖光（照亮倒悬城市的底面）
    const bounce = new DirectionalLight(0xffa070, 1.4)
    bounce.position.set(20, -60, 30)
    bounce.target.position.set(0, 20, 60)
    R.add(bounce, bounce.target)
    const pyl = new PointLight(0x8fffe8, 30, 16, 1.6)
    pyl.position.set(PYLON.x, Y + 3, PYLON.z)
    R.add(pyl)

    // ---------- 重力电池 ----------
    this.cellMesh = itemModel('cell', '#8fd8d2')
    this.cellMesh.scale.setScalar(0.5)
    R.add(this.cellMesh)

    B.build(R, 'city')
    this.buildInteractions()
    this.syncState(true)
  }

  // ---------------- 建造辅助 ----------------
  private props!: {
    ivory: MeshStandardMaterial; brass: MeshStandardMaterial; dark: MeshStandardMaterial; soil: MeshStandardMaterial; bark: MeshStandardMaterial
    leaves: MeshStandardMaterial; blossom: MeshStandardMaterial; globe: MeshStandardMaterial; seat: MeshStandardMaterial
  }

  /** 花坛与树。y 是地面高度，g = 1 立在地上，g = -1 倒挂在上城楼板底面 */
  private planterTree(B: Batcher, x: number, z: number, y: number, g: 1 | -1, m: MeshStandardMaterial, i: number) {
    const P = this.props
    B.box(P.ivory, x, y + g * 0.3, z, 1.6, 0.6, 1.6)
    B.box(P.brass, x, y + g * 0.62, z, 1.66, 0.04, 1.66)
    B.box(P.soil, x, y + g * 0.58, z, 1.4, 0.04, 1.4)
    B.cyl(P.bark, x, y + g * 1.7, z, g > 0 ? 0.12 : 0.07, 2.3, 8, g > 0 ? 0.07 : 0.12)
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + i
      const r = 0.75 + ((k + i) % 3) * 0.18
      B.add(new IcosahedronGeometry(r, 1), m, trs(x + Math.cos(a) * 0.45, y + g * (2.9 + k * 0.32), z + Math.sin(a) * 0.45, a, a * 0.7, 0))
    }
    this.col.slab(x, z, 1.6, 1.6, Math.min(y, y + g * 0.62), Math.max(y, y + g * 0.62), { walkable: false, tag: 'planter' })
  }

  /** 双头路灯 */
  private lampPost(B: Batcher, x: number, z: number, y: number, g: 1 | -1) {
    const P = this.props
    B.cyl(P.dark, x, y + g * 0.15, z, 0.2, 0.3, 12)
    B.cyl(P.brass, x, y + g * 1.9, z, 0.06, 3.6, 8)
    B.box(P.brass, x, y + g * 3.62, z, 0.9, 0.05, 0.05)
    for (const dx of [-0.42, 0.42]) {
      B.add(new SphereGeometry(0.17, 14, 10), P.globe, trs(x + dx, y + g * 3.42, z))
      B.cyl(P.brass, x + dx, y + g * 3.6, z, 0.1, 0.06, 10)
    }
    this.col.cyl(x, z, 0.2, Math.min(y, y + g * 3.7), Math.max(y, y + g * 3.7), { tag: 'lamp' })
  }

  /** 长椅：座面沿 z，靠背在 side 一侧（side = 1 靠背在 +x） */
  private parkBench(B: Batcher, x: number, z: number, y: number, g: 1 | -1, side: 1 | -1) {
    const P = this.props
    B.box(P.seat, x, y + g * 0.46, z, 0.5, 0.06, 1.9)
    B.box(P.seat, x + side * 0.24, y + g * 0.8, z, 0.06, 0.5, 1.9)
    for (const dz of [-0.8, 0.8]) B.box(P.dark, x, y + g * 0.22, z + dz, 0.46, 0.44, 0.08)
    this.col.slab(x, z, 0.56, 1.9, Math.min(y, y + g * 0.5), Math.max(y, y + g * 0.5), { surface: 'wood', tag: 'bench' })
  }

  private rail(B: Batcher, m: MeshStandardMaterial, x: number, z: number, sx: number, sz: number, y: number) {
    B.box(m, x, y + 1.05, z, Math.max(sx, 0.08), 0.06, Math.max(sz, 0.08))
    const len = Math.max(sx, sz)
    const n = Math.max(1, Math.round(len / 1.5))
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5
      B.box(m, x + (sx > sz ? t * sx : 0), y + 0.52, z + (sz > sx ? t * sz : 0), 0.05, 1.04, 0.05)
    }
    this.col.slab(x, z, Math.max(sx, 0.2), Math.max(sz, 0.2), y, y + 1.1, { tag: 'rail', walkable: false })
  }

  /** 倒悬的栏杆（挂在 H 平面下方） */
  private urail(B: Batcher, m: MeshStandardMaterial, x: number, z: number, sx: number, sz: number) {
    B.box(m, x, H - 1.05, z, Math.max(sx, 0.08), 0.06, Math.max(sz, 0.08))
    const len = Math.max(sx, sz)
    const n = Math.max(1, Math.round(len / 1.5))
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5
      B.box(m, x + (sx > sz ? t * sx : 0), H - 0.52, z + (sz > sx ? t * sz : 0), 0.05, 1.04, 0.05)
    }
    this.col.slab(x, z, Math.max(sx, 0.2), Math.max(sz, 0.2), H - 1.1, H, { tag: 'rail', walkable: false })
  }

  /** 浮岛底下的岩体（倒锥） */
  private island(B: Batcher, m: MeshStandardMaterial, x: number, z: number, w: number, d: number, y: number, depth: number, inverted = false) {
    const r = Math.max(w, d) * 0.62
    const g = new CylinderGeometry(r, r * 0.12, depth, 9, 3)
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
      const k = 1 + Math.sin(px * 1.7 + pz * 0.9) * 0.08 + Math.sin(py * 0.7) * 0.06
      pos.setXYZ(i, px * k * (w / Math.max(w, d)), py, pz * k * (d / Math.max(w, d)))
    }
    g.computeVertexNormals()
    const s = inverted ? -1 : 1
    B.add(g, m, new Matrix4().makeRotationX(inverted ? Math.PI : 0).setPosition(x, y - s * depth / 2, z))
  }

  /** 室内房间（四面墙 + 顶，门在一侧） */
  private room(B: Batcher, m: MeshStandardMaterial, cx: number, cz: number, w: number, d: number, y: number, h: number, door: 'w') {
    B.box(m, cx, y + h, cz, w + 0.4, 0.3, d + 0.4)
    B.box(m, cx + w / 2, y + h / 2, cz, 0.3, h, d)
    B.box(m, cx, y + h / 2, cz - d / 2, w, h, 0.3)
    B.box(m, cx, y + h / 2, cz + d / 2, w, h, 0.3)
    this.col.slab(cx + w / 2, cz, 0.3, d, y, y + h)
    this.col.slab(cx, cz - d / 2, w, 0.3, y, y + h)
    this.col.slab(cx, cz + d / 2, w, 0.3, y, y + h)
    if (door === 'w') {
      const x = cx - w / 2
      B.box(m, x, y + h / 2, cz - d / 4 - 0.6, 0.3, h, d / 2 - 1.2)
      B.box(m, x, y + h / 2, cz + d / 4 + 0.6, 0.3, h, d / 2 - 1.2)
      B.box(m, x, y + h - 0.6, cz, 0.3, 1.2, 2.4)
      this.col.slab(x, cz - d / 4 - 0.6, 0.3, d / 2 - 1.2, y, y + h)
      this.col.slab(x, cz + d / 4 + 0.6, 0.3, d / 2 - 1.2, y, y + h)
    }
    this.col.slab(cx, cz, w, d, y - 1, y, { surface: 'marble', tag: 'roomFloor' })
  }

  /** 方位仪：底座 + 电池槽 + 刻度盘 */
  private controlPillar(B: Batcher, brass: MeshStandardMaterial, teal: MeshStandardMaterial, p: Vector3, g: 1 | -1, lamp: MeshStandardMaterial) {
    B.box(teal, p.x, p.y + g * 0.55, p.z, 0.7, 1.1, 0.7)
    B.box(brass, p.x, p.y + g * 1.12, p.z, 0.8, 0.06, 0.8)
    B.box(this.darkM, p.x, p.y + g * 0.07, p.z, 0.86, 0.14, 0.86)
    for (const cx of [-0.34, 0.34]) for (const cz of [-0.34, 0.34]) B.box(brass, p.x + cx, p.y + g * 0.6, p.z + cz, 0.05, 1.0, 0.05)
    B.add(new CylinderGeometry(0.16, 0.5, 0.16, 4), brass, trs(p.x, p.y + g * 1.23, p.z, g > 0 ? 0 : Math.PI, Math.PI / 4, 0))
    B.box(this.darkM, p.x - 0.352, p.y + g * 0.85, p.z, 0.02, 0.56, 0.56)
    this.col.slab(p.x, p.z, 0.8, 0.8, Math.min(p.y, p.y + g * 1.15), Math.max(p.y, p.y + g * 1.15), { tag: 'pillar', walkable: false })
    const dial = new Mesh(new CylinderGeometry(0.22, 0.22, 0.05, 32), lamp)
    dial.position.set(p.x - 0.36, p.y + g * 0.85, p.z)
    dial.rotation.z = Math.PI / 2
    ;(g > 0 ? this.root : this.upper).add(dial)
    const plate = new Mesh(new PlaneGeometry(0.6, 0.3), new MeshStandardMaterial({ map: textTexture({ w: 256, h: 128, bg: '#13302e', lines: [{ text: '桥 梁 方 位 仪', size: 0.2, color: '#c9e8e4', y: 0.35 }, { text: g > 0 ? 'BRIDGE · LOWER' : 'BRIDGE · UPPER', size: 0.12, color: '#8fd8d2', font: MONO, y: 0.72 }] }) }))
    plate.position.set(p.x - 0.36, p.y + g * 0.45, p.z)
    plate.rotation.set(g > 0 ? 0 : Math.PI, -Math.PI / 2, 0)
    ;(g > 0 ? this.root : this.upper).add(plate)
  }

  /** 重力塔：环形底座、四根立柱、贯穿两城的光柱 */
  private pylon(B: Batcher, brass: MeshStandardMaterial, teal: MeshStandardMaterial, y: number, g: 1 | -1) {
    B.cyl(teal, PYLON.x, y + g * 0.08, PYLON.z, PYLON.r + 0.6, 0.16, 48)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const x = PYLON.x + Math.cos(a) * (PYLON.r + 0.3), z = PYLON.z + Math.sin(a) * (PYLON.r + 0.3)
      B.cyl(brass, x, y + g * 2.2, z, 0.12, 4.4, 10)
      this.col.cyl(x, z, 0.15, Math.min(y, y + g * 4.4), Math.max(y, y + g * 4.4))
    }
    B.box(brass, PYLON.x, y + g * 0.55, PYLON.z, 0.5, 1.1, 0.5)
    this.col.slab(PYLON.x, PYLON.z, 0.5, 0.5, Math.min(y, y + g * 1.1), Math.max(y, y + g * 1.1), { tag: 'pylonConsole', walkable: false })
    if (g > 0) {
      const beamMat = new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uI: { value: 1 } },
        vertexShader: `varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uTime; uniform float uI; varying vec3 vL; varying vec3 vN; varying vec3 vV;
          void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float bands = 0.6 + 0.4 * sin(vL.y * 1.4 - uTime * 3.0);
          gl_FragColor = vec4(vec3(0.5, 1.0, 0.92) * e * bands * 0.35 * uI, 1.0); }`,
        blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide,
      })
      this.beam = new Mesh(new CylinderGeometry(PYLON.r, PYLON.r, H - Y, 32, 1, true), beamMat)
      this.beam.position.set(PYLON.x, (Y + H) / 2, PYLON.z)
      this.root.add(this.beam)
    }
  }

  /** 旋转桥段的模型：桥面（铺装 + 栏杆）在 +y，桁架鳍板在 -y */
  private buildSegment(grp: Group, d: SegmentDef, deckM: MeshStandardMaterial, brass: MeshStandardMaterial, dark: MeshStandardMaterial) {
    const SB = new Batcher()
    SB.box(deckM, 0, 0, 0, d.halfW * 2, d.thick, d.halfL * 2)
    SB.box(brass, 0, d.thick / 2 + 0.01, 0, 0.12, 0.02, d.halfL * 2)
    for (const s of [-1, 1]) {
      SB.box(brass, s * (d.halfW - 0.06), d.thick / 2 + 1.05, 0, 0.06, 0.06, d.halfL * 2)
      for (let i = 0; i <= 8; i++) SB.box(brass, s * (d.halfW - 0.06), d.thick / 2 + 0.52, -d.halfL + i * (d.halfL / 4), 0.05, 1.04, 0.05)
    }
    // 鳍板涂黄黑警示斜纹：一眼看出“这一面不能走”
    const hazard = std({ color: 0xffffff, map: TEX.hazard(), rough: 0.6, metal: 0.2 })
    for (const s of [-1, 1]) SB.box(hazard, 0, -d.thick / 2 - d.finH / 2, s * (d.halfL - 0.2), d.halfW * 2, d.finH, 0.4, 0, 0.8)
    // 桁架：斜撑
    for (let i = 0; i < 6; i++) {
      const z = -d.halfL + 1 + i * ((d.halfL * 2 - 2) / 5)
      SB.boxR(dark, 0, -d.thick / 2 - 0.9, z, d.halfW * 2 - 0.2, 0.12, 0.12, 0, 0, 0)
      SB.boxR(dark, -d.halfW + 0.3, -d.thick / 2 - 0.9, z, 0.1, 1.8, 0.1, 0.5, 0, 0)
      SB.boxR(dark, d.halfW - 0.3, -d.thick / 2 - 0.9, z, 0.1, 1.8, 0.1, -0.5, 0, 0)
    }
    SB.box(dark, 0, -d.thick / 2 - 1.8, 0, 0.2, 0.2, d.halfL * 2)
    SB.build(grp, 'segment')
    grp.position.set(d.cx, d.cy, d.cz)
  }

  // ---------------- 交互 ----------------
  private buildInteractions() {
    const g = this.game
    // 重力电池
    this.item({
      id: 'cell', pos: this.cellSpots.tram.clone(), radius: 0.45, label: '漂浮的电池', verb: '拾取',
      enabled: () => !S.is('city.cellGot'),
      use: () => {
        S.set('city.cellGot')
        g.pickup('cell')
        g.say('', '电池在手心里往上拽，像要回到天上去。', 3.5)
        this.syncState()
      },
    })
    // 方位仪 C1 / C2
    const pillar = (key: 'A' | 'B', p: Vector3, grav: 1 | -1) => {
      const slot = key === 'A' ? 'C1' : 'C2'
      this.item({
        id: `pillar${key}`, pos: v3(p.x, p.y + grav * 1.0, p.z), radius: 0.6, gravity: grav,
        label: () => `桥梁方位仪 · ${(S.num(`city.rot${key}`, key === 'A' ? 1 : 0) * 90) % 360}°`,
        verb: () => (S.flag('city.cellAt') === slot ? '转动 90°' : S.has('cell') ? '放入重力电池' : '检查'),
        use: () => {
          if (S.flag('city.cellAt') === slot) {
            if (this.playerOnSegment(key)) {
              g.sfx('deny')
              g.say('', '桥上有人。方位仪拒绝转动。', 2.5)
              return
            }
            const r = (S.num(`city.rot${key}`, key === 'A' ? 1 : 0) + 1) % 4
            S.set(`city.rot${key}`, r)
            g.sfx('servo', v3(0, p.y, key === 'A' ? SEG_A.cz : SEG_B.cz))
            g.sfx('heavy', v3(0, p.y, key === 'A' ? SEG_A.cz : SEG_B.cz), 0.5)
            this.syncState()
            return
          }
          if (S.has('cell')) {
            S.take('cell')
            S.set('city.cellAt', slot)
            g.sfx('insert', p)
            g.sfx('powerUp', p, 0.6)
            g.say('', '方位仪亮了。刻度盘可以转动了。', 3)
            this.syncState()
            return
          }
          g.sfx('deny', p)
          g.say('', '刻度盘纹丝不动。底座上有一个空着的电池槽，形状像一枚圆柱。', 4)
        },
      })
      this.item({
        id: `pillarTake${key}`, pos: v3(p.x, p.y + grav * 1.2, p.z + 0.01), radius: 0.3, gravity: grav, label: '方位仪里的重力电池', verb: '取出电池',
        enabled: () => S.flag('city.cellAt') === slot,
        use: () => {
          S.set('city.cellAt', '')
          g.pickup('cell')
          g.sfx('lever', p)
          g.say('', '电池取出后，桥段咔地一声锁死在原位。', 3)
          this.syncState()
        },
      })
    }
    pillar('A', C1, 1)
    pillar('B', C2, -1)
    // 重力塔（下 / 上）
    for (const grav of [1, -1] as const) {
      const y = grav > 0 ? Y : H
      this.item({
        id: `pylon${grav}`, pos: v3(PYLON.x, y + grav * 1.15, PYLON.z), radius: 0.5, gravity: grav, range: 2.8,
        label: '重力塔', verb: grav > 0 ? '启动 · 去往上城' : '启动 · 回到下城',
        blocked: () => {
          const b = g.player.body
          return Math.hypot(b.x - PYLON.x, b.z - PYLON.z) < PYLON.r - 0.3 ? null : '先站进光柱里'
        },
        use: () => this.flip(),
      })
    }
    // 档案
    this.item({
      id: 'archive2', pos: v3(13.1, Y + 0.85, 24.4), radius: 0.3, label: '会议纪要', verb: '阅读',
      use: () => g.archive('a2'),
    })
    // 碎片
    this.item({
      id: 'fragment', pos: v3(0, H - 1.7, 102.5), radius: 0.5, gravity: -1, label: '悬浮的碎片', verb: '取下',
      enabled: () => !S.is('city.fragment'),
      use: () => {
        S.set('city.fragment')
        g.pickup('fragment_city')
        g.sfx('success')
        g.fx.glitch = 0.5
        g.flash(0.4, 99)
        g.say('', '碎片离开环心的一瞬，两座城市同时轻轻震了一下——像是想起了什么。', 5)
        this.syncState()
      },
    })
    // 倒写的字
    this.item({
      id: 'mural', pos: v3(-5.9, H - 2.2, 56.5), radius: 1.4, range: 5, gravity: -1, label: '墙上的字', verb: '阅读',
      use: () => {
        S.set('city.mural')
        g.read({ title: '脚下即天空', sub: '倒悬楼宇墙上的刻字（只有倒过来才读得懂）', kind: 'plaque', body: ['让桥面朝向你的脚。', '在上面的城市里，桥要翻过来才能走。', '——城市规划局 · 上城分局'] })
      },
    })
    // 从下面看那面墙
    this.item({
      id: 'muralBelow', pos: v3(-5.9, H - 2.2, 56.5), radius: 1.4, range: 40, gravity: 1, label: '头顶楼墙上的字', verb: '辨认',
      use: () => g.say('', '字是倒着刻的，从这里看不明白。也许得站到那边去。', 3.5),
    })
    // 失落的车票：纸鹤
    this.item({
      id: 'lost2', pos: v3(-9.5, H - 0.66, 64), radius: 0.3, gravity: -1, label: '一只翅膀朝下的纸鹤', verb: '拾取',
      enabled: () => !S.get().collectibles.includes('t2'),
      use: () => {
        g.collect('t2')
        this.syncState()
      },
    })
    // 电车
    this.item({
      id: 'tram', pos: v3(-11.5, Y + 1.5, 11.5), radius: 2.0, label: '翻倒的电车', verb: '检查',
      use: () => g.say('', '电车车顶朝下躺着，车窗里的灯还亮着。车厢里没有人，座椅上落满了花瓣。', 4.5),
    })
    // 驶入后：出车门的触发
    this.trigger({ id: 'explore', min: v3(-16, 0, 9), max: v3(16, 4, 28), once: true, enter: () => { S.set('city.explored'); g.refresh() } })
    this.trigger({ id: 'L2', min: v3(-12, 0, 52), max: v3(12, 4, 74), enter: () => { if (!S.is('city.reachedL2')) { S.set('city.reachedL2'); g.refresh() } } })
    this.trigger({
      id: 'core', min: v3(-3, H - 3, 99), max: v3(3, H + 0.5, 105),
      enter: () => {
        if (!S.is('city.tower')) {
          S.set('city.tower')
          g.say('', '塔心里很安静。三道铜环围着一枚碎片缓缓转动。', 4)
          g.refresh()
        }
      },
    })
  }

  private playerOnSegment(key: 'A' | 'B') {
    const d = key === 'A' ? SEG_A : SEG_B
    const b = this.game.player.body
    return Math.abs(b.x - d.cx) < d.halfW + 0.6 && Math.abs(b.z - d.cz) < d.halfL + 0.4 && Math.abs(b.y - d.cy) < 4
  }

  private flip() {
    const g = this.game
    if (this.flipCool > 0) return
    this.flipCool = 2.5
    g.sfx('gravity')
    g.fx.glitch = 0.3
    g.player.flipGravity()
    if (g.player.g < 0 && !S.is('city.inverted')) {
      S.set('city.inverted')
      g.say('', '天空在脚下翻了过去。', 3)
      g.refresh()
    }
  }

  /** 由状态重建场景：电池位置、桥段朝向、碎片、纸鹤 */
  private syncState(instant = false) {
    const rotA = S.num('city.rotA', 1), rotB = S.num('city.rotB', 0)
    const place = (cols: Collider[], d: SegmentDef, rot: number) => {
      const boxes = segmentBoxes(d, rot)
      boxes.forEach((bx, i) => {
        const c = cols[i]
        c.cx = (bx.x0 + bx.x1) / 2
        c.cz = (bx.z0 + bx.z1) / 2
        c.hx = (bx.x1 - bx.x0) / 2
        c.hz = (bx.z1 - bx.z0) / 2
        c.minY = bx.y0
        c.maxY = bx.y1
        c.walkable = bx.role === 'deck'
        c.enabled = true
      })
    }
    place(this.colA, SEG_A, rotA)
    place(this.colB, SEG_B, rotB)
    if (instant) {
      this.visA = rotA
      this.visB = rotB
    }
    const at = S.flag('city.cellAt')
    this.cellMesh.visible = !S.has('cell') && (at === 'C1' || at === 'C2' || !S.is('city.cellGot'))
    const spot = at === 'C1' ? this.cellSpots.C1 : at === 'C2' ? this.cellSpots.C2 : this.cellSpots.tram
    if (at === 'C2') {
      this.upper.add(this.cellMesh)
    } else this.root.add(this.cellMesh)
    this.cellMesh.position.copy(spot)
    this.dialLamps.A.emissive.setHex(at === 'C1' ? 0x8fffe8 : 0x203030)
    this.dialLamps.A.emissiveIntensity = at === 'C1' ? 3 : 1
    this.dialLamps.B.emissive.setHex(at === 'C2' ? 0x8fffe8 : 0x203030)
    this.dialLamps.B.emissiveIntensity = at === 'C2' ? 3 : 1
    this.fragment.visible = !S.is('city.fragment')
    this.crane.visible = !S.get().collectibles.includes('t2')
  }

  // ---------------- 每帧 ----------------
  update(dt: number, t: number) {
    const g = this.game
    this.flipCool -= dt
    // 桥段旋转动画（碰撞体在 syncState 时已切换到目标朝向；转动时玩家不在桥上）
    const tA = S.num('city.rotA', 1), tB = S.num('city.rotB', 0)
    const step = (v: number, target: number) => {
      let d = target - v
      while (d > 2) d -= 4
      while (d < -2) d += 4
      const s = Math.sign(d) * Math.min(Math.abs(d), dt * 0.7)
      return v + s
    }
    this.visA = step(this.visA, tA)
    this.visB = step(this.visB, tB)
    this.segA.rotation.z = this.visA * Math.PI / 2
    this.segB.rotation.z = this.visB * Math.PI / 2
    // 动画
    for (const r of this.rings) {
      const s = r.userData.speed as number
      if (r.userData.axis === 0) r.rotation.x += dt * s
      else if (r.userData.axis === 1) r.rotation.y += dt * s
      else r.rotation.z += dt * s
    }
    this.fragment.rotation.y += dt * 0.8
    this.fragment.position.y = H - 1.7 + Math.sin(t * 1.3) * 0.08
    if (this.cellMesh.visible) {
      this.cellMesh.rotation.y += dt * 0.6
      this.cellMesh.position.y += Math.sin(t * 2) * 0.0015
    }
    ;(this.beam.material as ShaderMaterial).uniforms.uTime.value = t
    this.clouds.mat.uniforms.uTime.value = t
    // 声音：高空的风
    g.audio.setRain(0)
    g.audio.setWind(0.55, 0.7)
    g.audio.setOpenness(g.docked ? 1 : 0.6)
    // 驶入时刻（世界倒转）以外，上城保持在最终位置
    if (g.docked) {
      this.upperPivot.rotation.x = 0
      this.sky.mat.uniforms.uFlip.value = 0
    }
  }

  onDocked() {
    this.upperPivot.rotation.x = 0
    this.sky.mat.uniforms.uFlip.value = 0
    if (this.firstArrival) {
      this.firstArrival = false
      this.game.say('列车长', '倒悬都市到了。记得抬头。', 3.5)
    }
  }

  /**
   * Moment 2 · 世界倒转：列车驶近时，上城从云海之下绕到城市背后，再翻到头顶倒挂。
   * 只在第一次到达（或展映回放）时播放；之后上城保持在头顶。
   */
  onApproach(p: number) {
    const first = !S.get().visited.includes('city') || this.forceMoment
    if (p < 0.01) {
      this.firstArrival = first
      this.arrivalT = 0
    }
    if (!first) {
      this.upperPivot.rotation.x = 0
      return
    }
    // 列车开到城市旁边（从车窗正好看得见）时才开始翻转
    const k = Math.min(1, Math.max(0, (p - 0.4) / 0.55))
    const e = k * k * (3 - 2 * k)
    this.upperPivot.rotation.x = Math.PI * (1 - e)
    this.sky.mat.uniforms.uFlip.value = 1 - e
    if (p > 0.4 && p < 0.43 && this.arrivalT === 0) {
      this.arrivalT = 1
      this.game.sfx('heavy', undefined, 0.8)
      this.game.say('', '窗外，整座城市正在翻过来。', 4)
    }
    if (p > 0.75) this.game.moment('invert')
  }

  /** 展映模式强制播放世界倒转 */
  forceMoment = false

  /** 展映：车窗视角 */
  momentShots(): Shot[] {
    return [
      // 坐在靠窗的位置，视线从远处的城市一路抬到头顶
      { dur: 24, from: [v3(0.0, 2.25, 0.55), v3(0.0, 2.1, 0.75)], look: [v3(60, 6, 150), v3(10, 8, 150), v3(0, 40, 140), v3(0, 34, 40)], fov: [70, 78], ease: 'inOut' },
    ]
  }
}

