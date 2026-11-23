// 末班 0000 次：机车 + 可进入的客车车厢 + 一节熄灯的尾车。程序化建模，贯穿全部世界。
// 车厢坐标：地板 y = 1.0，内部 x ∈ [-10, 10]，z ∈ [-1.4, 1.4]，车门在 +Z 一侧 x = ±5.5。
import {
  AdditiveBlending, ShaderMaterial, Vector2, BufferGeometry, Float32BufferAttribute, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry,
  PointLight, Shape, SphereGeometry, SpotLight, type Material,
} from 'three'
import { CollisionWorld, type Collider } from '../../physics/collision'
import { Batcher, boxGeo, glassMat, glowMat, std, trs } from './kit'
import { TEX } from './textures'
import { textTexture, DISPLAY, MONO } from './text'
import type { QualityPreset } from '../../engine/quality'

export const FLOOR_Y = 1.0
export const CAR_HALF = 10
export const INNER_Z = 1.4
export const OUTER_Z = 1.52
export const ROOF_Y = 3.45
export const DOOR_X = [-5.5, 5.5]
export const DOOR_W = 1.3

/**
 * 放样：把 xy 截面（车身轮廓）沿 +X 方向推进 len 米，宽度 / 高度按 w(t) / h(t) 收缩，末端封口。
 * 用于机车流线型车鼻。
 */
