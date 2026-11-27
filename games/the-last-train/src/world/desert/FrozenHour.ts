// 世界 3：时间沙漠 / The Frozen Hour
// 整个世界的时间停在黄昏。沙粒、钟表碎片悬在半空，远处的沙暴凝固成一面墙。
// 核心机制：时砂怀表 —— 对准带时间印记的物体，[R] 按住倒转、[F] 暂停 / 恢复。倒转之后时间会重新流动。
// 多步谜题：倒下的钟塔就是跨越裂谷的桥 → 过桥 → 倒转钟塔让它立起来并暂停（塔门露出）→ 倒转升降台下来、
//          站上去恢复时间上到塔顶 → 时间悖论：一根指针向前、一根向后，让两根同时停在 12 点 → 取得碎片与指针
//          → 下塔、出塔、恢复钟塔时间让它再次倒下成桥 → 回到列车。
import {
  Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, InstancedBufferAttribute, InstancedMesh, Matrix4,
  Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Quaternion, Scene, ShaderMaterial, SphereGeometry, TorusGeometry, Vector2, Vector3, ConeGeometry, IcosahedronGeometry,
} from 'three'
import { World, v3 } from '../World'
import { Batcher, boxGeo, glowMat, std, trs, yieldFrame } from '../shared/kit'
import { TEX, fbm } from '../shared/textures'
import { textTexture, DISPLAY, MONO } from '../shared/text'
import { makeSky } from '../shared/sky'
import { motes } from '../shared/Whale'
import { itemModel } from '../shared/itemModels'
import { makeTimeObj, stepTime, startRewind, endRewind, togglePause, type TimeObj } from '../../puzzles/time'
import { S } from '../../state/store'
import { setUI, ui } from '../../state/ui'
import type { Collider } from '../../physics/collision'
import type { LoopHandle } from '../../audio/AudioEngine'
import type { Shot } from '../../game/api'

const Y = 1.0
const HINGE = v3(0, -3.4, 47)
const SPIRE = { len: 26, w: 4.4, d: 4.4 }
const LIFT_TOP = 18.6

interface TimeTarget {
  obj: TimeObj
  name: string
  center: () => Vector3
  radius: number
  allowed: () => string | null
}

export class FrozenHour extends World {
  readonly id = 'desert' as const
  private sky!: ReturnType<typeof makeSky>
  private spire = new Group()
  private spireCols: { fallen: Collider[]; upright: Collider[] } = { fallen: [], upright: [] }
  private lift = new Group()
  private liftCol!: Collider
  private handM = new Group()
  private handH = new Group()
  private handMOut = new Group()
  private handHOut = new Group()
  private cage!: Group
  private fragment!: Object3D
  private watchMesh!: Object3D
  private dune!: Mesh
  private duneTicket!: Mesh
  private objs: Record<string, TimeObj> = {}
  private targets: TimeTarget[] = []
  private rewinding: TimeObj | null = null
  private rewindSound: LoopHandle | null = null
  private sand!: ReturnType<typeof motes>
  private debris!: InstancedMesh
  private debrisMat!: MeshStandardMaterial
  private debrisU = { uRise: { value: 0 }, uTime: { value: 0 } }
  private rise = 0
  private riseTarget = 0
  private fragmentsG = new Group()
  private storm!: ShaderMaterial
  private saveAcc = 0
  private tickAcc = 0
  private lastSpireT = 1

  constructor() {
    super()
    this.env.background = new Color(0x2a1a2a)
    this.env.fogColor = new Color(0xc8906a)
    this.env.fogDensity = 0.0055
    this.env.score = 'desert'
    this.env.interior = 0.45
    this.env.fx = { exposure: 1.0, bloom: 0.55, bloomThreshold: 1.15, vignette: 0.45, grain: 0.03, saturation: 1.02, contrast: 1.06, tint: new Color(1.03, 0.99, 0.94), lift: new Color(0.03, 0.015, 0.03) }
    this.spawn = { x: 0, y: Y, z: 5, yaw: 0 }
    this.approachLength = 560
    this.approachTime = 24
    this.departLength = 560
    this.departTime = 13
  }

  envScene() {
    const s = new Scene()
    const sky = makeSky({ top: new Color(0.2, 0.15, 0.35), mid: new Color(1.6, 0.9, 0.5), bottom: new Color(0.8, 0.55, 0.4), sun: new Vector3(0.6, 0.12, -0.8), sunColor: new Color(3, 1.8, 0.9), sunSize: 0.05, radius: 50 })
    s.add(sky.mesh)
    return s
  }

