// 列车长：程序化的人物剪影（长大衣、大檐帽、提灯）。脸永远藏在帽檐的阴影里。
import { CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial, SphereGeometry, Vector2, Vector3, type Object3D } from 'three'
import { boxGeo, glowMat, std } from './kit'

export class Conductor {
  readonly group = new Group()
  private head = new Group()
  private body = new Group()
  private lantern = new Group()
  private lanternGlow!: MeshStandardMaterial
  private t = Math.random() * 10
  /** 帽子是否戴着（终点世界里会摘下） */
  hat = new Group()
  visible = true

  /** coat：大衣颜色；hat：是否戴帽；hair：头发颜色；lantern：是否提灯（终点里撑伞的人用同一套模型） */
  constructor(opts: { coat?: number; hat?: boolean; hair?: number; lantern?: boolean } = {}) {
    const navy = new MeshStandardMaterial({ color: opts.coat ?? 0x141c2c, roughness: 0.75, metalness: 0.05 })
    const navy2 = new MeshStandardMaterial({ color: 0x0e1420, roughness: 0.8 })
    const brass = std({ color: 0xc8a060, rough: 0.3, metal: 1 })
    const skin = std({ color: 0x6a5446, rough: 0.6 })
    const glove = std({ color: 0x15110e, rough: 0.6 })
    const shoe = std({ color: 0x0a0a0a, rough: 0.35, metal: 0.2 })
    const g = this.group
    g.name = 'conductor'
    // 长大衣：车床旋转体，从肩到膝盖略微外扩
    const prof = [
      [0.0, 0.62], [0.2, 0.62], [0.235, 0.7], [0.215, 0.95], [0.19, 1.18], [0.205, 1.38], [0.22, 1.44], [0.16, 1.5], [0.07, 1.53], [0.0, 1.53],
    ].map(([r, y]) => new Vector2(r, y))
    const coat = new Mesh(new LatheGeometry(prof, 28), navy)
    coat.scale.set(1, 1, 0.72)
    coat.castShadow = true
    this.body.add(coat)
    // 前襟的铜扣
    for (let i = 0; i < 4; i++) {
      const b = new Mesh(new SphereGeometry(0.014, 8, 6), brass)
      b.position.set(0.0, 1.32 - i * 0.12, 0.165 + i * 0.006)
      this.body.add(b)
    }
    // 腿与鞋
    for (const s of [-1, 1]) {
      const leg = new Mesh(new CylinderGeometry(0.065, 0.06, 0.62, 10), navy2)
      leg.position.set(s * 0.09, 0.31, 0)
      leg.castShadow = true
      this.body.add(leg)
      const sh = new Mesh(boxGeo(0.1, 0.07, 0.24), shoe)
      sh.position.set(s * 0.09, 0.035, 0.04)
      this.body.add(sh)
    }
    // 手臂
    for (const s of [-1, 1]) {
      const arm = new Group()
      const upper = new Mesh(new CylinderGeometry(0.055, 0.05, 0.62, 10), navy)
      upper.position.y = -0.31
      upper.castShadow = true
      arm.add(upper)
      const hand = new Mesh(new SphereGeometry(0.05, 10, 8), glove)
      hand.position.y = -0.64
      arm.add(hand)
      arm.position.set(s * 0.25, 1.46, 0)
      arm.rotation.z = s * 0.1
      if (s > 0 && opts.lantern !== false) {
        arm.rotation.x = -0.25
        // 提灯
        this.lantern.position.set(0, -0.78, 0.02)
        const frame = new Mesh(boxGeo(0.12, 0.18, 0.12), brass)
        this.lantern.add(frame)
        this.lanternGlow = glowMat(0xffc070, 6)
        const core = new Mesh(new SphereGeometry(0.045, 12, 10), this.lanternGlow)
        this.lantern.add(core)
        const handle = new Mesh(new CylinderGeometry(0.006, 0.006, 0.14, 6), brass)
        handle.position.y = 0.14
        this.lantern.add(handle)
        arm.add(this.lantern)
      }
      this.body.add(arm)
    }
    // 衣领
    const collar = new Mesh(new CylinderGeometry(0.09, 0.13, 0.08, 16), navy)
    collar.position.y = 1.56
    this.body.add(collar)
    // 头与帽子
    const head = new Mesh(new SphereGeometry(0.105, 20, 16), skin)
    head.scale.set(0.9, 1.08, 0.95)
    head.castShadow = true
    this.head.add(head)
    const crown = new Mesh(new CylinderGeometry(0.13, 0.115, 0.1, 24), navy)
    crown.position.y = 0.1
    this.hat.add(crown)
    const top = new Mesh(new CylinderGeometry(0.14, 0.13, 0.025, 24), navy)
    top.position.y = 0.155
    top.scale.set(1, 1, 1.08)
    this.hat.add(top)
    const brim = new Mesh(new CylinderGeometry(0.13, 0.135, 0.012, 24, 1, false, -Math.PI * 0.5, Math.PI), std({ color: 0x050505, rough: 0.2, metal: 0.3 }))
    brim.position.set(0, 0.05, 0.04)
    brim.rotation.x = 0.18
    this.hat.add(brim)
    const band = new Mesh(new CylinderGeometry(0.117, 0.117, 0.025, 24, 1, true), brass)
    band.position.y = 0.06
    this.hat.add(band)
    const badge = new Mesh(new CylinderGeometry(0.018, 0.018, 0.006, 16), brass)
    badge.rotation.x = Math.PI / 2
    badge.position.set(0, 0.11, 0.128)
    this.hat.add(badge)
    this.hat.position.y = 0.02
    this.head.add(this.hat)
    // 头发：帽子底下也有（摘帽后露出来——“帽子底下的头发，已经白了”）
    const hair = new Mesh(new SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), std({ color: opts.hair ?? 0xd8d4cc, rough: 0.9 }))
    hair.scale.set(0.95, 1.05, 1.02)
    hair.position.set(0, 0.012, -0.012)
    hair.rotation.x = -0.25
    this.head.add(hair)
    if (opts.hat === false) this.hat.visible = false
    this.head.position.y = 1.7
    this.body.add(this.head)
    g.add(this.body)
    g.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) m.castShadow = true
    })
  }

  place(parent: Object3D, x: number, y: number, z: number, yaw: number) {
    parent.add(this.group)
    this.group.position.set(x, y, z)
    this.group.rotation.y = yaw
  }

  setLantern(on: number) {
    this.lanternGlow.emissiveIntensity = on * 6
  }

  /** 头部转向玩家（世界坐标），身体缓慢跟随 */
  update(dt: number, look: Vector3 | null) {
    this.t += dt
    const breathe = Math.sin(this.t * 1.3)
    this.body.scale.y = 1 + breathe * 0.006
    this.lantern.rotation.z = Math.sin(this.t * 0.9) * 0.05
    if (look && this.group.parent) {
      const p = new Vector3()
      this.group.getWorldPosition(p)
      const dx = look.x - p.x, dz = look.z - p.z
      const want = Math.atan2(dx, dz)
      // 身体转向
      let d = want - this.group.rotation.y
      d = Math.atan2(Math.sin(d), Math.cos(d))
      if (Math.abs(d) > 0.9) this.group.rotation.y += d * (1 - Math.exp(-dt * 1.2))
      let hd = want - this.group.rotation.y
      hd = Math.atan2(Math.sin(hd), Math.cos(hd))
      this.head.rotation.y += (Math.max(-1, Math.min(1, hd)) - this.head.rotation.y) * (1 - Math.exp(-dt * 3))
      const dy = look.y - (p.y + 1.7)
      const dist = Math.hypot(dx, dz)
      this.head.rotation.x += (Math.max(-0.3, Math.min(0.4, -Math.atan2(dy, dist) * 0.6)) - this.head.rotation.x) * (1 - Math.exp(-dt * 3))
    }
  }
}

