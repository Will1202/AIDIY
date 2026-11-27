// 世界 4：记忆博物馆 / The Museum of Memories
// 列车停进一座无尽的展馆。每个展厅是一段记忆，有的房间会随着你的视角改变结构。
// 谜题：
//   「最初」厅 —— 错视：站进地上的金圈、朝正确方向看，散落的碎片拼成一幅画，玻璃罩打开 → 玩具火车
//   「离别」厅 —— 走廊尽头是一面墙；当你不看它的时候，它会变成一扇门 → 红伞
//   「等待」厅 —— 转动雕塑，让它在墙上投下的影子拼出 00:00 → 停走的手表
//   圆厅 —— 三段记忆放回对应的基座，馆长之门打开 → 镜厅：镜子里的人穿着列车长的制服
//   穿过镜子 —— 镜中世界：第一张车票、列车长人事档案、第四枚碎片
import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, RingGeometry, Scene, SphereGeometry, SpotLight, TorusGeometry, Vector3,
} from 'three'
import { World, v3 } from '../World'
import { Batcher, boxGeo, glowMat, std, trs, yieldFrame } from '../shared/kit'
import { TEX, fbm, makeTex } from '../shared/textures'
import { textTexture, MONO } from '../shared/text'
import { itemModel } from '../shared/itemModels'
import { memoryPainting, PAINTING_TITLES } from './paintings'
import { Conductor } from '../shared/Conductor'
import { PEDESTALS, MEMORY_ITEMS, pedestalsSolved, anamorphAligned, angleError, pixelText } from '../../puzzles/museum'
import { S } from '../../state/store'
import type { Collider } from '../../physics/collision'
import type { Shot } from '../../game/api'

const Y = 1.0
const ROT = { x: 0, z: 24, r: 8 }
const MIRROR_Z = 46
const VANTAGE = v3(-20, Y, 20)
const ANA_TARGET = v3(-13.2, 2.9, 27.4)
const TURN = v3(40, Y, 10)
const SPOT = v3(35.2, 3.3, 10)
const SOLUTION = 0

export class Museum extends World {
  readonly id = 'museum' as const
  private shards: { mesh: Mesh; from: Vector3; to: Vector3 }[] = []
  private anaT = 0
  private caseLids: Record<string, Object3D> = {}
  private exhibits: Record<string, Object3D> = {}
  private pedestalItems: Object3D[] = [new Group(), new Group(), new Group()]
  private curatorDoor!: Mesh
  private curatorCol!: Collider
  private corridorWall!: Mesh
  private corridorCol!: Collider
  private corridorDoor!: Group
  private sculpture = new Group()
  private theta = 1.9
  private mirrorCol!: Collider
  private mirrorGlass!: Mesh
  private avatar = new Conductor()
  private mirrorWorld = new Group()
  private firstTicket!: Mesh
  private fragment!: Object3D
  private lostFrame!: Mesh
  private beam!: Mesh

  constructor() {
    super()
    this.env.background = new Color(0x1a1612)
    this.env.fogColor = new Color(0x2a2420)
    this.env.fogDensity = 0.012
    this.env.score = 'museum'
    this.env.interior = 0.7
    this.env.fx = { exposure: 1.05, bloom: 0.5, bloomThreshold: 1.2, vignette: 0.5, grain: 0.03, saturation: 0.95, contrast: 1.05, tint: new Color(1.03, 1.0, 0.96), lift: new Color(0.02, 0.015, 0.01) }
    this.spawn = { x: 0, y: Y, z: 6, yaw: 0 }
    this.approachLength = 520
    this.approachTime = 22
    this.departLength = 520
    this.departTime = 13
  }