  async build() {
    const R = this.root
    const q = this.q
    const B = new Batcher()
    const sandstone = std({ color: 0xd8b48a, map: TEX.stone(), normalMap: TEX.stoneNormal(), rough: 0.85 })
    const ashlar = std({ color: 0xdcb48a, map: TEX.ashlar(), normalMap: TEX.ashlarNormal(), rough: 0.82 })
    const flag = std({ color: 0xdcbc94, map: TEX.flagstone(), normalMap: TEX.flagstoneNormal(), rough: 0.78 })
    const sandM = std({ color: 0xe8c49a, map: TEX.sand(), normalMap: TEX.sandNormal(), rough: 0.95, normalScale: 0.8 })
    const gold = std({ color: 0xd8a84a, rough: 0.3, metal: 1, map: TEX.brushed() })
    const cloth = std({ color: 0xffffff, map: TEX.canvasStripe(), rough: 0.92, side: DoubleSide })
    const cloth2 = std({ color: 0xe8dcc0, map: TEX.concrete(), rough: 0.95, side: DoubleSide })
    const wood = std({ color: 0x7a5a3a, map: TEX.wood(), rough: 0.7 })

    // ---------- 天空 ----------
    this.sky = makeSky({ top: new Color(0.1, 0.08, 0.22), mid: new Color(1.3, 0.62, 0.32), bottom: new Color(0.6, 0.38, 0.3), sun: new Vector3(0.55, 0.1, -0.83), sunColor: new Color(2.6, 1.4, 0.6), sunSize: 0.045, stars: 0.6 })
    R.add(this.sky.mesh)

    // ---------- 沙丘地形 ----------
    const dunes = new PlaneGeometry(1600, 1600, 200, 200)
    dunes.rotateX(-Math.PI / 2)
    const dp = dunes.getAttribute('position')
    const heightAt = (x: number, z: number) => {
      // 游玩区域附近压平，远处起伏的沙丘
      const play = Math.max(Math.abs(x) / 30, (z > 0 ? z / 70 : -z / 8))
      const k = Math.min(1, Math.max(0, play - 1) * 0.5)
      const d = fbm(x * 0.0009 + 0.5, z * 0.0009 + 0.5, 4, 4, 7) * 34 - 14 + Math.sin(x * 0.02 + z * 0.01) * 3
      return Y - 0.05 + (d - 2) * k
    }
    for (let i = 0; i < dp.count; i++) {
      const x = dp.getX(i), z = dp.getZ(i)
      let h = heightAt(x, z)
      // 裂谷
      if (z > 24 && z < 44 && Math.abs(x) < 400) {
        h = Math.min(h, -40)
        // 网格间距 8 米，直接压低会在裂谷边缘留下拉伸的斜坡；把这一排顶点挪到岩壁背后，让坡面藏在岩壁后面
        dp.setZ(i, z < 34 ? 23.5 : 44.5)
      }
      dp.setY(i, h)
    }
    dunes.computeVertexNormals()
    const duv = dunes.getAttribute('uv')
    for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getX(i) * 200, duv.getY(i) * 200)
    const ground = new Mesh(dunes, sandM)
    ground.receiveShadow = true
    R.add(ground)
    // 裂谷两侧岩壁
    for (const [z, s] of [[24, 1], [44, -1]] as [number, number][]) {
      // 裂谷一直延伸到雾里（之前只有 160 米长，两端能看到地形扭成的竖条）
      const wallG = new PlaneGeometry(800, 46, 200, 23)
      const wp = wallG.getAttribute('position')
      for (let i = 0; i < wp.count; i++) wp.setZ(i, Math.sin(wp.getX(i) * 0.3) * 0.8 + Math.sin(wp.getY(i) * 0.7 + wp.getX(i) * 0.1) * 0.6)
      wallG.computeVertexNormals()
      // 岩壁的 UV 按真实尺寸铺（之前整面只铺一次，纹理被拉成了木纹似的竖条）
      const wuv = wallG.getAttribute('uv')
      for (let i = 0; i < wuv.count; i++) wuv.setXY(i, (wuv.getX(i) * 800) / 7, (wuv.getY(i) * 46) / 7)
      const wall = new Mesh(wallG, sandstone)
      wall.position.set(0, Y - 23, z)
      wall.rotation.y = s > 0 ? 0 : Math.PI // 两面岩壁都朝向裂谷内侧（之前朝反了，被背面剔除，只看得到拉伸的沙地）
      R.add(wall)
    }
    // 碰撞：营地、广场、站台；四周的空气墙
    this.col.slab(0, 15.5, 60, 17, -2, Y, { surface: 'sand', tag: 'camp' })
    this.col.slab(0, 54, 44, 20, -2, Y, { surface: 'sand', tag: 'plaza' })
    this.col.slab(0, 4.3, 64, 5.4, -2, Y, { surface: 'stone', tag: 'platform' })
    this.col.slab(-30.5, 15, 1, 30, Y, Y + 4, { walkable: false, tag: 'bound' })
    this.col.slab(30.5, 15, 1, 30, Y, Y + 4, { walkable: false, tag: 'bound' })
    this.col.slab(-22.5, 54, 1, 22, Y, Y + 4, { walkable: false, tag: 'bound' })
    this.col.slab(22.5, 54, 1, 22, Y, Y + 4, { walkable: false, tag: 'bound' })
    this.col.slab(0, 64.5, 44, 1, Y, Y + 4, { walkable: false, tag: 'bound' })
    this.col.slab(0, -2.5, 900, 3, -1, 0, { surface: 'stone', tag: 'bed', safe: false })
    // 站台
    B.box(flag, 0, Y - 0.5, 4.3, 64, 1, 5.4, 0, 3)
    B.box(gold, 0, Y + 0.01, 1.75, 64, 0.02, 0.15, 0, 1, false)
    for (const z of [-0.72, 0.72]) B.box(gold, 0, 0.06, z, 1200, 0.12, 0.08, 0, 4)
    B.box(sandstone, 0, -0.25, 0, 1200, 0.5, 4.2, 0, 3)
    const nameTex = textTexture({ w: 1024, h: 200, bg: '#2a1a12', border: '#d8a84a', lines: [{ text: '时 间 沙 漠', size: 0.38, color: '#f3e2c0', y: 0.42 }, { text: 'THE FROZEN HOUR · 23:59:59', size: 0.13, color: '#d8a84a', font: MONO, y: 0.8, spacing: 0.25 }] })
    const ns = new Mesh(new PlaneGeometry(4, 0.8), new MeshStandardMaterial({ map: nameTex, side: DoubleSide }))
    ns.position.set(-10, Y + 2.4, 6.9)
    R.add(ns)
    B.box(gold, -11.9, Y + 1.2, 6.9, 0.08, 2.4, 0.08)
    B.box(gold, -8.1, Y + 1.2, 6.9, 0.08, 2.4, 0.08)
    // 站台上的油灯柱与候车长凳
    const lanternGlow = glowMat(0xffb860, 4)
    for (const x of [-20, 6, 22]) {
      B.cyl(wood, x, Y + 1.6, 6.5, 0.07, 3.2, 8)
      B.box(wood, x + 0.3, Y + 3.1, 6.5, 0.7, 0.06, 0.06)
      B.box(gold, x + 0.55, Y + 2.78, 6.5, 0.22, 0.32, 0.22)
      B.add(new SphereGeometry(0.09, 10, 8), lanternGlow, trs(x + 0.55, Y + 2.76, 6.5))
      this.col.cyl(x, 6.5, 0.1, Y, Y + 3.2)
    }
    const lampP = new PointLight(0xffb060, 6, 7, 1.8)
    lampP.position.set(6.55, Y + 2.7, 6.5)
    R.add(lampP)
    for (const x of [-16, 13]) {
      B.box(wood, x, Y + 0.45, 6.4, 2.0, 0.07, 0.45)
      B.box(wood, x, Y + 0.85, 6.62, 2.0, 0.4, 0.05)
      for (const dx of [-0.85, 0.85]) B.box(ashlar, x + dx, Y + 0.21, 6.4, 0.2, 0.42, 0.4)
      this.col.slab(x, 6.45, 2.0, 0.5, Y, Y + 0.5, { surface: 'wood', tag: 'bench' })
    }
    await yieldFrame()

