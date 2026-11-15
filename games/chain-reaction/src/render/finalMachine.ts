import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PointLight,
  Points, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three'
import type { Materials } from './materials'
import type { QualityPreset } from './quality'
import { gearGeometry } from './geometry'

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const range = (t: number, a: number, b: number) => ease((t - a) / (b - a))

/**
 * THE FINAL MACHINE — a closed bronze sphere crowning the tower. It only performs once its trigger
 * cup reports a settled marble (showTime ≥ 0); everything here is driven by that clock:
 * rings wake → petals unfold → arms extend → core ignites → gold particles bloom outward.
 */
export class FinalMachine {
  readonly group = new Group()
  private petals: Group[] = []
  private rings: Mesh[] = []
  private arms: Group[] = []
  private gears: Mesh[] = []
  private core: Mesh
  private coreMat: MeshStandardMaterial
  private light: PointLight
  private spire: Group
  private particles: Points
  private pMat: ShaderMaterial
  private R: number
  private disposables: { dispose(): void }[] = []

  constructor(mats: Materials, q: QualityPreset, scale: number) {
    const R = 2.5 * scale
    this.R = R
    const C = new Vector3(0, 4.3 * scale, 0)
    this.group.position.copy(C)
    // pedestal column from the cup up to the sphere
    const col = new Mesh(new CylinderGeometry(0.28 * scale, 0.5 * scale, C.y - R * 0.6, 24), mats.brassDark)
    col.position.y = -(C.y - R * 0.6) / 2 - R * 0.6
    col.castShadow = true
    this.group.add(col)
    const collar = new Mesh(new TorusGeometry(0.6 * scale, 0.09 * scale, 10, 40), mats.brass)
    collar.rotation.x = Math.PI / 2
    collar.position.y = -R * 0.62
    this.group.add(collar)
    // core
    this.coreMat = new MeshStandardMaterial({ color: '#ffcf6a', emissive: new Color('#ffb02e'), emissiveIntensity: 0.2, metalness: 0.6, roughness: 0.25 })
    this.core = new Mesh(new SphereGeometry(R * 0.32, 48, 32), this.coreMat)
    this.group.add(this.core)
    this.light = new PointLight('#ffc070', 0, R * 9, 1.6)
    this.group.add(this.light)
    // inner gears round the core
    for (let i = 0; i < 6; i++) {
      const g = new Mesh(gearGeometry(18 + i * 2, 0.045 * scale, 0.06 * scale, 'spoked', q.detail), i % 2 ? mats.gold : mats.brass)
      const a = (i / 6) * Math.PI * 2
      g.position.set(Math.cos(a) * R * 0.5, Math.sin(a * 2) * R * 0.12, Math.sin(a) * R * 0.5)
      g.lookAt(0, g.position.y, 0)
      g.userData.dir = i % 2 ? 1 : -1
      g.userData.shared = true
      this.gears.push(g)
      this.group.add(g)
    }
    // armillary rings
    for (let i = 0; i < 4; i++) {
      const r = new Mesh(new TorusGeometry(R * (0.62 + i * 0.09), 0.035 * scale, 10, Math.round(96 * q.detail)), i % 2 ? mats.gold : mats.steel)
      r.rotation.set(i * 0.7, i * 1.1, i * 0.4)
      r.castShadow = true
      this.rings.push(r)
      this.group.add(r)
    }
    // shell petals: 8 spherical lunes hinged at the bottom pole
    const petalGeo = (k: number) => new SphereGeometry(R, 24, 24, (k / 8) * Math.PI * 2 + 0.01, (Math.PI * 2) / 8 - 0.02, 0.02, Math.PI * 0.88)
    for (let k = 0; k < 8; k++) {
      const pivot = new Group()
      pivot.position.set(0, -R * 0.93, 0)
      const shell = new Mesh(petalGeo(k), k % 2 ? mats.brassDark : mats.copper)
      shell.position.y = R * 0.93
      shell.castShadow = true
      ;(shell.material as MeshStandardMaterial).side = 2
      pivot.add(shell)
      // brass rib along the petal edge
      const rib = new Mesh(new TorusGeometry(R * 1.005, 0.03 * scale, 6, 48, Math.PI * 0.9), mats.brass)
      rib.rotation.y = -(k / 8) * Math.PI * 2 - Math.PI / 2
      rib.rotation.z = Math.PI / 2 + 0.04
      rib.position.y = R * 0.93
      pivot.add(rib)
      pivot.userData.angle = (k / 8 + 1 / 16) * Math.PI * 2
      this.petals.push(pivot)
      this.group.add(pivot)
    }
    // 16 telescoping arms
    for (let i = 0; i < 16; i++) {
      const arm = new Group()
      const a = (i / 16) * Math.PI * 2
      const el = (i % 2 ? 0.35 : -0.15)
      arm.rotation.set(0, -a, el)
      const seg1 = new Mesh(new BoxGeometry(R * 0.9, 0.08 * scale, 0.08 * scale), mats.steel)
      seg1.position.x = R * 0.45
      arm.add(seg1)
      const seg2 = new Mesh(new BoxGeometry(R * 0.8, 0.05 * scale, 0.05 * scale), mats.brass)
      seg2.position.x = R * 0.4
      seg2.name = 'tele'
      arm.add(seg2)
      const claw = new Mesh(new SphereGeometry(0.09 * scale, 12, 8), mats.lampOn)
      claw.name = 'claw'
      arm.add(claw)
      arm.scale.setScalar(0.001)
      this.arms.push(arm)
      this.group.add(arm)
    }
    // spire / power unit on top
    this.spire = new Group()
    this.spire.position.y = R * 0.98
    const mast = new Mesh(new CylinderGeometry(0.05 * scale, 0.16 * scale, 1.6 * scale, 16), mats.brass)
    mast.position.y = 0.8 * scale
    this.spire.add(mast)
    for (let i = 0; i < 3; i++) {
      const t = new Mesh(new TorusGeometry((0.5 - i * 0.12) * scale, 0.025 * scale, 8, 40), mats.gold)
      t.rotation.x = Math.PI / 2
      t.position.y = (0.5 + i * 0.4) * scale
      this.spire.add(t)
    }
    const tip = new Mesh(new SphereGeometry(0.12 * scale, 16, 12), this.coreMat)
    tip.position.y = 1.65 * scale
    this.spire.add(tip)
    this.group.add(this.spire)
    // gold particles (GPU): each has a seed direction, speed, spin and life
    const n = q.particles
    const geo = new BufferGeometry()
    const seed = new Float32Array(n * 4)
    const dir = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1
      const th = Math.random() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      dir.set([Math.cos(th) * s, u * 0.7 + 0.15, Math.sin(th) * s], i * 3)
      seed.set([Math.random(), 0.4 + Math.random() * 1.6, Math.random() * 6.28, 0.5 + Math.random()], i * 4)
    }
    geo.setAttribute('position', new BufferAttribute(dir, 3))
    geo.setAttribute('seed', new BufferAttribute(seed, 4))
    this.pMat = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uT: { value: -1 }, uR: { value: R }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uT; uniform float uR; uniform float uPx;
        varying float vA; varying float vHot;
        void main() {
          // staggered emission: each particle launches at seed.x * 6 s into the show
          float t = uT - 5.0 - seed.x * 6.0;
          float life = 5.5 * seed.w;
          float k = clamp(t / life, 0.0, 1.0);
          vec3 d = normalize(position);
          float dist = uR * 0.35 + seed.y * uR * 3.2 * (1.0 - exp(-k * 3.0));
          float sw = seed.z + k * 4.0 * (0.5 + seed.y);
          vec3 swirl = vec3(cos(sw) * d.z - sin(sw) * d.x, 0.0, sin(sw) * d.z + cos(sw) * d.x);
          vec3 p = mix(d, normalize(vec3(swirl.x, d.y, swirl.z)), 0.6) * dist;
          p.y += k * k * uR * 0.8 - k * uR * 0.2;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // particles right in front of the lens would bloom into a screen-wide haze: fade them out
          float near = smoothstep(1.5, 6.0, -mv.z);
          vA = (t > 0.0 ? 1.0 : 0.0) * smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.65, 1.0, k)) * near;
          vHot = 1.0 - k;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(uPx * 14.0, uPx * (2.0 + seed.y * 3.0) * (20.0 / -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vHot;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d) * vA;
          vec3 col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.92, 0.6), vHot) * (1.6 + vHot * 3.0);
          gl_FragColor = vec4(col * a, a);
        }`,
    })
    this.particles = new Points(geo, this.pMat)
    this.particles.frustumCulled = false
    this.group.add(this.particles)
    this.disposables.push(geo, this.pMat, this.coreMat)
  }

  /** show = seconds since the final trigger fired (−1 = dormant) */
  update(show: number, time: number, dt: number) {
    const t = Math.max(0, show)
    const on = show >= 0
    const R = this.R
    // idle breathing even before activation, so the sphere reads as a machine, not a prop
    const idle = 0.08
    const wake = on ? range(t, 0, 1.5) : 0
    for (const [i, r] of this.rings.entries()) {
      const sp = idle + wake * (0.6 + i * 0.35) + (on ? range(t, 4, 7) * (1.2 + i * 0.5) : 0)
      r.rotation.x += dt * sp * (i % 2 ? 1 : -1)
      r.rotation.y += dt * sp * 0.6
    }
    for (const g of this.gears) g.rotateZ(dt * (0.2 + wake * 3) * (g.userData.dir as number))
    const open = on ? range(t, 1.5, 4.2) : 0
    for (const p of this.petals) {
      const a = p.userData.angle as number
      // hinge axis tangent to the bottom ring: tilt the petal outward and down
      p.rotation.set(0, 0, 0)
      p.rotateOnAxis(new Vector3(Math.sin(a), 0, Math.cos(a)), -open * 1.25)
    }
    const ext = on ? range(t, 3.2, 6.2) : 0
    for (const [i, a] of this.arms.entries()) {
      const e = range(ext * 1.15 - i * 0.012, 0, 1)
      a.scale.setScalar(Math.max(0.001, e))
      const tele = a.getObjectByName('tele')!
      tele.position.x = R * (0.4 + e * 0.65)
      const claw = a.getObjectByName('claw')!
      claw.position.x = R * (0.85 + e * 0.7)
      a.rotation.y += dt * 0.15 * wake
    }
    const ignite = on ? range(t, 0.3, 5.5) : 0
    this.coreMat.emissiveIntensity = 0.2 + ignite * 4 + (on ? Math.sin(time * 6) * 0.4 * ignite : 0)
    this.core.scale.setScalar(1 + ignite * 0.12 + Math.sin(time * 3) * 0.015)
    this.light.intensity = ignite * 70
    this.spire.rotation.y += dt * (0.1 + ignite * 2.5)
    this.pMat.uniforms.uT.value = on ? t : -1
  }

  setPixelScale(px: number) {
    this.pMat.uniforms.uPx.value = px
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.group.traverse((o) => { if (o instanceof Mesh && !o.userData.shared) o.geometry.dispose() })
  }
}
