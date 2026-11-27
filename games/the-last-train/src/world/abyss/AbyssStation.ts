// 世界 2：深海终点站 / The Abyss Station
// 列车驶进海底的玻璃隧道。观测穹顶外是鲸、水母、发光生物、巨型遗迹和一节沉没的车厢。
// 谜题链：被淹的更衣室找到保险丝 → 配电室恢复主电路 → 探照灯照亮三座声碑（得到目标波形）
//        → 声呐把三组频率调准（看波形 / 听拍音）→ 遗迹入口打开 → 升降梯下到遗迹取得碎片。
// 标志性时刻：驶入时车厢灯光熄灭，一头巨鲸贴着车窗缓缓游过，照亮周围的水母。
import {
  AdditiveBlending, BackSide, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Scene, ShaderMaterial, SphereGeometry, SpotLight, Vector2, Vector3, RingGeometry, TorusGeometry, IcosahedronGeometry,
} from 'three'
import { World, v3 } from '../World'
import { Batcher, boxGeo, glassMat, glowMat, std, yieldFrame, trs } from '../shared/kit'
import { TEX } from '../shared/textures'
import { textTexture, MONO } from '../shared/text'
import { Whale, jellyfish, motes } from '../shared/Whale'
import { itemModel } from '../shared/itemModels'
import { SONAR, matches, inBeam } from '../../puzzles/sonar'
import { bridges, type SonarBridge } from '../../systems/bridges'
import { S } from '../../state/store'
import type { Collider } from '../../physics/collision'
import type { LoopHandle } from '../../audio/AudioEngine'
import type { Shot } from '../../game/api'

const Y = 1.0
const DOME = { x: 0, z: 34, r: 12 }
const MONO_POS = [v3(-40, -9, 64), v3(6, -13, 96), v3(46, -10, 58)]
const LIGHT_POS = v3(0, 13.2, 34)
const RUIN_Y = -19

export class AbyssStation extends World {
  readonly id = 'abyss' as const
  private whale!: Whale
  private jelly!: ReturnType<typeof jellyfish>
  private jelly2!: ReturnType<typeof jellyfish>
  private snow!: ReturnType<typeof motes>
  private rays: Mesh[] = []
  private monoliths: { mesh: Mesh; mat: MeshStandardMaterial; tone: LoopHandle | null; lit: number }[] = []
  private search!: SpotLight
  private searchBeam!: Mesh
  private sYaw = 0
  private sPitch = -0.35
  private litTimer = [0, 0, 0]
  private whaleTimer = 0
  private emergency!: PointLight
  private mainLights: PointLight[] = []
  private flood!: SpotLight
  private lampMats: MeshStandardMaterial[] = []
  private power = 0
  private powerSeq = -1
  private consoleMats: MeshStandardMaterial[] = []
  private elevator = new Group()
  private elevCol!: Collider
  private elevY = Y
  private elevTarget = Y
  private elevMoving = false
  private gateGlow!: MeshStandardMaterial
  private lockerDoor!: Group
  private fuseMesh!: Object3D
  private fragment!: Object3D
  private lostTicket!: Mesh
  private sonarTones: (LoopHandle | null)[] = [null, null, null]
  private sonarActive = -1
  private whaleAngle = 0
  private approachWhale = false
  private fuseInMesh!: Mesh
  private leverArm!: Mesh

  constructor() {
    super()
    this.env.background = new Color(0x020a12)
    this.env.fogColor = new Color(0x03141f)
    this.env.fogDensity = 0.02
    this.env.score = 'abyss'
    this.env.openness = 0.6
    this.env.fx = { exposure: 1.15, bloom: 0.85, bloomThreshold: 0.9, vignette: 0.6, grain: 0.035, saturation: 1.0, contrast: 1.05, tint: new Color(0.92, 1.0, 1.06), lift: new Color(0.0, 0.015, 0.03) }
    this.spawn = { x: 0, y: Y, z: 4, yaw: 0 }
    this.approachLength = 540
    this.approachTime = 30
    this.departLength = 520
    this.departTime = 13
  }

  envScene() {
    const s = new Scene()
    const sky = new Mesh(new SphereGeometry(50, 16, 8), new MeshBasicMaterial({ color: new Color(0.02, 0.08, 0.12), side: BackSide }))
    s.add(sky)
    const top = new Mesh(new PlaneGeometry(60, 60), new MeshBasicMaterial({ color: new Color(0.3, 0.7, 0.9) }))
    top.position.y = 30
    top.rotation.x = Math.PI / 2
    s.add(top)
    return s
  }