  envScene() {
    const s = new Scene()
    s.add(new Mesh(new SphereGeometry(50, 16, 8), new MeshBasicMaterial({ color: new Color(0.25, 0.22, 0.2), side: 1 })))
    const l = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial({ color: new Color(3, 2.8, 2.5) }))
    l.position.y = 20
    l.rotation.x = Math.PI / 2
    s.add(l)
    return s
  }

  async build() {
    const R = this.root
    const B = new Batcher()
    const marble = std({ color: 0xe8e2d8, map: TEX.marble(), rough: 0.18, env: 1.4 })
    const wall = std({ color: 0xece4d4, map: TEX.plaster(), rough: 0.9 })
    const dado = std({ color: 0x3a2418, map: TEX.wood(), rough: 0.55 })
    const wallDark = std({ color: 0x5a2a28, rough: 0.9 })
    const gold = std({ color: 0xc9a35a, rough: 0.3, metal: 1, map: TEX.brushed() })
    const velvet = std({ color: 0x6a1a1c, rough: 1 })
    const wood = std({ color: 0x4a2e1e, map: TEX.wood(), rough: 0.5 })
    const glass = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transparent: true, opacity: 0.12, depthWrite: false, clearcoat: 1, envMapIntensity: 2 })
    this.tm = {
      dado,
      panel: std({ color: 0x5a3a26, map: TEX.wood(), rough: 0.45 }),
      gold,
      base: std({ color: 0x1c1410, rough: 0.5 }),
      cornice: std({ color: 0xf4ecdc, map: TEX.plaster(), rough: 0.85 }),
    }

    // ---------- 站台 + 长廊展厅 ----------
    B.box(marble, 0, Y - 0.5, 7.8, 70, 1, 12.4, 0, 3)
    this.col.slab(0, 7.8, 70, 12.4, -2, Y, { surface: 'marble', tag: 'hall' })
    // 后墙：中间留出通往圆厅的门洞（碰撞体本来就有这个开口，之前画面上却是一整面墙）
    for (const sx of [-1, 1]) B.box(wall, sx * 18.25, 4, 14.2, 33.5, 6, 0.4, 0, 3)
    B.box(wall, 0, 6.1, 14.2, 3, 1.8, 0.4)
    B.box(wall, 0, 5.4, 15, 3.4, 0.4, 2.2)
    for (const sx of [-1, 1]) B.box(gold, sx * 1.6, Y + 2.1, 13.97, 0.18, 4.2, 0.1)
    B.box(gold, 0, Y + 4.27, 13.97, 3.38, 0.14, 0.1)
    B.box(wall, 0, 7.2, 9, 70, 0.4, 10.8)
    for (const [a, b] of [[-35, -1.5], [1.5, 35]] as [number, number][]) this.col.slab((a + b) / 2, 14.2, b - a, 0.4, Y, 7, { walkable: false })
    this.col.slab(-35, 8, 0.4, 12.4, Y, 7, { walkable: false })
    this.col.slab(35, 4.3, 0.4, 5.4, Y, 7, { walkable: false })
    this.col.slab(35, 13, 0.4, 2, Y, 7, { walkable: false })
    this.col.slab(0, -2.5, 900, 3, -1, 0, { surface: 'marble', tag: 'bed', safe: false })
    // 隧道式的车道：轨道从展馆中穿过
    B.box(std({ color: 0x2a2420, rough: 0.6 }), 0, -0.25, 0, 900, 0.5, 4.2, 0, 3)
    for (const z of [-0.72, 0.72]) B.box(gold, 0, 0.06, z, 900, 0.12, 0.08, 0, 4)
    for (let x = -440; x <= 440; x += 9) {
      B.box(wall, x, 4.2, -2.6, 1.2, 8.4, 1.2)
      B.boxR(wall, x, 8.2, 0.5, 1.0, 0.6, 7.0, 0, 0, 0)
    }
    B.box(wall, 0, 8.6, 1.5, 900, 0.4, 9)
    // 长廊的画（程序化的“其他世界”）
    // 长廊的八幅画：这趟旅程里的八个地方（雨夜站台、倒悬都市、深海的鲸、落日沙漠、回廊、黎明、隧道、末班车）
    const paintingXs = [-30, -24, -14, -8, 8, 14, 24, 30]
    // 描金画框：金属度低一些，靠漫反射也能显出金色（纯金属在这里只反射暗色的环境）
    const frameGold = std({ color: 0xb8913f, rough: 0.42, metal: 0.55, map: TEX.brushed() })
    paintingXs.forEach((x, i) => {
      const w = 2.4 + (i % 3) * 0.6, h = 1.6 + (i % 2) * 0.5
      const tex = makeTex(`memPaint${i}`, 192, memoryPainting(i, w / h))
      const p = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: tex, roughness: 0.7 }))
      // 画面必须在画框前面：画框盒子的正面在 z = 13.97（之前画放在 13.98，被画框整个挡住，长廊里只看得到八块深色板子）
      p.position.set(x, 3.4, 13.955)
      p.rotation.y = Math.PI
      R.add(p)
      B.box(frameGold, x, 3.4, 14.0, w + 0.25, h + 0.25, 0.06)
      const lamp = new Mesh(boxGeo(0.8, 0.05, 0.1), glowMat(0xffe0b0, 4))
      lamp.position.set(x, 3.4 + h / 2 + 0.35, 13.9)
      R.add(lamp)
      const label = new Mesh(new PlaneGeometry(0.62, 0.15), new MeshStandardMaterial({ map: textTexture({ w: 320, h: 80, bg: '#e8e0d0', lines: [{ text: PAINTING_TITLES[i], size: 0.36, color: '#2a2018', y: 0.42 }, { text: `NO. ${i + 1}`, size: 0.16, color: '#7a6a58', font: MONO, y: 0.8 }] }), roughness: 0.8 }))
      // 展签挂在画的右侧（观众视角），底边与画框齐平
      label.position.set(x - w / 2 - 0.45, 3.4 - h / 2 + 0.12, 13.97)
      label.rotation.y = Math.PI
      R.add(label)
    })
    // 镶在画框里的旧车票（失落的车票 #5）
    this.lostFrame = new Mesh(boxGeo(0.4, 0.2, 0.01), std({ color: 0xd8c8a0, rough: 0.8 }))
    this.lostFrame.position.set(-19, 3.0, 13.96)
    R.add(this.lostFrame)
    B.box(gold, -19, 3.0, 14.0, 0.8, 0.6, 0.05)
    const tag = new Mesh(new PlaneGeometry(0.5, 0.12), new MeshStandardMaterial({ map: textTexture({ w: 256, h: 64, bg: '#e8e0d0', lines: [{ text: '无题 · Untitled', size: 0.4, color: '#333', y: 0.55 }] }) }))
    tag.position.set(-19, 2.55, 13.97)
    tag.rotation.y = Math.PI
    R.add(tag)
    const nameTex = textTexture({ w: 1024, h: 200, bg: '#2a1c18', border: '#c9a35a', lines: [{ text: '记 忆 博 物 馆', size: 0.38, color: '#f3e8d8', y: 0.42 }, { text: 'THE MUSEUM OF MEMORIES · PERMANENT COLLECTION', size: 0.11, color: '#c9a35a', font: MONO, y: 0.8, spacing: 0.2 }] })
    const ns = new Mesh(new PlaneGeometry(4.2, 0.8), new MeshStandardMaterial({ map: nameTex }))
    ns.position.set(0, 5.8, 13.98)
    ns.rotation.y = Math.PI
    R.add(ns)
    // 天鹅绒隔离带
    for (let x = -32; x <= 32; x += 4) {
      if (Math.abs(x) < 3) continue
      B.cyl(gold, x, Y + 0.45, 12.6, 0.04, 0.9, 8)
      this.col.cyl(x, 12.6, 0.08, Y, Y + 0.9, { walkable: false })
    }
    for (let x = -30; x <= 30; x += 4) if (Math.abs(x) > 3) B.box(velvet, x, Y + 0.8, 12.6, 3.9, 0.05, 0.05)
    // 长廊墙裙、檐口与藻井梁
    this.wainscot(B, 'x', 14.0, -1, -34.8, -1.5)
    this.wainscot(B, 'x', 14.0, -1, 1.5, 34.8)
    for (let x = -32.5; x <= 32.5; x += 5) {
      B.box(dado, x, 6.86, 9, 0.32, 0.28, 10.6)
      B.box(gold, x, 6.71, 9, 0.34, 0.03, 10.6)
    }
    B.box(dado, 0, 6.86, 4.0, 70, 0.28, 0.32)
    // 吊灯：黄铜灯罩 + 暖色灯泡（与画作射灯一起照亮长廊）
    const bulb = glowMat(0xffd6a0, 5)
    for (const x of [-27.5, -17.5, -7.5, 7.5, 17.5, 27.5]) {
      B.cyl(gold, x, 6.1, 9, 0.012, 1.5, 6)
      B.cyl(gold, x, 5.28, 9, 0.42, 0.22, 20, 0.12)
      B.add(new SphereGeometry(0.13, 12, 8), bulb, trs(x, 5.12, 9))
    }
    // 观画长凳（皮面 + 木腿），背对列车、面向画墙
    const leather = std({ color: 0x3a1a14, rough: 0.55 })
    for (const x of [-27, -11, 11, 27]) {
      B.box(leather, x, Y + 0.44, 7.6, 2.0, 0.1, 0.55)
      B.box(dado, x, Y + 0.36, 7.6, 2.04, 0.06, 0.59)
      for (const dx of [-0.85, 0.85]) B.box(dado, x + dx, Y + 0.17, 7.6, 0.12, 0.34, 0.45)
      this.col.slab(x, 7.6, 2.04, 0.59, Y, Y + 0.5, { surface: 'wood', tag: 'bench' })
    }
    await yieldFrame()

    // ---------- 圆厅 ----------
    B.cyl(marble, ROT.x, Y - 0.15, ROT.z, ROT.r, 0.3, 48)
    this.col.cyl(ROT.x, ROT.z, ROT.r, -2, Y, { surface: 'marble', tag: 'rotunda' })
    this.col.slab(0, 15, 3.2, 2.2, -2, Y, { surface: 'marble', tag: 'passage' })
    B.box(marble, 0, Y - 0.5, 15, 3.2, 1, 2.2)
    B.box(wall, -1.7, 4, 15, 0.4, 6, 2.2)
    B.box(wall, 1.7, 4, 15, 0.4, 6, 2.2)
    this.col.slab(-1.7, 15, 0.4, 2.2, Y, 7, { walkable: false })
    this.col.slab(1.7, 15, 0.4, 2.2, Y, 7, { walkable: false })
    const doorAngles = [-Math.PI / 2, Math.PI, 0, Math.PI / 2] // S, W, E, N（atan2 约定：z 轴）
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2
      const x = ROT.x + Math.cos(a) * ROT.r, z = ROT.z + Math.sin(a) * ROT.r
      const isDoor = doorAngles.some((d) => Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d))) < 0.19)
      if (isDoor) continue
      B.box(wall, x, 4, z, 1.35, 6, 0.4, -a + Math.PI / 2)
      // 墙裙与金线
      const ix = ROT.x + Math.cos(a) * (ROT.r - 0.24), iz = ROT.z + Math.sin(a) * (ROT.r - 0.24)
      B.box(dado, ix, Y + 0.6, iz, 1.36, 1.2, 0.08, -a + Math.PI / 2)
      B.box(gold, ix, Y + 1.24, iz, 1.36, 0.05, 0.1, -a + Math.PI / 2)
      B.box(gold, ix, 6.6, iz, 1.36, 0.08, 0.12, -a + Math.PI / 2)
      this.col.box(x, 4, z, 1.35, 6, 0.4, { yaw: -a + Math.PI / 2, walkable: false })
    }
    // 圆厅里四幅大画（四个对角方向）
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2
      const tex = makeTex(`rotPaint${i}`, 128, (u, v) => {
        const n = fbm(u, v, 3, 5, 600 + i)
        const pal = [[0.08, 0.1, 0.18], [0.85, 0.6, 0.35], [0.2, 0.45, 0.55], [0.6, 0.2, 0.18]][i]
        const sky = v > 0.45 ? 1 : 0
        const k = n * 0.8 + sky * 0.3
        return [pal[0] + k * 0.5, pal[1] + k * 0.4, pal[2] + k * 0.35]
      })
      const px = ROT.x + Math.cos(a) * (ROT.r - 0.3), pz = ROT.z + Math.sin(a) * (ROT.r - 0.3)
      const pm = new Mesh(new PlaneGeometry(2.6, 1.8), new MeshStandardMaterial({ map: tex, roughness: 0.7 }))
      pm.position.set(px, 3.6, pz)
      pm.lookAt(ROT.x, 3.6, ROT.z)
      R.add(pm)
      B.box(gold, px + Math.cos(a) * 0.04, 3.6, pz + Math.sin(a) * 0.04, 2.9, 2.1, 0.06, -a + Math.PI / 2)
    }
    // 穹顶与天光
    const dome = new SphereGeometry(ROT.r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    const domeM = new Mesh(dome, std({ color: 0xd8cfc0, rough: 0.9, side: DoubleSide }))
    domeM.position.set(ROT.x, 7, ROT.z)
    R.add(domeM)
    const oculus = new Mesh(new CylinderGeometry(1.2, 1.2, 0.1, 32), glowMat(0xfff4e0, 6))
    oculus.position.set(ROT.x, 7 + ROT.r - 0.05, ROT.z)
    R.add(oculus)
    const beamMat = new MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.06, blending: AdditiveBlending, depthWrite: false })
    this.beam = new Mesh(new CylinderGeometry(1.2, 2.2, 13.5, 32, 1, true), beamMat)
    this.beam.position.set(ROT.x, 7.6, ROT.z)
    R.add(this.beam)
    // 三座基座
    PEDESTALS.forEach((p, i) => {
      const x = -3 + i * 3, z = 28.6 + (i === 1 ? 0.6 : 0)
      B.cyl(marble, x, Y + 0.55, z, 0.45, 1.1, 24)
      B.cyl(gold, x, Y + 1.12, z, 0.5, 0.05, 24)
      this.col.cyl(x, z, 0.5, Y, Y + 1.1, { walkable: false })
      const lab = new Mesh(new PlaneGeometry(0.7, 0.24), new MeshStandardMaterial({ map: textTexture({ w: 256, h: 88, bg: '#1a1410', lines: [{ text: p.key, size: 0.5, color: '#e8d4a8', y: 0.42 }, { text: p.en, size: 0.18, color: '#9a8460', font: MONO, y: 0.82 }] }) }))
      lab.position.set(x, Y + 0.7, z - 0.46)
      lab.rotation.y = Math.PI
      R.add(lab)
      this.pedestalItems[i].position.set(x, Y + 1.25, z)
      R.add(this.pedestalItems[i])
    })
    // 馆长之门（北门，基座全部归位后升起）
    this.curatorDoor = new Mesh(boxGeo(3.2, 5.2, 0.3), wood)
    this.curatorDoor.position.set(0, Y + 2.6, ROT.z + ROT.r)
    R.add(this.curatorDoor)
    this.curatorCol = this.col.slab(0, ROT.z + ROT.r, 3.2, 0.4, Y, Y + 5.2, { tag: 'curatorDoor', walkable: false })
    const doorSign = new Mesh(new PlaneGeometry(2.2, 0.5), new MeshStandardMaterial({ map: textTexture({ w: 512, h: 120, bg: '#2a1c14', lines: [{ text: '当三段记忆归位，门会记起自己', size: 0.26, color: '#e8d4a8', y: 0.5 }] }) }))
    doorSign.position.set(0, Y + 5.6, ROT.z + ROT.r - 0.2)
    doorSign.rotation.y = Math.PI
    R.add(doorSign)
    // 门框、门板浮雕与壁灯
    for (const x of [-1.75, 1.75]) B.box(gold, x, Y + 2.7, ROT.z + ROT.r - 0.25, 0.22, 5.4, 0.16)
    B.box(gold, 0, Y + 5.42, ROT.z + ROT.r - 0.25, 3.72, 0.24, 0.16)
    const panelMat = std({ color: 0x5a3a26, map: TEX.wood(), rough: 0.45 })
    for (const px of [-0.75, 0.75]) for (const py of [-1.3, 1.1]) {
      const pn = new Mesh(boxGeo(1.1, py < 0 ? 1.9 : 2.3, 0.06), panelMat)
      pn.position.set(px, py, -0.17)
      this.curatorDoor.add(pn)
    }
    const emblem = new Mesh(new TorusGeometry(0.42, 0.045, 8, 40), gold)
    emblem.position.set(0, 0.1, -0.2)
    this.curatorDoor.add(emblem)
    const sconceGlow = glowMat(0xffd6a0, 6)
    for (const x of [-2.5, 2.5]) {
      const sz = ROT.z + Math.sqrt(ROT.r * ROT.r - x * x) - 0.32
      B.box(gold, x, Y + 3.3, sz + 0.06, 0.18, 0.5, 0.05)
      B.add(new SphereGeometry(0.11, 12, 8), sconceGlow, trs(x, Y + 3.45, sz - 0.08))
    }
    const doorLamp = new PointLight(0xffc890, 8, 6, 1.6)
    doorLamp.position.set(0, Y + 3.6, ROT.z + ROT.r - 1.4)
    R.add(doorLamp)
    // 圆厅地面的金线镶嵌
    for (const [r0, r1] of [[2.2, 2.3], [2.45, 2.5], [6.6, 6.7]] as [number, number][]) {
      B.add(new RingGeometry(r0, r1, 72), gold, trs(ROT.x, Y + 0.006, ROT.z, -Math.PI / 2, 0, 0), false)
    }
    const inlay = std({ color: 0x3a3430, map: TEX.marble(), rough: 0.2, env: 1.2 })
    B.add(new RingGeometry(2.3, 2.45, 72), inlay, trs(ROT.x, Y + 0.005, ROT.z, -Math.PI / 2, 0, 0), false)
    await yieldFrame()

    // ---------- 「最初」厅（西）：错视 ----------
    this.room(B, marble, wall, -16, 24, 12, 12, 'E')
    this.col.slab(-9, 24, 2, 3, -2, Y, { surface: 'marble' })
    B.box(marble, -9, Y - 0.5, 24, 2, 1, 3)
    for (const z of [22.3, 25.7]) { B.box(wall, -9, 4, z, 2, 6, 0.4); this.col.slab(-9, z, 2, 0.4, Y, 7, { walkable: false }) }
    // 观察点（金圈）
    const ring = new Mesh(new TorusGeometry(0.5, 0.03, 8, 48), gold)
    ring.rotation.x = Math.PI / 2
    ring.position.set(VANTAGE.x, Y + 0.02, VANTAGE.z)
    R.add(ring)
    const eye = VANTAGE.clone().add(v3(0, 1.62, 0))
    const D = ANA_TARGET.clone().sub(eye).normalize()
    const right = new Vector3().crossVectors(D, v3(0, 1, 0)).normalize()
    const up = new Vector3().crossVectors(right, D).normalize()
    const C = eye.clone().addScaledVector(D, 7)
    const anaTex = textTexture({ w: 768, h: 512, glow: '#ffd890', lines: [
      { text: '最 初', size: 0.32, color: '#ffe2a8', y: 0.42, weight: '700' },
      { text: '— 我以为它能带我去任何地方 —', size: 0.07, color: '#ffe2a8', y: 0.78 },
    ] })
    const cols = 6, rows = 4, PW = 3.0, PH = 2.0
    const shardMat = new MeshBasicMaterial({ map: anaTex, transparent: true, side: DoubleSide, depthWrite: false })
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const g = new PlaneGeometry(PW / cols, PH / rows)
      const uv = g.getAttribute('uv') as Float32BufferAttribute
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (i + uv.getX(k)) / cols, (j + uv.getY(k)) / rows)
      const P = C.clone().addScaledVector(right, (i + 0.5) / cols * PW - PW / 2).addScaledVector(up, (j + 0.5) / rows * PH - PH / 2)
      const kDepth = 0.45 + Math.random() * 0.9
      const from = eye.clone().add(P.clone().sub(eye).multiplyScalar(kDepth))
      const m = new Mesh(g, shardMat)
      m.position.copy(from)
      m.scale.setScalar(kDepth)
      m.lookAt(m.position.clone().sub(D))
      m.renderOrder = 6
      R.add(m)
      this.shards.push({ mesh: m, from, to: P })
    }
    this.anaDir = D
    this.anaEye = eye
    this.displayCase(B, marble, gold, glass, 'toy_train', v3(-11.8, Y, 28.6))
    this.plaque(v3(-11.8, Y, 27.7), '玩具火车', '我第一次看见火车时，以为它能带我去任何地方。')

    // ---------- 东侧走廊 + 「离别」厅 ----------
    B.box(marble, 15, Y - 0.5, 24, 14, 1, 3)
    this.col.slab(15, 24, 14, 3, -2, Y, { surface: 'marble', tag: 'corridor' })
    for (const z of [22.3, 25.7]) { B.box(wall, 15, 4, z, 14, 6, 0.4); this.col.slab(15, z, 14, 0.4, Y, 7, { walkable: false }) }
    B.box(wall, 15, 7, 24, 14, 0.4, 3.4)
    this.wainscot(B, 'x', 22.5, 1, 8.3, 21.9)
    this.wainscot(B, 'x', 25.5, -1, 8.3, 21.9)
    for (let i = 0; i < 4; i++) {
      const p = new Mesh(new PlaneGeometry(1.0, 0.7), new MeshStandardMaterial({ map: makeTex(`cor${i}`, 64, (u, v) => { const n = fbm(u, v, 4, 3, 400 + i); return [0.3 + n * 0.4, 0.25 + n * 0.3, 0.3 + n * 0.2] }), roughness: 0.8 }))
      p.position.set(10 + i * 3.2, 3.2, 25.48)
      p.rotation.y = Math.PI
      R.add(p)
    }
    // 尽头的墙：上面挂着一幅“这条走廊”的画
    this.corridorWall = new Mesh(boxGeo(0.4, 6, 3), wall)
    this.corridorWall.position.set(22.2, 4, 24)
    R.add(this.corridorWall)
    // 画里就是这条走廊：一点透视的地面、墙裙、墙面，尽头又是这面墙和这幅画（一层套一层）
    const corridorPaint = (u: number, v: number): [number, number, number] => {
      for (let level = 0; level < 4; level++) {
        const dx = (u - 0.5) * 1.6, dy = (v - 0.5) * 1.1
        const m = Math.max(Math.abs(dx) / 1.6, Math.abs(dy) / 1.1) * 2
        if (m < 0.22) {
          // 尽头的墙：中间挂着同一幅画，再往里递归
          const pu = (u - 0.5) / 0.22 * 2.4, pv = (v - 0.45) / 0.22 * 2.4
          if (Math.abs(pu) < 0.5 && Math.abs(pv) < 0.36) {
            if (Math.abs(pu) > 0.45 || Math.abs(pv) > 0.31) return [0.55, 0.42, 0.2]
            u = pu + 0.5
            v = pv / 0.72 + 0.5
            continue
          }
          return [0.8, 0.76, 0.68]
        }
        const wall = Math.abs(dx) / 1.6 > Math.abs(dy) / 1.1
        const depth = 0.22 / m
        if (wall) {
          const h = dy / (Math.abs(dx) / 1.6 * 1.1)
          const k = 0.55 + depth * 0.35
          if (h < -0.6) return [0.22 * k, 0.14 * k, 0.1 * k]
          if (h < -0.56) return [0.7 * k, 0.55 * k, 0.25 * k]
          return [0.86 * k, 0.8 * k, 0.7 * k]
        }
        const k = 0.5 + depth * 0.4
        if (dy < 0) {
          const line = Math.abs(((1 / m) * 2) % 1 - 0.5) > 0.46
          return line ? [0.6 * k, 0.58 * k, 0.55 * k] : [0.92 * k, 0.9 * k, 0.86 * k]
        }
        return [0.7 * k, 0.66 * k, 0.6 * k]
      }
      return [0.5, 0.45, 0.4]
    }
    const recur = new Mesh(new PlaneGeometry(1.6, 1.1), new MeshStandardMaterial({ map: makeTex('recurCorridor', 256, corridorPaint), roughness: 0.8 }))
    recur.position.set(-0.21, 0, 0)
    recur.rotation.y = -Math.PI / 2
    this.corridorWall.add(recur)
    for (const [y, h, z, w] of [[0.6, 0.08, 0, 1.76], [-0.6, 0.08, 0, 1.76], [0, 1.28, 0.84, 0.08], [0, 1.28, -0.84, 0.08]] as [number, number, number, number][]) {
      const f = new Mesh(boxGeo(0.05, h, w), gold)
      f.position.set(-0.225, y, z)
      this.corridorWall.add(f)
    }
    this.corridorCol = this.col.slab(22.2, 24, 0.4, 3, Y, 7, { tag: 'corridorWall', walkable: false })
    this.corridorDoor = new Group()
    for (const z of [22.4, 25.6]) {
      const f = new Mesh(boxGeo(0.4, 6, 0.2), wall)
      f.position.set(22.2, 4, z)
      this.corridorDoor.add(f)
    }
    R.add(this.corridorDoor)
    this.room(B, marble, wall, 28, 24, 12, 12, 'W')
    // 室内的雨：静止的雨丝
    const rainG = new BoxGeometry(0.008, 0.5, 0.008)
    const rain = new InstancedMesh(rainG, new MeshBasicMaterial({ color: 0x9ab8d8, transparent: true, opacity: 0.5 }), 600)
    const m4 = new Matrix4()
    for (let i = 0; i < 600; i++) {
      m4.makeTranslation(23 + Math.random() * 10, Y + 0.3 + Math.random() * 5, 19 + Math.random() * 10)
      rain.setMatrixAt(i, m4)
    }
    R.add(rain)
    B.box(wood, 30.5, Y + 0.45, 26, 2.2, 0.08, 0.6)
    B.box(wood, 30.5, Y + 0.8, 26.3, 2.2, 0.6, 0.06)
    this.col.slab(30.5, 26, 2.2, 0.6, Y, Y + 0.5, { surface: 'wood', tag: 'bench' })
    const umb = itemModel('umbrella', '#b33a32')
    umb.scale.setScalar(0.9)
    umb.position.set(30.0, Y + 1.0, 26.0)
    umb.rotation.z = 1.2
    R.add(umb)
    this.exhibits.umbrella = umb
    this.plaque(v3(28.4, Y, 26.2), '红伞', '那天下雨。我把伞留给了你，自己跑去赶车。')
    const rl = new PointLight(0x9ab8d8, 20, 12, 1.6)
    rl.position.set(28, 5.5, 24)
    R.add(rl)
    await yieldFrame()

    // ---------- 「等待」厅（东端）：影子雕塑 ----------
    this.room(B, marble, wallDark, 40, 10, 12, 12, 'W', 4)
    const turn = new Mesh(new CylinderGeometry(0.7, 0.8, 0.5, 32), gold)
    turn.position.set(TURN.x, Y + 0.25, TURN.z)
    R.add(turn)
    this.col.cyl(TURN.x, TURN.z, 0.8, Y, Y + 0.5, { walkable: false })
    this.col.cyl(TURN.x, TURN.z, 0.9, Y + 0.5, Y + 3.6, { walkable: false })
    // 体素雕塑：从聚光灯出发、射向墙上每个像素的光线上各放一块方块
    const pix = pixelText('00:00')
    const cell = 0.22
    const cubeMat = std({ color: 0xe8e0d0, rough: 0.6, metal: 0.1 })
    const cubes: Matrix4[] = []
    const toWall = (px: number, py: number) => v3(45.85, 3.3 + (py - 2) * cell, 10 + (px - 8) * cell)
    for (const p of pix) {
      const W = toWall(p.x, p.y)
      const f = 0.44 + Math.random() * 0.1
      const c = SPOT.clone().add(W.clone().sub(SPOT).multiplyScalar(f))
      const s = cell * f * 0.98
      cubes.push(new Matrix4().makeScale(s, s, s).setPosition(c.x - TURN.x, c.y, c.z - TURN.z))
    }
    for (let i = 0; i < 26; i++) {
      // 诱饵方块：影子落在字的范围之外
      const W = v3(45.85, 3.3 + (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.9), 10 + (Math.random() - 0.5) * 6)
      const f = 0.42 + Math.random() * 0.14
      const c = SPOT.clone().add(W.clone().sub(SPOT).multiplyScalar(f))
      const s = (0.05 + Math.random() * 0.06)
      cubes.push(new Matrix4().makeScale(s, s * 2, s).setPosition(c.x - TURN.x, c.y, c.z - TURN.z))
    }
    const sc = new InstancedMesh(new BoxGeometry(1, 1, 1), cubeMat, cubes.length)
    cubes.forEach((m, i) => sc.setMatrixAt(i, m))
    sc.castShadow = true
    this.sculpture.add(sc)
    const rod = new Mesh(new CylinderGeometry(0.03, 0.03, 3.2, 8), gold)
    rod.position.y = Y + 1.9
    this.sculpture.add(rod)
    this.sculpture.position.set(TURN.x, 0, TURN.z)
    R.add(this.sculpture)
    const spot = new SpotLight(0xfff0d8, 220, 20, 0.55, 0.35, 1.2)
    spot.position.copy(SPOT)
    spot.target.position.set(45.9, 3.3, 10)
    spot.castShadow = true
    spot.shadow.mapSize.set(1024, 1024)
    spot.shadow.bias = -0.0008
    spot.shadow.camera.near = 0.5
    spot.shadow.camera.far = 14
    R.add(spot, spot.target)
    const lamp = new Mesh(new CylinderGeometry(0.15, 0.25, 0.4, 16), gold)
    lamp.position.copy(SPOT)
    lamp.rotation.z = Math.PI / 2
    R.add(lamp)
    this.displayCase(B, marble, gold, glass, 'wristwatch', v3(43.6, Y, 14.2))
    this.plaque(v3(42.6, Y, 14.2), '停走的手表', '我在站台等了一整夜。钟一直没有走。')
    await yieldFrame()

    // ---------- 镜厅 + 镜中世界 ----------
    this.buildMirrorHall(B, marble, wall, gold)

    // ---------- 灯光 ----------
    R.add(new HemisphereLight(0xfff2e0, 0x3a2a20, 0.75))
    const sky = new DirectionalLight(0xfff0dc, 1.6)
    sky.position.set(4, 30, 26)
    sky.target.position.set(0, 0, 24)
    R.add(sky, sky.target)
    for (const [x, z, c, i] of [[-20, 9, 0xffd8a8, 30], [20, 9, 0xffd8a8, 30], [0, 24, 0xfff0d8, 40], [-16, 24, 0xffd8a8, 26], [0, 40, 0xcfe0ff, 26]] as [number, number, number, number][]) {
      const l = new PointLight(c, i, 18, 1.5)
      l.position.set(x, 5.6, z)
      R.add(l)
    }

    B.build(R, 'museum')
    this.buildInteractions()
    this.syncState()
  }

  private anaDir!: Vector3
  private anaEye!: Vector3

  private tm!: { dado: MeshStandardMaterial; panel: MeshStandardMaterial; gold: MeshStandardMaterial; base: MeshStandardMaterial; cornice: MeshStandardMaterial }

  /** 墙裙（护墙板 + 金色腰线 + 踢脚）与顶部檐口，沿一面墙的内表面铺设。
   *  axis 'x'：墙沿 x 方向，内表面在 z = f；axis 'z'：墙沿 z 方向，内表面在 x = f。n 是内表面朝向（±1）。 */
  private wainscot(B: Batcher, axis: 'x' | 'z', f: number, n: 1 | -1, a: number, b: number) {
    const T = this.tm
    const len = b - a
    if (len < 0.3) return
    const put = (mat: MeshStandardMaterial, along: number, y: number, h: number, depth: number, l: number) => {
      const off = f + (n * depth) / 2
      if (axis === 'x') B.box(mat, along, y, off, l, h, depth)
      else B.box(mat, off, y, along, depth, h, l)
    }
    const c = (a + b) / 2
    put(T.dado, c, Y + 0.6, 1.2, 0.05, len)
    put(T.gold, c, Y + 1.23, 0.05, 0.1, len)
    put(T.base, c, Y + 0.09, 0.18, 0.08, len)
    const np = Math.max(1, Math.round(len / 1.4))
    const pw = len / np
    for (let i = 0; i < np; i++) put(T.panel, a + pw * (i + 0.5), Y + 0.68, 0.72, 0.08, pw - 0.28)
    put(T.cornice, c, 6.84, 0.24, 0.2, len)
    put(T.gold, c, 6.7, 0.04, 0.07, len)
  }

  /** 方形房间：地面、四墙、天花板，门开在一侧 */
  private room(B: Batcher, floor: MeshStandardMaterial, wall: MeshStandardMaterial, cx: number, cz: number, w: number, d: number, door: 'E' | 'W', doorW = 3) {
    B.box(floor, cx, Y - 0.5, cz, w, 1, d, 0, 3)
    this.col.slab(cx, cz, w, d, -2, Y, { surface: 'marble', tag: 'roomFloor' })
    B.box(wall, cx, 7.2, cz, w, 0.4, d)
    for (const s of [-1, 1]) {
      B.box(wall, cx, 4, cz + s * d / 2, w, 6, 0.4)
      this.col.slab(cx, cz + s * d / 2, w, 0.4, Y, 7, { walkable: false })
    }
    const far = door === 'E' ? cx - w / 2 : cx + w / 2
    const near = door === 'E' ? cx + w / 2 : cx - w / 2
    B.box(wall, far, 4, cz, 0.4, 6, d)
    this.col.slab(far, cz, 0.4, d, Y, 7, { walkable: false })
    const seg = (d - doorW) / 2
    for (const s of [-1, 1]) {
      B.box(wall, near, 4, cz + s * (doorW / 2 + seg / 2), 0.4, 6, seg)
      this.col.slab(near, cz + s * (doorW / 2 + seg / 2), 0.4, seg, Y, 7, { walkable: false })
    }
    // 墙裙与檐口
    const ix0 = cx - w / 2 + 0.2, ix1 = cx + w / 2 - 0.2, iz0 = cz - d / 2 + 0.2, iz1 = cz + d / 2 - 0.2
    this.wainscot(B, 'x', iz0, 1, ix0, ix1)
    this.wainscot(B, 'x', iz1, -1, ix0, ix1)
    const fs = door === 'E' ? 1 : -1
    this.wainscot(B, 'z', far + fs * 0.2, fs as 1 | -1, iz0, iz1)
    this.wainscot(B, 'z', near - fs * 0.2, -fs as 1 | -1, iz0, cz - doorW / 2)
    this.wainscot(B, 'z', near - fs * 0.2, -fs as 1 | -1, cz + doorW / 2, iz1)
  }

  /** 展柜：底座 + 可抬起的玻璃罩 + 展品 */
  private displayCase(B: Batcher, marble: MeshStandardMaterial, gold: MeshStandardMaterial, glass: MeshPhysicalMaterial, item: string, p: Vector3) {
    B.box(marble, p.x, p.y + 0.5, p.z, 0.9, 1.0, 0.9)
    B.box(gold, p.x, p.y + 1.02, p.z, 0.95, 0.04, 0.95)
    this.col.slab(p.x, p.z, 0.9, 0.9, p.y, p.y + 1.0, { walkable: false })
    const lid = new Group()
    const box = new Mesh(new BoxGeometry(0.86, 0.7, 0.86), glass)
    box.position.y = 0.35
    lid.add(box)
    const top = new Mesh(boxGeo(0.88, 0.03, 0.88), gold)
    top.position.y = 0.71
    lid.add(top)
    lid.position.set(p.x, p.y + 1.04, p.z)
    this.root.add(lid)
    this.caseLids[item] = lid
    const m = itemModel(item === 'toy_train' ? 'toytrain' : 'wristwatch', item === 'toy_train' ? '#2f4f8a' : '#9aa3ad')
    m.scale.setScalar(0.32)
    m.position.set(p.x, p.y + 1.2, p.z)
    this.root.add(m)
    this.exhibits[item] = m
    const l = new PointLight(0xffe0b0, 3, 3, 2)
    l.position.set(p.x, p.y + 2.2, p.z)
    this.root.add(l)
  }

  private plaques: { pos: Vector3; title: string; body: string }[] = []
  private plaque(p: Vector3, title: string, body: string) {
    const m = new Mesh(boxGeo(0.36, 0.5, 0.08), std({ color: 0x2a2018, rough: 0.6 }))
    m.position.set(p.x, p.y + 0.5, p.z)
    m.rotation.x = -0.3
    this.root.add(m)
    this.col.slab(p.x, p.z, 0.36, 0.2, p.y, p.y + 0.75, { walkable: false })
    this.plaques.push({ pos: v3(p.x, p.y + 0.8, p.z), title, body })
  }

  /** 镜厅（z 32..46）+ 镜面另一侧的镜像世界（z 46..60） */
  private buildMirrorHall(B: Batcher, marble: MeshStandardMaterial, wall: MeshStandardMaterial, gold: MeshStandardMaterial) {
    const R = this.root
    const z0 = ROT.z + ROT.r, z1 = MIRROR_Z
    // 连接圆厅的门洞地面
    this.col.slab(0, z0 + 0.5, 3.2, 1.4, -2, Y, { surface: 'marble' })
    const hall = (g: Group, mirror: boolean) => {
      const HB = new Batcher()
      HB.box(marble, 0, Y - 0.5, (z0 + z1) / 2, 14, 1, z1 - z0, 0, 3)
      HB.box(wall, 0, 7.2, (z0 + z1) / 2, 14, 0.4, z1 - z0)
      for (const s of [-1, 1]) HB.box(wall, s * 7, 4, (z0 + z1) / 2, 0.4, 6, z1 - z0)
      HB.box(wall, -4.6, 4, z0, 4.8, 6, 0.4)
      HB.box(wall, 4.6, 4, z0, 4.8, 6, 0.4)
      HB.box(wall, 0, 6.2, z0, 4.4, 2, 0.4)
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
        HB.cyl(marble, s * 5.2, 4, z0 + 3 + i * 4.5, 0.35, 6, 16)
        HB.box(gold, s * 5.2, 6.9, z0 + 3 + i * 4.5, 0.9, 0.2, 0.9)
      }
      HB.box(std({ color: 0x3a2418, map: TEX.wood(), rough: 0.6 }), 4.4, Y + 0.45, z0 + 9.5, 0.6, 0.08, 2.4)
      for (const sd of [-1, 1]) this.wainscot(HB, 'z', sd * 6.8, (-sd) as 1 | -1, z0 + 0.2, z1)
      if (mirror) {
        // 镜中世界里，对应圆厅入口的门洞后面什么也没有：用一扇关着的门封住（碰撞体本来就是整面墙）
        HB.box(this.tm.panel, 0, (Y + 5.2) / 2, z0 + 0.02, 4.4, 4.2, 0.1)
        HB.box(this.tm.dado, 0, (Y + 5.2) / 2, z0 + 0.09, 0.06, 4.2, 0.04)
        for (const dx of [-1.1, 1.1]) for (const dy of [1.2, 3.1]) HB.box(this.tm.dado, dx, Y + dy, z0 + 0.09, 1.6, 1.5, 0.03)
        for (const dx of [-0.25, 0.25]) HB.box(this.tm.gold, dx, Y + 2.1, z0 + 0.13, 0.05, 0.4, 0.05)
        for (const dx of [-2.25, 2.25]) HB.box(this.tm.gold, dx, (Y + 5.2) / 2, z0 + 0.12, 0.12, 4.3, 0.08)
        HB.box(this.tm.gold, 0, Y + 4.25, z0 + 0.12, 4.62, 0.12, 0.08)
      }
      this.wainscot(HB, 'x', z0 + 0.2, 1, -6.8, -2.2)
      this.wainscot(HB, 'x', z0 + 0.2, 1, 2.2, 6.8)
      HB.build(g, mirror ? 'mirrorHallM' : 'mirrorHall')
      // 墙上的反写文字：只有在镜子里才读得正
      const tex = textTexture({ w: 1024, h: 256, bg: '#e2d8c6', mirror: true, lines: [{ text: '车 票 在 镜 子 里', size: 0.3, color: '#3a2a20', y: 0.42 }, { text: 'THE TICKET IS IN THE MIRROR', size: 0.1, color: '#6a5a48', font: MONO, y: 0.78, spacing: 0.2 }] })
      const t = new Mesh(new PlaneGeometry(3.6, 0.9), new MeshStandardMaterial({ map: tex, roughness: 0.8 }))
      t.position.set(-4.4, 4.2, z0 + 0.22)
      g.add(t)
    }
    const real = new Group()
    hall(real, false)
    R.add(real)
    // 镜像世界：镜像复制（z' = 2·MIRROR_Z − z），色调偏冷
    hall(this.mirrorWorld, true)
    this.mirrorWorld.scale.z = -1
    this.mirrorWorld.position.z = 2 * MIRROR_Z
    R.add(this.mirrorWorld)
    const cold = new PointLight(0x9fc4ff, 26, 18, 1.5)
    cold.position.set(0, 5, MIRROR_Z + 7)
    R.add(cold)
    // 碰撞：真实镜厅 + 镜像
    this.col.slab(0, (z0 + z1) / 2, 14, z1 - z0, -2, Y, { surface: 'marble', tag: 'mirrorHall' })
    this.col.slab(0, MIRROR_Z + (z1 - z0) / 2, 14, z1 - z0, -2, Y, { surface: 'marble', tag: 'mirrorWorld' })
    for (const s of [-1, 1]) {
      this.col.slab(s * 7, MIRROR_Z, 0.4, (z1 - z0) * 2, Y, 7, { walkable: false })
      for (let i = 0; i < 3; i++) {
        const z = z0 + 3 + i * 4.5
        this.col.cyl(s * 5.2, z, 0.4, Y, 7)
        this.col.cyl(s * 5.2, 2 * MIRROR_Z - z, 0.4, Y, 7)
      }
    }
    this.col.slab(-4.6, z0, 4.8, 0.4, Y, 7, { walkable: false })
    this.col.slab(4.6, z0, 4.8, 0.4, Y, 7, { walkable: false })
    this.col.slab(0, 2 * MIRROR_Z - z0, 14, 0.4, Y, 7, { walkable: false })
    this.col.slab(4.4, z0 + 9.5, 0.6, 2.4, Y, Y + 0.5, { surface: 'wood' })
    this.col.slab(4.4, 2 * MIRROR_Z - z0 - 9.5, 0.6, 2.4, Y, Y + 0.5, { surface: 'wood' })
    // 镜面本身
    this.mirrorGlass = new Mesh(new PlaneGeometry(12, 5.6), new MeshPhysicalMaterial({ color: 0xcfe0ff, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.1, depthWrite: false, clearcoat: 1, envMapIntensity: 2, side: DoubleSide }))
    this.mirrorGlass.position.set(0, Y + 2.8, MIRROR_Z)
    this.mirrorGlass.renderOrder = 7
    R.add(this.mirrorGlass)
    B.box(gold, 0, Y + 5.7, MIRROR_Z, 12.4, 0.2, 0.12)
    B.box(gold, -6.1, Y + 2.8, MIRROR_Z, 0.2, 5.8, 0.12)
    B.box(gold, 6.1, Y + 2.8, MIRROR_Z, 0.2, 5.8, 0.12)
    this.mirrorCol = this.col.slab(0, MIRROR_Z, 12, 0.2, Y, 7, { tag: 'mirror', walkable: false })
    // 镜子里的“你”
    this.avatar.place(R, 0, Y, MIRROR_Z + 6, Math.PI)
    // 镜中世界独有的东西
    this.firstTicket = itemModel('oldticket', '#d8c39a').children[0] as Mesh
    this.firstTicket.scale.setScalar(0.1)
    this.firstTicket.position.set(4.4, Y + 0.52, 2 * MIRROR_Z - z0 - 10.2)
    R.add(this.firstTicket)
    const desk = new Mesh(boxGeo(1.2, 0.8, 0.6), std({ color: 0x2a2a34, rough: 0.5 }))
    desk.position.set(-4.4, Y + 0.4, MIRROR_Z + 6)
    R.add(desk)
    this.col.slab(-4.4, MIRROR_Z + 6, 1.2, 0.6, Y, Y + 0.8, { walkable: false })
    const file = new Mesh(boxGeo(0.3, 0.03, 0.22), std({ color: 0x8a9aaa, rough: 0.8 }))
    file.position.set(-4.4, Y + 0.82, MIRROR_Z + 6)
    R.add(file)
    B.cyl(marble, 0, Y + 0.6, MIRROR_Z + 11, 0.5, 1.2, 24)
    this.col.cyl(0, MIRROR_Z + 11, 0.55, Y, Y + 1.2, { walkable: false })
    this.fragment = itemModel('fragment', '#f08a78')
    this.fragment.scale.setScalar(0.4)
    this.fragment.position.set(0, Y + 1.8, MIRROR_Z + 11)
    R.add(this.fragment)
  }

  // ---------------- 交互 ----------------
  private buildInteractions() {
    const g = this.game
    for (const p of this.plaques) {
      this.item({ id: `plaque.${p.title}`, pos: p.pos, radius: 0.35, label: `展签 · ${p.title}`, verb: '阅读', use: () => g.read({ title: p.title, sub: '展签', kind: 'plaque', body: [p.body] }) })
    }
    const take = (item: string, flag: string) => () => {
      S.set(flag)
      g.pickup(item)
      this.syncState()
    }
    this.item({
      id: 'toy_train', pos: v3(-11.8, Y + 1.25, 28.6), radius: 0.4, label: () => (S.is('museum.anamorph') ? '玩具火车' : '玻璃罩里的玩具火车'),
      verb: () => (S.is('museum.anamorph') ? '拾取' : '检查'),
      enabled: () => !S.is('museum.got.toy_train'),
      use: () => {
        if (!S.is('museum.anamorph')) {
          g.sfx('deny')
          g.say('', '玻璃罩打不开。罩子上刻着：「从最初的位置看」。地上有一个金色的圈。', 4)
          return
        }
        take('toy_train', 'museum.got.toy_train')()
      },
    })
    this.item({
      id: 'umbrella', pos: v3(30.0, Y + 1.0, 26.0), radius: 0.6, label: '红伞', verb: '拾取',
      enabled: () => !S.is('museum.got.umbrella') && S.is('museum.corridor'),
      use: take('umbrella', 'museum.got.umbrella'),
    })
    this.item({
      id: 'wristwatch', pos: v3(43.6, Y + 1.25, 14.2), radius: 0.4, label: () => (S.is('museum.shadow') ? '停走的手表' : '玻璃罩里的手表'),
      verb: () => (S.is('museum.shadow') ? '拾取' : '检查'),
      enabled: () => !S.is('museum.got.wristwatch'),
      use: () => {
        if (!S.is('museum.shadow')) {
          g.sfx('deny')
          g.say('', '玻璃罩锁着。墙上的影子乱成一团。', 3)
          return
        }
        take('wristwatch', 'museum.got.wristwatch')()
      },
    })
    // 影子雕塑
    this.item({
      id: 'sculpture', pos: v3(TURN.x, Y + 1.8, TURN.z), radius: 1.0, label: '转台上的雕塑', verb: () => (S.is('museum.shadow') ? '已定格' : '转动'),
      enabled: () => !S.is('museum.shadow'),
      use: () => {
        g.manipulate('转动雕塑', (dx) => {
          this.theta += dx * 0.004
          if (Math.abs(dx) > 0.5 && Math.random() < 0.15) g.sfx('dial', TURN, 0.4)
          if (angleError(this.theta, SOLUTION) < 0.07 && !S.is('museum.shadow')) {
            this.theta = SOLUTION
            S.set('museum.shadow')
            S.set('museum.theta', this.theta)
            g.sfx('success')
            g.say('', '墙上的影子拼成了四个数字：00:00。展柜的锁弹开了。', 4)
            this.syncState()
            g.refresh()
          }
        }, () => S.set('museum.theta', this.theta))
      },
    })
    // 基座
    PEDESTALS.forEach((p, i) => {
      this.item({
        id: `pedestal${i}`, pos: v3(-3 + i * 3, Y + 1.3, 28.6 + (i === 1 ? 0.6 : 0)), radius: 0.5, label: `基座 · ${p.key}`,
        verb: () => {
          const cur = S.flag(`museum.ped${i}`) as string | undefined
          if (cur) return '取回'
          const held = MEMORY_ITEMS.find((m) => S.has(m))
          return held ? `放上 ${({ toy_train: '玩具火车', umbrella: '红伞', wristwatch: '停走的手表' } as Record<string, string>)[held]}` : '检查'
        },
        enabled: () => !S.is('museum.doorOpen'),
        use: () => {
          const cur = S.flag(`museum.ped${i}`) as string | undefined
          if (cur) {
            S.set(`museum.ped${i}`, '')
            g.pickup(cur)
            this.syncState()
            return
          }
          const held = MEMORY_ITEMS.find((m) => S.has(m))
          if (!held) {
            g.say('', `基座上刻着「${p.key}」。它在等一段记忆。`, 3)
            return
          }
          S.take(held)
          S.set(`museum.ped${i}`, held)
          g.sfx('insert', v3(-3 + i * 3, Y + 1.3, 28.6))
          this.syncState()
          const placed = [0, 1, 2].map((k) => (S.flag(`museum.ped${k}`) as string) || undefined)
          if (pedestalsSolved(placed)) {
            S.set('museum.doorOpen')
            this.syncState()
            g.sfx('heavy', v3(0, 3, 32))
            g.sfx('success')
            g.say('', '三段记忆归位。北面的门缓缓升起——门的另一边，是一面巨大的镜子。', 4.5)
            g.refresh()
          } else if (placed.every(Boolean)) {
            g.sfx('deny')
            g.say('', '三座基座都放满了，门却没有动。有一段记忆放错了地方。', 3.5)
          }
        },
      })
    })
    // 镜子
    this.item({
      id: 'mirrorText', pos: v3(4.4, 4.2, 2 * MIRROR_Z - (ROT.z + ROT.r) - 0.22), radius: 1.6, range: 30, label: '镜子里那面墙上的字', verb: '阅读',
      enabled: () => this.game.player.body.z < MIRROR_Z,
      use: () => {
        S.set('museum.mirrorText')
        g.read({ title: '车票在镜子里', sub: '在镜子里才读得正的字', kind: 'mirror', body: ['车票在镜子里。', '——写给下一个“我”'] })
        g.refresh()
      },
    })
    this.item({
      id: 'first_ticket', pos: this.firstTicket.position.clone(), radius: 0.3, label: '长椅上的旧车票', verb: '拾取',
      enabled: () => !S.has('first_ticket') && !S.is('terminus.firstIn') && this.game.player.body.z > MIRROR_Z,
      use: () => {
        g.pickup('first_ticket')
        g.say('', '「目的地：回家」。这张票从来没有被检过。', 4)
        this.syncState()
      },
    })
    this.item({
      id: 'archive5', pos: v3(-4.4, Y + 0.85, MIRROR_Z + 6), radius: 0.3, label: '人事档案', verb: '阅读',
      enabled: () => this.game.player.body.z > MIRROR_Z,
      use: () => g.archive('a5'),
    })
    this.item({
      id: 'fragment', pos: v3(0, Y + 1.8, MIRROR_Z + 11), radius: 0.5, label: '镜像碎片', verb: '取下',
      enabled: () => !S.is('museum.fragment') && this.game.player.body.z > MIRROR_Z,
      use: () => {
        S.set('museum.fragment')
        g.pickup('fragment_museum')
        g.sfx('success')
        g.say('', '碎片的镜面里，映出的人穿着列车长的制服。', 4)
        this.syncState()
      },
    })
    this.item({
      id: 'lost5', pos: v3(-19, 3.0, 13.9), radius: 0.4, label: '画框里的车票', verb: '取下',
      enabled: () => !S.get().collectibles.includes('t5'),
      use: () => { g.collect('t5'); this.syncState() },
    })
    this.trigger({ id: 'mirrorWorld', min: v3(-7, 0, MIRROR_Z + 0.4), max: v3(7, 5, MIRROR_Z + 14), enter: () => { if (!S.is('museum.mirrorWorld')) { S.set('museum.mirrorWorld'); g.say('', '镜子的这一边很冷。所有东西都反了过来——只有你没有。', 4); g.refresh() } } })
  }

  private syncState() {
    for (const k of ['toy_train', 'umbrella', 'wristwatch']) {
      const ex = this.exhibits[k]
      if (ex) ex.visible = !S.is(`museum.got.${k}`)
    }
    if (this.caseLids.toy_train) this.caseLids.toy_train.position.y = Y + 1.04 + (S.is('museum.anamorph') ? 0.9 : 0)
    if (this.caseLids.wristwatch) this.caseLids.wristwatch.position.y = Y + 1.04 + (S.is('museum.shadow') ? 0.9 : 0)
    this.pedestalItems.forEach((grp, i) => {
      grp.clear()
      const it = S.flag(`museum.ped${i}`) as string | undefined
      if (it) {
        const m = itemModel(({ toy_train: 'toytrain', umbrella: 'umbrella', wristwatch: 'wristwatch' } as Record<string, 'toytrain' | 'umbrella' | 'wristwatch'>)[it], '#888')
        m.scale.setScalar(0.32)
        grp.add(m)
      }
    })
    const open = S.is('museum.doorOpen')
    this.curatorCol.enabled = !open
    this.curatorDoor.position.y = Y + 2.6 + (open ? 5 : 0)
    const cor = S.is('museum.corridor')
    this.corridorWall.visible = !cor
    this.corridorCol.enabled = !cor
    this.corridorDoor.visible = cor
    this.mirrorCol.enabled = !S.is('museum.mirror')
    this.firstTicket.visible = !S.has('first_ticket') && !S.is('terminus.firstIn')
    this.fragment.visible = !S.is('museum.fragment')
    this.lostFrame.visible = !S.get().collectibles.includes('t5')
    const th = S.flag('museum.theta')
    if (typeof th === 'number') this.theta = th
    if (S.is('museum.anamorph')) this.anaT = 1
  }

  update(dt: number, t: number) {
    const g = this.game
    const p = g.player
    // 错视：站在金圈里并朝正确方向看
    if (!S.is('museum.anamorph') && anamorphAligned(p.eye, p.forward, this.anaEye, this.anaDir)) {
      S.set('museum.anamorph')
      g.sfx('glass')
      g.sfx('success')
      g.say('', '散落的碎片在你眼前拼成了两个字：「最初」。展柜的玻璃罩升了起来。', 4.5)
      g.refresh()
      this.syncState()
    }
    if (S.is('museum.anamorph') && this.anaT < 1) this.anaT = Math.min(1, this.anaT + dt * 0.5)
    const e = this.anaT * this.anaT * (3 - 2 * this.anaT)
    for (const s of this.shards) {
      s.mesh.position.lerpVectors(s.from, s.to, e)
      const k0 = s.from.distanceTo(this.anaEye) / s.to.distanceTo(this.anaEye)
      s.mesh.scale.setScalar(k0 + (1 - k0) * e)
    }
    // 走廊：你不看它的时候，墙变成门
    if (!S.is('museum.corridor')) {
      const b = p.body
      if (b.x > 10 && b.x < 21.5 && Math.abs(b.z - 24) < 1.6 && p.lookDot(v3(22.2, 3, 24)) < 0.1) {
        S.set('museum.corridor')
        g.sfx('heavy', v3(22, 3, 24), 0.4)
        g.say('', '身后传来石头挪动的声音。你回过头——尽头的墙不见了，变成了一扇门。', 4.5)
        g.refresh()
        this.syncState()
      }
    }
    // 影子雕塑
    this.sculpture.rotation.y = this.theta
    // 镜中的“你”：镜像玩家的位置与朝向
    const inHall = p.body.z > ROT.z + ROT.r - 1 && p.body.z < MIRROR_Z && Math.abs(p.body.x) < 7
    this.avatar.group.visible = inHall
    if (inHall) {
      this.avatar.group.position.set(p.body.x, Y, 2 * MIRROR_Z - p.body.z)
      const f = p.forward
      this.avatar.group.rotation.y = Math.atan2(f.x, -f.z)
      if (!S.is('museum.mirror') && p.lookDot(v3(p.body.x, Y + 1.7, 2 * MIRROR_Z - p.body.z)) > 0.93 && MIRROR_Z - p.body.z < 10) {
        S.set('museum.mirror')
        g.fx.glitch = 0.8
        g.sfx('glass')
        g.sfx('timeStop', undefined, 0.6)
        g.say('', '镜子里的人穿着列车长的制服。帽檐下的那张脸——是你。', 5)
        setTimeout(() => g.say('', '镜面像水一样晃了一下。你可以走进去。', 4), 5200)
        g.refresh()
        this.syncState()
      }
    }
    this.avatar.update(dt, null)
    ;(this.mirrorGlass.material as MeshPhysicalMaterial).opacity = S.is('museum.mirror') ? 0.06 + Math.sin(t * 2) * 0.03 : 0.1
    this.fragment.rotation.y += dt * 0.6
    ;(this.beam.material as MeshBasicMaterial).opacity = 0.05 + Math.sin(t * 0.3) * 0.015
    g.audio.setRain(0)
    g.audio.setWind(0)
    g.audio.setSea(0)
    g.audio.setOpenness(0.85)
  }

  momentShots(): Shot[] {
    return []
  }
}

