// 背包里每件物品的 3D 模型（物品预览、世界里的摆放共用）
import { CylinderGeometry, ExtrudeGeometry, Group, IcosahedronGeometry, LatheGeometry, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Path, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, Vector2, type Object3D } from 'three'
import { boxGeo, glowMat, std } from './kit'
import type { ItemModel } from '../../content/items'
import { textTexture } from './text'

export function itemModel(model: ItemModel, color: string): Object3D {
  const g = new Group()
  const brass = std({ color: 0xc29a56, rough: 0.3, metal: 1 })
  switch (model) {
    case 'ticket':
    case 'oldticket': {
      const tex = textTexture({
        w: 512, h: 256, bg: model === 'ticket' ? '#e9dfc6' : '#cdb48a', border: '#8a6a3a', grain: model === 'oldticket' ? 0.12 : 0.03,
        lines: [
          { text: '末班 0000 次', size: 0.16, color: '#3a2a1a', y: 0.28 },
          { text: '零号站台 · 23:59', size: 0.11, color: '#5a4a3a', y: 0.52 },
          { text: model === 'ticket' ? '目的地 ________' : '目的地  回 家', size: 0.1, color: '#5a4a3a', y: 0.76 },
        ],
      })
      const m = new Mesh(boxGeo(1.6, 0.02, 0.8), [std({ color }), std({ color }), new MeshStandardMaterial({ map: tex, roughness: 0.8 }), std({ color }), std({ color }), std({ color })])
      g.add(m)
      break
    }
    case 'punch': {
      for (const s of [-1, 1]) {
        const a = new Mesh(boxGeo(1.2, 0.12, 0.18), brass)
        a.rotation.y = s * 0.15
        a.position.z = s * 0.12
        g.add(a)
      }
      const h = new Mesh(new CylinderGeometry(0.1, 0.1, 0.4, 16), brass)
      h.rotation.x = Math.PI / 2
      h.position.x = 0.5
      g.add(h)
      break
    }
    case 'cell': {
      const c = new Mesh(new CylinderGeometry(0.28, 0.28, 0.9, 24), new MeshPhysicalMaterial({ color: 0x9fe6df, transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1 }))
      g.add(c)
      const core = new Mesh(new SphereGeometry(0.16, 16, 12), glowMat(0x8fffe8, 4))
      g.add(core)
      for (const y of [-0.48, 0.48]) {
        const cap = new Mesh(new CylinderGeometry(0.3, 0.3, 0.08, 24), brass)
        cap.position.y = y
        g.add(cap)
      }
      break
    }
    case 'fragment': {
      const m = new Mesh(new IcosahedronGeometry(0.45, 0), new MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.1, transmission: 0, clearcoat: 1, flatShading: true }))
      m.scale.set(0.7, 1.3, 0.7)
      g.add(m)
      break
    }
    case 'fuse': {
      const glass = new Mesh(new CylinderGeometry(0.16, 0.16, 0.9, 20), new MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.05 }))
      glass.rotation.z = Math.PI / 2
      g.add(glass)
      const wire = new Mesh(new CylinderGeometry(0.015, 0.015, 0.9, 6), glowMat(0xffc060, 1.5))
      wire.rotation.z = Math.PI / 2
      g.add(wire)
      for (const x of [-0.5, 0.5]) {
        const cap = new Mesh(new CylinderGeometry(0.18, 0.18, 0.16, 20), brass)
        cap.rotation.z = Math.PI / 2
        cap.position.x = x
        g.add(cap)
      }
      break
    }
    case 'watch': {
      const body = new Mesh(new CylinderGeometry(0.45, 0.45, 0.12, 32), brass)
      body.rotation.x = Math.PI / 2
      g.add(body)
      const face = new Mesh(new CylinderGeometry(0.4, 0.4, 0.02, 32), glowMat(0xffd890, 0.6))
      face.rotation.x = Math.PI / 2
      face.position.z = 0.07
      g.add(face)
      const ring = new Mesh(new TorusGeometry(0.1, 0.03, 8, 16), brass)
      ring.position.y = 0.55
      g.add(ring)
      for (let i = 0; i < 18; i++) {
        const s = new Mesh(new SphereGeometry(0.018, 6, 4), glowMat(0xffc060, 3))
        s.position.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0.1)
        g.add(s)
      }
      break
    }
    case 'hands': {
      // 一对蓝钢指针：细长的刀身、桃心形针尖、尾部带配重圆孔（之前是两根方条）
      const blued = std({ color: 0x2a3a58, metal: 0.85, rough: 0.25 })
      const hand = (len: number, w: number) => {
        const sh = new Shape()
        sh.moveTo(-w * 0.4, -len * 0.2)
        sh.lineTo(w * 0.4, -len * 0.2)
        sh.lineTo(w * 0.22, len * 0.62)
        sh.quadraticCurveTo(w * 1.4, len * 0.7, 0, len)
        sh.quadraticCurveTo(-w * 1.4, len * 0.7, -w * 0.22, len * 0.62)
        sh.lineTo(-w * 0.4, -len * 0.2)
        const hole = new Path()
        hole.absarc(0, -len * 0.11, w * 0.24, 0, Math.PI * 2, true)
        sh.holes.push(hole)
        const geo = new ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 10 })
        geo.translate(0, 0, -0.015)
        // 深色刀身贴在略大一圈的黄铜底板上，暗背景里也看得清轮廓
        const hg = new Group()
        const blade = new Mesh(geo, blued)
        blade.position.z = 0.012
        const rim = new Mesh(geo, brass)
        rim.scale.set(1.3, 1.035, 1)
        rim.position.set(0, -len * 0.006, -0.012)
        hg.add(rim, blade)
        return hg
      }
      const minute = hand(1.25, 0.14)
      minute.position.z = 0.03
      g.add(minute)
      const hour = hand(0.85, 0.2)
      hour.rotation.z = -0.55
      g.add(hour)
      const hub = new Mesh(new CylinderGeometry(0.09, 0.09, 0.12, 20), brass)
      hub.rotation.x = Math.PI / 2
      g.add(hub)
      g.position.y = -0.42
      g.scale.setScalar(0.85)
      break
    }
    case 'toytrain': {
      // 铁皮玩具火车：圆筒锅炉、驾驶室带窗和顶棚、车头圆牌上漆着「0」、侧面一把发条钥匙
      const blue = std({ color: 0x2f4f8a, rough: 0.35, metal: 0.55 })
      const red = std({ color: 0x8a2a24, rough: 0.4, metal: 0.45 })
      const black = std({ color: 0x111111, metal: 0.6, rough: 0.4 })
      const base = new Mesh(boxGeo(1.05, 0.12, 0.42), red)
      base.position.y = 0.16
      g.add(base)
      const boiler = new Mesh(new CylinderGeometry(0.19, 0.19, 0.72, 24), blue)
      boiler.rotation.z = Math.PI / 2
      boiler.position.set(0.12, 0.4, 0)
      g.add(boiler)
      for (const x of [-0.1, 0.2]) {
        const band = new Mesh(new TorusGeometry(0.192, 0.012, 6, 24), brass)
        band.rotation.y = Math.PI / 2
        band.position.set(x, 0.4, 0)
        g.add(band)
      }
      const cab = new Mesh(boxGeo(0.34, 0.4, 0.44), red)
      cab.position.set(-0.36, 0.42, 0)
      g.add(cab)
      const roof = new Mesh(boxGeo(0.44, 0.04, 0.52), black)
      roof.position.set(-0.36, 0.64, 0)
      g.add(roof)
      for (const z of [-0.222, 0.222]) {
        const win = new Mesh(new PlaneGeometry(0.18, 0.14), black)
        win.position.set(-0.36, 0.5, z)
        win.rotation.y = z > 0 ? 0 : Math.PI
        g.add(win)
      }
      const chim = new Mesh(new CylinderGeometry(0.05, 0.08, 0.22, 14), black)
      chim.position.set(0.36, 0.66, 0)
      g.add(chim)
      const dome = new Mesh(new SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass)
      dome.position.set(0.05, 0.58, 0)
      g.add(dome)
      const plateTex = textTexture({ w: 128, h: 128, bg: '#c29a56', lines: [{ text: '0', size: 0.7, color: '#2a1a10', y: 0.52, weight: '700' }] })
      const plate = new Mesh(new CylinderGeometry(0.13, 0.13, 0.02, 24), [brass, std({ color: 0xffffff, map: plateTex, rough: 0.4, metal: 0.3 }), brass])
      plate.rotation.z = -Math.PI / 2
      plate.position.set(0.49, 0.4, 0)
      g.add(plate)
      // 发条钥匙
      const stem = new Mesh(new CylinderGeometry(0.015, 0.015, 0.12, 8), brass)
      stem.rotation.x = Math.PI / 2
      stem.position.set(-0.36, 0.4, -0.28)
      g.add(stem)
      for (const s of [-1, 1]) {
        const wing = new Mesh(new TorusGeometry(0.045, 0.012, 6, 14), brass)
        wing.position.set(-0.36 + s * 0.05, 0.4, -0.34)
        g.add(wing)
      }
      for (const x of [-0.32, 0.05, 0.36]) for (const z of [-0.2, 0.2]) {
        const w = new Mesh(new CylinderGeometry(0.11, 0.11, 0.05, 18), black)
        w.rotation.x = Math.PI / 2
        w.position.set(x, 0.11, z)
        g.add(w)
        const hubc = new Mesh(new CylinderGeometry(0.035, 0.035, 0.06, 10), brass)
        hubc.rotation.x = Math.PI / 2
        hubc.position.set(x, 0.11, z)
        g.add(hubc)
      }
      g.position.y = -0.25
      g.scale.setScalar(0.85)
      break
    }
    case 'umbrella': {
      // 八片伞面：微微外鼓的八棱伞（之前是一个球冠，侧着放时像一颗红球），伞骨沿棱线，顶上有伞尖
      const prof = [new Vector2(0.001, 0.34), new Vector2(0.2, 0.3), new Vector2(0.42, 0.18), new Vector2(0.62, 0)]
      const canopy = new Mesh(new LatheGeometry(prof, 8), std({ color: 0xb33a32, rough: 0.6, side: 2 }))
      canopy.material.flatShading = true
      canopy.position.y = 0.5
      g.add(canopy)
      const ribM = std({ color: 0x2a1a18, rough: 0.5 })
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const rib = new Mesh(new CylinderGeometry(0.008, 0.008, 0.7, 4), ribM)
        rib.position.set(Math.sin(a) * 0.31, 0.5 + 0.17, Math.cos(a) * 0.31)
        rib.lookAt(Math.sin(a) * 0.62, 0.5, Math.cos(a) * 0.62)
        rib.rotateX(Math.PI / 2)
        g.add(rib)
      }
      const tip = new Mesh(new CylinderGeometry(0.008, 0.018, 0.12, 6), ribM)
      tip.position.y = 0.5 + 0.4
      g.add(tip)
      const shaft = new Mesh(new CylinderGeometry(0.02, 0.02, 1.3, 8), std({ color: 0x222222, metal: 0.7 }))
      shaft.position.y = 0.2
      g.add(shaft)
      const hook = new Mesh(new TorusGeometry(0.08, 0.02, 6, 12, Math.PI), std({ color: 0x5a3a24 }))
      hook.position.set(0.08, -0.45, 0)
      hook.rotation.z = Math.PI
      g.add(hook)
      g.rotation.z = 0.4
      break
    }
    case 'wristwatch': {
      const face = new Mesh(new CylinderGeometry(0.32, 0.32, 0.1, 28), std({ color: 0x9aa3ad, metal: 1, rough: 0.25 }))
      face.rotation.x = Math.PI / 2
      g.add(face)
      const dial = new Mesh(new CylinderGeometry(0.28, 0.28, 0.02, 28), std({ color: 0xefe8d8, rough: 0.5 }))
      dial.rotation.x = Math.PI / 2
      dial.position.z = 0.055
      g.add(dial)
      const h = new Mesh(boxGeo(0.03, 0.2, 0.01), std({ color: 0x111111 }))
      h.position.set(0, 0.1, 0.07)
      g.add(h)
      for (const y of [-0.55, 0.55]) {
        const strap = new Mesh(boxGeo(0.3, 0.5, 0.05), std({ color: 0x3a2418, rough: 0.8 }))
        strap.position.y = y
        g.add(strap)
      }
      break
    }
    case 'cap': {
      const crown = new Mesh(new CylinderGeometry(0.5, 0.44, 0.4, 28), std({ color: 0x1c2638, rough: 0.7 }))
      crown.position.y = 0.2
      g.add(crown)
      const brim = new Mesh(new CylinderGeometry(0.52, 0.52, 0.04, 28, 1, false, -Math.PI / 2, Math.PI), std({ color: 0x050505, rough: 0.2 }))
      brim.position.set(0, 0.02, 0.15)
      g.add(brim)
      const badge = new Mesh(new CylinderGeometry(0.07, 0.07, 0.02, 16), brass)
      badge.rotation.x = Math.PI / 2
      badge.position.set(0, 0.25, 0.48)
      g.add(badge)
      break
    }
  }
  return g
}