  async build() {
    const R = this.root
    const q = this.q
    const B = new Batcher()
    const steel = std({ color: 0x8a9aa4, rough: 0.35, metal: 0.9, map: TEX.brushed() })
    const darkSteel = std({ color: 0x2a3640, rough: 0.5, metal: 0.8, map: TEX.grime() })
    const rust = std({ color: 0x7a6a5a, map: TEX.rust(), rough: 0.8, metal: 0.5 })
    const floorM = std({ color: 0x5a6a72, map: TEX.tiles(), rough: 0.45, metal: 0.3 })
    const grate = std({ color: 0x3a4650, rough: 0.6, metal: 0.8 })
    const sand = std({ color: 0x4a5a5a, map: TEX.sand(), normalMap: TEX.sandNormal(), rough: 1 })
    const rock = std({ color: 0x2e3a40, map: TEX.stone(), normalMap: TEX.stoneNormal(), rough: 0.95 })
    const ruinM = std({ color: 0x5a6a6a, map: TEX.stone(), normalMap: TEX.stoneNormal(), rough: 0.9 })
    // 玩家总在隧道 / 穹顶里面：只画内侧面，避免双面透明叠加的满屏开销
    const glass = glassMat(0x6ab8d0, 0.12, 0.02, BackSide)

    // ---------- 海底 ----------
    const seabed = new PlaneGeometry(1400, 900, 140, 90)
    seabed.rotateX(-Math.PI / 2)
    const sp = seabed.getAttribute('position')
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), z = sp.getZ(i)
      const d = Math.hypot(x, (z - 30) * 1.2)
      let h = -6 - Math.max(0, d - 30) * 0.06 + Math.sin(x * 0.03) * 2 + Math.cos(z * 0.045 + x * 0.01) * 2.5 + Math.sin(x * 0.11 + z * 0.07) * 0.6
      if (Math.abs(z) < 8) h = Math.min(h, -1.2)
      sp.setY(i, h)
    }
    seabed.computeVertexNormals()
    const uv = seabed.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 140, uv.getY(i) * 90)
    const bed = new Mesh(seabed, sand)
    bed.position.z = 120
    bed.receiveShadow = true
    R.add(bed)
    // 岩石
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 180
      const x = Math.cos(a) * r, z = 34 + Math.sin(a) * r
      if (Math.abs(z) < 10) continue
      const g = new SphereGeometry(1, 7, 5)
      const s = 2 + Math.random() * 9
      B.add(g, rock, new Matrix4().makeScale(s * (0.8 + Math.random()), s * (0.4 + Math.random() * 0.8), s).setPosition(x, -8 + Math.random() * 2, z))
    }
    // 海带（实例化细长平面，着色器里摆动）
    const kelpGeo = new PlaneGeometry(0.6, 10, 1, 8)
    kelpGeo.translate(0, 5, 0)
    const kelpMat = new MeshStandardMaterial({ color: 0x1a4a3a, roughness: 0.7, side: DoubleSide, emissive: 0x041a12 })
    const kelpU = { uTime: { value: 0 } }
    kelpMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, kelpU)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = position.y / 10.0;
        transformed.x += sin(uTime * 0.8 + instanceMatrix[3].x * 0.3 + position.y * 0.4) * sway * sway * 1.6;
        transformed.z += cos(uTime * 0.6 + instanceMatrix[3].z * 0.2) * sway * sway * 0.8;`)
    }
    this.kelpU = kelpU
    const kelpN = Math.round(500 * q.particles + 120)
    const kelp = new InstancedMesh(kelpGeo, kelpMat, kelpN)
    const m4 = new Matrix4()
    for (let i = 0; i < kelpN; i++) {
      const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 120
      const x = Math.cos(a) * r, z = 34 + Math.sin(a) * r
      if (Math.abs(z) < 9) continue
      const s = 0.6 + Math.random() * 1.2
      m4.makeRotationY(Math.random() * Math.PI).scale(new Vector3(s, s * (0.6 + Math.random()), s)).setPosition(x, -7, z)
      kelp.setMatrixAt(i, m4)
    }
    R.add(kelp)
    await yieldFrame()

    // ---------- 玻璃隧道与站台 ----------
    const TL = 1100
    const tube = new CylinderGeometry(6.4, 6.4, TL, 40, 1, true, -Math.PI / 2, Math.PI)
    tube.rotateZ(Math.PI / 2)
    const tubeMesh = new Mesh(tube, glass)
    tubeMesh.position.set(0, 0.2, 2.2)
    tubeMesh.renderOrder = 3
    R.add(tubeMesh)
    for (let x = -TL / 2; x <= TL / 2; x += 6) {
      const rib = new CylinderGeometry(6.5, 6.5, 0.18, 32, 1, true, -Math.PI / 2, Math.PI)
      rib.rotateZ(Math.PI / 2)
      B.add(rib, darkSteel, new Matrix4().makeTranslation(x, 0.2, 2.2))
    }
    B.box(darkSteel, 0, -0.3, 2.2, TL, 0.6, 12.8, 0, 3)
    for (const z of [-0.72, 0.72]) B.box(steel, 0, 0.06, z, TL, 0.12, 0.08, 0, 4)
    const sl = new InstancedMesh(boxGeo(0.26, 0.14, 2.6), std({ color: 0x2a2a2a, rough: 0.8 }), Math.round(TL / 0.8))
    for (let i = 0; i < sl.count; i++) { m4.makeTranslation(-TL / 2 + i * 0.8, -0.03, 0); sl.setMatrixAt(i, m4) }
    R.add(sl)
    B.box(floorM, 0, Y - 0.5, 4.3, 70, 1, 5.4, 0, 2)
    this.col.slab(0, 4.3, 70, 5.4, -1, Y, { surface: 'metal', tag: 'platform' })
    this.col.slab(-18.3, 7.4, 33.4, 0.4, Y, 7, { tag: 'tubeWall', walkable: false })
    this.col.slab(18.3, 7.4, 33.4, 0.4, Y, 7, { tag: 'tubeWall', walkable: false })
    for (const ex of [-35, 35]) this.col.slab(ex, 4.3, 0.4, 5.4, Y, 7, { tag: 'tubeEnd', walkable: false })
    this.col.slab(0, -2.5, TL, 3, -1, 0, { surface: 'metal', tag: 'bed', safe: false })
    // 站台标识
    const sign = new Mesh(new PlaneGeometry(4.2, 0.8), new MeshStandardMaterial({ map: textTexture({ w: 1024, h: 200, bg: '#04161f', border: '#4cc9ff', lines: [{ text: '深 海 终 点 站', size: 0.38, color: '#cfefff', y: 0.42 }, { text: 'ABYSS STATION · DEPTH 3,200 M', size: 0.13, color: '#4cc9ff', font: MONO, y: 0.8, spacing: 0.25 }] }), emissive: 0xffffff, emissiveIntensity: 0.4 }))
    sign.position.set(-8, Y + 3.2, 7.05)
    sign.rotation.y = Math.PI
    R.add(sign)
    // 通往穹顶的玻璃走廊
    const cor = new CylinderGeometry(1.9, 1.9, 16, 24, 1, true, -Math.PI / 2, Math.PI)
    cor.rotateX(Math.PI / 2)
    cor.rotateZ(Math.PI / 2)
    const corMesh = new Mesh(cor, glass)
    corMesh.position.set(0, Y, 14.5)
    corMesh.rotation.z = Math.PI / 2
    R.add(corMesh)
    for (let z = 7; z <= 22; z += 2.5) {
      const rib = new CylinderGeometry(2.0, 2.0, 0.12, 20, 1, true, 0, Math.PI)
      rib.rotateX(Math.PI / 2)
      B.add(rib, darkSteel, new Matrix4().makeTranslation(0, Y, z))
    }
    B.box(grate, 0, Y - 0.05, 14.5, 3.2, 0.1, 15.5)
    this.col.slab(0, 14.5, 3.4, 15.6, -1, Y, { surface: 'grate', tag: 'corridor' })
    this.col.slab(-1.75, 14.5, 0.2, 15, Y, Y + 3, { tag: 'corWall', walkable: false })
    this.col.slab(1.75, 14.5, 0.2, 15, Y, Y + 3, { tag: 'corWall', walkable: false })
    // 走廊口两侧的隧道墙开口
    await yieldFrame()

    // ---------- 观测穹顶 ----------
    const domeGeo = new SphereGeometry(DOME.r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2)
    const dome = new Mesh(domeGeo, glass)
    dome.position.set(DOME.x, Y, DOME.z)
    dome.renderOrder = 3
    R.add(dome)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const rib = new CylinderGeometry(0.08, 0.08, 1, 6)
      for (let k = 0; k < 10; k++) {
        const t0 = (k / 10) * Math.PI / 2, t1 = ((k + 1) / 10) * Math.PI / 2
        const p0 = new Vector3(Math.cos(t0) * DOME.r * Math.cos(a), Math.sin(t0) * DOME.r, Math.cos(t0) * DOME.r * Math.sin(a))
        const p1 = new Vector3(Math.cos(t1) * DOME.r * Math.cos(a), Math.sin(t1) * DOME.r, Math.cos(t1) * DOME.r * Math.sin(a))
        const mid = p0.clone().add(p1).multiplyScalar(0.5)
        const len = p0.distanceTo(p1)
        const mm = new Matrix4().lookAt(p0, p1, new Vector3(0, 1, 0))
        mm.multiply(new Matrix4().makeRotationX(Math.PI / 2)).multiply(new Matrix4().makeScale(1, len, 1)).setPosition(mid.x + DOME.x, mid.y + Y, mid.z + DOME.z)
        B.add(rib.clone(), darkSteel, mm)
      }
    }
    B.cyl(darkSteel, DOME.x, Y + 12.2, DOME.z, 1.6, 0.6, 24)
    // 穹顶地面：中心留出升降梯井
    const hole = 1.6
    // 地面是一个圆环（中间是升降梯井口，之前是整块圆盘，坐升降梯下去时抬头会看到井口被地板封住）；UV 按 1.2 米一块砖铺
    const floorTop = new RingGeometry(hole + 0.1, DOME.r, 72, 3)
    const fuv = floorTop.getAttribute('uv')
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, (fuv.getX(i) * DOME.r * 2) / 1.2, (fuv.getY(i) * DOME.r * 2) / 1.2)
    B.add(floorTop, floorM, trs(DOME.x, Y, DOME.z, -Math.PI / 2, 0, 0))
    B.add(new CylinderGeometry(DOME.r, DOME.r, 0.3, 72, 1, true), floorM, new Matrix4().makeTranslation(DOME.x, Y - 0.15, DOME.z))
    // 地面镶嵌：两道钢圈、井口的警示环、通往走廊 / 侧室 / 控制台的导向灯带（断电暗红，通电后青蓝）
    for (const [r0, r1] of [[5.95, 6.25], [9.55, 9.7]] as [number, number][]) B.add(new RingGeometry(r0, r1, 72), darkSteel, trs(DOME.x, Y + 0.004, DOME.z, -Math.PI / 2, 0, 0), false)
    const hz = new RingGeometry(hole + 0.12, hole + 0.5, 48)
    const huv = hz.getAttribute('uv')
    for (let i = 0; i < huv.count; i++) huv.setXY(i, huv.getX(i) * 3, huv.getY(i) * 3)
    B.add(hz, std({ map: TEX.hazard(), rough: 0.6 }), trs(DOME.x, Y + 0.005, DOME.z, -Math.PI / 2, 0, 0), false)
    const strip = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0)
      B.add(boxGeo(0.07, 0.012, len), this.guideM, trs((x0 + x1) / 2, Y + 0.006, (z0 + z1) / 2, 0, Math.atan2(x1 - x0, z1 - z0), 0), false)
    }
    for (const o of [-1.0, 1.0]) {
      strip(o, DOME.z - DOME.r + 0.3, o, DOME.z - 2.3)
      strip(o, DOME.z + 2.3, o, DOME.z + 8.6)
      strip(DOME.x - DOME.r + 0.3, DOME.z + o, DOME.x - 2.3, DOME.z + o)
      strip(DOME.x + 2.3, DOME.z + o, DOME.x + DOME.r - 0.3, DOME.z + o)
    }
    const hh = 1.15
    const side = DOME.r - hh
    for (const [x, z, sx, sz] of [[-(hh + side / 2), DOME.z, side, 24], [hh + side / 2, DOME.z, side, 24], [0, DOME.z - hh - side / 2, hh * 2, side], [0, DOME.z + hh + side / 2, hh * 2, side]] as [number, number, number, number][]) {
      this.col.slab(x, z, sx, sz, -1, Y, { surface: 'metal', tag: 'domeFloor' })
    }
    // 圆形墙（24 段近似，留出走廊与两侧门）
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2
      const x = DOME.x + Math.cos(a) * (DOME.r - 0.2), z = DOME.z + Math.sin(a) * (DOME.r - 0.2)
      const toCorridor = Math.abs(x) < 2.2 && z < DOME.z
      const toSide = Math.abs(z - DOME.z) < 1.6 && Math.abs(Math.abs(x) - DOME.r) < 1.5
      if (toCorridor || toSide) continue
      this.col.box(x, Y + 3, z, 0.4, 6, 2.8, { yaw: -a, tag: 'domeWall', walkable: false })
    }
    // 升降梯井（向下通往遗迹）
    // 井筒只从遗迹天花板通到穹顶地面；遗迹里升降平台四面敞开
    const S0 = RUIN_Y + 8.6
    const shaft = new CylinderGeometry(hole + 0.1, hole + 0.1, Y - S0, 24, 1, true)
    B.add(shaft, darkSteel, new Matrix4().makeTranslation(DOME.x, (Y + S0) / 2, DOME.z))
    const shaftBack = new Mesh(new CylinderGeometry(hole + 0.12, hole + 0.12, Y - S0, 24, 1, true), std({ color: 0x1a2228, rough: 0.8, side: BackSide }))
    shaftBack.position.set(DOME.x, (Y + S0) / 2, DOME.z)
    R.add(shaftBack)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      this.col.box(DOME.x + Math.cos(a) * (hole + 0.25), (Y - 1.2 + S0) / 2, DOME.z + Math.sin(a) * (hole + 0.25), 0.3, Y - 1.2 - S0, 1.4, { yaw: -a, tag: 'shaft', walkable: false })
    }
    // 升降平台
    const plat = new Mesh(new CylinderGeometry(hole - 0.05, hole - 0.05, 0.2, 32), grate)
    plat.position.y = -0.1
    this.elevator.add(plat)
    this.gateGlow = glowMat(0x204050, 1)
    const rim = new Mesh(new CylinderGeometry(hole - 0.02, hole - 0.02, 0.05, 32, 1, true), this.gateGlow)
    this.elevator.add(rim)
    const ctrl = new Mesh(boxGeo(0.3, 1.0, 0.3), darkSteel)
    ctrl.position.set(0.9, 0.5, -0.9)
    this.elevator.add(ctrl)
    this.elevator.position.set(DOME.x, Y, DOME.z)
    R.add(this.elevator)
    this.elevCol = this.col.cyl(DOME.x, DOME.z, hole - 0.05, Y - 0.2, Y, { surface: 'grate', tag: 'elevator' })
    // 中央的圆形长椅
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3
      const x = DOME.x + Math.cos(a) * 5.2, z = DOME.z + Math.sin(a) * 5.2
      if (z > DOME.z + 3 && Math.abs(x) < 3) continue
      B.box(steel, x, Y + 0.45, z, 1.6, 0.08, 0.6, -a + Math.PI / 2)
      this.col.box(x, Y + 0.25, z, 1.6, 0.5, 0.6, { yaw: -a + Math.PI / 2, tag: 'bench' })
    }
    // 控制台：探照灯（正前）与声呐（左前）
    this.console(B, darkSteel, v3(0, Y, DOME.z + 9.4), 0, '探照灯 · SEARCHLIGHT')
    this.console(B, darkSteel, v3(-5.4, Y, DOME.z + 7.6), 0.55, '声呐阵列 · SONAR')
    await yieldFrame()

    // ---------- 配电室（右侧） ----------
    const painted = std({ color: 0x55666e, map: TEX.grime(), rough: 0.65, metal: 0.15 })
    const cabinetM = std({ color: 0x405652, map: TEX.grime(), rough: 0.5, metal: 0.3 })
    this.sideRoom(B, painted, 15, DOME.z, 6.5, 8)
    const panel = new Mesh(boxGeo(0.2, 1.6, 2.2), darkSteel)
    panel.position.set(18.05, Y + 1.4, DOME.z)
    R.add(panel)
    const fuseSlot = new Mesh(new CylinderGeometry(0.09, 0.09, 0.5, 12), std({ color: 0x111111, rough: 0.4 }))
    fuseSlot.rotation.x = Math.PI / 2
    fuseSlot.position.set(17.92, Y + 1.7, DOME.z - 0.5)
    R.add(fuseSlot)
    this.fuseInMesh = new Mesh(new CylinderGeometry(0.1, 0.1, 0.55, 12), glowMat(0xffc060, 2))
    this.fuseInMesh.rotation.x = Math.PI / 2
    this.fuseInMesh.position.copy(fuseSlot.position)
    R.add(this.fuseInMesh)
    const leverBase = new Mesh(boxGeo(0.25, 0.3, 0.3), steel)
    leverBase.position.set(17.9, Y + 1.2, DOME.z + 0.6)
    R.add(leverBase)
    this.leverArm = new Mesh(new CylinderGeometry(0.035, 0.035, 0.7, 8), std({ color: 0x8a1c14, rough: 0.4 }))
    this.leverArm.geometry.translate(0, 0.35, 0)
    this.leverArm.position.set(17.8, Y + 1.25, DOME.z + 0.6)
    this.leverArm.rotation.z = 0.6
    R.add(this.leverArm)
    const schemTex = textTexture({ w: 512, h: 360, bg: '#0a1a22', border: '#2a5a6a', lines: [{ text: '主电路 · MAIN BUS', size: 0.07, color: '#8fd8ff', font: MONO, y: 0.15 }, { text: '① 装入保险丝 F-07', size: 0.08, color: '#cfefff', y: 0.45 }, { text: '② 拉下主闸', size: 0.08, color: '#cfefff', y: 0.65 }, { text: '备用件存放于更衣室', size: 0.06, color: '#ffb070', y: 0.86 }] })
    const schem = new Mesh(new PlaneGeometry(1.4, 1.0), new MeshStandardMaterial({ map: schemTex, emissiveMap: schemTex, emissive: 0xffffff, emissiveIntensity: 0.7 }))
    schem.position.set(18.04, Y + 2.6, DOME.z)
    schem.rotation.y = -Math.PI / 2
    R.add(schem)
    // 配电柜、指示灯、线槽、地面警示线
    const hazardM = std({ map: TEX.hazard(), rough: 0.7 })
    const ledOff = glowMat(0x3a0806, 1)
    this.statusLeds = ledOff
    for (const z of [DOME.z - 3.55, DOME.z + 3.55]) {
      for (const x of [13.4, 14.5, 15.6, 16.7]) {
        B.box(cabinetM, x, Y + 1.0, z, 1.0, 2.0, 0.5)
        B.box(steel, x, Y + 1.0, z + Math.sign(DOME.z - z) * 0.255, 0.9, 1.86, 0.01)
        for (let k = 0; k < 3; k++) B.box(ledOff, x - 0.3 + k * 0.12, Y + 1.75, z + Math.sign(DOME.z - z) * 0.265, 0.05, 0.05, 0.01)
        B.box(darkSteel, x + 0.36, Y + 1.0, z + Math.sign(DOME.z - z) * 0.27, 0.04, 0.3, 0.03)
      }
      this.col.slab(15.05, z, 4.4, 0.5, Y, Y + 2.0, { walkable: false, tag: 'cabinets' })
      B.box(darkSteel, 15, Y + 2.95, z, 6.2, 0.08, 0.36)
      for (let x = 12.4; x < 18; x += 0.9) B.box(rust, x, Y + 3.0, z, 0.05, 0.1, 0.38)
    }
    for (const z of [DOME.z - 1.6, DOME.z + 1.6]) B.cyl(rust, 18.0, Y + 1.6, z, 0.06, 3.2, 8)
    B.box(hazardM, 17.45, Y + 0.006, DOME.z, 0.3, 0.012, 2.6)
    const warn = new Mesh(new PlaneGeometry(0.7, 0.36), new MeshStandardMaterial({ map: textTexture({ w: 256, h: 128, bg: '#e8c440', lines: [{ text: '⚡ 高压危险', size: 0.3, color: '#1a1a1a', y: 0.4, weight: '700' }, { text: 'HIGH VOLTAGE', size: 0.16, color: '#1a1a1a', font: MONO, y: 0.78 }] }) }))
    warn.position.set(18.04, Y + 2.35, DOME.z + 2.45)
    warn.rotation.y = -Math.PI / 2
    R.add(warn)

    // ---------- 被淹的更衣室（左侧） ----------
    const tile = std({ color: 0x6f8f92, map: TEX.tiles(), rough: 0.3, metal: 0.1 })
    this.sideRoom(B, tile, -15, DOME.z, 6.5, 8, 'wet')
    // 更衣长凳
    B.box(std({ color: 0x5a4030, map: TEX.wood(), rough: 0.6 }), -15, Y + 0.45, DOME.z - 2.6, 2.4, 0.07, 0.42)
    for (const dx of [-1.0, 1.0]) B.box(steel, -15 + dx, Y + 0.22, DOME.z - 2.6, 0.06, 0.44, 0.36)
    this.col.slab(-15, DOME.z - 2.6, 2.4, 0.42, Y, Y + 0.5, { surface: 'wood', tag: 'bench' })
    for (let k = 0; k < 4; k++) B.box(steel, -16.4 + k * 0.9, Y + 1.8, DOME.z - 3.84, 0.04, 0.04, 0.14)
    const water = new Mesh(new PlaneGeometry(6, 7.5), std({ color: 0x0a2a36, rough: 0.05, metal: 0.6, env: 2, transparent: true, opacity: 0.85 }))
    water.rotation.x = -Math.PI / 2
    water.position.set(-15, Y + 0.12, DOME.z)
    R.add(water)
    for (let i = 0; i < 5; i++) {
      const lx = -18.0, lz = DOME.z - 2.4 + i * 1.2
      const door = new Mesh(boxGeo(0.06, 1.9, 1.1), rust)
      door.position.set(lx + 0.4, Y + 0.95, lz)
      if (i !== 2) R.add(door)
      B.box(rust, lx, Y + 0.95, lz - 0.6, 0.8, 1.9, 0.04)
    }
    B.box(rust, -18.0, Y + 0.95, DOME.z + 3.0, 0.8, 1.9, 0.04)
    B.box(rust, -18.38, Y + 0.95, DOME.z, 0.04, 1.9, 6.0)
    B.box(rust, -18.0, Y + 1.92, DOME.z, 0.8, 0.04, 6.0)
    B.box(rust, -18.0, Y + 0.02, DOME.z, 0.8, 0.04, 6.0)
    B.box(rust, -18.0, Y + 1.0, DOME.z, 0.78, 0.03, 1.15)
    this.col.slab(-18.1, DOME.z, 0.6, 6.2, Y, Y + 1.9, { tag: 'lockers', surface: 'metal' })
    this.lockerDoor = new Group()
    const ld = new Mesh(boxGeo(0.06, 1.9, 1.1), rust)
    ld.position.z = 0.55
    this.lockerDoor.add(ld)
    this.lockerDoor.position.set(-17.6, Y + 0.95, DOME.z - 0.55)
    R.add(this.lockerDoor)
    this.fuseMesh = itemModel('fuse', '#d9c18a')
    this.fuseMesh.scale.setScalar(0.25)
    this.fuseMesh.position.set(-17.75, Y + 1.12, DOME.z)
    R.add(this.fuseMesh)
    // 漏水的管道
    B.cyl(rust, -15, Y + 3.6, DOME.z - 2.5, 0.12, 6, 10)
    const drip = new Mesh(new PlaneGeometry(0.4, 3.2), new MeshBasicMaterial({ color: 0x4a9ab8, transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false }))
    drip.position.set(-15, Y + 1.6, DOME.z - 2.5)
    R.add(drip)
    // 水里的旧车票
    this.lostTicket = new Mesh(boxGeo(0.16, 0.004, 0.08), std({ color: 0xa8b8b0, rough: 0.9 }))
    this.lostTicket.position.set(-13.4, Y + 0.08, DOME.z + 2.6)
    this.lostTicket.rotation.y = 0.7
    R.add(this.lostTicket)
    await yieldFrame()

    // ---------- 遗迹（升降梯下方） ----------
    const rz = DOME.z + 6
    B.box(ruinM, 0, RUIN_Y - 0.5, rz, 18, 1, 22, 0, 2)
    this.col.slab(0, rz, 18, 22, RUIN_Y - 1, RUIN_Y, { surface: 'stone', tag: 'ruinFloor' })
    for (const s of [-1, 1]) {
      B.box(ruinM, s * 9.2, RUIN_Y + 4, rz, 0.6, 8, 22, 0, 2)
      this.col.slab(s * 9.2, rz, 0.6, 22, RUIN_Y, RUIN_Y + 8, { tag: 'ruinWall', walkable: false })
    }
    B.box(ruinM, 0, RUIN_Y + 4, rz + 11.2, 18, 8, 0.6, 0, 2)
    B.box(ruinM, 0, RUIN_Y + 4, rz - 11.2, 18, 8, 0.6, 0, 2)
    this.col.slab(0, rz + 11.2, 18, 0.6, RUIN_Y, RUIN_Y + 8, { tag: 'ruinWall', walkable: false })
    this.col.slab(0, rz - 11.2, 18, 0.6, RUIN_Y, RUIN_Y + 8, { tag: 'ruinWall', walkable: false })
    for (const [x, z, sx, sz] of [[-5.4, rz, 7.8, 23], [5.4, rz, 7.8, 23], [0, DOME.z - 7.65, 3, 13.3], [0, DOME.z + 9.65, 3, 17.3]] as [number, number, number, number][]) {
      B.box(ruinM, x, RUIN_Y + 8.3, z, sx, 0.6, sz)
    }
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
      const z = rz - 7 + i * 4.6
      // 右侧第二根柱子断了，上半截倒在地上
      const broken = s > 0 && i === 1
      const h = broken ? 3.1 : 8
      B.cyl(ruinM, s * 6.5, RUIN_Y + h / 2, z, 0.55, h, 12)
      B.box(ruinM, s * 6.5, RUIN_Y + 0.25, z, 1.5, 0.5, 1.5)
      if (!broken) B.box(ruinM, s * 6.5, RUIN_Y + 7.7, z, 1.4, 0.6, 1.4)
      this.col.cyl(s * 6.5, z, 0.6, RUIN_Y, RUIN_Y + h)
      this.col.slab(s * 6.5, z, 1.5, 1.5, RUIN_Y, RUIN_Y + 0.5, { walkable: false, tag: 'colBase' })
    }
    // 倒下的半截柱子
    B.add(new CylinderGeometry(0.55, 0.55, 4.4, 12), ruinM, trs(4.3, RUIN_Y + 0.55, rz - 1.6, 0, 0.35, Math.PI / 2))
    this.col.box(4.3, RUIN_Y + 0.55, rz - 1.6, 4.4, 1.1, 1.1, { yaw: 0.35, tag: 'fallenCol', walkable: false })
    for (let k = 0; k < 4; k++) B.add(new IcosahedronGeometry(0.28 + k * 0.06, 0), ruinM, trs(6.1 - k * 0.3, RUIN_Y + 0.2, rz - 2.9 + k * 0.7, k, k * 2, 0))
    // 祭台周围的发光刻环与放射状刻线
    const groove = glowMat(0x4cc9ff, 1.1)
    for (const [r0, r1] of [[1.9, 1.96], [2.6, 2.66]] as [number, number][]) {
      B.add(new RingGeometry(r0, r1, 64), groove, trs(0, RUIN_Y + 0.006, rz + 8, -Math.PI / 2, 0, 0), false)
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      B.add(boxGeo(0.04, 0.01, 0.62), groove, trs(Math.sin(a) * 2.28, RUIN_Y + 0.006, rz + 8 + Math.cos(a) * 2.28, 0, a, 0), false)
    }
    // 后墙上的圆形浮雕：像一面没有指针的钟
    const relief = new Mesh(new TorusGeometry(2.4, 0.16, 10, 64), std({ color: 0x5a6a6a, map: TEX.stone(), rough: 0.9 }))
    relief.position.set(0, RUIN_Y + 4.6, rz + 10.82)
    R.add(relief)
    const reliefGlow = new Mesh(new TorusGeometry(1.9, 0.05, 8, 64), groove)
    reliefGlow.position.set(0, RUIN_Y + 4.6, rz + 10.86)
    R.add(reliefGlow)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      B.box(groove, Math.sin(a) * 2.05, RUIN_Y + 4.6 + Math.cos(a) * 2.05, rz + 10.86, 0.08, k % 3 === 0 ? 0.5 : 0.25, 0.04, 0)
    }
    // 墙脚与柱脚的发光海葵（一次绘制的实例）
    const anemoneN = 90
    // 不受光照的 HDR 颜色（大于 1）配合每个实例的颜色，才能既发光又各有色相
    const anemone = new InstancedMesh(new SphereGeometry(1, 8, 6), new MeshBasicMaterial({ color: new Color(2.4, 2.4, 2.4) }), anemoneN)
    const am = new Matrix4()
    for (let k = 0; k < anemoneN; k++) {
      const side = k % 3
      let x: number, z: number
      if (side === 0) { x = (Math.random() < 0.5 ? -1 : 1) * (8.4 + Math.random() * 0.4); z = rz - 10 + Math.random() * 20 }
      else if (side === 1) { x = -8 + Math.random() * 16; z = rz + 10.4 + Math.random() * 0.4 }
      else { const c = Math.floor(Math.random() * 8); x = (c % 2 ? 1 : -1) * 6.5 + (Math.random() - 0.5) * 1.8; z = rz - 7 + Math.floor(c / 2) * 4.6 + (Math.random() - 0.5) * 1.8 }
      const sc = 0.05 + Math.random() * 0.1
      am.makeScale(sc, sc * (0.6 + Math.random()), sc).setPosition(x, RUIN_Y + sc * 0.5, z)
      anemone.setMatrixAt(k, am)
      anemone.setColorAt(k, new Color().setHSL(Math.random() < 0.6 ? 0.92 : 0.52, 0.8, 0.6))
    }
    R.add(anemone)
    // 发光的刻纹
    const glyph = textTexture({ w: 1024, h: 256, bg: '#000000', glow: '#4cc9ff', lines: [{ text: '◯ ━ ◯ ━ ◯　末班车总会来的　◯ ━ ◯ ━ ◯', size: 0.22, color: '#7fe8ff', y: 0.5 }] })
    for (const s of [-1, 1]) {
      const gm = new Mesh(new PlaneGeometry(14, 1.6), new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: glyph, emissiveIntensity: 1.4, transparent: true }))
      gm.position.set(s * 8.85, RUIN_Y + 5, rz)
      gm.rotation.y = -s * Math.PI / 2
      R.add(gm)
    }
    // 祭台 + 碎片
    B.box(ruinM, 0, RUIN_Y + 0.5, rz + 8, 2.4, 1, 1.6)
    this.col.slab(0, rz + 8, 2.4, 1.6, RUIN_Y, RUIN_Y + 1, { tag: 'altar', walkable: false })
    this.fragment = itemModel('fragment', '#53c8ff')
    this.fragment.scale.setScalar(0.45)
    this.fragment.position.set(0, RUIN_Y + 1.7, rz + 8)
    R.add(this.fragment)
    const ruinLight = new PointLight(0x4cc9ff, 30, 18, 1.5)
    ruinLight.position.set(0, RUIN_Y + 5, rz + 4)
    R.add(ruinLight)
    // 档案石碑
    B.box(ruinM, -5, RUIN_Y + 1.2, rz + 5, 1.4, 2.4, 0.4)
    this.col.slab(-5, rz + 5, 1.4, 0.4, RUIN_Y, RUIN_Y + 2.4, { tag: 'tablet', walkable: false })
    const tab = new Mesh(new PlaneGeometry(1.1, 1.6), new MeshStandardMaterial({ map: textTexture({ w: 256, h: 384, bg: '#1a2628', lines: [{ text: '值班日志', size: 0.07, color: '#cfefff', y: 0.15 }, ...[0, 1, 2, 3, 4].map((i) => ({ text: '— — — — — —', size: 0.05, color: '#6a8a90', y: 0.32 + i * 0.12 }))] }), emissive: 0x4cc9ff, emissiveIntensity: 0.15 }))
    tab.position.set(-5, RUIN_Y + 1.4, rz + 4.79)
    tab.rotation.y = Math.PI
    R.add(tab)
    await yieldFrame()

    // ---------- 声碑 ----------
    MONO_POS.forEach((p, i) => {
      const wave = textTexture({ w: 256, h: 768, bg: '#121c1e', lines: [{ text: ['Ⅰ', 'Ⅱ', 'Ⅲ'][i], size: 0.08, color: '#9fd8e8', y: 0.08 }, { text: '〰'.repeat(i + 2), size: 0.08, color: '#9fd8e8', y: 0.5 }] })
      const mat = new MeshStandardMaterial({ color: 0x4a5a5c, map: TEX.stone(), roughness: 0.8, emissive: 0xffffff, emissiveMap: wave, emissiveIntensity: 0.0 })
      const mesh = new Mesh(boxGeo(2.6, 10, 1.4), mat)
      mesh.position.set(p.x, p.y + 5, p.z)
      mesh.lookAt(0, p.y + 5, DOME.z)
      R.add(mesh)
      this.monoliths.push({ mesh, mat, tone: null, lit: 0 })
    })
    // 远处的巨型遗迹拱门
    for (let i = 0; i < 6; i++) {
      const a = -0.5 + i * 0.25
      const x = Math.sin(a) * 170, z = 34 + Math.cos(a) * 170
      B.box(ruinM, x - 6, 10, z, 3, 40, 3)
      B.box(ruinM, x + 6, 10, z, 3, 40, 3)
      B.box(ruinM, x, 31, z, 16, 3, 3.4)
    }
    // 沉船：一节翻倒的车厢，侧面写着“零号”
    const wreck = new Group()
    const wb = new Mesh(boxGeo(20, 3.2, 3.1), rust)
    wreck.add(wb)
    const wnum = new Mesh(new PlaneGeometry(4, 1.6), new MeshStandardMaterial({ map: textTexture({ w: 512, h: 200, lines: [{ text: '零 号', size: 0.6, color: '#c8b89a', y: 0.5 }] }), transparent: true, roughness: 0.9 }))
    wnum.position.set(3, 0.2, 1.56)
    wreck.add(wnum)
    for (let i = 0; i < 6; i++) {
      const w = new Mesh(new PlaneGeometry(1.4, 0.9), glowMat(0x2a6a7a, 0.4))
      w.position.set(-7.5 + i * 2.8, 0.6, 1.56)
      wreck.add(w)
    }
    wreck.position.set(-72, -10, 118)
    wreck.rotation.set(0.25, 0.6, 1.35)
    R.add(wreck)

    // ---------- 生物 ----------
    this.whale = new Whale(32)
    R.add(this.whale.group)
    const avoid = (x: number, y: number, z: number) => z < 12 || Math.hypot(x - DOME.x, y - Y, z - DOME.z) < DOME.r + 3
    this.jelly = jellyfish(Math.round(220 * q.particles + 60), { x: 0, y: 10, z: 80, sx: 220, sy: 30, sz: 130 }, undefined, undefined, avoid)
    R.add(this.jelly.mesh)
    // 驶入航道旁的一条水母带（巨鲸游过时被照亮）
    this.jelly2 = jellyfish(Math.round(160 * q.particles + 40), { x: -230, y: 6, z: 22, sx: 480, sy: 14, sz: 18 }, undefined, undefined, avoid)
    R.add(this.jelly2.mesh)
    this.snow = motes(Math.round(4000 * q.particles + 600), 60, new Color(0.35, 0.6, 0.7), 0.05, new Vector2(0.04, -0.15))
    R.add(this.snow.points)
    // 体积光：从海面斜射下来的光柱
    const rayMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
        void main(){ float x = vUv.x; float a = smoothstep(0.0, 0.4, x) * smoothstep(1.0, 0.6, x) * smoothstep(0.0, 0.7, vUv.y);
        a *= 0.5 + 0.5 * sin(x * 12.0 + uTime * 0.3) * sin(x * 5.0 - uTime * 0.2);
        // 离镜头太近的光柱会变成一整片发白的面，按距离淡出
        a *= smoothstep(14.0, 40.0, distance(cameraPosition, vW));
        gl_FragColor = vec4(vec3(0.3, 0.65, 0.8) * a * 0.1, 1.0); }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide,
    })
    for (let i = 0; i < 6; i++) {
      const ra = (i / 6) * Math.PI * 2 + 0.4
      const ray = new Mesh(new PlaneGeometry(12 + Math.random() * 8, 120), rayMat)
      ray.position.set(Math.cos(ra) * (50 + Math.random() * 30), 40, DOME.z + 30 + Math.sin(ra) * (40 + Math.random() * 25))
      ray.lookAt(DOME.x, 40, DOME.z)
      ray.rotateZ(0.22)
      this.rays.push(ray)
      R.add(ray)
    }
    this.rayMat = rayMat

    // ---------- 灯光 ----------
    const hemi = new HemisphereLight(0x2a6a8a, 0x020608, 0.7)
    R.add(hemi)
    const moon = new DirectionalLight(0x4a9ab8, 0.6)
    moon.position.set(20, 80, 10)
    R.add(moon)
    this.emergency = new PointLight(0xff2a1a, 14, 20, 1.6)
    this.emergency.position.set(0, Y + 6, DOME.z)
    R.add(this.emergency)
    for (const [x, z] of [[0, 8], [0, DOME.z]] as [number, number][]) {
      const l = new PointLight(0xcfe8ff, 0, 22, 1.5)
      l.position.set(x, Y + 5, z)
      R.add(l)
      this.mainLights.push(l)
    }
    for (let i = 0; i < 10; i++) {
      const lm = glowMat(0xcfe8ff, 0)
      this.lampMats.push(lm)
      const a = (i / 10) * Math.PI * 2
      const lamp = new Mesh(new SphereGeometry(0.12, 10, 8), lm)
      lamp.position.set(DOME.x + Math.cos(a) * (DOME.r - 0.6), Y + 3.4, DOME.z + Math.sin(a) * (DOME.r - 0.6))
      R.add(lamp)
    }
    this.flood = new SpotLight(0xbfe8ff, 0, 70, 1.0, 0.7, 1.2)
    this.flood.position.set(0, Y + 11, DOME.z)
    this.flood.target.position.set(0, -8, DOME.z + 20)
    R.add(this.flood, this.flood.target)
    // 探照灯（穹顶顶上）
    this.search = new SpotLight(0xeaf6ff, 0, 180, 0.13, 0.4, 1.0)
    this.search.position.copy(LIGHT_POS)
    R.add(this.search, this.search.target)
    const beamMat = new ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: `varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uI; varying vec3 vL; varying vec3 vN; varying vec3 vV;
        void main(){ float along = clamp(-vL.y / 120.0, 0.0, 1.0); float e = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * uI * e * pow(1.0 - along, 1.5) * 0.45, 1.0); }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide,
    })
    const bg = new CylinderGeometry(0.3, 16, 120, 24, 1, true)
    bg.translate(0, -60, 0)
    this.searchBeam = new Mesh(bg, beamMat)
    this.searchBeam.position.copy(LIGHT_POS)
    R.add(this.searchBeam)
    const housing = new Mesh(new CylinderGeometry(0.5, 0.7, 1.0, 16), darkSteel)
    housing.position.copy(LIGHT_POS)
    this.searchHousing = housing
    R.add(housing)

    B.build(R, 'abyss')
    this.buildInteractions()
    this.syncState()

    // 声呐桥
    const self = this
    const values = [S.num('abyss.v0', 120), S.num('abyss.v1', 420), S.num('abyss.v2', 640)]
    const bridge: SonarBridge = {
      get known() { return [0, 1, 2].map((i) => S.is(`abyss.lit${i}`)) },
      get solved() { return [0, 1, 2].map((i) => S.is(`abyss.f${i}`)) },
      values,
      get targets() { return [...SONAR.targets] },
      min: SONAR.min,
      max: SONAR.max,
      get powered() { return S.is('abyss.power') },
      set(i: number, v: number) { self.setSonar(i, v) },
      ping() { self.game.sfx('ping', v3(0, Y + 2, DOME.z + 8)) },
    }
    this.sonarBridge = bridge
    bridges.sonar = bridge
    this.own(() => {
      if (bridges.sonar === bridge) bridges.sonar = null
      this.sonarTones.forEach((t) => t?.stop())
      this.monoliths.forEach((m) => m.tone?.stop())
    })
  }

  private kelpU!: { uTime: { value: number } }
  private rayMat!: ShaderMaterial
  private searchHousing!: Mesh
  private sonarBridge!: SonarBridge

  private console(B: Batcher, m: MeshStandardMaterial, p: Vector3, yaw: number, label: string) {
    B.box(m, p.x, p.y + 0.5, p.z, 1.4, 1.0, 0.8, yaw)
    this.col.box(p.x, p.y + 0.5, p.z, 1.4, 1.0, 0.8, { yaw, tag: 'console', walkable: false })
    const scr = glowMat(0x0a2a36, 1)
    this.consoleMats.push(scr)
    const screen = new Mesh(new PlaneGeometry(1.1, 0.5), scr)
    screen.position.set(p.x, p.y + 1.15, p.z + 0.1)
    screen.rotation.set(-0.7, yaw, 0, 'YXZ')
    this.root.add(screen)
    const tag = new Mesh(new PlaneGeometry(1.0, 0.16), new MeshStandardMaterial({ map: textTexture({ w: 512, h: 80, bg: '#0a141a', lines: [{ text: label, size: 0.45, color: '#8fd8ff', font: MONO, y: 0.55 }] }) }))
    tag.position.set(p.x, p.y + 0.85, p.z - 0.41)
    tag.rotation.y = Math.PI + yaw
    this.root.add(tag)
    return screen
  }

  private sideRoom(B: Batcher, m: MeshStandardMaterial, cx: number, cz: number, w: number, d: number, surface: 'metal' | 'wet' = 'metal') {
    const x0 = cx - w / 2, x1 = cx + w / 2
    B.box(m, cx, Y + 3.2, cz, w, 0.2, d)
    B.box(m, cx, Y - 0.1, cz, w, 0.2, d)
    B.box(m, cx, Y + 1.6, cz - d / 2, w, 3.2, 0.2)
    B.box(m, cx, Y + 1.6, cz + d / 2, w, 3.2, 0.2)
    const far = cx > 0 ? x1 : x0
    B.box(m, far, Y + 1.6, cz, 0.2, 3.2, d)
    this.col.slab(cx, cz, w, d, -1, Y, { surface, tag: 'roomFloor' })
    this.col.slab(cx, cz - d / 2, w, 0.2, Y, Y + 3.2, { walkable: false })
    this.col.slab(cx, cz + d / 2, w, 0.2, Y, Y + 3.2, { walkable: false })
    this.col.slab(far, cz, 0.2, d, Y, Y + 3.2, { walkable: false })
    const l = new PointLight(0xff3a2a, 4, 9, 1.8)
    l.position.set(cx, Y + 2.8, cz)
    this.root.add(l)
    this.roomLights.push(l)
    // 吸顶灯管：断电时暗红，通电后冷白
    for (const dz of [-1.6, 1.6]) {
      B.box(this.fixtureM, cx, Y + 3.06, cz + dz, 2.4, 0.08, 0.22)
      B.box(this.tubeM, cx, Y + 3.0, cz + dz, 2.2, 0.05, 0.1)
    }
  }

  private roomLights: PointLight[] = []
  private tubeM = glowMat(0xff3a2a, 0.6)
  private guideM = glowMat(0xff2a1a, 0.5)
  private fixtureM = std({ color: 0x9aa6ae, rough: 0.4, metal: 0.6 })
  private statusLeds!: MeshStandardMaterial

  // ---------------- 交互 ----------------
  private buildInteractions() {
    const g = this.game
    this.trigger({ id: 'enter', min: v3(-2, 0, 10), max: v3(2, 4, 22), enter: () => { if (!S.is('abyss.entered')) { S.set('abyss.entered'); g.say('', '玻璃外面，有什么巨大的东西在黑暗里移动。', 3.5); g.refresh() } } })
    // 更衣室柜门
    this.item({
      id: 'locker', pos: v3(-17.6, Y + 1.2, DOME.z), radius: 0.6, label: '更衣柜', verb: () => (S.is('abyss.lockerOpen') ? '已打开' : '撬开柜门'),
      enabled: () => !S.is('abyss.lockerOpen'),
      use: () => {
        S.set('abyss.lockerOpen')
        g.sfx('locker', v3(-17.6, 2, DOME.z))
        g.say('', '柜门锈住了，费了点劲才拉开。里面有个用防水布包着的东西。', 3.5)
        this.syncState()
      },
    })
    this.item({
      id: 'fuse', pos: v3(-17.75, Y + 1.12, DOME.z), radius: 0.3, label: '防水布包', verb: '拾取',
      enabled: () => S.is('abyss.lockerOpen') && !S.is('abyss.fuseGot'),
      use: () => {
        S.set('abyss.fuseGot')
        g.pickup('fuse')
        this.syncState()
      },
    })
    this.item({
      id: 'lost3', pos: this.lostTicket.position.clone(), radius: 0.3, range: 2.2, label: '泡在水里的车票', verb: '拾取',
      enabled: () => !S.get().collectibles.includes('t3'),
      use: () => { g.collect('t3'); this.syncState() },
    })
    // 配电
    this.item({
      id: 'fuseSlot', pos: v3(17.92, Y + 1.7, DOME.z - 0.5), radius: 0.35, label: '主电路保险丝槽', verb: () => (S.has('fuse') ? '装入保险丝' : '检查'),
      enabled: () => !S.is('abyss.fuseIn'),
      use: () => {
        if (!S.has('fuse')) {
          g.sfx('deny')
          g.say('', '槽是空的。旁边的图纸写着：备用件存放于更衣室。', 3.5)
          return
        }
        S.take('fuse')
        S.set('abyss.fuseIn')
        g.sfx('insert', v3(17.9, 2.7, DOME.z))
        this.syncState()
      },
    })
    this.item({
      id: 'mainLever', pos: v3(17.8, Y + 1.5, DOME.z + 0.6), radius: 0.35, label: '主闸', verb: () => (S.is('abyss.power') ? '已通电' : '拉下'),
      enabled: () => !S.is('abyss.power'),
      blocked: () => (S.is('abyss.fuseIn') ? null : '主电路缺一根保险丝'),
      use: () => {
        S.set('abyss.power')
        g.sfx('lever', v3(17.8, 2.5, DOME.z))
        g.sfx('powerUp')
        this.powerSeq = 0
        g.say('', '灯一盏接一盏亮起来。外面的黑暗退后了几十米。', 4)
        g.refresh()
        this.syncState()
      },
    })
    // 探照灯
    this.item({
      id: 'searchlight', pos: v3(0, Y + 1.1, DOME.z + 9.4), radius: 0.7, label: '探照灯控制台', verb: '操纵',
      blocked: () => (S.is('abyss.power') ? null : '没有电'),
      use: () => {
        const p = g.player
        p.teleport(0, Y, DOME.z + 8.4, p.yaw, p.pitch)
        g.sfx('servo')
        g.manipulate('探照灯', (dx, dy) => {
          this.sYaw -= dx * 0.0016
          this.sPitch = Math.max(-1.1, Math.min(0.9, this.sPitch - dy * 0.0016))
          this.sYaw = Math.max(-1.7, Math.min(1.7, this.sYaw))
          // 视线跟随光束
          p.yaw = this.sYaw + Math.PI
          p.pitch = Math.max(-0.9, Math.min(0.9, this.sPitch + 0.18))
        })
        p.yaw = this.sYaw + Math.PI
      },
    })
    this.item({
      id: 'sonar', pos: v3(-5.4, Y + 1.1, DOME.z + 7.6), radius: 0.7, label: '声呐阵列', verb: '使用',
      blocked: () => (S.is('abyss.power') ? null : '没有电'),
      use: () => g.openSonar(),
    })
    // 升降梯
    this.item({
      id: 'elevator', pos: v3(0.9, Y + 1.0, DOME.z - 0.9), radius: 0.4, label: '升降梯', verb: () => (this.elevTarget > RUIN_Y + 1 ? '下降到遗迹' : '上升'),
      blocked: () => (S.is('abyss.gate') ? (this.elevMoving ? '正在运行' : null) : '入口还封着。三座声碑沉默着。'),
      use: () => this.ride(this.elevTarget > RUIN_Y + 1 ? RUIN_Y : Y),
    })
    this.item({
      id: 'elevatorDown', pos: v3(0.9, RUIN_Y + 1.0, DOME.z - 0.9), radius: 0.4, label: '升降梯', verb: '上升',
      enabled: () => this.elevY < RUIN_Y + 0.5 && !this.elevMoving,
      use: () => this.ride(Y),
    })
    this.item({
      id: 'archive3', pos: v3(-5, RUIN_Y + 1.4, DOME.z + 6 + 4.8), radius: 0.7, label: '值班日志石碑', verb: '阅读',
      use: () => g.archive('a3'),
    })
    this.item({
      id: 'fragment', pos: v3(0, RUIN_Y + 1.7, DOME.z + 14), radius: 0.5, label: '发光的碎片', verb: '取下',
      enabled: () => !S.is('abyss.fragment'),
      use: () => {
        S.set('abyss.fragment')
        g.pickup('fragment_abyss')
        g.sfx('success')
        g.say('', '碎片贴在掌心，里面有很远的人声。像有人在站台上喊你的名字。', 4.5)
        this.syncState()
      },
    })
    // 看沉船
    this.item({
      id: 'wreckView', pos: v3(-72, -10, 118), radius: 8, range: 120, label: '远处的沉船', verb: '凝视',
      enabled: () => S.is('abyss.power'),
      use: () => {
        S.set('abyss.wreck')
        g.say('', '那不是船。那是一节车厢，侧面写着「零号」。', 4)
      },
    })
  }

  private ride(target: number) {
    if (this.elevMoving) return
    const b = this.game.player.body
    const on = Math.hypot(b.x - DOME.x, b.z - DOME.z) < 1.5
    if (!on) {
      this.game.say('', '先站到升降平台上。', 2)
      return
    }
    this.elevTarget = target
    this.elevMoving = true
    this.game.sfx('heavy', v3(0, this.elevY, DOME.z), 0.6)
  }

  private setSonar(i: number, v: number) {
    const g = this.game
    if (!S.is('abyss.power') || S.is(`abyss.f${i}`)) return
    this.sonarBridge.values[i] = v
    S.set(`abyss.v${i}`, v)
    // 自己的发射音 + 已知声碑的目标音 → 拍音
    for (let k = 0; k < 3; k++) if (k !== i && this.sonarTones[k]) { this.sonarTones[k]!.stop(); this.sonarTones[k] = null }
    if (!this.sonarTones[i]) this.sonarTones[i] = g.audio.toneLoop(v, undefined, 'sine', 0.05)
    this.sonarTones[i]?.freq?.(v)
    this.sonarActive = i
    const known = S.is(`abyss.lit${i}`)
    const m = this.monoliths[i]
    if (known && !m.tone) m.tone = g.audio.toneLoop(SONAR.targets[i], undefined, 'sine', 0.05)
    if (known && matches(v, i)) {
      S.set(`abyss.f${i}`)
      this.sonarBridge.values[i] = SONAR.targets[i]
      g.sfx('bell')
      g.say('', `第 ${['一', '二', '三'][i]} 座声碑开始共鸣。`, 2.5)
      this.sonarTones[i]?.stop()
      this.sonarTones[i] = null
      m.tone?.stop()
      m.tone = null
      if ([0, 1, 2].every((k) => S.is(`abyss.f${k}`))) {
        S.set('abyss.gate')
        setTimeout(() => {
          g.sfx('heavy', undefined, 1)
          g.sfx('success')
          g.say('', '三座声碑同时唱出一个和弦。穹顶脚下传来石头移动的声音——遗迹的入口打开了。', 5)
          g.refresh()
        }, 900)
      }
      g.refresh()
    }
  }

  private syncState() {
    this.lockerDoor.rotation.y = S.is('abyss.lockerOpen') ? -1.7 : 0
    this.fuseMesh.visible = S.is('abyss.lockerOpen') && !S.is('abyss.fuseGot')
    this.fuseInMesh.visible = S.is('abyss.fuseIn')
    this.leverArm.rotation.z = S.is('abyss.power') ? -0.6 : 0.6
    this.fragment.visible = !S.is('abyss.fragment')
    this.lostTicket.visible = !S.get().collectibles.includes('t3')
    if (S.is('abyss.power') && this.powerSeq < 0) this.power = 1
  }

  update(dt: number, t: number) {
    const g = this.game
    // 通电序列
    if (this.powerSeq >= 0) {
      this.powerSeq += dt
      this.power = Math.min(1, this.powerSeq / 3)
      if (this.powerSeq > 3) this.powerSeq = -1
    }
    const pw = this.power
    this.emergency.intensity = (1 - pw) * (8 + 6 * Math.sin(t * 3))
    this.roomLights.forEach((l) => { l.color.setHex(pw > 0.5 ? 0xcfe8ff : 0xff3a2a); l.intensity = pw > 0.5 ? 16 : 5 })
    this.tubeM.emissive.setHex(pw > 0.5 ? 0xdff0ff : 0xff3a2a)
    this.tubeM.emissiveIntensity = pw > 0.5 ? 4 : 0.6
    this.guideM.emissive.setHex(pw > 0.5 ? 0x4cc9ff : 0xff2a1a)
    this.guideM.emissiveIntensity = pw > 0.5 ? 2.2 : 0.5
    this.statusLeds.emissive.setHex(pw > 0.5 ? 0x40ff80 : 0x3a0806)
    this.statusLeds.emissiveIntensity = pw > 0.5 ? 3 : 1
    this.mainLights.forEach((l, i) => (l.intensity = pw > (i + 1) / 3 ? 45 : 0))
    this.lampMats.forEach((m, i) => (m.emissiveIntensity = pw > i / 10 ? 6 : 0))
    this.flood.intensity = pw * 260
    this.consoleMats.forEach((m) => { m.emissive.setHex(pw > 0.5 ? 0x2a8aa8 : 0x061a22); m.emissiveIntensity = pw > 0.5 ? 1.6 : 0.6 })
    // 探照灯
    const dir = new Vector3(Math.sin(this.sYaw) * Math.cos(this.sPitch), Math.sin(this.sPitch), Math.cos(this.sYaw) * Math.cos(this.sPitch))
    this.search.intensity = pw * 4200
    this.search.target.position.copy(LIGHT_POS).addScaledVector(dir, 40)
    ;(this.searchBeam.material as ShaderMaterial).uniforms.uI.value = pw
    this.searchBeam.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir)
    this.searchHousing.quaternion.copy(this.searchBeam.quaternion)
    if (pw > 0.9) {
      MONO_POS.forEach((p, i) => {
        const hit = inBeam(LIGHT_POS, dir, v3(p.x, p.y + 5, p.z), 0.11)
        if (hit && !S.is(`abyss.lit${i}`)) {
          this.litTimer[i] += dt
          if (this.litTimer[i] > 0.7) {
            S.set(`abyss.lit${i}`)
            g.sfx('ping', p)
            g.say('', `光束照亮了第 ${['一', '二', '三'][i]} 座声碑。碑面刻着一道波纹——声呐屏上出现了它的回声。`, 4)
            g.refresh()
          }
        } else this.litTimer[i] = 0
      })
      if (!S.is('abyss.whale') && inBeam(LIGHT_POS, dir, this.whale.group.position, 0.16)) {
        this.whaleTimer += dt
        if (this.whaleTimer > 0.6) {
          S.set('abyss.whale')
          g.sfx('whale', this.whale.group.position)
          g.say('', '光扫过它的侧腹。巨鲸转过一只眼睛，看了你很久。', 4.5)
          g.refresh()
        }
      } else this.whaleTimer = 0
    }
    this.monoliths.forEach((m, i) => {
      const target = S.is(`abyss.f${i}`) ? 2.4 + Math.sin(t * 3 + i) * 0.6 : S.is(`abyss.lit${i}`) ? 0.8 : 0
      m.lit += (target - m.lit) * (1 - Math.exp(-dt * 2))
      m.mat.emissiveIntensity = m.lit
    })
    // 升降梯
    if (this.elevMoving) {
      const d = this.elevTarget - this.elevY
      const sp = Math.sign(d) * Math.min(Math.abs(d), dt * 2.4)
      this.elevY += sp
      if (Math.abs(this.elevTarget - this.elevY) < 0.001) {
        this.elevY = this.elevTarget
        this.elevMoving = false
        g.sfx('lever', v3(0, this.elevY + 1, DOME.z))
      }
    }
    this.elevator.position.y = this.elevY
    this.elevCol.minY = this.elevY - 0.2
    this.elevCol.maxY = this.elevY
    this.gateGlow.emissive.setHex(S.is('abyss.gate') ? 0x4cc9ff : 0x102028)
    this.gateGlow.emissiveIntensity = S.is('abyss.gate') ? 3 + Math.sin(t * 2) : 1
    // 鲸：绕观测站缓慢巡游（驶入时由 onApproach 接管）
    this.whale.update(dt)
    if (!this.approachWhale) {
      this.whaleAngle += dt * 0.035
      const a = this.whaleAngle
      const p = v3(Math.cos(a) * 70, 22 + Math.sin(a * 2) * 6, DOME.z + 30 + Math.sin(a) * 60)
      const nx = v3(Math.cos(a + 0.01) * 70, 22 + Math.sin((a + 0.01) * 2) * 6, DOME.z + 30 + Math.sin(a + 0.01) * 60)
      this.whale.group.position.copy(p)
      this.whale.group.lookAt(nx)
      this.whale.group.rotateY(-Math.PI / 2)
      this.whale.glow = 0.6
    }
    if (Math.random() < dt * 0.04) g.sfx('whale', this.whale.group.position, 0.6)
    this.fragment.rotation.y += dt * 0.7
    this.fragment.position.y = RUIN_Y + 1.7 + Math.sin(t * 1.4) * 0.08
    this.jelly.mat.uniforms.uTime.value = t
    this.jelly2.mat.uniforms.uTime.value = t
    this.snow.mat.uniforms.uTime.value = t
    const cl = g.camera.position.clone()
    this.root.worldToLocal(cl)
    ;(this.snow.mat.uniforms.uC.value as Vector3).copy(cl)
    this.kelpU.uTime.value = t
    this.rayMat.uniforms.uTime.value = t
    // 声音
    g.audio.setRain(0)
    g.audio.setWind(0)
    g.audio.setSea(0.8)
    g.audio.setOpenness(0.5)
    if (Math.random() < dt * 0.05) g.sfx('bubbles', v3(g.player.body.x + (Math.random() - 0.5) * 10, 3, g.player.body.z + 5), 0.5)
    // 关掉声呐面板后停止发射音
    if (this.sonarActive >= 0 && !(g as unknown as { anyModal?: () => boolean }).anyModal?.()) {
      this.sonarTones.forEach((s, k) => { s?.stop(); this.sonarTones[k] = null })
      this.monoliths.forEach((m) => { m.tone?.stop(); m.tone = null })
      this.sonarActive = -1
    }
  }

  /**
   * Moment 3 · 深海鲸鱼：驶入途中车厢灯熄灭，巨鲸从车头方向贴着车窗游过，
   * 它身上的光点照亮周围的水母；鲸游过之后灯重新亮起。
   */
  onApproach(p: number) {
    const g = this.game
    const first = !S.get().visited.includes('abyss') || this.forceMoment
    if (!first) return
    const s = -this.approachLength * Math.pow(1 - p, 2.2)
    if (p > 0.3 && p < 0.8) {
      this.approachWhale = true
      if (!this.lightsOff) {
        this.lightsOff = true
        g.train.setInterior(0)
        g.sfx('deny', undefined, 0.6)
        g.say('', '车厢里的灯突然灭了。', 2.5)
      }
      // 鲸在列车 +z 侧，相对列车从前往后缓慢游过
      const k = (p - 0.3) / 0.5
      const rel = 60 - k * 130
      // 鲸的身体正对车窗高度（窗户在 1.85–2.85 m），离车窗约 11 米
      this.whale.group.position.set(s + rel, 2.6 + Math.sin(k * 3) * 0.8, 12.5)
      this.whale.group.rotation.set(0, Math.PI, 0)
      this.whale.glow = 1.6
      this.jelly2.mat.uniforms.uBoost.value = Math.max(0, 1 - Math.abs(k - 0.5) * 2)
      if (k > 0.35 && !this.calledOnce) {
        this.calledOnce = true
        g.sfx('whale', this.whale.group.position, 1)
        g.moment('whale')
      }
    } else if (p >= 0.8 && this.lightsOff) {
      this.lightsOff = false
      this.approachWhale = false
      g.train.setInterior(1)
      this.jelly2.mat.uniforms.uBoost.value = 0
    }
  }

  forceMoment = false
  private lightsOff = false
  private calledOnce = false

  onDocked() {
    this.game.train.setInterior(1)
    this.approachWhale = false
    this.lightsOff = false
  }

  momentShots(): Shot[] {
    return [{ dur: 24, from: [v3(-1.5, 2.1, -0.7), v3(1.5, 2.1, -0.7)], look: [v3(4, 2.4, 12), v3(-4, 2.6, 12)], fov: [70, 64], ease: 'linear' }]
  }
}

