// 世界 5：不存在的终点 / The Station That Never Was
// 铁轨是一个环。列车沿着环驶入时，之前见过的世界——倒悬的城、鲸、凝固的沙、博物馆的画框——环绕着站台出现。
// 而终点站本身，就是零号站台：没有雨，天将亮未亮，钟停在 00:00，钟面上没有指针。
// 三个结局，三种不同的实际操作（由游戏状态决定能否完成）：
//   离开列车 —— 列车长在车票上写下目的地后，持票走出出站闸机
//   成为新的列车长 —— 进入驾驶室，戴上帽子，拉下发车杆
//   打破时间循环 —— 给大钟装上指针、放入第一张车票（并且读过足够的档案、告诉列车长你的决定），把钟拨到 00:01
import {
  AdditiveBlending, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, PointLight, Scene, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from 'three'
import { World, v3 } from '../World'
import { Batcher, boxGeo, glowMat, std, yieldFrame, trs } from '../shared/kit'
import { TEX, makeTex, fbm } from '../shared/textures'
import { textTexture, DISPLAY, MONO, signBoard } from '../shared/text'
import { makeSky, windowize } from '../shared/sky'
import { Whale, motes } from '../shared/Whale'
import { itemModel } from '../shared/itemModels'
import { FLOOR_Y } from '../shared/Train'
import { Conductor } from '../shared/Conductor'
import { S } from '../../state/store'
import { endingAvailable, loopRequirements } from '../../systems/endings'
import type { Collider } from '../../physics/collision'
import type { Shot } from '../../game/api'

const Y = 1.0
const RING = 320
const CLOCK = v3(0, Y, 6.6)
const GATE_X = 36

export class Terminus extends World {
  readonly id = 'terminus' as const
  private sky!: ReturnType<typeof makeSky>
  private orbit = new Group()
  private whale!: Whale
  private clockHands = new Group()
  private minute!: Mesh
  private hour!: Mesh
  private ticketSlot!: Mesh
  private gateCol!: Collider
  private gateArms: Mesh[] = []
  private cap!: Group
  private dust!: ReturnType<typeof motes>
  private sunrise = 0
  private sunTarget = 0
  private ringBreak = 0
  private ringSegs: Mesh[] = []
  private umbrellaFigure!: Group
  private sun!: DirectionalLight
  private ending: 'none' | 'running' = 'none'

  constructor() {
    super()
    this.env.background = new Color(0x1a2034)
    this.env.fogColor = new Color(0x4a4a66)
    this.env.fogDensity = 0.0035
    this.env.score = 'terminus'
    this.env.interior = 0.5
    this.env.fx = { exposure: 0.95, bloom: 0.6, bloomThreshold: 1.15, vignette: 0.45, grain: 0.025, saturation: 1.0, contrast: 1.04, tint: new Color(1.0, 0.99, 1.02), lift: new Color(0.02, 0.02, 0.04) }
    this.spawn = { x: 0, y: Y, z: 4, yaw: 0 }
    this.approachLength = 900
    this.approachTime = 34
    this.departLength = 600
    this.departTime = 13
  }

  conductorSpot() {
    if (!S.is('terminus.arrived')) return null
    if (this.ending === 'running') return null
    return { x: 3.2, y: Y, z: 4.4, yaw: -Math.PI / 2 - 0.4 }
  }

  envScene() {
    const s = new Scene()
    const sky = makeSky({ top: new Color(0.1, 0.14, 0.3), mid: new Color(1.4, 0.9, 0.8), bottom: new Color(0.5, 0.45, 0.6), sun: new Vector3(0.3, -0.05, -1), sunColor: new Color(3, 2, 1.4), sunSize: 0.06, radius: 50, disk: 'wide' })
    s.add(sky.mesh)
    return s
  }

  /** 环形轨道：车站在环上 (0,0,0)，切线沿 +x，环心在 -z 方向 */
  trackPose(s: number, out: Matrix4) {
    const a = s / RING
    out.makeRotationY(a)
    out.setPosition(RING * Math.sin(a), 0, -RING + RING * Math.cos(a))
    return out
  }

  async build() {
    const R = this.root
    const q = this.q
    const B = new Batcher()
    const stone = std({ color: 0xd8d0c4, map: TEX.concrete(), roughMap: TEX.concreteRough(), rough: 0.8 })
    const tiles = std({ color: 0xe0dad0, map: TEX.tiles(), rough: 0.35, env: 1.4 })
    const iron = std({ color: 0x2a2e36, rough: 0.5, metal: 0.8 })
    const brass = std({ color: 0xd2a860, rough: 0.28, metal: 1, map: TEX.brushed() })
    const brick = std({ color: 0xc8a898, map: TEX.brick(), normalMap: TEX.brickNormal(), rough: 0.85 })
    const wood = std({ color: 0x7a5236, map: TEX.wood(), rough: 0.55 })
    const enamel = std({ color: 0x2a4a3a, rough: 0.35, metal: 0.2 })

    this.sky = makeSky({ top: new Color(0.03, 0.05, 0.15), mid: new Color(0.82, 0.46, 0.44), bottom: new Color(0.18, 0.16, 0.28), sun: new Vector3(0.25, -0.16, -1), sunColor: new Color(1.4, 0.8, 0.5), sunSize: 0.025, stars: 1 })
    R.add(this.sky.mesh)
    // 云海
    const cloudTex = TEX.cloud()
    const cm = new MeshBasicMaterial({ map: cloudTex, color: 0x9a8aa8, transparent: true, opacity: 0.55, depthWrite: false })
    for (let i = 0; i < 26; i++) {
      const c = new Mesh(new PlaneGeometry(260, 260), cm)
      c.rotation.x = -Math.PI / 2
      c.position.set((Math.random() - 0.5) * 1600, -40 - Math.random() * 30, (Math.random() - 0.5) * 1600 - RING)
      R.add(c)
    }

    // ---------- 环形轨道（高架，横跨天空） ----------
    const segN = 160
    for (let i = 0; i < segN; i++) {
      const a0 = (i / segN) * Math.PI * 2, a1 = ((i + 1) / segN) * Math.PI * 2
      const p0 = v3(RING * Math.sin(a0), 0, -RING + RING * Math.cos(a0)), p1 = v3(RING * Math.sin(a1), 0, -RING + RING * Math.cos(a1))
      const mid = p0.clone().add(p1).multiplyScalar(0.5)
      const len = p0.distanceTo(p1) + 0.1
      const seg = new Mesh(boxGeo(len, 0.6, 4.2), iron)
      seg.position.copy(mid).add(v3(0, -0.35, 0))
      seg.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x)
      R.add(seg)
      this.ringSegs.push(seg)
      if (i % 4 === 0) {
        const pil = new Mesh(new CylinderGeometry(0.8, 1.2, 60, 8), stone)
        pil.position.copy(mid).add(v3(0, -30.6, 0))
        R.add(pil)
        this.ringSegs.push(pil)
      }
      for (const z of [-0.72, 0.72]) {
        const rail = new Mesh(boxGeo(len, 0.12, 0.08), brass)
        rail.position.copy(mid).add(v3(-Math.sin(seg.rotation.y) * z * 0, 0.06, 0))
        rail.rotation.y = seg.rotation.y
        rail.translateZ(z)
        R.add(rail)
        this.ringSegs.push(rail)
      }
    }
    this.col.slab(0, -2.5, 200, 3, -1, 0, { surface: 'stone', tag: 'bed', safe: false })
    await yieldFrame()

    // ---------- 站台：零号站台，但完好、干燥、天将亮 ----------
    B.box(stone, 0, Y - 0.5, 5.3, 84, 1, 7.4, 0, 2)
    B.box(tiles, 0, Y + 0.005, 5.6, 84, 0.01, 6.6, 0, 2)
    B.box(std({ color: 0xc89a2a, rough: 0.5 }), 0, Y + 0.012, 2.15, 84, 0.012, 0.3)
    this.col.slab(0, 5.3, 84, 7.4, -2, Y, { surface: 'marble', tag: 'platform' })
    this.col.slab(-42.2, 5.3, 0.4, 7.4, Y, Y + 3, { walkable: false })
    this.col.slab(-25, 1.65, 12, 0.12, Y, Y + 3, { walkable: false, tag: 'edge' })
    this.col.slab(34, 1.65, 12, 0.12, Y, Y + 3, { walkable: false, tag: 'edge' })
    this.col.slab(19, 1.55, 17.2, 0.1, Y, Y + 3, { walkable: false, tag: 'hull' })
    this.col.slab(-21, 1.55, 20.6, 0.1, Y, Y + 3, { walkable: false, tag: 'hull' })
    // 站房立面（干净、窗里有晨光）
    B.box(brick, 0, 4.2, 9.2, 84, 8.4, 0.4, 0, 2.4)
    this.col.slab(0, 9.2, 84, 0.4, Y, 9, { walkable: false })
    const winM = windowize(std({ color: 0xc8b8a8, rough: 0.6 }), new Color(1.6, 1.2, 0.8), 0.6, 3.2, 3)
    B.box(winM, 0, 9, 9.45, 84, 3.6, 0.1, 0, 3)
    // 雨棚
    B.box(iron, 0, 5.5, 6.2, 76, 0.12, 6.6)
    for (let x = -36; x <= 36; x += 8) {
      B.cyl(iron, x, 3.25, 4.4, 0.13, 4.5, 14)
      this.col.cyl(x, 4.4, 0.24, Y, 5.5)
      const lamp = new Mesh(new SphereGeometry(0.11, 12, 8), glowMat(0xffe2b0, 7))
      lamp.position.set(x + 4, 4.6, 5.2)
      R.add(lamp)
      // 吊杆与搪瓷灯罩
      B.cyl(iron, x + 4, 5.1, 5.2, 0.015, 0.8, 6)
      B.cyl(enamel, x + 4, 4.74, 5.2, 0.36, 0.2, 20, 0.09)
    }
    const nameTex = textTexture({ w: 1024, h: 256, bg: '#14202c', border: '#d2a860', lines: [{ text: '终 点 站', size: 0.36, color: '#f3ecd8', y: 0.4 }, { text: 'TERMINUS · THE STATION THAT NEVER WAS', size: 0.11, color: '#d2a860', font: MONO, y: 0.76, spacing: 0.2 }] })
    for (const x of [-20, 20]) {
      const n = signBoard(new MeshStandardMaterial({ map: nameTex }), 3.4, 0.85)
      n.position.set(x, 4.5, 5.6)
      R.add(n)
    }
    // 长椅（新的车票放在这里）
    for (const x of [-12, 12]) {
      B.box(wood, x, Y + 0.45, 7.6, 1.9, 0.06, 0.5)
      B.box(wood, x, Y + 0.8, 7.85, 1.9, 0.5, 0.05)
      this.col.slab(x, 7.6, 1.9, 0.55, Y, Y + 0.5, { surface: 'wood' })
    }
    const newTicket = new Mesh(boxGeo(0.16, 0.004, 0.08), std({ color: 0xf2ead8, rough: 0.8 }))
    newTicket.position.set(12.4, Y + 0.49, 7.55)
    R.add(newTicket)
    this.newTicket = newTicket

    // ---------- 站房立面：门、亮着晨光的窗、时刻表、线路图、行李 ----------
    // 窗里的晨光：上亮下暗，两侧有窗帘的褶皱，看起来屋里有纵深
    const morningTex = makeTex('morningWin', 64, (u, v) => {
      const curtain = Math.max(0, 1 - Math.min(u, 1 - u) / 0.16)
      const fold = 0.85 + 0.15 * Math.sin(u * 60)
      const k = (0.35 + v * 0.65) * (1 - curtain * 0.55 * fold)
      return [k, k * 0.86, k * 0.7]
    })
    const morning = glowMat(0xffd8a8, 1.4, morningTex)
    const frameM = std({ color: 0x3a2a20, map: TEX.wood(), rough: 0.5 })
    const face = 8.98
    for (const x of [-26, 0, 26]) {
      // 双开木门：上半是透光的玻璃，上方一扇扇形气窗
      B.box(frameM, x, Y + 1.6, face - 0.04, 2.4, 3.2, 0.1)
      for (const dx of [-0.55, 0.55]) {
        B.add(new PlaneGeometry(0.8, 1.3), morning, trs(x + dx, Y + 2.25, face - 0.095, 0, Math.PI, 0), false)
        B.box(frameM, x + dx, Y + 0.85, face - 0.11, 0.8, 1.1, 0.03)
        B.box(brass, x + dx * 0.25, Y + 1.5, face - 0.14, 0.04, 0.32, 0.04)
      }
      B.box(frameM, x, Y + 1.6, face - 0.12, 0.08, 3.1, 0.04)
      B.add(new PlaneGeometry(2.0, 0.6), morning, trs(x, Y + 3.6, face - 0.05, 0, Math.PI, 0), false)
      B.box(stone, x, Y + 4.0, face - 0.1, 2.9, 0.22, 0.2)
      B.box(stone, x, Y + 0.03, face - 0.35, 2.8, 0.06, 0.7)
    }
    for (const x of [-34, -18, 18, 34]) {
      B.add(new PlaneGeometry(2.6, 2.0), morning, trs(x, Y + 2.2, face - 0.02, 0, Math.PI, 0), false)
      B.box(iron, x, Y + 2.2, face - 0.06, 2.8, 0.1, 0.06)
      B.box(iron, x, Y + 3.24, face - 0.06, 2.8, 0.08, 0.06)
      B.box(iron, x, Y + 1.16, face - 0.06, 2.8, 0.08, 0.06)
      for (const dx of [-1.36, -0.45, 0.45, 1.36]) B.box(iron, x + dx, Y + 2.2, face - 0.06, 0.06, 2.1, 0.06)
      B.box(stone, x, Y + 1.08, face - 0.15, 3.0, 0.1, 0.3)
    }
    // 时刻表：零号线每一站的发车时间，最后一行没有时间
    const ttTex = textTexture({ w: 768, h: 512, bg: '#1a2430', border: '#d2a860', lines: [
      { text: '零号线 · 末班车时刻表', size: 0.075, color: '#f3ecd8', y: 0.1 },
      { text: 'LINE 0 · LAST SERVICE', size: 0.04, color: '#d2a860', font: MONO, y: 0.18, spacing: 0.2 },
      { text: '午夜车站', size: 0.055, color: '#e8e0d0', y: 0.31, align: 'left', x: 0.1 }, { text: '00:00', size: 0.055, color: '#ffc870', font: MONO, y: 0.31, align: 'right', x: 0.9 },
      { text: '倒悬都市', size: 0.055, color: '#e8e0d0', y: 0.42, align: 'left', x: 0.1 }, { text: '00:00', size: 0.055, color: '#ffc870', font: MONO, y: 0.42, align: 'right', x: 0.9 },
      { text: '深海终点站', size: 0.055, color: '#e8e0d0', y: 0.53, align: 'left', x: 0.1 }, { text: '00:00', size: 0.055, color: '#ffc870', font: MONO, y: 0.53, align: 'right', x: 0.9 },
      { text: '时间沙漠', size: 0.055, color: '#e8e0d0', y: 0.64, align: 'left', x: 0.1 }, { text: '23:59', size: 0.055, color: '#ffc870', font: MONO, y: 0.64, align: 'right', x: 0.9 },
      { text: '记忆博物馆', size: 0.055, color: '#e8e0d0', y: 0.75, align: 'left', x: 0.1 }, { text: '00:00', size: 0.055, color: '#ffc870', font: MONO, y: 0.75, align: 'right', x: 0.9 },
      { text: '不存在的终点', size: 0.055, color: '#e8e0d0', y: 0.86, align: 'left', x: 0.1 }, { text: '--:--', size: 0.055, color: '#8a8478', font: MONO, y: 0.86, align: 'right', x: 0.9 },
    ] })
    const tt = new Mesh(new PlaneGeometry(2.4, 1.6), new MeshStandardMaterial({ map: ttTex, emissive: 0xffffff, emissiveMap: ttTex, emissiveIntensity: 0.25, roughness: 0.5 }))
    tt.position.set(-9, Y + 2.1, face - 0.03)
    tt.rotation.y = Math.PI
    R.add(tt)
    B.box(brass, -9, Y + 2.1, face - 0.01, 2.56, 1.76, 0.03)
    // 线路图：一条环线，六个站点
    const mapTex = textTexture({ w: 768, h: 384, bg: '#efe6d2', border: '#2a3a4a', lines: [
      { text: '零号线 线路图 · LINE 0', size: 0.07, color: '#2a3a4a', y: 0.12 },
      { text: '○ 午夜车站 ─ ○ 倒悬都市 ─ ○ 深海终点站', size: 0.07, color: '#3a4a5a', y: 0.45 },
      { text: '○ 时间沙漠 ─ ○ 记忆博物馆 ─ ● 不存在的终点', size: 0.07, color: '#3a4a5a', y: 0.64 },
      { text: '本线为环线 · THIS LINE HAS NO END', size: 0.05, color: '#a0402a', font: MONO, y: 0.86, spacing: 0.1 },
    ] })
    const lineMap = new Mesh(new PlaneGeometry(2.4, 1.2), new MeshStandardMaterial({ map: mapTex, roughness: 0.6 }))
    lineMap.position.set(9, Y + 2.1, face - 0.03)
    lineMap.rotation.y = Math.PI
    R.add(lineMap)
    B.box(iron, 9, Y + 2.1, face - 0.01, 2.52, 1.32, 0.03)
    // 长椅旁有人留下的行李
    const leather = std({ color: 0x5a3424, rough: 0.6 })
    B.box(leather, -14.3, Y + 0.3, 7.95, 0.8, 0.6, 0.28)
    B.box(leather, -14.25, Y + 0.72, 7.95, 0.62, 0.24, 0.24)
    B.box(brass, -14.3, Y + 0.64, 7.95, 0.2, 0.04, 0.05)
    B.box(std({ color: 0x2a3a4a, rough: 0.7 }), -15.05, Y + 0.25, 7.6, 0.45, 0.5, 0.35)
    this.col.slab(-14.6, 7.8, 1.5, 0.7, Y, Y + 0.85, { walkable: false, tag: 'luggage' })

    // ---------- 站台大钟（没有指针） ----------
    B.cyl(iron, CLOCK.x, Y + 2.2, CLOCK.z, 0.18, 4.4, 12)
    this.col.cyl(CLOCK.x, CLOCK.z, 0.3, Y, Y + 4.4)
    const faceTex = textTexture({ w: 512, h: 512, bg: '#f2ead8', lines: [
      { text: 'XII', size: 0.1, color: '#2a2018', font: DISPLAY, y: 0.11, weight: '600' }, { text: 'VI', size: 0.1, color: '#2a2018', font: DISPLAY, y: 0.89, weight: '600' },
      { text: 'III', size: 0.1, color: '#2a2018', font: DISPLAY, y: 0.5, x: 0.89, weight: '600' }, { text: 'IX', size: 0.1, color: '#2a2018', font: DISPLAY, y: 0.5, x: 0.11, weight: '600' },
      { text: '零号线 · LINE 0', size: 0.035, color: '#6a5a48', font: MONO, y: 0.66 },
    ] })
    for (const s of [-1, 1]) {
      const face = new Mesh(new CylinderGeometry(0.9, 0.9, 0.06, 48), new MeshStandardMaterial({ map: faceTex, roughness: 0.5, emissive: 0xfff0d0, emissiveMap: faceTex, emissiveIntensity: 0.35 }))
      face.rotation.set(Math.PI / 2, s > 0 ? 0 : Math.PI, 0)
      face.position.set(CLOCK.x, Y + 4.9, CLOCK.z + s * 0.12)
      R.add(face)
      const rim = new Mesh(new TorusGeometry(0.92, 0.06, 10, 48), brass)
      rim.position.set(CLOCK.x, Y + 4.9, CLOCK.z + s * 0.12)
      R.add(rim)
    }
    B.box(brass, CLOCK.x, Y + 4.9, CLOCK.z, 0.5, 0.5, 0.25)
    // 指针（装上之后才出现，朝站台一侧）
    this.minute = new Mesh(boxGeo(0.05, 0.75, 0.02), std({ color: 0x1a1410, metal: 0.8, rough: 0.4 }))
    this.minute.geometry.translate(0, 0.32, 0)
    this.hour = new Mesh(boxGeo(0.08, 0.5, 0.02), std({ color: 0x1a1410, metal: 0.8, rough: 0.4 }))
    this.hour.geometry.translate(0, 0.2, 0)
    this.hour.position.z = 0.02
    this.clockHands.add(this.minute, this.hour)
    this.clockHands.position.set(CLOCK.x, Y + 4.9, CLOCK.z - 0.17)
    R.add(this.clockHands)
    // 钟柱上的票口
    const slotPlate = new Mesh(boxGeo(0.4, 0.3, 0.12), brass)
    slotPlate.position.set(CLOCK.x, Y + 1.3, CLOCK.z - 0.22)
    R.add(slotPlate)
    this.ticketSlot = new Mesh(boxGeo(0.18, 0.01, 0.1), glowMat(0x2a1a0a, 1))
    this.ticketSlot.position.set(CLOCK.x, Y + 1.32, CLOCK.z - 0.29)
    R.add(this.ticketSlot)

    // ---------- 出站闸机 ----------
    for (const z of [3.2, 5.6, 8.0]) {
      B.box(iron, GATE_X, Y + 0.5, z, 1.2, 1.0, 0.25)
      this.col.slab(GATE_X, z, 1.2, 0.25, Y, Y + 1.0, { walkable: false })
      const arm = new Mesh(boxGeo(0.06, 0.06, 1.0), brass)
      arm.position.set(GATE_X, Y + 0.85, z + 0.65)
      R.add(arm)
      this.gateArms.push(arm)
    }
    this.gateCol = this.col.slab(GATE_X, 5.6, 0.3, 7.0, Y, Y + 3, { tag: 'gate', walkable: false })
    const exitTex = textTexture({ w: 512, h: 160, bg: '#1a3a24', lines: [{ text: '出 站', size: 0.42, color: '#e8f2e0', y: 0.42 }, { text: 'EXIT →', size: 0.18, color: '#9ad8a0', font: MONO, y: 0.8 }] })
    // 两块单面的牌子背靠背：从站台和从街上看都是正字（双面材质从背面看是反字）
    const exitMat = new MeshStandardMaterial({ map: exitTex, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 0.6 })
    for (const sd of [-1, 1]) {
      const exitSign = new Mesh(new PlaneGeometry(1.6, 0.5), exitMat)
      exitSign.position.set(GATE_X + sd * 0.03, 3.6, 5.6)
      exitSign.rotation.y = (sd * Math.PI) / 2
      R.add(exitSign)
    }
    B.box(iron, GATE_X, 3.6, 5.6, 0.04, 0.56, 1.66)
    // 闸机外：通往晨光里的街道
    B.box(stone, GATE_X + 14, Y - 0.5, 5.6, 28, 1, 7)
    this.col.slab(GATE_X + 14, 5.6, 28, 7, -2, Y, { surface: 'stone', tag: 'street' })
    this.col.slab(GATE_X + 14, 1.9, 28, 0.3, Y, Y + 3, { walkable: false })
    this.col.slab(GATE_X + 14, 9.3, 28, 0.3, Y, Y + 3, { walkable: false })
    this.col.slab(GATE_X + 28.2, 5.6, 0.4, 7, Y, Y + 3, { walkable: false })
    // 闸机外：晨光里的街。远处一片渐亮的天，街两侧是剪影般的楼
    const dawnTex = makeTex('dawnSky', 128, (_u, v) => {
      const k = 1 - v
      return [1.0 * (0.55 + k * 0.45), 0.62 + k * 0.3, 0.55 + k * 0.1]
    })
    const dawn = new Mesh(new PlaneGeometry(60, 40), new MeshBasicMaterial({ map: dawnTex, color: new Color(2.2, 1.9, 1.7), fog: false }))
    dawn.position.set(GATE_X + 60, 12, 5.6)
    dawn.rotation.y = -Math.PI / 2
    R.add(dawn)
    const sil = std({ color: 0x2a2630, rough: 0.9 })
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1
      const h = 6 + Math.random() * 14
      B.box(sil, GATE_X + 8 + Math.floor(i / 2) * 7, Y + h / 2, 5.6 + side * (6 + Math.random() * 3), 6, h, 4)
    }
    // 街灯：灯柱 + 弯臂 + 灯罩（之前只有悬空的发光球）
    for (let i = 0; i < 6; i++) {
      const lx = GATE_X + 6 + i * 4, lz = i % 2 ? 2.4 : 8.8
      const inward = i % 2 ? 1 : -1
      B.cyl(iron, lx, Y + 1.7, lz, 0.06, 3.4, 8)
      B.box(iron, lx, Y + 3.38, lz + inward * 0.25, 0.05, 0.05, 0.55)
      B.cyl(enamel, lx, Y + 3.26, lz + inward * 0.5, 0.22, 0.14, 14, 0.06)
      const lamp = new Mesh(new SphereGeometry(0.08, 8, 6), glowMat(0xffd8a0, 4 - i * 0.5))
      lamp.position.set(lx, Y + 3.16, lz + inward * 0.5)
      R.add(lamp)
      this.col.cyl(lx, lz, 0.1, Y, Y + 3.4)
    }

    // ---------- 驾驶室里的帽子 ----------
    this.cap = itemModel('cap', '#1c2638') as Group
    this.cap.scale.setScalar(0.32)
    this.cap.position.set(15.6, FLOOR_Y + 0.65, 0)
    R.add(this.cap)

    // ---------- 撑红伞的人（只在打破循环的结局里出现） ----------
    this.umbrellaFigure = new Group()
    // 等你的人：同一套人物模型，深红色大衣，不戴帽子，撑着那把红伞
    const waiting = new Conductor({ coat: 0x4a2a2a, hat: false, hair: 0x2a2220, lantern: false })
    waiting.group.rotation.y = 0
    this.umbrellaFigure.add(waiting.group)
    const umb = itemModel('umbrella', '#b33a32')
    umb.rotation.z = 0.12
    umb.position.set(0.18, 1.55, 0.05)
    umb.scale.setScalar(1.1)
    this.umbrellaFigure.add(umb)
    this.umbrellaFigure.position.set(-8, Y, 5)
    this.umbrellaFigure.rotation.y = Math.PI / 2
    this.umbrellaFigure.visible = false
    R.add(this.umbrellaFigure)

    // ---------- 环绕的世界（终点反转） ----------
    this.buildOrbit()
    R.add(this.orbit)
    this.whale = new Whale(60)
    R.add(this.whale.group)
    this.dust = motes(Math.round(3000 * q.particles + 500), 80, new Color(1.0, 0.82, 0.6), 0.04, new Vector2(0.1, 0.02))
    R.add(this.dust.points)

    // ---------- 灯光 ----------
    R.add(new HemisphereLight(0x8a9ad8, 0x4a3a40, 0.9))
    this.sun = new DirectionalLight(0xffc8a0, 1.2)
    this.sun.position.set(40, 30, -80)
    this.sun.target.position.set(0, 0, 5)
    this.sun.castShadow = q.shadows
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
    const sc = this.sun.shadow.camera
    sc.left = -50; sc.right = 50; sc.top = 30; sc.bottom = -30; sc.near = 10; sc.far = 200
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.radius = 3
    R.add(this.sun, this.sun.target)
    const warm = new PointLight(0xffd8a8, 30, 18, 1.6)
    warm.position.set(0, 5, 6)
    R.add(warm)

    B.build(R, 'terminus')
    this.buildInteractions()
    this.syncState()
  }

  private newTicket!: Mesh

  private buildOrbit() {
    const O = this.orbit
    // 倒悬的城：头顶天空里一整片倒挂的楼
    const tower = windowize(std({ color: 0xd8d0c0, rough: 0.6 }), new Color(1.0, 0.7, 0.4), 0.3)
    const OB = new Batcher()
    OB.box(std({ color: 0x8a7a6a, rough: 0.9 }), -160, 150, 120, 140, 6, 90)
    for (let i = 0; i < 26; i++) {
      const x = -220 + Math.random() * 120, z = 80 + Math.random() * 80, h = 20 + Math.random() * 60, w = 8 + Math.random() * 10
      OB.box(tower, x, 147 - h / 2, z, w, h, w, 0, 4)
    }
    // 凝固的沙岛与倒下的钟塔
    OB.add(new SphereGeometry(40, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0xe0b888, map: TEX.sand(), rough: 1 }), new Matrix4().makeScale(1.4, 0.35, 1).setPosition(180, 40, -60))
    OB.boxR(std({ color: 0xd8b48a, map: TEX.stone(), rough: 0.85 }), 180, 52, -60, 6, 6, 36, 0.4, 0.6, 0)
    // 沉没的车厢，悬在半空
    OB.boxR(std({ color: 0x5a6a6a, map: TEX.rust(), rough: 0.8, metal: 0.4 }), 60, 70, 220, 22, 3.4, 3.2, 0.2, 0.5, 1.3)
    OB.build(O, 'orbit')
    // 博物馆的画框
    const gold = std({ color: 0xd2a860, rough: 0.3, metal: 1 })
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const r = 140 + (i % 3) * 30
      const g = new Group()
      const tex = makeTex(`orbitPaint${i}`, 64, (u, v) => { const n = fbm(u, v, 3, 3, 500 + i); return [0.3 + n * 0.6, 0.2 + n * 0.4 + v * 0.2, 0.3 + (1 - n) * 0.4] })
      const pic = new Mesh(new PlaneGeometry(14, 10), new MeshStandardMaterial({ map: tex, side: DoubleSide, roughness: 0.7 }))
      g.add(pic)
      const fr = new Mesh(boxGeo(15.4, 11.4, 0.6), gold)
      fr.position.z = -0.4
      g.add(fr)
      g.position.set(Math.cos(a) * r, 30 + Math.sin(i * 2.3) * 18, -40 + Math.sin(a) * r)
      g.lookAt(0, 10, 0)
      g.userData.spin = 0.02 + (i % 4) * 0.01
      O.add(g)
    }
    // 漂浮的钟表碎片与齿轮
    for (let i = 0; i < 18; i++) {
      const gear = new Mesh(new TorusGeometry(2 + Math.random() * 5, 0.5, 6, 18), gold)
      gear.position.set((Math.random() - 0.5) * 400, 20 + Math.random() * 80, (Math.random() - 0.5) * 400 - 40)
      gear.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      gear.userData.spin = (Math.random() - 0.5) * 0.1
      O.add(gear)
    }
    // 远方的光：其他世界的灯
    for (let i = 0; i < 40; i++) {
      const s = new Mesh(new SphereGeometry(0.6 + Math.random(), 8, 6), new MeshBasicMaterial({ color: new Color().setHSL(0.08 + Math.random() * 0.5, 0.7, 0.7), transparent: true, opacity: 0.8, blending: AdditiveBlending }))
      s.position.set((Math.random() - 0.5) * 900, 10 + Math.random() * 120, (Math.random() - 0.5) * 900 - 300)
      O.add(s)
    }
  }

  // ---------------- 交互 ----------------
  private buildInteractions() {
    const g = this.game
    this.trigger({ id: 'out', min: v3(-40, 0.5, 1.7), max: v3(GATE_X - 1, 4, 9), enter: () => { if (!S.is('terminus.out')) { S.set('terminus.out'); g.refresh() } } })
    // 大钟
    this.item({
      id: 'clockHands', pos: v3(CLOCK.x, Y + 4.9, CLOCK.z - 0.2), radius: 1.0, range: 4.8, label: '没有指针的大钟',
      verb: () => (S.is('terminus.handsIn') ? (S.is('terminus.firstIn') ? '把钟拨到 00:01' : '钟面在等什么') : S.has('hands') ? '装上指针' : '检查'),
      use: () => {
        if (!S.is('terminus.handsIn')) {
          if (S.has('hands')) {
            S.take('hands')
            S.set('terminus.handsIn')
            g.sfx('insert', CLOCK)
            g.sfx('clockStrike', v3(0, 6, 6), 0.6)
            g.say('', '指针装上去了，严丝合缝。它们原本就属于这座钟。两根指针都指着 12。', 4)
            this.syncState()
            return
          }
          g.say('', '钟面上没有指针。钟停在 00:00——或者说，它根本没有办法走。', 4)
          return
        }
        if (!S.is('terminus.firstIn')) {
          g.say('', '钟柱上有一个票口，比普通的票口窄一些。', 3)
          return
        }
        this.tryLoop()
      },
    })
    this.item({
      id: 'ticketSlot', pos: v3(CLOCK.x, Y + 1.32, CLOCK.z - 0.3), radius: 0.3, label: '钟柱上的票口',
      verb: () => (S.has('first_ticket') ? '放入第一张车票' : S.has('ticket') ? '放入车票' : '检查'),
      enabled: () => !S.is('terminus.firstIn'),
      use: () => {
        if (S.has('first_ticket')) {
          S.take('first_ticket')
          S.set('terminus.firstIn')
          g.sfx('punch')
          g.sfx('chime', CLOCK, 0.5)
          g.say('', '票口吞下了那张从未被检过的票。钟里传来一声很轻的“咔”。', 4)
          this.syncState()
          return
        }
        g.sfx('deny')
        g.say('', S.has('ticket') ? '票口吐出了你的车票。不是这一张。' : '票口在等一张票。', 3)
      },
    })
    // 出站闸机
    this.item({
      id: 'gate', pos: v3(GATE_X, Y + 1.0, 5.6), radius: 1.2, label: '出站闸机', verb: () => (endingAvailable('leave') ? '刷票出站' : '检查'),
      use: () => {
        if (!endingAvailable('leave')) {
          g.sfx('deny', v3(GATE_X, 1.5, 5.6))
          g.say('', S.has('ticket') ? '闸机读不出你车票的目的地。目的地一栏还是空的。' : '闸机在等一张车票。', 3.5)
          return
        }
        this.endLeave()
      },
    })
    // 驾驶室：帽子与发车杆
    this.item({
      id: 'cap', pos: v3(15.6, FLOOR_Y + 0.7, 0), radius: 0.35, label: '列车长的帽子', verb: '戴上',
      enabled: () => S.is('terminus.capOffered') && !S.has('cap'),
      use: () => {
        g.pickup('cap')
        g.say('', '帽子比想象中轻。内衬里缝着一个名字——和你的一模一样。', 4)
        this.syncState()
      },
    })
    this.item({
      id: 'cabLever', pos: v3(16.6, FLOOR_Y + 1.15, 0.6), radius: 0.3, label: '驾驶室发车杆', verb: () => (S.has('cap') ? '拉下' : '检查'),
      enabled: () => this.game.train.cabOpen > 0,
      use: () => {
        if (!S.has('cap')) {
          g.say('', '发车杆很沉。只有列车长才能拉动它。', 3)
          return
        }
        this.endConductor()
      },
    })
    this.item({
      id: 'lost6', pos: v3(12.4, Y + 0.5, 7.55), radius: 0.3, label: '长椅上的新车票', verb: '拾取',
      enabled: () => !S.get().collectibles.includes('t6'),
      use: () => { g.collect('t6'); this.syncState() },
    })
    this.item({
      id: 'umbrellaFigure', pos: v3(-8, Y + 1.5, 5), radius: 0.6, label: '撑着红伞的人', verb: '走过去',
      enabled: () => this.umbrellaFigure.visible,
      use: () => {},
    })
  }

  private tryLoop() {
    const g = this.game
    const req = loopRequirements()
    const miss = req.filter((r) => !r.ok)
    if (miss.length) {
      g.sfx('deny', CLOCK)
      const m = miss[0]
      const text = m.id === 'archives' ? '指针在 12 点微微颤抖，却拨不动。像是在等你知道得更多一点。（读过的异常档案不足 4 份）'
        : m.id === 'consent' ? '指针拨不动。也许该先告诉列车长你的决定。'
        : `还缺：${m.label}`
      g.say('', text, 4.5)
      return
    }
    this.endLoop()
  }

  private syncState() {
    this.clockHands.visible = S.is('terminus.handsIn')
    ;(this.ticketSlot.material as MeshStandardMaterial).emissive.setHex(S.is('terminus.firstIn') ? 0xffc870 : 0x2a1a0a)
    ;(this.ticketSlot.material as MeshStandardMaterial).emissiveIntensity = S.is('terminus.firstIn') ? 4 : 1
    this.cap.visible = S.is('terminus.capOffered') && !S.has('cap')
    this.newTicket.visible = !S.get().collectibles.includes('t6')
    this.game.train.setCab(S.is('terminus.capOffered'))
    this.gateCol.enabled = true
  }

  update(dt: number, t: number) {
    const g = this.game
    // 剧情状态变化（对话里设置的 flag）需要反映到场景
    if (this.cap.visible !== (S.is('terminus.capOffered') && !S.has('cap'))) this.syncState()
    if ((g.train.cabOpen > 0) !== S.is('terminus.capOffered')) this.syncState()
    for (const c of this.orbit.children) {
      const sp = c.userData.spin as number | undefined
      if (sp) c.rotation.y += dt * sp
    }
    this.orbit.rotation.y += dt * 0.004
    // 鲸在云里绕着车站游
    const a = t * 0.03
    const wp = v3(Math.cos(a) * 220, 60 + Math.sin(a * 2) * 12, -60 + Math.sin(a) * 160)
    const wn = v3(Math.cos(a + 0.01) * 220, 60 + Math.sin((a + 0.01) * 2) * 12, -60 + Math.sin(a + 0.01) * 160)
    this.whale.group.position.copy(wp)
    this.whale.group.lookAt(wn)
    this.whale.group.rotateY(-Math.PI / 2)
    this.whale.glow = 0.6
    this.whale.update(dt)
    // 日出（打破循环的结局）
    this.sunrise += (this.sunTarget - this.sunrise) * (1 - Math.exp(-dt * 0.35))
    const su = this.sky.mat.uniforms
    ;(su.uSun.value as Vector3).set(0.25, -0.16 + this.sunrise * 0.4, -1).normalize()
    ;(su.uTop.value as Color).setRGB(0.05 + this.sunrise * 0.25, 0.08 + this.sunrise * 0.35, 0.2 + this.sunrise * 0.45)
    su.uStars.value = 1 - this.sunrise
    ;(su.uSunCol.value as Color).setRGB(1.4 + this.sunrise * 1.8, 0.8 + this.sunrise * 1.3, 0.5 + this.sunrise * 0.8)
    su.uTime.value = t
    this.sun.intensity = 1.2 + this.sunrise * 3
    // 环轨断开
    if (this.ringBreak > 0 && this.ringBreak < 1) {
      this.ringBreak = Math.min(1, this.ringBreak + dt * 0.12)
      this.ringSegs.forEach((s, i) => {
        if (Math.abs(s.position.x) < 40 && s.position.z > -60) return
        s.position.y -= dt * (2 + (i % 7)) * this.ringBreak * 3
        s.rotation.x += dt * 0.2 * ((i % 3) - 1)
      })
    }
    // 闸机臂
    const open = endingAvailable('leave')
    this.gateArms.forEach((arm) => { arm.rotation.x += ((open ? 1.5 : 0) - arm.rotation.x) * (1 - Math.exp(-dt * 4)) })
    this.dust.mat.uniforms.uTime.value = t
    const cl = g.camera.position.clone()
    this.root.worldToLocal(cl)
    ;(this.dust.mat.uniforms.uC.value as Vector3).copy(cl)
    g.audio.setRain(0)
    g.audio.setWind(0.2, 0.6)
    g.audio.setSea(0)
    g.audio.setOpenness(1)
  }

  onDocked() {
    if (!S.is('terminus.arrived')) {
      S.set('terminus.arrived')
      this.game.say('列车长', '到了。', 2.5)
    }
    this.syncState()
  }

  /** Moment 5 · 终点反转：沿着环形轨道驶入，之前的世界以新的方式环绕出现 */
  onApproach(p: number) {
    const g = this.game
    if (p > 0.15 && p < 0.17 && !this.saidRing) {
      this.saidRing = true
      g.say('', '铁轨在弯。一直在弯。', 3)
    }
    if (p > 0.45 && !this.saidWorlds) {
      this.saidWorlds = true
      g.say('', '窗外，你见过的那些世界都在：倒挂的城、云里的鲸、凝固的沙、悬空的画框。它们围着同一个地方。', 5.5)
    }
    if (p > 0.82 && !this.saidStation) {
      this.saidStation = true
      g.say('', '终点站——是零号站台。', 4)
      g.moment('reversal')
    }
  }

  private saidRing = false
  private saidWorlds = false
  private saidStation = false

  // ---------------- 结局过场 ----------------
  private endLeave() {
    const g = this.game
    this.ending = 'running'
    S.take('ticket')
    g.sfx('punch')
    g.sfx('lever', v3(GATE_X, 1.5, 5.6))
    this.gateCol.enabled = false
    const e = g.player.eye.clone()
    void g.cinematic([
      { dur: 6, from: [e.clone(), v3(GATE_X + 6, 2.4, 5.6), v3(GATE_X + 18, 2.6, 5.6)], look: [v3(GATE_X + 10, 2.5, 5.6), v3(GATE_X + 30, 3, 5.6)], ease: 'inOut', fov: [70, 60] },
      { dur: 5, from: [v3(GATE_X + 20, 2.8, 5.6), v3(GATE_X + 8, 5, 3)], look: [v3(0, 3, 5), v3(0, 3.5, 4)], ease: 'inOut', fov: [55, 45], start: () => g.setFade(0) },
      { dur: 3, from: [v3(GATE_X + 8, 5, 3)], look: [v3(0, 3.5, 4)], start: () => g.setFade(1) },
    ], { skippable: true }).then(() => {
      g.setFade(0)
      g.ending('leave')
    })
  }

  private endConductor() {
    const g = this.game
    this.ending = 'running'
    S.take('cap')
    g.sfx('lever')
    g.sfx('horn', v3(26, 3, 0), 0.9)
    const cond = g.conductor
    cond.place(this.root, 2, Y, 4.6, -Math.PI / 2)
    cond.hat.visible = false
    const train = g.train
    let tt = 0
    void g.cinematic([
      { dur: 4, from: [v3(15.2, 2.7, 0.2)], look: [v3(30, 2.6, 0)], fov: [62, 60], start: () => train.setDoors(false) },
      {
        dur: 9, from: [v3(-6, 2.2, 6.5), v3(-14, 2.6, 7.5)], look: [v3(2, 2, 4.6), v3(12, 2.4, 2)], ease: 'inOut', fov: [50, 44],
        tick: (_p, dt) => {
          // 匀加速出站：9 秒后约 120 米、速度约 27 m/s
          tt += dt
          train.group.position.x = 1.5 * tt * tt
          train.externalSpeed = 3 * tt
        },
      },
      { dur: 3, from: [v3(-14, 2.6, 7.5)], look: [v3(30, 2.4, 2)], start: () => g.setFade(1) },
    ], { skippable: true }).then(() => {
      train.group.position.x = 0
      train.externalSpeed = 0
      cond.hat.visible = true
      g.setFade(0)
      g.ending('conductor')
    })
  }

  private endLoop() {
    const g = this.game
    this.ending = 'running'
    const minute = this.minute
    let k = 0
    void g.cinematic([
      {
        dur: 5, from: [v3(0, Y + 3.6, 3.4)], look: [v3(0, Y + 4.9, 6.4)], fov: [40, 32], ease: 'out',
        tick: (p) => {
          const m = Math.min(1, p * 1.4)
          minute.rotation.z = -m * (Math.PI * 2 / 60)
          if (p > 0.7 && k === 0) {
            k = 1
            g.sfx('clockStrike', CLOCK)
            g.fx.flash.setRGB(0.9, 0.8, 0.6)
            this.sunTarget = 1
            this.ringBreak = 0.01
          }
        },
      },
      { dur: 9, from: [v3(0, 3, 4), v3(-20, 10, 18), v3(-30, 18, 30)], look: [v3(0, 3, 0), v3(-10, 4, -40), v3(0, 10, -200)], ease: 'inOut', fov: [50, 60], start: () => g.say('', '00:01。环形的铁轨在远处断开，变成一条笔直的线。', 5) },
      {
        dur: 7, from: [v3(-2, 2.4, 3), v3(-4, 2.3, 4)], look: [v3(-8, 2.2, 5), v3(-8, 2.4, 5)], ease: 'inOut', fov: [48, 40],
        start: () => {
          this.umbrellaFigure.visible = true
          g.conductor.hat.visible = false
          g.conductor.place(this.root, -6.5, Y, 4.2, -Math.PI / 2)
        },
      },
      { dur: 3, from: [v3(-4, 2.3, 4)], look: [v3(-8, 2.4, 5)], start: () => g.setFade(1) },
    ], { skippable: true }).then(() => {
      g.setFade(0)
      g.conductor.hat.visible = true
      g.ending('loop')
    })
  }

  momentShots(): Shot[] {
    // 先朝环心一侧的车窗看出去（之前的世界都围在环里），到站时转回站台：终点就是零号站台
    return [
      { dur: 22, from: [v3(0.0, 2.2, -0.4), v3(0.0, 2.15, -0.5)], look: [v3(-60, 18, -150), v3(0, 30, -160), v3(60, 22, -150)], fov: [74, 80], ease: 'inOut' },
      { dur: 9, from: [v3(0.0, 2.15, -0.5), v3(0.2, 2.3, 0.3)], look: [v3(30, 10, -100), v3(0, 3, 20)], fov: [80, 62], ease: 'inOut' },
    ]
  }
}

