// 背包里每件物品的 3D 模型（物品预览、世界里的摆放共用）
import { CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, type Object3D } from 'three'
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
      const a = new Mesh(boxGeo(0.12, 1.3, 0.04), std({ color: 0x2a2420, metal: 0.8, rough: 0.4 }))
      a.position.y = 0.4
      g.add(a)
      const b = new Mesh(boxGeo(0.16, 0.9, 0.04), std({ color: 0x2a2420, metal: 0.8, rough: 0.4 }))
      b.position.set(0.2, 0.25, 0.06)
      b.rotation.z = -0.5
      g.add(b)
      const hub = new Mesh(new CylinderGeometry(0.1, 0.1, 0.1, 16), brass)
      hub.rotation.x = Math.PI / 2
      g.add(hub)
      break
    }
    case 'toytrain': {
      const body = new Mesh(boxGeo(1.0, 0.4, 0.4), std({ color: 0x2f4f8a, rough: 0.4, metal: 0.5 }))
      body.position.y = 0.25
      g.add(body)
      const cab = new Mesh(boxGeo(0.35, 0.3, 0.42), std({ color: 0x8a2a24, rough: 0.4, metal: 0.4 }))
      cab.position.set(-0.32, 0.55, 0)
      g.add(cab)
      const chim = new Mesh(new CylinderGeometry(0.06, 0.08, 0.25, 12), std({ color: 0x111111 }))
      chim.position.set(0.3, 0.55, 0)
      g.add(chim)
      for (const x of [-0.3, 0.05, 0.35]) for (const z of [-0.2, 0.2]) {
        const w = new Mesh(new CylinderGeometry(0.11, 0.11, 0.05, 16), std({ color: 0x111111, metal: 0.6 }))
        w.rotation.x = Math.PI / 2
        w.position.set(x, 0.08, z)
        g.add(w)
      }
      break
    }
    case 'umbrella': {
      const canopy = new Mesh(new SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), std({ color: 0xb33a32, rough: 0.6, side: 2 }))
      canopy.position.y = 0.5
      g.add(canopy)
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