    // ---------- 驼队营地 ----------
    const tent = (x: number, z: number, r: number, h: number, m: MeshStandardMaterial) => {
      const g = new ConeGeometry(r, h, 6, 1, true)
      B.add(g, m, new Matrix4().makeTranslation(x, Y + h / 2, z))
      B.cyl(wood, x, Y + h / 2 + 0.2, z, 0.06, h + 0.4, 6)
      this.col.cyl(x, z, r * 0.85, Y, Y + h * 0.6, { tag: 'tent' })
    }
    tent(-15, 13, 3.2, 4.2, cloth)
    tent(14, 16, 2.6, 3.6, cloth2)
    tent(19, 10, 2.2, 3.0, cloth)
    // 大帐篷（可以进去，日记在里面）：四根柱子 + 布顶
    for (const [x, z] of [[-6, 17], [-1, 17], [-6, 21.5], [-1, 21.5]] as [number, number][]) {
      B.cyl(wood, x, Y + 1.5, z, 0.08, 3, 6)
      this.col.cyl(x, z, 0.12, Y, Y + 3)
    }
    const roof = new ConeGeometry(4, 1.6, 4, 1, true)
    roof.rotateY(Math.PI / 4)
    B.add(roof, cloth2, new Matrix4().makeScale(1, 1, 0.9).setPosition(-3.5, Y + 3.7, 19.25))
    B.box(cloth, -3.5, Y + 1.5, 21.6, 5, 3, 0.05)
    B.box(cloth, -6.1, Y + 1.5, 19.25, 0.05, 3, 4.6)
    this.col.slab(-3.5, 21.6, 5, 0.2, Y, Y + 3, { walkable: false })
    this.col.slab(-6.1, 19.25, 0.2, 4.6, Y, Y + 3, { walkable: false })
    B.box(std({ color: 0x6a2a2a, rough: 1 }), -3.5, Y + 0.01, 19.4, 4.4, 0.02, 3.6)
    B.box(wood, -4.6, Y + 0.3, 20.6, 1.2, 0.6, 0.6)
    this.col.slab(-4.6, 20.6, 1.2, 0.6, Y, Y + 0.6, { tag: 'chest', surface: 'wood' })
    const diary = new Mesh(boxGeo(0.28, 0.06, 0.2), std({ color: 0x5a3a24, rough: 0.8 }))
    diary.position.set(-4.6, Y + 0.64, 20.6)
    R.add(diary)
    const lampL = new PointLight(0xffb060, 14, 8, 1.8)
    lampL.position.set(-3.5, Y + 2.4, 19.2)
    R.add(lampL)
    // 箱子、木桶
    for (const [x, z, s] of [[8, 12, 1], [9.2, 12.4, 0.8], [-10, 9, 0.9], [11, 20, 1.1]] as [number, number, number][]) {
      B.box(wood, x, Y + s * 0.4, z, s * 0.9, s * 0.8, s * 0.9)
      this.col.slab(x, z, s * 0.9, s * 0.9, Y, Y + s * 0.8, { surface: 'wood', tag: 'crate' })
    }
    // 祭台与怀表
    B.box(ashlar, 0, Y + 0.5, 11, 1.4, 1, 1.0)
    B.box(gold, 0, Y + 1.02, 11, 1.5, 0.05, 1.1)
    this.col.slab(0, 11, 1.4, 1.0, Y, Y + 1.0, { tag: 'altar', walkable: false })
    this.watchMesh = itemModel('watch', '#e6b65c')
    this.watchMesh.scale.setScalar(0.22)
    this.watchMesh.position.set(0, Y + 1.25, 11)
    R.add(this.watchMesh)
    const altarLight = new PointLight(0xffc870, 8, 6, 2)
    altarLight.position.set(0, Y + 2, 11)
    R.add(altarLight)
    // 会被倒转的沙堆（里面埋着旧车票）
    const duneG = new CylinderGeometry(0.2, 1.8, 1.1, 20, 4)
    const duv2 = duneG.getAttribute('position')
    for (let i = 0; i < duv2.count; i++) duv2.setY(i, duv2.getY(i) + Math.sin(duv2.getX(i) * 3) * 0.06)
    duneG.computeVertexNormals()
    this.dune = new Mesh(duneG, sandM)
    this.dune.position.set(-13, Y + 0.45, 19)
    R.add(this.dune)
    this.duneTicket = new Mesh(boxGeo(0.16, 0.004, 0.08), std({ color: 0xe9dfc6, rough: 0.8 }))
    this.duneTicket.position.set(-13, Y + 0.03, 19)
    R.add(this.duneTicket)
    await yieldFrame()

    // ---------- 广场 ----------
    B.box(flag, 0, Y - 0.3, 54, 44, 0.6, 20, 0, 3)
    for (const [x, z] of [[-14, 50], [14, 50], [-14, 60], [14, 60]] as [number, number][]) {
      this.column(B, ashlar, x, z, 5.2)
      B.box(gold, x, Y + 6.1, z, 1.8, 0.2, 1.8)
      this.col.cyl(x, z, 0.75, Y, Y + 6)
      this.col.slab(x, z, 1.6, 1.6, Y, Y + 0.4, { walkable: false, tag: 'colBase' })
    }
    // 营地边缘的断柱与滚落的柱段
    for (const [x, z, h] of [[24, 18, 2.6], [-22.5, 21, 1.4], [-25, 8, 3.4]] as [number, number, number][]) {
      this.column(B, ashlar, x, z, h, true)
      this.col.cyl(x, z, 0.75, Y, Y + 0.6 + h)
      this.col.slab(x, z, 1.6, 1.6, Y, Y + 0.4, { walkable: false, tag: 'colBase' })
    }
    for (const [x, z, yaw] of [[21.6, 20.6, 0.4], [-20.4, 22.8, 1.9]] as [number, number, number][]) {
      B.add(this.flutedGeo(0.7, 1.3), ashlar, trs(x, Y + 0.62, z, 0, yaw, Math.PI / 2))
      this.col.box(x, Y + 0.62, z, 1.3, 1.24, 1.24, { yaw, tag: 'drum', walkable: false })
    }
    // 塔基（钟塔立起来时站在这里）
    B.box(gold, 0, Y + 0.02, 49.2, 5.6, 0.04, 5.6)

