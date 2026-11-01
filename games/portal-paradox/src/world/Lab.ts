import {
  BoxGeometry as BoxGeometryLike, Color, CylinderGeometry, DirectionalLight, FogExp2, Group, HemisphereLight, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RectAreaLight,
  Scene, SphereGeometry, TorusGeometry, Vector3, type Material, type Texture,
} from 'three'
import { Builder } from './Builder'
import { LightStrips, createMotes, createSunShaft } from './effects'
import { patchStandard, SUN_SLIT } from './materials'
import { concreteTexture, floorTexture, metalTexture, signTexture } from './textures'
import type { PhysicsWorld } from '../physics/PhysicsWorld'
import type { QualityPreset } from '../engine/Quality'

export const LAB = {
  halfW: 22,
  zFar: -96,
  zNear: 32,
  height: 26,
  pillarX: 15,
  bay: 12,
  catwalkY: 9,
  spawn: { pos: new Vector3(1.2, 0, 24), yaw: 0 },
  /** default station of portal α */
  stationA: { pos: new Vector3(0, 0, -6), yaw: 0 },
  /** where the mass-driver launches the demo cube from, and its aim point */
  launcher: { pos: new Vector3(-2.6, 1.42, 7.2), aim: new Vector3(0, 2.05, -6) },
}

const FONT = '"PP Display", "Arial Narrow", Arial, sans-serif'
const MONO = '"PP Mono", ui-monospace, Consolas, monospace'

export interface LabWorld {
  scene: Scene
  ambient: Color
  update(t: number, dt: number): void
  setPower(p: number): void
  setQuality(q: QualityPreset): void
  power: number
  sun: DirectionalLight
  /** apparatus meshes that should be hidden when baking the environment */
  materials: Material[]
}

