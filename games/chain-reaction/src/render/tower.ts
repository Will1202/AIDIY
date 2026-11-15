import {
  BoxGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, RingGeometry, SRGBColorSpace, Vector3, type Material,
} from 'three'
import type { Materials } from './materials'
import type { QualityPreset } from './quality'
import type { Simulation } from '../sim/simulation'
import { ZONE_NAMES } from '../sim/schema'

function m(geo: BoxGeometry | CylinderGeometry, mat: Material, cast = true) {
  const x = new Mesh(geo, mat)
  x.castShadow = cast
  x.receiveShadow = true
  return x
}

/** engraved brass plaque texture */
function plaque(num: number, title: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 1024, 256)
  grad.addColorStop(0, '#b8893c')
  grad.addColorStop(0.5, '#e3b866')
  grad.addColorStop(1, '#9c7030')
  g.fillStyle = grad
  g.fillRect(0, 0, 1024, 256)
  g.strokeStyle = 'rgba(60,35,10,0.7)'
  g.lineWidth = 6
  g.strokeRect(14, 14, 996, 228)
  g.fillStyle = 'rgba(45,25,8,0.92)'
  g.font = '600 64px "Archivo Variable", "Archivo", system-ui, sans-serif'
  g.textBaseline = 'middle'
  g.fillText(`ZONE ${String(num).padStart(2, '0')}`, 52, 92)
  g.font = '800 82px "Archivo Variable", "Archivo", system-ui, sans-serif'
  g.fillText(title, 52, 178)
  for (const [x, y] of [[34, 34], [990, 34], [34, 222], [990, 222]]) {
    g.beginPath()
    g.arc(x, y, 9, 0, 7)
    g.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

function engraving(text: string, sub: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#141a1c'
  g.fillRect(0, 0, 2048, 256)
  g.fillStyle = '#d8a64e'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '800 120px "Archivo Variable", "Archivo", system-ui, sans-serif'
  g.fillText(text, 1024, 100)
  g.font = '500 44px "Geist Mono Variable", "Geist Mono", ui-monospace, monospace'
  g.fillStyle = 'rgba(216,166,78,0.75)'
  g.fillText(sub, 1024, 200)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/**
 * The architecture the machine lives in. Purely visual (no colliders): I-beam columns, zone ring
 * beams, cross bracing, the riveted gear wall, a heavy plinth and zone plaques. Derived from the
 * machine's bounds so it frames whatever is loaded.
 */
export function buildTower(sim: Simulation, mats: Materials, q: QualityPreset): { group: Group; dispose(): void } {
  const g = new Group()
  g.name = 'tower'
  const disposables: { dispose(): void }[] = []
  const bb = sim.bounds()
  const isDemo = sim.scene.name === 'The Grand Contraption'
  // ground: a dark, slightly glossy floor with brass inlay rings
  const floorMat = new MeshPhysicalMaterial({ color: '#0f1517', roughness: 0.42, metalness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.4 })
  disposables.push(floorMat)
  // the floor fades out at its rim so the ground melts into the backdrop instead of a hard horizon
  floorMat.transparent = true
  floorMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = 'varying vec3 vFloorPos;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= 1.0 - smoothstep(14.0, 30.0, length(vFloorPos.xz));')
    sh.vertexShader = 'varying vec3 vFloorPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vFloorPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  }
  const floor = new Mesh(new CircleGeometry(32, 96), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  g.add(floor)
  for (const r of [9, 12.5]) {
    const ring = new Mesh(new RingGeometry(r, r + 0.06, 128), mats.brassDark)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.005
    g.add(ring)
  }
  if (!isDemo) return { group: g, dispose: () => disposables.forEach((d) => d.dispose()) }

  // ---- The Grand Contraption's tower -------------------------------------------------------
  const x0 = -6.55, x1 = 6.55, z0 = -2.05, z1 = 3.25
  const colH = 19.0 // columns from the plinth (3.6) to 22.6, the crown sits above
  const beam = (a: Vector3, b: Vector3, w: number, mat: Material) => {
    const d = b.clone().sub(a)
    const len = d.length()
    const mesh = m(new BoxGeometry(w, len, w), mat)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize())
    g.add(mesh)
    return mesh
  }
  // I-beam columns (flanges + web)
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) {
      const col = new Group()
      col.add(m(new BoxGeometry(0.34, colH, 0.06), mats.steelDark))
      const f1 = m(new BoxGeometry(0.06, colH, 0.34), mats.steelDark)
      f1.position.x = -0.15
      const f2 = f1.clone()
      f2.position.x = 0.15
      col.add(f1, f2)
      col.position.set(x, colH / 2 + 3.6, z)
      g.add(col)
      const finial = m(new CylinderGeometry(0.06, 0.22, 0.6, 12), mats.brass)
      finial.position.set(x, 3.6 + colH + 0.3, z)
      g.add(finial)
      const foot = m(new BoxGeometry(0.7, 0.2, 0.7), mats.brassDark)
      foot.position.set(x, 3.7, z)
      g.add(foot)
    }
  }
  // zone ring beams
  const levels = [3.6, 8.2, 12.0, 17.45, 21.0]
  for (const y of levels) {
    for (const [a, b] of [[new Vector3(x0, y, z0), new Vector3(x1, y, z0)], [new Vector3(x0, y, z1), new Vector3(x1, y, z1)], [new Vector3(x0, y, z0), new Vector3(x0, y, z1)], [new Vector3(x1, y, z0), new Vector3(x1, y, z1)]] as const) {
      beam(a, b, 0.2, mats.steelDark)
    }
  }
  // X bracing on the back face and the sides (leaves the front open to the camera)
  for (let i = 0; i < levels.length - 1; i++) {
    const ya = levels[i], yb = levels[i + 1]
    beam(new Vector3(x0, ya, z0), new Vector3(x1 * 0.0 + -2.2, yb, z0), 0.07, mats.brassDark)
    beam(new Vector3(x1, ya, z0), new Vector3(2.2, yb, z0), 0.07, mats.brassDark)
    for (const x of [x0, x1]) {
      // the loading chute passes through the lowest left bay
      if (i === 0 && x === x0) continue
      beam(new Vector3(x, ya, z0), new Vector3(x, yb, z1), 0.06, mats.steelDark)
      beam(new Vector3(x, ya, z1), new Vector3(x, yb, z0), 0.06, mats.steelDark)
    }
  }
  // the riveted gear wall behind the clockwork
  const wall = m(new BoxGeometry(12.6, 5.0, 0.08), mats.patina)
  wall.position.set(0, 14.7, -1.82)
  g.add(wall)
  // lower back wall behind the pendulum hall and spring chamber (so those zones read against metal, not void)
  const wallLo = m(new BoxGeometry(12.6, 8.4, 0.08), mats.patina)
  wallLo.position.set(0, 3.6 + 4.2, -1.95)
  g.add(wallLo)
  for (let i = 0; i < 6; i++) {
    const rib = m(new BoxGeometry(0.12, 8.4, 0.14), mats.steelDark)
    rib.position.set(-6 + i * 2.4, 3.6 + 4.2, -1.9)
    g.add(rib)
  }
  // heavy plinth with the machine's name
  const plinth = m(new BoxGeometry(x1 - x0 + 1.6, 3.6, z1 - z0 + 1.6), mats.iron)
  plinth.position.set(0, 1.8, (z0 + z1) / 2)
  g.add(plinth)
  const capStone = m(new BoxGeometry(x1 - x0 + 1.9, 0.16, z1 - z0 + 1.9), mats.brassDark)
  capStone.position.set(0, 3.62, (z0 + z1) / 2)
  g.add(capStone)
  for (const y of [0.25, 3.3]) {
    const band = m(new BoxGeometry(x1 - x0 + 1.66, 0.06, z1 - z0 + 1.66), mats.brassDark)
    band.position.set(0, y, (z0 + z1) / 2)
    g.add(band)
  }
  const tex = engraving('CHAIN REACTION', 'THE BUTTERFLY MACHINE  ·  ONE MARBLE. A THOUSAND CONSEQUENCES.')
  const nameMat = new MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.4, emissive: '#3a2408', emissiveMap: tex, emissiveIntensity: 0.6 })
  disposables.push(tex, nameMat)
  const name = new Mesh(new PlaneGeometry(12, 1.5), nameMat)
  name.position.set(0, 1.9, z1 + 0.81)
  g.add(name)
  // zone plaques at the front-left of each zone
  const plaqueY: Record<number, [number, number, number]> = {
    1: [x0 + 1.6, 22.5, z1 + 0.02], 2: [x0 + 1.6, 18.35, z1 + 0.02], 3: [x1 - 1.6, 16.4, z1 + 0.02], 4: [x1 - 1.6, 12.6, z1 + 0.02],
    5: [x0 + 1.6, 12.6, z1 + 0.02], 6: [x0 + 1.6, 8.8, z1 + 0.02], 7: [x0 - 1.0, 4.4, 2.6], 8: [x1 - 1.6, 22.5, z1 + 0.02],
  }
  for (const [k, pos] of Object.entries(plaqueY)) {
    const t = plaque(Number(k), ZONE_NAMES[Number(k)])
    const mat = new MeshStandardMaterial({ map: t, metalness: 0.7, roughness: 0.45, color: '#b8b0a0' })
    disposables.push(t, mat)
    const p = new Mesh(new PlaneGeometry(2.0, 0.5), mat)
    p.position.set(...pos)
    if (Number(k) === 7) p.rotation.y = Math.PI / 2
    g.add(p)
  }
  // rivets: instanced studs along every ring beam and the gear wall
  if (q.rivets) {
    const pts: Vector3[] = []
    for (const y of levels) {
      for (let x = x0 + 0.4; x < x1; x += 0.55) pts.push(new Vector3(x, y, z1 + 0.105), new Vector3(x, y - 0.06, z1 + 0.105))
    }
    for (let x = -6.1; x <= 6.1; x += 0.5) for (const y of [12.3, 17.1]) pts.push(new Vector3(x, y, -1.77))
    const studs = new InstancedMesh(new CylinderGeometry(0.03, 0.03, 0.03, 8), mats.brass, pts.length)
    const mm = new Matrix4()
    const rot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    pts.forEach((p, i) => studs.setMatrixAt(i, mm.compose(p, rot, new Vector3(1, 1, 1))))
    g.add(studs)
  }
  void bb
  return { group: g, dispose: () => disposables.forEach((d) => d.dispose()) }
}