    // ---------- 钟塔（可以倒下 / 立起的时间物体） ----------
    this.buildSpire(ashlar, gold)
    R.add(this.spire)
    this.spire.position.copy(HINGE)
    // 碰撞：倒下时是桥（顶面与地面齐平）；立起时是空心的塔
    const f = this.col.slab(0, HINGE.z - SPIRE.len / 2, SPIRE.w, SPIRE.len, HINGE.y, HINGE.y + SPIRE.d, { surface: 'stone', tag: 'spireBridge' })
    this.spireCols.fallen.push(f)
    const z0 = HINGE.z, z1 = HINGE.z + SPIRE.d, yTop = HINGE.y + SPIRE.len
    const up = this.spireCols.upright
    up.push(this.col.slab(-2.0, (z0 + z1) / 2, 0.4, SPIRE.d, HINGE.y, yTop, { tag: 'spireWall', walkable: false }))
    up.push(this.col.slab(2.0, (z0 + z1) / 2, 0.4, SPIRE.d, HINGE.y, yTop, { tag: 'spireWall', walkable: false }))
    up.push(this.col.slab(0, z1 - 0.2, SPIRE.w, 0.4, HINGE.y, yTop, { tag: 'spireWall', walkable: false }))
    up.push(this.col.slab(-1.5, z0 + 0.2, 1.4, 0.4, HINGE.y, yTop, { tag: 'spireWall', walkable: false }))
    up.push(this.col.slab(1.5, z0 + 0.2, 1.4, 0.4, HINGE.y, yTop, { tag: 'spireWall', walkable: false }))
    up.push(this.col.slab(0, z0 + 0.2, 1.6, 0.4, Y + 2.4, yTop, { tag: 'spireWall', walkable: false }))
    up.push(this.col.slab(0, (z0 + z1) / 2, 3.6, 3.6, HINGE.y, Y, { surface: 'stone', tag: 'spireFloor' }))
    up.push(this.col.slab(0, (z0 + z1) / 2, SPIRE.w, SPIRE.d, yTop - 0.4, yTop, { tag: 'spireRoof' }))
    // 升降台（塔内）
    const lp = new Mesh(boxGeo(3.2, 0.2, 3.2), gold)
    lp.position.y = -0.1
    this.lift.add(lp)
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as [number, number][]) {
      const c = new Mesh(new CylinderGeometry(0.03, 0.03, 1.0, 6), gold)
      c.position.set(x, 0.5, z)
      this.lift.add(c)
    }
    R.add(this.lift)
    this.liftCol = this.col.slab(0, HINGE.z + SPIRE.d / 2, 3.2, 3.2, Y - 0.2, Y, { surface: 'metal', tag: 'lift' })
    await yieldFrame()

    // ---------- 悬浮的钟表碎片 ----------
    const numerals = ['XII', 'III', 'VI', 'IX', 'I', 'VII', 'X', 'IV']
    numerals.forEach((n, i) => {
      const tex = textTexture({ w: 256, h: 256, lines: [{ text: n, size: 0.5, color: '#e8c070', font: DISPLAY, y: 0.5, weight: '600' }] })
      const m = new Mesh(new PlaneGeometry(3, 3), new MeshStandardMaterial({ map: tex, transparent: true, side: DoubleSide, emissive: 0xffb050, emissiveMap: tex, emissiveIntensity: 0.6 }))
      const a = (i / numerals.length) * Math.PI * 2
      m.position.set(Math.cos(a) * 40, 16 + Math.sin(i * 1.7) * 6, 40 + Math.sin(a) * 30)
      m.rotation.set(Math.sin(i) * 0.5, a, Math.cos(i) * 0.4)
      this.fragmentsG.add(m)
    })
    for (let i = 0; i < 14; i++) {
      const gear = new Mesh(new TorusGeometry(0.8 + Math.random() * 1.6, 0.2, 6, 18), gold)
      gear.position.set((Math.random() - 0.5) * 90, 6 + Math.random() * 22, 10 + Math.random() * 70)
      gear.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      this.fragmentsG.add(gear)
    }
    R.add(this.fragmentsG)
    // 碎片 / 建筑部件：怀表启动后从地面浮起、悬在空中
    const dCount = Math.round(220 * q.particles + 60)
    this.debrisMat = std({ color: 0xc8a07a, map: TEX.stone(), rough: 0.85 })
    const du = this.debrisU
    this.debrisMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, du)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aD;\nuniform float uRise; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float r = smoothstep(aD.w * 0.4, aD.w * 0.4 + 0.6, uRise);
          float ang = r * aD.z * 3.0;
          mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
          transformed.xy = rot * transformed.xy;
          transformed.y += r * aD.y + sin(uTime * 0.2 + aD.x) * 0.05 * r;`)
    }
    this.debrisMat.customProgramCacheKey = () => 'debris'
    const dg = new IcosahedronGeometry(0.5, 0)
    this.debris = new InstancedMesh(dg, this.debrisMat, dCount)
    const ad = new Float32Array(dCount * 4)
    const m4 = new Matrix4()
    for (let i = 0; i < dCount; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 6 + Math.random() * 45
      const x = Math.cos(a) * r, z = 30 + Math.sin(a) * r * 0.9
      if (z > 22 && z < 46 && Math.abs(x) < 6) continue
      const s = 0.2 + Math.random() * Math.random() * 2.2
      m4.compose(v3(x, Y + s * 0.3, z), new Quaternion().setFromAxisAngle(v3(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 3), v3(s, s * (0.6 + Math.random()), s))
      this.debris.setMatrixAt(i, m4)
      ad[i * 4] = Math.random() * 10
      ad[i * 4 + 1] = (2 + Math.random() * 14) / s
      ad[i * 4 + 2] = Math.random() - 0.5
      ad[i * 4 + 3] = Math.random()
    }
    dg.setAttribute('aD', new InstancedBufferAttribute(ad, 4))
    this.debris.castShadow = true
    this.debris.frustumCulled = false
    R.add(this.debris)
    // 悬浮的沙粒
    this.sand = motes(Math.round(9000 * q.particles + 1500), 70, new Color(1.0, 0.72, 0.42), 0.035, new Vector2(0.8, 0.05))
    this.sand.mat.uniforms.uFreeze.value = 1
    R.add(this.sand.points)
    // 凝固的沙暴墙
    this.storm = new ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec2 p = vec2(vUv.x * 12.0, vUv.y * 4.0);
          float c = fbm(p + vec2(fbm(p * 0.7) * 2.0, 0.0));
          float top = smoothstep(0.95, 0.55, vUv.y + (c - 0.5) * 0.35);
          vec3 col = mix(vec3(0.55, 0.32, 0.2), vec3(1.0, 0.68, 0.42), c) * (0.55 + vUv.y * 0.6);
          gl_FragColor = vec4(col, top * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * 0.92);
        }`,
      transparent: true, depthWrite: false, side: DoubleSide, fog: true,
    })
    ;(this.storm as unknown as { fog: boolean }).fog = false
    const stormG = new CylinderGeometry(520, 520, 180, 64, 1, true, Math.PI * 0.55, Math.PI * 0.9)
    const stormM = new Mesh(stormG, this.storm)
    stormM.position.set(0, 70, 120)
    R.add(stormM)

    // ---------- 灯光 ----------
    R.add(new HemisphereLight(0xa8a0d8, 0x8a5a3a, 0.9))
    const sun = new DirectionalLight(0xffb070, 3.6)
    sun.position.set(80, 20, -60)
    sun.target.position.set(0, 0, 35)
    sun.castShadow = q.shadows
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
    const sc = sun.shadow.camera
    sc.left = -60; sc.right = 60; sc.top = 50; sc.bottom = -40; sc.near = 10; sc.far = 260
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.04
    sun.shadow.radius = 3
    R.add(sun, sun.target)
    const clockLight = new PointLight(0xffd080, 10, 9, 1.8)
    clockLight.position.set(0, LIFT_TOP + 2.5, HINGE.z + 2.2)
    R.add(clockLight)
    this.clockLight = clockLight

    B.build(R, 'desert')
    this.setupTime()
    this.buildInteractions()
    this.applySpire(true)
    this.own(() => {
      this.rewindSound?.stop()
      setUI({ timeHud: null })
    })
  }

  private clockLight!: PointLight

  /** 带凹槽的柱身（16 道竖槽），UV 按真实尺寸铺砌块纹理 */
  private flutedGeo(r: number, h: number) {
    const g = new CylinderGeometry(r, r, h, 64, 1)
    const pos = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      if (Math.hypot(x, z) < 1e-4) continue
      const k = 1 - 0.07 * Math.pow(Math.max(0, Math.cos(Math.atan2(z, x) * 16)), 0.6)
      pos.setX(i, x * k)
      pos.setZ(i, z * k)
    }
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / 1.5, (uv.getY(i) * h) / 1.5)
    g.computeVertexNormals()
    return g
  }

  /** 石柱：方形柱础 + 圆盘 + 凹槽柱身 + 柱头；broken 时柱身上端是参差的断口 */
  private column(B: Batcher, m: MeshStandardMaterial, x: number, z: number, h: number, broken = false) {
    B.box(m, x, Y + 0.2, z, 1.6, 0.4, 1.6)
    B.cyl(m, x, Y + 0.5, z, 0.85, 0.2, 32)
    B.add(this.flutedGeo(0.7, h), m, trs(x, Y + 0.6 + h / 2, z))
    if (broken) {
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + x
        B.add(new IcosahedronGeometry(0.32, 0), m, trs(x + Math.cos(a) * 0.38, Y + 0.6 + h + 0.05, z + Math.sin(a) * 0.38, a, a * 0.5, 0, 1, 0.5 + (i % 3) * 0.3, 1))
      }
    } else {
      B.cyl(m, x, Y + 0.6 + h + 0.15, z, 0.7, 0.3, 32, 0.92)
    }
  }

  private buildSpire(stone: MeshStandardMaterial, gold: MeshStandardMaterial) {
    // 塔的局部坐标：铰链在原点，塔身沿 +y 长 26，厚度沿 +z 4.4，x ∈ [-2.2, 2.2]
    const SB = new Batcher()
    const L = SPIRE.len, W = SPIRE.w, D = SPIRE.d
    const t = 0.4
    // 四面墙（正面 z=0 留门洞：门在 y ∈ [4.4, 6.8]）
    SB.box(stone, -W / 2 + t / 2, L / 2, D / 2, t, L, D, 0, 2)
    SB.box(stone, W / 2 - t / 2, L / 2, D / 2, t, L, D, 0, 2)
    SB.box(stone, 0, L / 2, D - t / 2, W - 2 * t, L, t, 0, 2)
    SB.box(stone, -1.5, L / 2, t / 2, 1.4, L, t, 0, 2)
    SB.box(stone, 1.5, L / 2, t / 2, 1.4, L, t, 0, 2)
    SB.box(stone, 0, (6.8 + L) / 2, t / 2, 1.6, L - 6.8, t, 0, 2)
    SB.box(stone, 0, 2.2, t / 2, 1.6, 4.4, t, 0, 2)
    SB.box(stone, 0, 2.2, D / 2, W - 2 * t, 4.4, D - 2 * t, 0, 2)
    SB.box(stone, 0, L - 0.2, D / 2, W, 0.4, D)
    // 金色饰带
    for (const y of [6.9, 12, 17, 22]) SB.box(gold, 0, y, D / 2, W + 0.1, 0.18, D + 0.1)
    // 尖顶
    SB.add(new ConeGeometry(3.2, 6, 4), gold, new Matrix4().makeRotationY(Math.PI / 4).setPosition(0, L + 3, D / 2))
    // 门框
    SB.box(gold, -0.85, 5.6, -0.02, 0.1, 2.5, 0.1)
    SB.box(gold, 0.85, 5.6, -0.02, 0.1, 2.5, 0.1)
    SB.box(gold, 0, 6.85, -0.02, 1.8, 0.1, 0.1)
    SB.build(this.spire, 'spire')
    // 钟面：塔外（朝 -z）和塔内（朝 +z）
    const faceTex = textTexture({ w: 512, h: 512, bg: '#efe2c0', lines: [
      { text: 'XII', size: 0.1, color: '#3a2a1a', font: DISPLAY, y: 0.1, weight: '600' }, { text: 'VI', size: 0.1, color: '#3a2a1a', font: DISPLAY, y: 0.9, weight: '600' },
      { text: 'III', size: 0.1, color: '#3a2a1a', font: DISPLAY, y: 0.5, x: 0.9, weight: '600' }, { text: 'IX', size: 0.1, color: '#3a2a1a', font: DISPLAY, y: 0.5, x: 0.1, weight: '600' },
    ] })
    for (const [z, rot, hm, hh] of [[-0.03, Math.PI, this.handMOut, this.handHOut], [t + 0.02, 0, this.handM, this.handH]] as [number, number, Group, Group][]) {
      const face = new Mesh(new CylinderGeometry(1.5, 1.5, 0.05, 48), new MeshStandardMaterial({ map: faceTex, roughness: 0.6, emissive: 0xffe0a0, emissiveMap: faceTex, emissiveIntensity: 0.25 }))
      face.rotation.set(Math.PI / 2, rot, 0)
      face.position.set(0, LIFT_TOP + 2.2 - HINGE.y, z)
      this.spire.add(face)
      const mk = (len: number, wid: number, col: number) => {
        const g = new Group()
        const m = new Mesh(boxGeo(wid, len, 0.04), std({ color: col, rough: 0.35, metal: 0.8 }))
        m.position.y = len / 2 - 0.1
        g.add(m)
        return g
      }
      hm.add(mk(1.3, 0.09, 0x1a1410).children[0])
      hh.add(mk(0.9, 0.14, 0x2a1a10).children[0])
      for (const h of [hm, hh]) {
        h.position.set(0, LIFT_TOP + 2.2 - HINGE.y, z + (z < 0 ? -0.04 : 0.04) * (h === hh ? 1 : 2))
        this.spire.add(h)
      }
    }
    // 碎片的笼子（塔顶房间中央，悬在天花板下）
    this.cage = new Group()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const bar = new Mesh(new CylinderGeometry(0.02, 0.02, 0.9, 6), gold)
      bar.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35)
      this.cage.add(bar)
    }
    const ringT = new Mesh(new TorusGeometry(0.35, 0.03, 6, 24), gold)
    ringT.rotation.x = Math.PI / 2
    ringT.position.y = 0.45
    this.cage.add(ringT)
    this.cage.position.set(0, LIFT_TOP + 2.0 - HINGE.y, D / 2 + 0.7)
    this.spire.add(this.cage)
    this.fragment = itemModel('fragment', '#f0c36a')
    this.fragment.scale.setScalar(0.3)
    this.fragment.position.copy(this.cage.position)
    this.spire.add(this.fragment)
  }

  // ---------------- 时间物体 ----------------
  private setupTime() {
    const load = (o: TimeObj) => {
      const t = S.flag(`desert.t.${o.id}`)
      const m = S.flag(`desert.m.${o.id}`)
      if (typeof t === 'number') o.t = t
      if (m === 'run' || m === 'pause') o.mode = m
      this.objs[o.id] = o
      return o
    }
    const spire = load(makeTimeObj('spire', 1, 0.11, { rewindK: 0.75, snaps: [0, 1], snapTol: 0.05 }))
    const lift = load(makeTimeObj('lift', 1, 0.09, { rewindK: 1.6 }))
    const mh = load(makeTimeObj('minute', 0.33, 1 / 6, { cyclic: true, snaps: [0], snapTol: 0.035, rewindK: 1.2 }))
    const hh = load(makeTimeObj('hour', 0.66, -1 / 10, { cyclic: true, snaps: [0], snapTol: 0.035, rewindK: 1.2 }))
    const dune = load(makeTimeObj('dune', 1, 0.05, { rewindK: 3 }))
    const b = () => this.game.player.body
    const spireW = () => new Vector3().setFromMatrixPosition(this.spire.matrixWorld)
    this.targets = [
      {
        obj: spire, name: '倒下的钟塔', radius: 4.5,
        center: () => {
          const a = this.spireAngle()
          return spireW().add(v3(0, Math.cos(a) * 12, -Math.sin(a) * 12))
        },
        allowed: () => {
          const p = b()
          const inSweep = Math.abs(p.x) < 3.4 && p.z > HINGE.z - SPIRE.len - 1 && p.z < HINGE.z + SPIRE.d + 0.5 && p.y < HINGE.y + SPIRE.len + 1
          return inSweep ? '你站在钟塔会经过的地方。先退到一旁。' : null
        },
      },
      {
        obj: lift, name: '塔内的升降台', radius: 1.8,
        center: () => v3(0, Y + lift.t * (LIFT_TOP - Y), HINGE.z + SPIRE.d / 2),
        allowed: () => (this.spireUp() ? null : '升降台被压在倒下的塔身里。'),
      },
      {
        obj: mh, name: '分针（向前）', radius: 0.45,
        center: () => this.handTip(this.handM, 1.1),
        allowed: () => (this.spireUp() ? null : '钟面朝着地面，看不见指针。'),
      },
      {
        obj: hh, name: '时针（向后）', radius: 0.45,
        center: () => this.handTip(this.handH, 0.7),
        allowed: () => (this.spireUp() ? null : '钟面朝着地面，看不见指针。'),
      },
      { obj: dune, name: '一小堆沙', radius: 1.4, center: () => v3(-13, Y + 0.5, 19), allowed: () => null },
    ]
  }

  private handTip(h: Group, len: number) {
    const p = new Vector3(0, len, 0)
    h.updateWorldMatrix(true, false)
    return p.applyMatrix4(h.matrixWorld)
  }

  private spireAngle() {
    // t=0 立起，t=1 倒下（绕 x 轴 -90°）
    const t = this.objs.spire.t
    const e = t * t * (3 - 2 * t) * 0.15 + t * 0.85
    return e * Math.PI / 2
  }

  private spireUp() {
    return this.objs.spire.t <= 0.0001 && this.objs.spire.mode === 'pause'
  }

  /** 根据钟塔时间线更新模型与碰撞 */
  private applySpire(force = false) {
    const t = this.objs.spire.t
    this.spire.rotation.x = -this.spireAngle()
    const fallen = t >= 0.9999
    const upright = t <= 0.0001
    for (const c of this.spireCols.fallen) c.enabled = fallen
    for (const c of this.spireCols.upright) c.enabled = upright
    // 升降台只在塔立起时存在
    const lt = this.objs.lift.t
    this.lift.visible = upright || force ? upright : this.lift.visible
    this.lift.position.set(0, Y + lt * (LIFT_TOP - Y), HINGE.z + SPIRE.d / 2)
    this.liftCol.enabled = upright
    this.liftCol.minY = this.lift.position.y - 0.2
    this.liftCol.maxY = this.lift.position.y
    if (upright && !S.is('desert.spireUp')) {
      S.set('desert.spireUp')
      this.game.say('', '钟塔重新站了起来。塔门就在面前。', 3.5)
      this.game.sfx('clockStrike', v3(0, 20, HINGE.z))
      this.game.refresh()
    }
    if (fallen && this.lastSpireT < 0.999 && !force) this.game.sfx('heavy', v3(0, 2, 35), 1)
    this.lastSpireT = t
  }

  // ---------------- 交互 ----------------
  private buildInteractions() {
    const g = this.game
    this.item({
      id: 'watch', pos: v3(0, Y + 1.25, 11), radius: 0.35, label: '还在走的怀表', verb: '拿起',
      enabled: () => !S.has('watch'),
      use: () => {
        S.set('desert.watch')
        g.pickup('watch')
        this.activateTime()
      },
    })
    this.item({
      id: 'diary', pos: v3(-4.6, Y + 0.66, 20.6), radius: 0.3, label: '沙里的日记', verb: '阅读',
      use: () => g.archive('a4'),
    })
    this.item({
      id: 'lost4', pos: v3(-13, Y + 0.05, 19), radius: 0.35, label: '沙里露出的车票', verb: '拾取',
      enabled: () => this.objs.dune.t < 0.15 && !S.get().collectibles.includes('t4'),
      use: () => { g.collect('t4'); this.duneTicket.visible = false },
    })
    this.item({
      id: 'fragment', pos: v3(0, LIFT_TOP + 2.0, HINGE.z + SPIRE.d / 2 + 0.7), radius: 0.5, label: '笼中的碎片', verb: () => (S.is('desert.clock') ? '取下' : '笼门锁着'),
      enabled: () => this.spireUp() && !S.is('desert.fragment'),
      blocked: () => (S.is('desert.clock') ? null : '笼子锁着。锁孔的形状像钟面上的 12。'),
      use: () => {
        S.set('desert.fragment')
        g.pickup('fragment_desert')
        g.sfx('success')
        g.say('', '碎片里的光一动不动。你知道，它会一直停在这一秒。', 4)
        this.fragment.visible = false
      },
    })
    this.item({
      id: 'hands', pos: v3(0, LIFT_TOP + 2.2, HINGE.z + 0.5), radius: 0.6, label: '停在 12 点的指针', verb: '拆下',
      enabled: () => this.spireUp() && S.is('desert.clock') && !S.has('hands') && !S.is('desert.handsTaken'),
      use: () => {
        S.set('desert.handsTaken')
        g.pickup('hands')
        g.say('', '指针很沉。它们本该属于另一座钟——一座一直停在零点的钟。', 4.5)
        this.handM.visible = false
        this.handH.visible = false
      },
    })
    this.item({
      id: 'clockFace', pos: v3(0, LIFT_TOP + 2.2, HINGE.z + 0.45), radius: 1.5, range: 3.5, label: '塔钟', verb: '查看',
      enabled: () => this.spireUp() && !S.is('desert.clock'),
      use: () => g.say('', '分针在向前走，时针却在倒着走。要让它们同时停在 12 点。', 4),
    })
    this.trigger({
      id: 'crossed', min: v3(-22, 0, 44), max: v3(22, 6, 64),
      enter: () => { if (!S.is('desert.crossed')) { S.set('desert.crossed'); g.refresh() } },
    })
    this.trigger({
      id: 'top', min: v3(-2, LIFT_TOP - 0.5, HINGE.z), max: v3(2, LIFT_TOP + 3, HINGE.z + SPIRE.d),
      enter: () => { if (!S.is('desert.top')) { S.set('desert.top'); g.say('', '塔顶的钟就在眼前。', 2.5); g.refresh() } },
    })
  }

  /** Moment 4 · 时间冻结：拿起怀表的一刻，沙粒、碎片和建筑部件从地面升起，悬停在空中 */
  activateTime(cinematic = true) {
    const g = this.game
    this.riseTarget = 1
    g.sfx('timeStop')
    g.fx.flash.setRGB(0.6, 0.45, 0.25)
    this.env.fx.freeze = 0.55
    S.set('desert.frozen')
    const p = g.player.eye.clone()
    if (cinematic) {
      void g.cinematic([
        {
          dur: 7, ease: 'inOut', fov: [60, 74],
          from: [p.clone().add(v3(0, 0.2, -2)), p.clone().add(v3(5, 2.5, -4)), p.clone().add(v3(9, 6, 4))],
          look: [p.clone(), p.clone().add(v3(0, 1.5, 6)), p.clone().add(v3(0, 4, 14))],
          tick: (k) => { this.rise = Math.max(this.rise, k) },
        },
      ], { letterbox: true }).then(() => {
        g.say('', '你按下怀表。整个世界停在了你的掌心里。[R] 倒转 · [F] 暂停 / 恢复', 5)
        g.moment('freeze')
        g.refresh()
      })
    } else {
      this.rise = 1
    }
  }

  update(dt: number, t: number) {
    const g = this.game
    // 读档时：已拿到怀表则世界处于“时间视觉”
    if (S.is('desert.frozen') && this.riseTarget === 0) {
      this.riseTarget = 1
      this.rise = 1
      this.env.fx.freeze = 0.55
    }
    this.rise += (this.riseTarget - this.rise) * (1 - Math.exp(-dt * 0.6))
    this.debrisU.uRise.value = this.rise
    this.debrisU.uTime.value = t
    // ---- 时间能力输入 ----
    const hasWatch = S.has('watch')
    let aim: TimeTarget | null = null
    if (hasWatch && g.docked && !g.inCinematic) {
      const eye = g.player.eye, f = g.player.forward
      // 选“最接近准星中心”的物体（偏离距离 / 半径 最小），而不是最近的，避免大物体挡住它里面的小物体
      let best = 1
      for (const tg of this.targets) {
        const c = tg.center()
        const to = c.clone().sub(eye)
        const tc = to.dot(f)
        if (tc < 0 || tc > 40) continue
        const d = Math.sqrt(Math.max(0, to.lengthSq() - tc * tc)) / tg.radius
        if (d < best) { best = d; aim = tg }
      }
    }
    const R = g.keys.down('KeyR')
    if (this.rewinding && (!R || !aim || aim.obj !== this.rewinding)) {
      endRewind(this.rewinding)
      this.persist(this.rewinding)
      this.rewinding = null
      this.rewindSound?.stop()
      this.rewindSound = null
      g.sfx('timeResume', undefined, 0.6)
    }
    if (aim) {
      const why = aim.allowed()
      if (R && !this.rewinding) {
        if (why) {
          if (g.keys.hit('KeyR')) { g.sfx('deny'); g.say('', why, 2.5) }
        } else {
          this.rewinding = aim.obj
          startRewind(aim.obj)
          this.rewindSound = g.audio.noiseLoop('pink', 'bandpass', 300, 1.5, 0.15)
        }
      }
      if (g.keys.hit('KeyF')) {
        if (why) { g.sfx('deny'); g.say('', why, 2.5) }
        else {
          togglePause(aim.obj)
          g.sfx(aim.obj.mode === 'pause' ? 'timeStop' : 'timeResume', undefined, 0.7)
          this.persist(aim.obj)
          this.checkClock()
        }
      }
    }
    if (hasWatch) {
      const st = aim ? (aim.obj.mode === 'rewind' ? 'rewind' : aim.obj.mode) : null
      const cur = ui().timeHud
      const name = aim ? aim.name : null
      if (!cur || cur.target !== name || cur.state !== st) setUI({ timeHud: { target: name, state: st } })
    }
    if (this.rewindSound) this.rewindSound.freq?.(300 + Math.sin(t * 6) * 120 + 400)
    // ---- 推进时间物体 ----
    for (const o of Object.values(this.objs)) stepTime(o, dt)
    // 升降台不会压到人：玩家站在它下方时，它最低只降到头顶上方
    {
      const p = g.player.body, lift = this.objs.lift
      const under = Math.abs(p.x) < 1.9 && Math.abs(p.z - (HINGE.z + SPIRE.d / 2)) < 1.9 && p.y < Y + lift.t * (LIFT_TOP - Y) - 0.4
      if (under) {
        const minT = (p.y + 1.9 - Y) / (LIFT_TOP - Y)
        if (lift.t < minT) lift.t = Math.min(1, minT)
      }
    }
    // 指针自然流动时的滴答
    this.tickAcc += dt
    if (this.tickAcc > 0.5) {
      this.tickAcc = 0
      if (this.objs.minute.mode !== 'pause' || this.objs.hour.mode !== 'pause') g.sfx('tick', v3(0, 20, HINGE.z), 0.7)
    }
    this.applySpire()
    this.handM.rotation.z = -this.objs.minute.t * Math.PI * 2
    this.handH.rotation.z = -this.objs.hour.t * Math.PI * 2
    this.handMOut.rotation.z = this.objs.minute.t * Math.PI * 2
    this.handHOut.rotation.z = this.objs.hour.t * Math.PI * 2
    // 沙堆：倒转后沙子流走，露出车票
    const dt0 = this.objs.dune.t
    this.dune.scale.set(0.2 + dt0 * 0.8, Math.max(0.02, dt0), 0.2 + dt0 * 0.8)
    this.dune.position.y = Y + 0.55 * dt0 - 0.05
    this.duneTicket.visible = !S.get().collectibles.includes('t4')
    // 动画
    this.watchMesh.visible = !S.has('watch')
    this.watchMesh.rotation.y += dt * 0.8
    this.fragment.rotation.y += dt * 0.5
    this.fragment.visible = !S.is('desert.fragment')
    this.cage.visible = !S.is('desert.clock')
    if (S.is('desert.handsTaken')) { this.handM.visible = false; this.handH.visible = false }
    this.fragmentsG.children.forEach((c, i) => { c.rotation.y += dt * 0.02 * (i % 2 ? 1 : -1) * (1 - this.rise * 0.9) })
    this.sand.mat.uniforms.uTime.value = t
    const cl = g.camera.position.clone()
    this.root.worldToLocal(cl)
    ;(this.sand.mat.uniforms.uC.value as Vector3).copy(cl)
    this.clockLight.intensity = this.spireUp() ? 10 : 0
    // 周期性存档时间线
    this.saveAcc += dt
    if (this.saveAcc > 1.5) {
      this.saveAcc = 0
      for (const o of Object.values(this.objs)) if (o.mode !== 'pause') this.persist(o)
    }
    // 声音：寂静（时间停止）
    g.audio.setRain(0)
    g.audio.setWind(S.has('watch') ? 0.05 : 0.25, 0.4)
    g.audio.setSea(0)
    g.audio.setOpenness(1)
  }

  private persist(o: TimeObj) {
    S.set(`desert.t.${o.id}`, Math.round(o.t * 10000) / 10000)
    S.set(`desert.m.${o.id}`, o.mode === 'rewind' ? 'run' : o.mode)
  }

  private checkClock() {
    const m = this.objs.minute, h = this.objs.hour
    const at12 = (o: TimeObj) => o.mode === 'pause' && (o.t < 1e-4 || o.t > 1 - 1e-4)
    if (!S.is('desert.clock') && at12(m) && at12(h)) {
      S.set('desert.clock')
      this.game.sfx('clockStrike', v3(0, 20, HINGE.z))
      this.game.sfx('success')
      this.game.say('', '两根指针在 12 点重合。笼子的锁“咔”地弹开了。', 4)
      this.game.refresh()
    }
  }

  onDocked() {
    if (S.is('desert.frozen')) {
      this.rise = 1
      this.riseTarget = 1
      this.env.fx.freeze = 0.55
    }
  }

  /** 展映：在营地里启动怀表 */
  momentShots(): Shot[] {
    const p = v3(0, Y + 1.6, 9)
    return [{ dur: 9, ease: 'inOut', fov: [58, 76], from: [p.clone().add(v3(0, 0.2, -2)), p.clone().add(v3(6, 3, -4)), p.clone().add(v3(10, 7, 6))], look: [p.clone().add(v3(0, 0, 2)), p.clone().add(v3(0, 2, 8)), p.clone().add(v3(0, 5, 18))], tick: (k) => { this.rise = Math.max(this.rise, k) } }]
  }

  /** 测试辅助：直接操作时间物体 */
  _time() {
    return this.objs
  }
}