export function buildLab(phys: PhysicsWorld, q: QualityPreset): LabWorld {
  const scene = new Scene()
  scene.name = 'lab'
  scene.matrixWorldAutoUpdate = false
  scene.background = new Color(0x020304)
  scene.fog = new FogExp2(new Color(0.026, 0.034, 0.046), 0.0115)

  const { halfW: X, zFar: Z0, zNear: Z1, height: H } = LAB
  const concreteTex = concreteTexture(1024, 7)
  const darkConcreteTex = concreteTexture(1024, 19, 0.62)
  const floorTex = floorTexture(1024, 21)
  const metalTex = metalTexture(512, 33)

  const concrete = patchStandard(new MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.92, metalness: 0 }), {
    tri: { map: concreteTex, scale: 1 / 4.8 }, ao: { floorY: 0, height: 3.2, strength: 0.55, ceilY: H }, sunMask: true,
  })
  const concreteDark = patchStandard(new MeshStandardMaterial({ color: 0x9a9fa6, roughness: 0.9, metalness: 0 }), {
    tri: { map: darkConcreteTex, scale: 1 / 4.8 }, ao: { floorY: 0, height: 2.4, strength: 0.5 }, sunMask: true,
  })
  const floor = patchStandard(new MeshPhysicalMaterial({ color: 0xd8dde3, roughness: 0.32, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.28 }), {
    tri: { map: floorTex, scale: 1 / 6 }, sunMask: true,
  })
  const metal = patchStandard(new MeshStandardMaterial({ color: 0x8b929b, roughness: 0.5, metalness: 0.85 }), {
    tri: { map: metalTex, scale: 1 / 2 }, sunMask: true,
  })
  const blackMetal = patchStandard(new MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.35, metalness: 0.9 }), {
    tri: { map: metalTex, scale: 1 / 2 }, sunMask: true,
  })
  const paint = patchStandard(new MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.55, metalness: 0 }), { sunMask: true })
  const glass = new MeshPhysicalMaterial({ color: 0x9fb6c8, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1 })

  const b = new Builder(phys)

  // ── shell ────────────────────────────────────────────────────────────────
  const len = Z1 - Z0
  const zc = (Z0 + Z1) / 2
  const floorMesh = new Mesh(new PlaneGeometry(X * 2, len).rotateX(-Math.PI / 2).translate(0, 0, zc), floor)
  floorMesh.receiveShadow = true
  floorMesh.matrixAutoUpdate = false
  scene.add(floorMesh)
  phys.box(null, X + 4, 0.5, len / 2 + 4, 0, -0.5, zc)

  // side walls with a stepped plinth and string courses
  for (const s of [-1, 1]) {
    b.box(concrete, 2, H + 2, len, s * (X + 1), H / 2 + 1, zc, true)
    b.box(concreteDark, 0.5, 1.1, len, s * (X - 0.25), 0.55, zc, true)
    b.box(concreteDark, 0.25, 0.35, len, s * (X - 0.12), LAB.catwalkY + 4.2, zc)
    b.box(concreteDark, 0.3, 0.6, len, s * (X - 0.15), 18.2, zc)
  }

  // ceiling: solid slab except the long skylight slit
  const slit = SUN_SLIT.uSlit.value
  const cy = H + 0.75
  b.box(concrete, slit.x + X, 1.5, len, (-X + slit.x) / 2, cy, zc, true)
  b.box(concrete, X - slit.y, 1.5, len, (X + slit.y) / 2, cy, zc, true)
  b.box(concrete, slit.y - slit.x, 1.5, slit.z - Z0, (slit.x + slit.y) / 2, cy, (Z0 + slit.z) / 2, true)
  b.box(concrete, slit.y - slit.x, 1.5, Z1 - slit.w, (slit.x + slit.y) / 2, cy, (Z1 + slit.w) / 2, true)
  // skylight glazing: invisible, but it keeps inverted-gravity objects inside the hall
  b.box(null, slit.y - slit.x + 0.4, 0.4, slit.w - slit.z + 0.4, (slit.x + slit.y) / 2, H + 0.2, (slit.z + slit.w) / 2, true)
  // skylight glow plane above the slit (the sky beyond)
  const skyGlow = new Mesh(new PlaneGeometry(slit.y - slit.x + 2, slit.w - slit.z + 2).rotateX(Math.PI / 2), new MeshBasicMaterial({ color: new Color(0.9, 1.0, 1.15).multiplyScalar(6), fog: false }))
  skyGlow.position.set((slit.x + slit.y) / 2, H + 1.6, (slit.z + slit.w) / 2)
  scene.add(skyGlow)

  // transverse beams + pillars every bay
  const strips = new LightStrips(new Color(0.86, 0.93, 1.0), 9)
  for (let i = 0, z = 24; z >= -84; z -= LAB.bay, i++) {
    b.box(concrete, X * 2, 2.4, 1.4, 0, H - 1.2, z, true)
    b.box(concreteDark, X * 2, 0.08, 1.5, 0, H - 2.36, z)
    for (const s of [-1, 1]) {
      const px = s * LAB.pillarX
      b.box(concrete, 2.2, H, 2.2, px, H / 2, z, true)
      b.box(concreteDark, 2.9, 0.6, 2.9, px, 0.3, z, true)
      b.box(concreteDark, 2.5, 0.25, 2.5, px, 0.72, z)
      // haunches where the beam meets the pillar
      b.box(concrete, 2.2, 1.2, 3.2, px, H - 2.6, z)
      // wall pilaster opposite
      b.box(concrete, 1.2, H, 1.8, s * (X - 0.6), H / 2, z, true)
    }
  }
  // ceiling light strips between beams, delayed from near to far for the power-on wave
  for (let z = 24; z > -84; z -= LAB.bay) {
    const zm = z - LAB.bay / 2
    const d = (Z1 - zm) / len
    for (const s of [-1, 1]) {
      strips.add(0.5, 0.12, LAB.bay - 2.2, s * 10, H - 0.08, zm, 0.08 + d * 0.55 + (s > 0 ? 0.03 : 0))
      strips.add(0.18, 0.08, LAB.bay - 2.2, s * 3.2, H - 0.06, zm, 0.12 + d * 0.55)
      // aisle strips under the catwalk soffit
      strips.add(0.3, 0.06, LAB.bay - 2.6, s * 19.5, LAB.catwalkY - 0.6, zm, 0.02 + d * 0.4)
    }
  }

  // ── catwalks (mezzanine) with railings ──────────────────────────────────
  for (const s of [-1, 1]) {
    const cx = s * (X - 2.5)
    b.box(concreteDark, 5, 0.5, len - 8, cx, LAB.catwalkY, zc - 2, true)
    b.box(concreteDark, 5, 0.9, 0.5, cx, LAB.catwalkY - 0.6, zc - 2)
    const rx = s * (X - 5)
    b.box(blackMetal, 0.06, 0.06, len - 8, rx, LAB.catwalkY + 1.35, zc - 2)
    b.box(blackMetal, 0.04, 0.04, len - 8, rx, LAB.catwalkY + 0.8, zc - 2)
    b.box(blackMetal, 0.12, 0.08, len - 8, rx, LAB.catwalkY + 0.29, zc - 2)
    for (let z = Z0 + 6; z < Z1 - 6; z += 2) b.box(blackMetal, 0.05, 1.1, 0.05, rx, LAB.catwalkY + 0.8, z)
    // human-scale doors under the catwalk: they make the 26 m hall read at its true size
    for (const z of [-66, -30, 6]) {
      b.box(blackMetal, 0.2, 2.4, 1.5, s * (X - 0.1), 1.2, z)
      b.box(metal, 0.12, 0.1, 1.9, s * (X - 0.14), 2.48, z)
      strips.add(0.04, 0.16, 0.6, s * (X - 0.2), 2.85, z, 0.02)
    }
  }

  // ── far end: the Great Door ─────────────────────────────────────────────
  const dw = 10, dh = 21
  b.box(concrete, X - dw, H, 2, -(X + dw) / 2, H / 2, Z0 - 1, true)
  b.box(concrete, X - dw, H, 2, (X + dw) / 2, H / 2, Z0 - 1, true)
  b.box(concrete, dw * 2, H - dh, 2, 0, dh + (H - dh) / 2, Z0 - 1, true)
  // deep recess
  for (const s of [-1, 1]) b.box(concreteDark, 1.2, dh, 5, s * (dw + 0.6), dh / 2, Z0 - 3.5, true)
  b.box(concreteDark, dw * 2 + 2.4, 1.6, 5, 0, dh + 0.8, Z0 - 3.5)
  // the two door leaves with a thin luminous seam between them
  for (const s of [-1, 1]) {
    b.box(blackMetal, dw - 0.06, dh, 1.2, s * (dw / 2 + 0.03), dh / 2, Z0 - 5.4, true)
    for (let k = 1; k < 7; k++) b.box(metal, dw - 0.6, 0.08, 0.1, s * (dw / 2 + 0.03), k * 3, Z0 - 4.78)
  }
  b.box(null, 0.2, dh, 1.2, 0, dh / 2, Z0 - 5.4, true)
  strips.add(0.05, dh - 0.4, 0.2, 0, dh / 2, Z0 - 5.7, 0.9)
  strips.add(dw * 2 - 1, 0.1, 0.1, 0, dh + 0.06, Z0 - 4.2, 0.92)
  b.box(concreteDark, dw * 2, 0.1, 6, 0, 0.05, Z0 - 3)

  // ── near end: entrance wall, shutter and control-room window ───────────
  b.box(concrete, X * 2 + 4, H - 13, 2, 0, 13 + (H - 13) / 2, Z1 + 1, true)
  for (const s of [-1, 1]) {
    b.box(concrete, X + 2 - 9, 3.5, 2, s * (9 + (X + 2 - 9) / 2), 11.25, Z1 + 1, true)
    b.box(concrete, X + 2 - 7, 9.5, 2, s * (7 + (X + 2 - 7) / 2), 4.75, Z1 + 1, true)
    b.box(paint, 0.2, 3.8, 1.6, s * 9.1, 11.2, Z1 + 2.7)
  }
  b.box(concreteDark, 18.4, 0.2, 1.6, 0, 9.4, Z1 + 2.7)
  b.box(paint, 18.4, 0.2, 1.6, 0, 13.1, Z1 + 2.7)
  // shutter
  for (let k = 0; k < 24; k++) b.box(metal, 14, 0.38, 0.3, 0, 0.2 + k * 0.4, Z1 + 0.6, k === 0)
  b.box(null, 14, 9.6, 0.4, 0, 4.8, Z1 + 0.6, true)
  b.box(blackMetal, 0.5, 9.8, 0.6, -7.1, 4.9, Z1 + 0.4)
  b.box(blackMetal, 0.5, 9.8, 0.6, 7.1, 4.9, Z1 + 0.4)
  // control room: window band at y 9.5–13 lit from inside
  const win = new Mesh(new PlaneGeometry(18, 3.4), glass)
  win.position.set(0, 11.2, Z1 + 0.2)
  win.rotation.y = Math.PI
  scene.add(win)
  b.box(blackMetal, 18.4, 0.3, 0.5, 0, 9.4, Z1 + 0.25)
  b.box(blackMetal, 18.4, 0.3, 0.5, 0, 13, Z1 + 0.25)
  for (let k = -4; k <= 4; k++) b.box(blackMetal, 0.12, 3.4, 0.3, k * 2.25, 11.2, Z1 + 0.25)
  b.box(paint, 18, 3.6, 0.2, 0, 11.2, Z1 + 3.4)
  strips.add(17, 0.1, 0.2, 0, 12.8, Z1 + 3.1, 0.05)
  for (let k = -3; k <= 3; k++) strips.add(1.2, 0.5, 0.05, k * 2.4, 10.4, Z1 + 3.2, 0.05 + Math.abs(k) * 0.01)

  // ── portal field station markings around α ──────────────────────────────
  const st = LAB.stationA.pos
  b.box(concreteDark, 12.4, 0.04, 12.4, st.x, 0.02, st.z)
  for (const s of [-1, 1]) {
    b.box(paint, 0.08, 0.006, 70, s * 6.5, 0.004, -20)
  }
  // specimen plinth for the glass shards
  b.box(concreteDark, 2.6, 0.8, 2.0, 7, 0.4, -10)
  b.box(metal, 2.7, 0.02, 2.1, 7, 0.8, -10)
  // console desks facing the gate
  for (const s of [-1, 1]) {
    const x = st.x + s * 4.4, z = st.z + 6.2
    b.box(blackMetal, 2.2, 0.95, 0.9, x, 0.475, z, true, -s * 0.35)
    b.box(metal, 2.2, 0.06, 1.0, x, 0.98, z, false, -s * 0.35)
  }

  // ── the mass driver (launcher) ──────────────────────────────────────────
  const L = LAB.launcher
  const aimDir = L.aim.clone().sub(L.pos).normalize()
  const lyaw = Math.atan2(-aimDir.x, -aimDir.z)
  const lpitch = Math.asin(aimDir.y)
  b.box(concreteDark, 1.6, 0.9, 2.4, L.pos.x, 0.45, L.pos.z + 0.6, true, lyaw)
  const rail = new Group()
  rail.position.copy(L.pos)
  rail.rotation.set(lpitch, lyaw, 0, 'YXZ')
  for (const s of [-1, 1]) {
    const r = new Mesh(new CylinderGeometry(0.05, 0.05, 2.6, 8).rotateX(Math.PI / 2), blackMetal)
    r.position.set(s * 0.42, -0.1, 0.5)
    rail.add(r)
  }
  const coilMat = new MeshStandardMaterial({ color: 0x111111, emissive: new Color(0.55, 0.85, 1.0), emissiveIntensity: 0 })
  for (let k = 0; k < 5; k++) {
    const c = new Mesh(new TorusGeometry(0.62, 0.05, 6, 24), coilMat)
    c.position.set(0, 0, 1.4 - k * 0.5)
    rail.add(c)
  }
  scene.add(rail)

  // ── apparatus ────────────────────────────────────────────────────────────
  const anim: ((t: number) => void)[] = []
  const chrome = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 1 })
  const ringMat = patchStandard(new MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.25, metalness: 1 }), { sunMask: true })
  const ringGlow = new MeshBasicMaterial({ color: new Color(0.55, 0.85, 1.0).multiplyScalar(4) })
  {
    // gyroscope: three counter-rotating rings levitating a chrome core
    const gx = -9.5, gz = -22
    const base = new Mesh(new CylinderGeometry(2.4, 2.8, 0.9, 48), concreteDark)
    base.position.set(gx, 0.45, gz)
    base.receiveShadow = true
    scene.add(base)
    phys.cylinder(0.45, 2.8, gx, 0.45, gz)
    const disc = new Mesh(new CylinderGeometry(1.6, 1.6, 0.05, 48), ringGlow)
    disc.position.set(gx, 0.93, gz)
    scene.add(disc)
    const pivot = new Group()
    pivot.position.set(gx, 4.6, gz)
    scene.add(pivot)
    const rings: Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const r = 2.7 - i * 0.6
      const ring = new Mesh(new TorusGeometry(r, 0.09, 12, 96), ringMat)
      ring.castShadow = true
      const trim = new Mesh(new TorusGeometry(r - 0.11, 0.015, 6, 96), ringGlow)
      ring.add(trim)
      pivot.add(ring)
      rings.push(ring)
    }
    const core = new Mesh(new SphereGeometry(0.62, 48, 32), chrome)
    core.castShadow = true
    pivot.add(core)
    anim.push((t) => {
      rings[0].rotation.set(t * 0.31, t * 0.17, 0)
      rings[1].rotation.set(-t * 0.23, 0, t * 0.41)
      rings[2].rotation.set(t * 0.5, -t * 0.37, t * 0.12)
      core.position.y = Math.sin(t * 1.3) * 0.12
    })
  }
  {
    // hovering monolith with a scanning line
    const mx = 10.5, mz = -32
    const mono = new Mesh(new BoxGeometryLike(2.0, 7.2, 0.5), new MeshPhysicalMaterial({ color: 0x050607, roughness: 0.12, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }))
    mono.castShadow = true
    scene.add(mono)
    const scan = new Mesh(new BoxGeometryLike(2.06, 0.03, 0.56), ringGlow)
    mono.add(scan)
    const pad = new Mesh(new CylinderGeometry(1.8, 1.8, 0.06, 48), concreteDark)
    pad.position.set(mx, 0.03, mz)
    scene.add(pad)
    const padGlow = new Mesh(new TorusGeometry(1.7, 0.025, 6, 96).rotateX(Math.PI / 2), ringGlow)
    padGlow.position.set(mx, 0.07, mz)
    scene.add(padGlow)
    anim.push((t) => {
      mono.position.set(mx, 4.6 + Math.sin(t * 0.7) * 0.25, mz)
      mono.rotation.set(0, t * 0.12, Math.sin(t * 0.4) * 0.03)
      scan.position.y = Math.sin(t * 0.9) * 3.4
    })
  }
  {
    // a suspended lattice of cubes high in the hall, undulating like a field line
    const nx = 9, ny = 3, nz = 9
    const inst = new InstancedMesh(new BoxGeometryLike(0.42, 0.42, 0.42), patchStandard(new MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.3, metalness: 0.9 }), { sunMask: true }), nx * ny * nz)
    inst.castShadow = true
    scene.add(inst)
    const m = new Matrix4()
    const o = new Object3D()
    anim.push((t) => {
      let i = 0
      for (let a = 0; a < nx; a++) for (let c = 0; c < ny; c++) for (let d = 0; d < nz; d++) {
        const x = (a - (nx - 1) / 2) * 1.1, z = -46 + (d - (nz - 1) / 2) * 1.1
        const y = 15 + c * 1.1 + Math.sin(t * 0.8 + a * 0.6 + d * 0.45) * 0.45
        o.position.set(x, y, z)
        o.rotation.set(t * 0.2 + a, t * 0.15 + d, 0)
        o.updateMatrix()
        m.copy(o.matrix)
        inst.setMatrixAt(i++, m)
      }
      inst.instanceMatrix.needsUpdate = true
    })
  }

  // ── signage ──────────────────────────────────────────────────────────────
  const signs: Mesh[] = []
  const signMat = (tex: Texture, emissive = 0) =>
    patchStandard(new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, metalness: 0, emissive: new Color(1, 1, 1), emissiveMap: emissive ? tex : null, emissiveIntensity: emissive, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }), { sunMask: true })
  const addSign = (tex: Texture, w: number, h: number, x: number, y: number, z: number, ry: number, emissive = 0, rx = 0) => {
    const m = new Mesh(new PlaneGeometry(w, h), signMat(tex, emissive))
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, 0, 'YXZ')
    m.renderOrder = 2
    scene.add(m)
    signs.push(m)
    return m
  }
  const wallText = (text: string, sub: string) => signTexture({
    w: 22, h: 2.2,
    draw: (c, w, h) => {
      c.fillStyle = 'rgba(236,240,244,0.82)'
      c.font = `800 ${h * 0.56}px ${FONT}`
      c.textBaseline = 'alphabetic'
      c.fillText(text, 0, h * 0.62)
      c.font = `500 ${h * 0.16}px ${MONO}`
      c.fillStyle = 'rgba(236,240,244,0.55)'
      c.fillText(sub, 4, h * 0.9)
      c.fillRect(0, h * 0.97, w * 0.25, h * 0.03)
    },
  }, 64)
  addSign(wallText('PORTAL RESEARCH DIVISION', 'SPATIAL TOPOLOGY GROUP  ·  FIELD STATIONS α / Ω  ·  CLEARANCE LEVEL 5'), 9.8, 0.98, -X + 0.03, 12.6, -18, Math.PI / 2)
  addSign(wallText('SPATIAL INTEGRITY NOT GUARANTEED', 'BEYOND THIS POINT, DISTANCE IS A SUGGESTION  ·  REPORT ALL PARADOXES'), 9.8, 0.98, X - 0.03, 12.6, -42, -Math.PI / 2)
  addSign(wallText('FIELD STATION α', 'TOPOLOGICAL ANCHOR  ·  LINK ESTABLISHED 2026-11-01  ·  DO NOT STAND IN THE APERTURE'), 9.8, 0.98, X - 0.03, 12.6, -6, -Math.PI / 2)
  addSign(wallText('CAUSALITY IS LOCAL', 'TEMPORAL BUFFER 10 S  ·  GRAVITY VECTOR CONFIGURABLE  ·  MIND THE GAP'), 9.8, 0.98, -X + 0.03, 12.6, -54, Math.PI / 2)
  addSign(signTexture({
    w: 16, h: 6,
    draw: (c, w, h) => {
      c.fillStyle = 'rgba(230,236,242,0.78)'
      c.font = `900 ${h * 0.86}px ${FONT}`
      c.textAlign = 'center'
      c.fillText('07', w / 2, h * 0.86)
    },
  }, 48), 16, 6, 0, 14.2, Z0 - 4.72, 0)
  addSign(signTexture({
    w: 8, h: 0.8,
    draw: (c, w, h) => {
      c.fillStyle = 'rgba(230,236,242,0.7)'
      c.font = `600 ${h * 0.42}px ${MONO}`
      c.textAlign = 'center'
      c.fillText('SECTOR 07  —  DO NOT OPEN  —  NO RETURN', w / 2, h * 0.62)
    },
  }, 96), 8, 0.8, 0, 9.5, Z0 - 4.72, 0)
  // bay numbers + hazard bands on every pillar
  const hazard = signTexture({
    w: 2.2, h: 0.5,
    draw: (c, w, h) => {
      c.fillStyle = '#b8932a'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#0d0e10'
      for (let x = -h; x < w + h; x += h * 0.9) {
        c.beginPath()
        c.moveTo(x, h)
        c.lineTo(x + h * 0.45, h)
        c.lineTo(x + h * 0.45 + h, 0)
        c.lineTo(x + h, 0)
        c.closePath()
        c.fill()
      }
    },
  }, 128)
  let bay = 1
  for (let z = 24; z >= -84; z -= LAB.bay, bay++) {
    const label = signTexture({
      w: 1.4, h: 1.1,
      draw: (c, _w, h) => {
        c.fillStyle = 'rgba(232,236,240,0.85)'
        c.font = `800 ${h * 0.5}px ${FONT}`
        c.fillText(`B${String(bay).padStart(2, '0')}`, 0, h * 0.55)
        c.font = `500 ${h * 0.11}px ${MONO}`
        c.fillText(`GRID ${String.fromCharCode(64 + bay)}/${bay * 12}  LOAD 4.2 MN`, 2, h * 0.8)
      },
    }, 128)
    for (const s of [-1, 1]) {
      const fx = s * (LAB.pillarX - 1.11)
      addSign(label, 1.4, 1.1, fx, 4.4, z, s > 0 ? -Math.PI / 2 : Math.PI / 2)
      for (const f of [-1, 1]) addSign(hazard, 2.2, 0.5, s * LAB.pillarX, 1.25, z + f * 1.111, f > 0 ? 0 : Math.PI)
    }
  }
  // floor ring around the field station
  addSign(signTexture({
    w: 12, h: 12,
    draw: (c, w) => {
      const cx = w / 2
      c.strokeStyle = 'rgba(225,232,240,0.55)'
      for (const [r, lw] of [[0.47, 3], [0.44, 1.2], [0.33, 1.2], [0.2, 2]] as const) {
        c.lineWidth = lw
        c.beginPath()
        c.arc(cx, cx, w * r, 0, Math.PI * 2)
        c.stroke()
      }
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2
        const r0 = w * (i % 10 === 0 ? 0.41 : 0.43), r1 = w * 0.47
        c.lineWidth = i % 10 === 0 ? 3 : 1
        c.beginPath()
        c.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0)
        c.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1)
        c.stroke()
      }
      c.fillStyle = 'rgba(225,232,240,0.6)'
      c.font = `600 ${w * 0.025}px ${MONO}`
      c.textAlign = 'center'
      c.fillText('FIELD STATION α  ·  TOPOLOGICAL ANCHOR  ·  KEEP CLEAR', cx, cx + w * 0.39)
    },
  }, 96), 12, 12, st.x, 0.045, st.z, 0, 0.0, -Math.PI / 2)

  // console screens
  const screen = signTexture({
    w: 1.9, h: 1.05,
    draw: (c, w, h) => {
      c.fillStyle = 'rgba(6,14,20,0.95)'
      c.fillRect(0, 0, w, h)
      c.strokeStyle = 'rgba(150,220,255,0.9)'
      c.lineWidth = 2
      c.beginPath()
      for (let x = 0; x < w; x += 2) {
        const y = h * 0.42 + Math.sin(x * 0.05) * h * 0.12 * Math.sin(x * 0.011) + Math.sin(x * 0.31) * 3
        if (x === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      }
      c.stroke()
      c.fillStyle = 'rgba(150,220,255,0.85)'
      c.font = `600 ${h * 0.07}px ${MONO}`
      c.fillText('FIELD COHERENCE   99.982%', 12, h * 0.12)
      c.fillText('LINK α ⇄ Ω        STABLE', 12, h * 0.21)
      for (let i = 0; i < 14; i++) c.fillRect(12 + i * (w / 15), h * 0.92 - (Math.sin(i * 1.7) * 0.5 + 0.6) * h * 0.25, w / 22, (Math.sin(i * 1.7) * 0.5 + 0.6) * h * 0.25)
    },
  }, 160)
  for (const s of [-1, 1]) {
    const m = addSign(screen, 1.9, 1.05, st.x + s * 4.4, 1.62, st.z + 6.2 - 0.12, -s * 0.35 + Math.PI, 1.6, -0.35)
    m.material.transparent = false
  }

  // ── lights ───────────────────────────────────────────────────────────────
  const hemi = new HemisphereLight(0x9fb6d4, 0x2a2c30, 0.5)
  scene.add(hemi)
  const sun = new DirectionalLight(0xf2f5ff, 26)
  const sd = SUN_SLIT.uSunDir.value
  const stripeCenter = new Vector3((slit.x + slit.y) / 2, H, (slit.z + slit.w) / 2).sub(sd.clone().multiplyScalar(H / sd.y))
  sun.target.position.copy(stripeCenter)
  sun.position.copy(stripeCenter).addScaledVector(sd, 60)
  sun.castShadow = true
  sun.shadow.camera.up.set(0, 0, -1)
  sun.shadow.camera.left = -8
  sun.shadow.camera.right = 8
  sun.shadow.camera.top = 70
  sun.shadow.camera.bottom = -70
  sun.shadow.camera.near = 20
  sun.shadow.camera.far = 100
  sun.shadow.bias = -0.0004
  sun.shadow.radius = 3
  sun.shadow.normalBias = 0.03
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
  scene.add(sun, sun.target)

  const stripLights: RectAreaLight[] = []
  for (const s of [-1, 1]) {
    const l = new RectAreaLight(0xdde9ff, 4.5, 1.4, 104)
    l.position.set(s * 10, H - 0.3, -30)
    l.rotation.x = -Math.PI / 2
    scene.add(l)
    stripLights.push(l)
  }
  // a cold key on the great door, and a soft fill on the field station
  const doorLight = new RectAreaLight(0xbcd6ff, 0, 0.6, 20)
  doorLight.position.set(0, dh / 2, Z0 - 4.6)
  doorLight.lookAt(0, dh / 2, 0)
  scene.add(doorLight)

  // ── atmosphere ───────────────────────────────────────────────────────────
  const shaft = createSunShaft(slit, H, sd, new Color(0.75, 0.85, 1.0))
  scene.add(shaft)
  const dust = createMotes({
    count: q.dustCount, box: [new Vector3(-X, 0.2, Z0), new Vector3(X, H - 1, Z1)], color: new Color(1, 1, 1), size: 0.035, seed: 5, rise: 0.02,
    beam: { slit, slitY: H, sunDir: sd }, ambient: 0.04,
  })
  scene.add(dust)

  for (const m of b.build()) scene.add(m)
  scene.add(strips.build())

  const timeMats: Material[] = [strips.material, shaft.material as Material, dust.material as Material]
  const world: LabWorld = {
    scene,
    ambient: new Color(0.62, 0.74, 0.95),
    sun,
    materials: [concrete, concreteDark, floor, metal, blackMetal, paint],
    power: 1,
    update(t, dt) {
      void dt
      for (const f of anim) f(t)
      for (const m of timeMats) (m as unknown as { uniforms: { uTime: { value: number } } }).uniforms.uTime.value = t
      coilMat.emissiveIntensity = coilCharge.value * 6
    },
    setPower(p) {
      world.power = p
      strips.material.uniforms.uPower.value = p
      const on = Math.min(1, Math.max(0, (p - 0.1) / 0.7))
      for (const l of stripLights) l.intensity = 4.5 * on * (q.areaLights > 0 ? 1 : 0)
      hemi.intensity = 0.1 + (q.areaLights > 0 ? 0.42 : 0.7) * on
      scene.environmentIntensity = 0.2 + 1.3 * on
      doorLight.intensity = Math.max(0, (p - 0.85) / 0.15) * 3
      ringGlow.color.setRGB(0.55, 0.85, 1.0).multiplyScalar(4 * on)
      ;(dust.material as unknown as { uniforms: { uAmbient: { value: number } } }).uniforms.uAmbient.value = 0.04 * on
    },
    setQuality(nq) {
      q = nq
      sun.shadow.mapSize.set(nq.shadowMapSize, nq.shadowMapSize)
      if (sun.shadow.map) {
        sun.shadow.map.dispose()
        sun.shadow.map = null
      }
      shaft.visible = nq.volumetric
      dust.geometry.setDrawRange(0, Math.min(nq.dustCount, dust.geometry.attributes.position.count))
      world.setPower(world.power)
    },
  }
  shaft.visible = q.volumetric
  world.setPower(1)
  return world
}

/** charge level of the launcher coils (driven by the director / launch events) */
export const coilCharge = { value: 0 }