function loft(prof: Vector2[], x0: number, len: number, steps: number, w: (t: number) => number, h: (t: number) => number) {
  const pos: number[] = []
  const idx: number[] = []
  const n = prof.length
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const ws = w(t), hs = h(t)
    for (const p of prof) pos.push(x0 + t * len, 0.55 + (p.y - 0.55) * hs, -p.x * ws)
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = a + 1, c = a + n, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  // 末端封口（扇形）
  const tip = pos.length / 3
  let cy = 0
  for (const p of prof) cy += p.y
  pos.push(x0 + len + 0.02, 0.55 + (cy / n - 0.55) * h(1), 0)
  const last = steps * n
  for (let j = 0; j < n - 1; j++) idx.push(last + j, tip, last + j + 1)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** ExtrudeGeometry 只保留侧面（去掉两端的封口） */
function extrudeSides(shape: Shape, depth: number) {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
  const side = g.groups.find((gr) => gr.materialIndex === 1)!
  const out = new BufferGeometry()
  for (const k of ['position', 'normal', 'uv'] as const) {
    const a = g.getAttribute(k)
    out.setAttribute(k, new Float32BufferAttribute((a.array as Float32Array).slice(side.start * a.itemSize, (side.start + side.count) * a.itemSize), a.itemSize))
  }
  g.dispose()
  return out
}

export class Train {
  readonly group = new Group()
  readonly col = new CollisionWorld()
  /** 车厢内部灯光强度 0..1（深海鲸鱼时刻会熄灯） */
  interior = 1
  private interiorTarget = 1
  /** 车门开度 0..1 */
  door = 0
  private doorTarget = 0
  private doorL: Object3D[] = []
  private doorR: Object3D[] = []
  private doorCols: Collider[] = []
  private lights: PointLight[] = []
  private lampMat!: MeshStandardMaterial
  private windowGlowMat!: MeshStandardMaterial
  private tailWinMat!: MeshStandardMaterial
  headlight!: SpotLight
  private headGlow!: Mesh
  private beam!: Mesh
  /** 控制台的部件（由 Game 绑定交互） */
  readonly console = new Group()
  readonly consoleSlots: Mesh[] = []
  readonly consoleLamps: MeshStandardMaterial[] = []
  readonly lever = new Group()
  readonly dial = new Group()
  /** 驾驶室（终点世界的“成为列车长”结局） */
  readonly cab = new Group()
  readonly cabDoor = new Group()
  cabOpen = 0
  private cabDoorCol!: Collider
  /** 尾车车窗 */
  private flick = 0
  /** 列车速度（m/s，仅用于视觉：车轮转动等） */
  speed = 0
  /** 过场里由世界直接驱动列车时的声音参数 */
  externalSpeed = 0
  externalBraking = false
  private wheels: Mesh[] = []

  constructor(readonly q: QualityPreset) {}

  build() {
    const g = this.group
    g.name = 'train'
    const B = new Batcher()
    const paint = new MeshStandardMaterial({ color: 0x1c2c4a, roughness: 0.28, metalness: 0.6, envMapIntensity: 1.6 })
    const stripe = std({ color: 0xe9dcc0, rough: 0.4, metal: 0.2 })
    const brass = std({ color: 0xc29a56, rough: 0.3, metal: 1, map: TEX.brushed() })
    const dark = std({ color: 0x0b0d10, rough: 0.7, metal: 0.4 })
    const under = std({ color: 0x15171a, rough: 0.85, metal: 0.5, map: TEX.grime() })
    const roofM = std({ color: 0x1a1f28, rough: 0.6, metal: 0.4 })
    const floorM = std({ color: 0x3a3330, rough: 0.8, map: TEX.wood(), metal: 0 })
    const wall = std({ color: 0xd8ccb0, rough: 0.55 })
    const woodM = std({ color: 0x6b4a32, rough: 0.45, map: TEX.wood() })
    const seatM = std({ color: 0xffffff, rough: 0.9, map: TEX.fabric() })
    const chrome = std({ color: 0xd8dde2, rough: 0.18, metal: 1 })
    const glass = glassMat(0xa8c0d0, 0.14)
    this.lampMat = glowMat(0xffe3b0, 3)
    this.windowGlowMat = glowMat(0xffc884, 0.0)
    this.tailWinMat = new MeshStandardMaterial({ color: 0x05070a, emissive: 0x18202c, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.2 })

    // ---------- 客车车厢外壳（窗户是真的开口，车门处整段断开） ----------
    const L = CAR_HALF * 2 + 0.6
    const winY0 = FLOOR_Y + 0.85, winY1 = FLOOR_Y + 1.85
    const doorTop = FLOOR_Y + 2.1
    const pillars = [-10.3, -7.6, -6.2, -4.8, -3.3, -1.1, 1.1, 3.3, 4.8, 6.2, 7.6, 10.3]
    const segsFor = (side: number): [number, number][] =>
      side > 0 ? [[-10.3, DOOR_X[0] - DOOR_W / 2], [DOOR_X[0] + DOOR_W / 2, DOOR_X[1] - DOOR_W / 2], [DOOR_X[1] + DOOR_W / 2, 10.3]] : [[-10.3, 10.3]]
    for (const side of [-1, 1]) {
      const z = side * (OUTER_Z - 0.05)
      const zi = side * (INNER_Z + 0.02)
      // 地板以下的裙板整段连续
      B.box(paint, 0, (0.55 + FLOOR_Y) / 2, z, L, FLOOR_Y - 0.55, 0.1)
      // 车门上方的檐板整段连续
      B.box(paint, 0, (doorTop + ROOF_Y - 0.2) / 2, z, L, ROOF_Y - 0.2 - doorTop, 0.1)
      B.box(wall, 0, (doorTop + ROOF_Y - 0.15) / 2, zi, CAR_HALF * 2, ROOF_Y - 0.15 - doorTop, 0.04)
      for (const [a, b] of segsFor(side)) {
        const w = b - a, mid = (a + b) / 2
        B.box(paint, mid, (FLOOR_Y + winY0) / 2, z, w, winY0 - FLOOR_Y, 0.1)
        B.box(paint, mid, (winY1 + doorTop) / 2, z, w, doorTop - winY1, 0.1)
        B.box(stripe, mid, winY0 - 0.12, z + side * 0.055, w, 0.07, 0.02)
        B.box(brass, mid, winY1 + 0.1, z + side * 0.055, w, 0.03, 0.02)
        const ia = Math.max(a, -CAR_HALF), ib = Math.min(b, CAR_HALF)
        B.box(woodM, (ia + ib) / 2, (FLOOR_Y + winY0) / 2 - 0.01, zi, ib - ia, winY0 - FLOOR_Y - 0.02, 0.04)
        B.box(wall, (ia + ib) / 2, (winY1 + doorTop) / 2, zi, ib - ia, doorTop - winY1, 0.04)
      }
      // 窗间立柱与玻璃
      for (let i = 0; i < pillars.length - 1; i++) {
        const a = pillars[i], b = pillars[i + 1]
        const mid = (a + b) / 2
        const isDoor = side > 0 && DOOR_X.some((d) => Math.abs(mid - d) < 0.8)
        if (isDoor) continue
        B.box(paint, a + 0.12, (winY0 + winY1) / 2, z, 0.24, winY1 - winY0, 0.1)
        B.box(wall, a + 0.12, (winY0 + winY1) / 2, zi, 0.24, winY1 - winY0, 0.04)
        B.add(new PlaneGeometry(b - a - 0.24, winY1 - winY0), glass, trs(mid + 0.06, (winY0 + winY1) / 2, z, 0, side > 0 ? 0 : Math.PI, 0), false, false)
      }
      B.box(paint, 10.3 - 0.12, (winY0 + winY1) / 2, z, 0.24, winY1 - winY0, 0.1)
    }
    // 车门门框
    for (const dx of DOOR_X) {
      B.box(brass, dx - DOOR_W / 2 - 0.03, FLOOR_Y + 1.05, OUTER_Z - 0.02, 0.05, 2.1, 0.06)
      B.box(brass, dx + DOOR_W / 2 + 0.03, FLOOR_Y + 1.05, OUTER_Z - 0.02, 0.05, 2.1, 0.06)
      B.box(brass, dx, doorTop + 0.02, OUTER_Z - 0.02, DOOR_W + 0.12, 0.05, 0.06)
      B.box(chrome, dx, FLOOR_Y - 0.02, OUTER_Z - 0.1, DOOR_W, 0.04, 0.3)
    }
    // 端墙
    for (const ex of [-1, 1]) {
      const x = ex * (CAR_HALF + 0.05)
      B.box(wall, x, (FLOOR_Y + ROOF_Y) / 2, -0.95, 0.1, ROOF_Y - FLOOR_Y, 0.9)
      B.box(wall, x, (FLOOR_Y + ROOF_Y) / 2, 0.95, 0.1, ROOF_Y - FLOOR_Y, 0.9)
      B.box(wall, x, (FLOOR_Y + 2.2 + ROOF_Y) / 2, 0, 0.1, ROOF_Y - FLOOR_Y - 2.2, 1.0)
      B.box(paint, x + ex * 0.2, (0.55 + ROOF_Y) / 2, 0, 0.3, ROOF_Y - 0.55, OUTER_Z * 2)
    }
    // 地板、天花、车顶
    B.box(floorM, 0, FLOOR_Y - 0.05, 0, CAR_HALF * 2 + 0.1, 0.1, INNER_Z * 2, 0, 1.2)
    B.box(dark, 0, FLOOR_Y - 0.08, INNER_Z + 0.06, CAR_HALF * 2, 0.04, 0.12)
    B.box(under, 0, 0.75, 0, L, 0.4, OUTER_Z * 2 - 0.1)
    B.box(wall, 0, ROOF_Y - 0.12, 0, CAR_HALF * 2, 0.05, INNER_Z * 2)
    const roof = new CylinderGeometry(1.75, 1.75, L + 0.2, 28, 1, true, Math.PI * 0.14, Math.PI * 0.72)
    B.add(roof, roofM, trs(0, ROOF_Y - 1.32, 0, 0, 0, Math.PI / 2))
    // 天花灯带
    for (const z of [-0.55, 0.55]) B.box(this.lampMat, 0, ROOF_Y - 0.16, z, CAR_HALF * 2 - 1, 0.03, 0.12, 0, 1, false)
    // 行李架
    for (const side of [-1, 1]) {
      B.box(chrome, 0, ROOF_Y - 0.55, side * 1.2, CAR_HALF * 2 - 0.6, 0.025, 0.025)
      B.box(chrome, 0, ROOF_Y - 0.55, side * 0.98, CAR_HALF * 2 - 0.6, 0.025, 0.025)
      B.box(dark, 0, ROOF_Y - 0.56, side * 1.09, CAR_HALF * 2 - 0.6, 0.01, 0.24)
    }

    // ---------- 座椅：面对面的双人座，过道在中间 ----------
    const rows = [-8.3, -7.0, -3.4, -2.1, -0.8, 0.8, 2.1, 3.4, 7.0, 8.3]
    rows.forEach((x, i) => {
      const facing = i % 2 === 0 ? 1 : -1
      for (const side of [-1, 1]) {
        const zc = side * 0.92
        B.box(seatM, x, FLOOR_Y + 0.42, zc, 0.5, 0.12, 0.9)
        B.box(seatM, x - facing * 0.24, FLOOR_Y + 0.82, zc, 0.1, 0.72, 0.9)
        B.box(woodM, x - facing * 0.3, FLOOR_Y + 1.2, zc, 0.06, 0.08, 0.94)
        B.box(dark, x, FLOOR_Y + 0.18, zc, 0.36, 0.36, 0.7)
        // 窗边小桌
        if (i % 2 === 0) B.box(woodM, x + facing * 0.65, FLOOR_Y + 0.72, side * 1.22, 0.5, 0.04, 0.3)
      }
      // 座椅碰撞
      for (const side of [-1, 1]) this.col.slab(x, side * 0.92, 0.55, 0.92, FLOOR_Y, FLOOR_Y + 0.5, { surface: 'carpet', tag: 'seat' })
      for (const side of [-1, 1]) this.col.slab(x - facing * 0.24, side * 0.92, 0.12, 0.92, FLOOR_Y, FLOOR_Y + 1.25, { tag: 'seatback' })
    })
    // 立柱扶手
    for (const x of [-4.4, 4.4, -1.6, 1.6]) {
      B.cyl(chrome, x, (FLOOR_Y + ROOF_Y) / 2, 0.0, 0.025, ROOF_Y - FLOOR_Y, 10)
      this.col.cyl(x, 0, 0.06, FLOOR_Y, ROOF_Y)
    }

    // ---------- 车门（左右对开滑门） ----------
    for (const dx of DOOR_X) {
      for (const s of [-1, 1]) {
        const d = new Group()
        const panel = new Mesh(boxGeo(DOOR_W / 2, 2.1, 0.05), paint)
        panel.castShadow = true
        d.add(panel)
        const pg = new Mesh(new PlaneGeometry(DOOR_W / 2 - 0.16, 0.9), glass)
        pg.position.set(0, 0.35, 0.03)
        d.add(pg)
        const hd = new Mesh(boxGeo(0.03, 0.4, 0.04), brass)
        hd.position.set(-s * (DOOR_W / 4 - 0.06), -0.05, 0.04)
        d.add(hd)
        d.position.set(dx + s * DOOR_W / 4, FLOOR_Y + 1.05, OUTER_Z - 0.06)
        d.userData.base = dx + s * DOOR_W / 4
        d.userData.dir = s
        g.add(d)
        ;(s < 0 ? this.doorL : this.doorR).push(d)
      }
      this.doorCols.push(this.col.slab(dx, OUTER_Z - 0.06, DOOR_W + 0.1, 0.12, FLOOR_Y, ROOF_Y, { tag: 'door' }))
    }

    // ---------- 车厢碰撞：墙、端墙、地板 ----------
    this.col.slab(0, 0, CAR_HALF * 2 + 0.2, INNER_Z * 2 + 0.2, 0.0, FLOOR_Y, { surface: 'wood', tag: 'carFloor' })
    this.col.slab(0, -(INNER_Z + 0.12), CAR_HALF * 2 + 0.6, 0.2, FLOOR_Y, ROOF_Y + 0.3, { tag: 'carWall' })
    // +Z 侧墙：车门处断开
    const segs: [number, number][] = [[-10.3, DOOR_X[0] - DOOR_W / 2], [DOOR_X[0] + DOOR_W / 2, DOOR_X[1] - DOOR_W / 2], [DOOR_X[1] + DOOR_W / 2, 10.3]]
    for (const [a, b] of segs) this.col.slab((a + b) / 2, INNER_Z + 0.12, b - a, 0.2, FLOOR_Y, ROOF_Y + 0.3, { tag: 'carWall' })
    // 车门上框（防止从门顶跳出）
    for (const dx of DOOR_X) this.col.slab(dx, INNER_Z + 0.12, DOOR_W, 0.2, FLOOR_Y + 2.15, ROOF_Y + 0.3, { tag: 'carWall' })
    // 端墙（前端留出驾驶室门洞，由 cabDoorCol 堵住）
    for (const ex of [-1, 1]) {
      this.col.slab(ex * (CAR_HALF + 0.1), -0.95, 0.2, 0.95, FLOOR_Y, ROOF_Y, { tag: 'carWall' })
      this.col.slab(ex * (CAR_HALF + 0.1), 0.95, 0.2, 0.95, FLOOR_Y, ROOF_Y, { tag: 'carWall' })
    }
    this.col.slab(-(CAR_HALF + 0.1), 0, 0.2, 1.0, FLOOR_Y, ROOF_Y, { tag: 'carWall' })
    this.col.slab(0, 0, CAR_HALF * 2 + 0.6, INNER_Z * 2 + 0.4, ROOF_Y - 0.1, ROOF_Y + 0.4, { tag: 'carRoof' })

    // 尾端门（通往熄灯的尾车，锁着）
    const rearDoor = new Mesh(boxGeo(0.06, 2.1, 0.95), woodM)
    rearDoor.position.set(-CAR_HALF - 0.02, FLOOR_Y + 1.05, 0)
    g.add(rearDoor)
    const rdw = new Mesh(new PlaneGeometry(0.5, 0.7), glass)
    rdw.rotation.y = Math.PI / 2
    rdw.position.set(-CAR_HALF + 0.02, FLOOR_Y + 1.5, 0)
    g.add(rdw)

    // ---------- 前端：驾驶室门 + 路线控制台 ----------
    const cdPanel = new Mesh(boxGeo(0.06, 2.1, 0.95), woodM)
    cdPanel.position.set(0, 0, 0.47)
    this.cabDoor.add(cdPanel)
    const cdw = new Mesh(new PlaneGeometry(0.5, 0.6), glass)
    cdw.rotation.y = -Math.PI / 2
    cdw.position.set(-0.04, 0.45, 0.47)
    this.cabDoor.add(cdw)
    const cdSign = new Mesh(new PlaneGeometry(0.42, 0.1), new MeshStandardMaterial({ map: textTexture({ w: 512, h: 128, bg: '#1a1410', lines: [{ text: '驾驶室 · 乘客止步', size: 0.42, color: '#d8b878', y: 0.52 }] }), roughness: 0.5 }))
    cdSign.rotation.y = -Math.PI / 2
    cdSign.position.set(-0.04, 0.95, 0.47)
    this.cabDoor.add(cdSign)
    this.cabDoor.position.set(CAR_HALF + 0.02, FLOOR_Y + 1.05, -0.47)
    g.add(this.cabDoor)
    this.cabDoorCol = this.col.slab(CAR_HALF + 0.1, 0, 0.2, 1.0, FLOOR_Y, ROOF_Y, { tag: 'cabDoor' })

    this.buildConsole(brass, dark, chrome, woodM)
    this.buildCab(B, paint, dark, brass, chrome)
    // 驾驶室碰撞（门打开后可以进入）
    this.col.slab(14, 0, 7.8, 2.8, 0, FLOOR_Y, { surface: 'metal', tag: 'cabFloor' })
    this.col.slab(14, -1.5, 8, 0.2, FLOOR_Y, ROOF_Y, { tag: 'carWall' })
    this.col.slab(14, 1.5, 8, 0.2, FLOOR_Y, ROOF_Y, { tag: 'carWall' })
    this.col.slab(17.6, 0, 0.4, 3, FLOOR_Y, ROOF_Y, { tag: 'carWall' })

    // ---------- 机车车头外观（流线型车鼻） ----------
    const loco = new Group()
    const noseShape = new Shape()
    noseShape.moveTo(-1.52, 0.55)
    noseShape.lineTo(1.52, 0.55)
    noseShape.lineTo(1.52, 3.0)
    noseShape.quadraticCurveTo(1.45, 3.75, 0, 3.92)
    noseShape.quadraticCurveTo(-1.45, 3.75, -1.52, 3.0)
    noseShape.lineTo(-1.52, 0.55)
    // 车身外壳只取侧面（不要端盖），这样从车厢能看进驾驶室
    const body = extrudeSides(noseShape, 13.5)
    body.rotateY(Math.PI / 2)
    body.translate(10.6, 0, 0)
    B.add(body, paint)
    // 驾驶室与机器间之间的隔墙、驾驶室内壁
    B.box(dark, 17.65, 2.2, 0, 0.1, 3.3, 3.0)
    for (const side of [-1, 1]) B.box(dark, 14.1, 2.2, side * 1.45, 7.0, 3.0, 0.06)
    // 流线型车鼻：沿车身截面放样，逐渐收窄、压低，前窗是一条深色玻璃带
    const prof = noseShape.getPoints(10)
    const nose = loft(prof, 24.1, 3.6, 18, (t) => Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.4))) * 0.98 + 0.02, (t) => 1 - 0.62 * Math.pow(t, 1.35))
    B.add(nose, paint)
    const shield = loft(prof.filter((p) => p.y > 2.75), 24.25, 1.5, 8, (t) => 1.01 * Math.sqrt(Math.max(0, 1 - Math.pow(0.1 + t * 0.42, 2.4))) * 0.98 + 0.02, (t) => 1.005 - 0.62 * Math.pow(0.1 + t * 0.42, 1.35))
    B.add(shield, new MeshStandardMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.9, emissive: 0x3a2410, emissiveIntensity: 0.6, envMapIntensity: 2 }))
    B.box(under, 26, 0.75, 0, 5.5, 0.4, 2.6)
    // 腰线 + 车号
    for (const side of [-1, 1]) {
      B.box(stripe, 17.5, FLOOR_Y + 0.73, side * 1.535, 13.5, 0.07, 0.02)
      B.box(brass, 17.5, FLOOR_Y + 1.95, side * 1.535, 13.5, 0.03, 0.02)
      const numTex = textTexture({ w: 512, h: 256, lines: [{ text: '0000', size: 0.6, color: '#e9dcc0', font: DISPLAY, y: 0.5, weight: '600', spacing: 0.08 }] })
      const num = new Mesh(new PlaneGeometry(1.6, 0.8), new MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.4, metalness: 0.3 }))
      num.position.set(19.5, 2.25, side * 1.54)
      num.rotation.y = side > 0 ? 0 : Math.PI
      loco.add(num)
      // 机车侧窗
      for (const wx of [12.2, 13.6, 15.0]) {
        const wm = new Mesh(new PlaneGeometry(1.0, 0.8), this.windowGlowMat)
        wm.position.set(wx, winY0 + 0.5, side * 1.535)
        wm.rotation.y = side > 0 ? 0 : Math.PI
        loco.add(wm)
      }
    }
    // 车头灯
    const lamp = new Mesh(new CylinderGeometry(0.24, 0.28, 0.2, 24), chrome)
    lamp.rotation.z = Math.PI / 2
    lamp.position.set(27.5, 1.65, 0)
    loco.add(lamp)
    this.headGlow = new Mesh(new CylinderGeometry(0.2, 0.2, 0.02, 24), glowMat(0xfff0d0, 30))
    this.headGlow.rotation.z = Math.PI / 2
    this.headGlow.position.set(27.62, 1.65, 0)
    loco.add(this.headGlow)
    this.headlight = new SpotLight(0xfff0d8, 0, 160, 0.32, 0.55, 1.2)
    this.headlight.position.set(27.7, 1.65, 0)
    this.headlight.target.position.set(80, 0.5, 0)
    loco.add(this.headlight, this.headlight.target)
    // 体积光锥（叠加，带噪声，雾里才看得见）
    const beamGeo = new CylinderGeometry(0.22, 9, 70, 32, 1, true)
    beamGeo.translate(0, -35, 0)
    beamGeo.rotateZ(Math.PI / 2)
    const beamMat = new ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: `varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uI; varying vec3 vL; varying vec3 vN; varying vec3 vV;
        void main(){ float along = clamp(vL.x / 70.0, 0.0, 1.0); float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.84) * uI * edge * pow(1.0 - along, 2.2) * 0.5, 1.0); }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide,
    })
    this.beam = new Mesh(beamGeo, beamMat)
    this.beam.position.set(27.7, 1.65, 0)
    this.beam.renderOrder = 5
    loco.add(this.beam)
    g.add(loco)

    // ---------- 尾车（熄灯，锁着） ----------
    const tailShape = new Shape()
    tailShape.moveTo(-1.52, 0.55)
    tailShape.lineTo(1.52, 0.55)
    tailShape.lineTo(1.52, 3.1)
    tailShape.quadraticCurveTo(1.4, 3.75, 0, 3.85)
    tailShape.quadraticCurveTo(-1.4, 3.75, -1.52, 3.1)
    tailShape.lineTo(-1.52, 0.55)
    const tail = new ExtrudeGeometry(tailShape, { depth: 20, bevelEnabled: false })
    tail.rotateY(Math.PI / 2)
    tail.translate(-31.2, 0, 0)
    B.add(tail, paint)
    B.box(under, -21.2, 0.75, 0, 20, 0.4, 2.8)
    for (const side of [-1, 1]) {
      B.box(stripe, -21.2, FLOOR_Y + 0.73, side * 1.535, 20, 0.07, 0.02)
      for (let i = 0; i < 7; i++) {
        const wm = new Mesh(new PlaneGeometry(1.5, 0.95), this.tailWinMat)
        wm.position.set(-29.4 + i * 2.75, winY0 + 0.5, side * 1.535)
        wm.rotation.y = side > 0 ? 0 : Math.PI
        loco.add(wm)
      }
    }
    // 尾灯
    for (const z of [-0.9, 0.9]) {
      const tl = new Mesh(new SphereGeometry(0.08, 12, 8), glowMat(0xff2a1a, 12))
      tl.position.set(-31.25, 1.3, z)
      loco.add(tl)
    }
    // 车厢连接处的风挡
    B.box(dark, -10.85, 2.1, 0, 0.8, 2.6, 2.4)
    for (const side of [-1, 1]) B.box(dark, 10.45, 2.1, side * 1.0, 0.4, 2.6, 1.0)
    B.box(dark, 10.45, 3.3, 0, 0.4, 0.4, 1.0)

    // ---------- 转向架与车轮 ----------
    const wheelGeo = new CylinderGeometry(0.46, 0.46, 0.14, 20)
    wheelGeo.rotateX(Math.PI / 2)
    const wheelMat = std({ color: 0x2a2c30, rough: 0.4, metal: 0.9 })
    for (const bx of [-28, -14.4, -7.5, 7.5, 13, 22.5]) {
      B.box(under, bx, 0.62, 0, 2.6, 0.3, 2.2)
      for (const ax of [-0.85, 0.85]) for (const z of [-0.78, 0.78]) {
        const w = new Mesh(wheelGeo, wheelMat)
        w.position.set(bx + ax, 0.46, z)
        g.add(w)
        this.wheels.push(w)
      }
    }

    // ---------- 车厢灯光（两盏暖光点光源，不投影） ----------
    for (const x of [-5, 5]) {
      const l = new PointLight(0xffd9a0, 22, 16, 1.5)
      l.position.set(x, ROOF_Y - 0.4, 0)
      g.add(l)
      this.lights.push(l)
    }
    // 车厢号牌
    const plate = new Mesh(new PlaneGeometry(0.9, 0.3), new MeshStandardMaterial({ map: textTexture({ w: 512, h: 170, bg: '#16100c', border: '#b89254', lines: [{ text: '末班 0000 次', size: 0.34, color: '#e2c48a', y: 0.4 }, { text: 'CAR 01 · NO TERMINUS', size: 0.16, color: '#9c8460', font: MONO, y: 0.75 }] }), roughness: 0.4, metalness: 0.4 }))
    plate.position.set(-CAR_HALF + 0.06, FLOOR_Y + 2.45, 0)
    plate.rotation.y = Math.PI / 2
    g.add(plate)

    B.build(g, 'train')
    this.group.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && m.material && (m.material as Material).transparent) m.castShadow = false
    })
  }

  private buildConsole(brass: Material, dark: Material, chrome: Material, wood: Material) {
    const c = this.console
    c.position.set(CAR_HALF - 0.55, FLOOR_Y, 1.0)
    // 底座
    const base = new Mesh(boxGeo(0.7, 1.0, 0.7), wood)
    base.position.y = 0.5
    base.castShadow = true
    c.add(base)
    const top = new Mesh(boxGeo(0.78, 0.06, 0.78), brass)
    top.position.y = 1.03
    c.add(top)
    // 倾斜的面板：环形线路图（5 站 + 终点）
    const panel = new Group()
    panel.position.set(0, 1.25, 0)
    panel.rotation.set(0, -Math.PI / 2, 0)
    panel.rotateX(-0.6)
    c.add(panel)
    const face = new Mesh(new CylinderGeometry(0.36, 0.36, 0.04, 48), dark)
    face.rotation.x = Math.PI / 2
    panel.add(face)
    const rim = new Mesh(new CylinderGeometry(0.385, 0.385, 0.05, 48, 1, true), brass)
    rim.rotation.x = Math.PI / 2
    panel.add(rim)
    const map = textTexture({ w: 512, h: 512, lines: [{ text: 'LINE 0', size: 0.06, color: '#c8a868', font: MONO, y: 0.5, spacing: 0.3 }] })
    const mapM = new Mesh(new CylinderGeometry(0.33, 0.33, 0.002, 48), new MeshStandardMaterial({ map, transparent: true, roughness: 0.6 }))
    mapM.rotation.x = Math.PI / 2
    mapM.position.z = 0.022
    panel.add(mapM)
    // 6 个站点灯 + 4 个碎片凹槽
    const names = ['站', '城', '海', '沙', '馆', '终']
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 - (i / 6) * Math.PI * 2
      const lampM = glowMat(0x2a1a10, 1)
      this.consoleLamps.push(lampM)
      const lamp = new Mesh(new SphereGeometry(0.028, 12, 8), lampM)
      lamp.position.set(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.03)
      panel.add(lamp)
      const lab = new Mesh(new PlaneGeometry(0.07, 0.07), new MeshStandardMaterial({ map: textTexture({ w: 64, h: 64, lines: [{ text: names[i], size: 0.7, color: '#c8a868', y: 0.52 }] }), transparent: true }))
      lab.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0.03)
      panel.add(lab)
      if (i >= 1 && i <= 4) {
        const slot = new Mesh(new CylinderGeometry(0.035, 0.035, 0.03, 6), new MeshStandardMaterial({ color: 0x080808, emissive: 0x000000, roughness: 0.2, metalness: 0.5 }))
        slot.rotation.x = Math.PI / 2
        const sa = a - Math.PI / 6
        slot.position.set(Math.cos(sa) * 0.31, Math.sin(sa) * 0.31, 0.03)
        panel.add(slot)
        this.consoleSlots.push(slot)
      }
    }
    // 中央旋钮（选择目的地）
    const knob = new Mesh(new CylinderGeometry(0.07, 0.08, 0.06, 24), brass)
    knob.rotation.x = Math.PI / 2
    knob.position.z = 0.04
    this.dial.add(knob)
    const needle = new Mesh(boxGeo(0.012, 0.2, 0.01), chrome)
    needle.position.set(0, 0.1, 0.08)
    this.dial.add(needle)
    panel.add(this.dial)
    // 发车拉杆
    const lb = new Mesh(boxGeo(0.12, 0.08, 0.2), dark)
    this.lever.add(lb)
    const arm = new Mesh(new CylinderGeometry(0.018, 0.018, 0.5, 10), chrome)
    arm.position.y = 0.25
    this.lever.add(arm)
    const ball = new Mesh(new SphereGeometry(0.05, 16, 12), new MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.35 }))
    ball.position.y = 0.5
    this.lever.add(ball)
    this.lever.position.set(0, 1.06, -0.25)
    this.lever.rotation.x = -0.5
    c.add(this.lever)
    this.col.slab(c.position.x, c.position.z, 0.75, 0.75, FLOOR_Y, FLOOR_Y + 1.1, { tag: 'console' })
    this.group.add(c)
  }

  private buildCab(B: Batcher, paint: Material, dark: Material, brass: Material, chrome: Material) {
    const cab = this.cab
    // 驾驶室内部：地板、驾驶台、座椅、拉杆
    B.box(dark, 14, FLOOR_Y - 0.03, 0, 7.6, 0.06, 2.8)
    B.box(paint, 14, ROOF_Y - 0.05, 0, 7.6, 0.1, 2.8)
    const desk = new Mesh(boxGeo(1.0, 1.0, 2.4), dark)
    desk.position.set(16.9, FLOOR_Y + 0.5, 0)
    cab.add(desk)
    const deskTop = new Mesh(boxGeo(1.1, 0.05, 2.5), brass)
    deskTop.position.set(16.9, FLOOR_Y + 1.02, 0)
    cab.add(deskTop)
    for (let i = 0; i < 5; i++) {
      const gauge = new Mesh(new CylinderGeometry(0.09, 0.09, 0.02, 20), glowMat(i === 2 ? 0xff7040 : 0xffd890, 1.2))
      gauge.rotation.z = Math.PI / 2
      gauge.position.set(16.42, FLOOR_Y + 1.25, -0.8 + i * 0.4)
      cab.add(gauge)
    }
    const seat = new Mesh(boxGeo(0.6, 0.1, 0.6), std({ color: 0x3a2a22, rough: 0.8 }))
    seat.position.set(15.6, FLOOR_Y + 0.55, 0)
    cab.add(seat)
    const seatBack = new Mesh(boxGeo(0.1, 0.7, 0.6), std({ color: 0x3a2a22, rough: 0.8 }))
    seatBack.position.set(15.25, FLOOR_Y + 0.95, 0)
    cab.add(seatBack)
    const post = new Mesh(new CylinderGeometry(0.04, 0.04, 0.5, 10), chrome)
    post.position.set(15.6, FLOOR_Y + 0.25, 0)
    cab.add(post)
    this.col.slab(16.9, 0, 1.1, 2.5, FLOOR_Y, FLOOR_Y + 1.05, { tag: 'desk', surface: 'metal' })
    const cabLight = new PointLight(0xffb070, 0, 6, 2)
    cabLight.position.set(14.5, ROOF_Y - 0.4, 0)
    cab.add(cabLight)
    cab.userData.light = cabLight
    this.group.add(cab)
  }

  /** 前往目的地的控制台灯：0 熄 / 1 可选 / 2 选中 */
  setConsoleLamp(i: number, state: 0 | 1 | 2 | 3) {
    const m = this.consoleLamps[i]
    if (!m) return
    const col = state === 0 ? 0x1a100a : state === 1 ? 0x8a6a3a : state === 2 ? 0xffd890 : 0x8fe8ff
    m.emissive.setHex(col)
    m.emissiveIntensity = state === 2 ? 6 : state === 3 ? 4 : 1.2
  }

  setSlot(i: number, color: string | null) {
    const s = this.consoleSlots[i]
    if (!s) return
    const m = s.material as MeshStandardMaterial
    if (color) {
      m.color.set(color)
      m.emissive.set(color)
      m.emissiveIntensity = 2.5
    } else {
      m.color.setHex(0x080808)
      m.emissive.setHex(0x000000)
    }
  }

  setDoors(open: boolean) {
    this.doorTarget = open ? 1 : 0
  }

  setInterior(on: number) {
    this.interiorTarget = on
  }

  setHeadlight(on: number) {
    this.headlight.intensity = on * 900
    ;(this.headGlow.material as MeshStandardMaterial).emissiveIntensity = 2 + on * 40
    ;(this.beam.material as ShaderMaterial).uniforms.uI.value = on
  }

  setCab(open: boolean) {
    this.cabOpen = open ? 1 : 0
    this.cabDoorCol.enabled = !open
    this.cabDoor.rotation.y = open ? -1.6 : 0
    ;(this.cab.userData.light as PointLight).intensity = open ? 5 : 0
  }

  get doorsOpen() {
    return this.door > 0.95
  }

  get doorsClosed() {
    return this.door < 0.02
  }

  update(dt: number, t: number) {
    // 车门：先略微外推再平移（像真正的塞拉门）
    const k = 1 - Math.exp(-dt * 2.2)
    this.door += (this.doorTarget - this.door) * k
    if (Math.abs(this.doorTarget - this.door) < 0.002) this.door = this.doorTarget
    const slide = Math.min(1, this.door * 1.1) * (DOOR_W / 2 - 0.02)
    const out = Math.min(1, this.door * 6) * 0.08
    for (const d of [...this.doorL, ...this.doorR]) {
      d.position.x = d.userData.base + d.userData.dir * slide
      d.position.z = OUTER_Z - 0.06 + out
    }
    for (const c of this.doorCols) c.enabled = this.door < 0.8
    // 车厢灯（熄灭时轻微闪烁）
    this.interior += (this.interiorTarget - this.interior) * (1 - Math.exp(-dt * (this.interiorTarget < this.interior ? 9 : 1.6)))
    let flicker = 1
    if (this.interiorTarget > 0.5 && this.interior < 0.98) flicker = 0.6 + 0.4 * Math.sin(t * 47) * Math.sin(t * 13)
    const lv = Math.max(0, this.interior * flicker)
    for (const l of this.lights) l.intensity = 22 * lv
    this.lampMat.emissiveIntensity = 3 * lv
    this.flick += dt
    this.windowGlowMat.emissive.setRGB(1, 0.78, 0.52)
    this.windowGlowMat.emissiveIntensity = 0.9 * lv
    // 车轮
    const ang = (this.speed * dt) / 0.46
    for (const w of this.wheels) w.rotation.z -= ang
  }

  /** 车厢里的位置是否在车门口区域 */
  static nearDoor(x: number, z: number) {
    return DOOR_X.some((d) => Math.abs(x - d) < DOOR_W / 2 + 0.2) && z > INNER_Z - 0.6
  }

  static inside(x: number, y: number, z: number) {
    return Math.abs(x) < CAR_HALF + 0.3 && Math.abs(z) < INNER_Z + 0.05 && y > FLOOR_Y - 0.4 && y < ROOF_Y
  }

  static inCab(x: number, y: number, z: number) {
    return x > CAR_HALF + 0.2 && x < 17.5 && Math.abs(z) < 1.5 && y > FLOOR_Y - 0.4 && y < ROOF_Y
  }
}

