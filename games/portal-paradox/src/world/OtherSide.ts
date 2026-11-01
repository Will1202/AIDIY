import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, CubeCamera, CylinderGeometry, DirectionalLight, FogExp2, Group,
  HalfFloatType, HemisphereLight, IcosahedronGeometry, InstancedMesh, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, OctahedronGeometry, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, TorusGeometry,
  Vector3, WebGLCubeRenderTarget, type Material, type WebGLRenderer,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createMotes } from './effects'
import { patchStandard } from './materials'
import { rng, rockTexture } from './textures'
import { NOISE } from '../render/shaderUtil'
import type { PhysicsWorld } from '../physics/PhysicsWorld'
import type { QualityPreset } from '../engine/Quality'

/** The Other Side lives 3 km from the lab, in the same physics world. */
export const OTHER_ORIGIN = new Vector3(0, 0, 3000)
export const OTHER = {
  /** default anchor of portal Ω, relative to the origin */
  stationB: { pos: new Vector3(0, 0, 9), yaw: Math.PI },
  islandR: 24,
  voidY: -70,
  sunDir: new Vector3(-0.42, 0.16, -0.89).normalize(),
  rimDir: new Vector3(0.72, 0.45, 0.35).normalize(),
}

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSun;
uniform vec3 uRim;
${NOISE}
vec3 stars(vec3 d) {
  vec3 p = d * 360.0;
  vec3 i = floor(p);
  float h = hash13(i);
  vec3 f = fract(p) - 0.5 - (vec3(hash13(i + 1.3), hash13(i + 2.7), hash13(i + 5.1)) - 0.5) * 0.6;
  float s = smoothstep(0.08, 0.0, length(f)) * step(0.985, h);
  return vec3(0.8, 0.85, 1.0) * s * (h - 0.985) * 260.0;
}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  // base gradient: indigo zenith → rose horizon → amber near the sun
  vec3 zen = vec3(0.012, 0.010, 0.04);
  vec3 hor = vec3(0.50, 0.16, 0.28);
  vec3 col = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.45));
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.45, 0.18) * pow(sd, 6.0) * 0.9 + vec3(1.0, 0.7, 0.4) * pow(sd, 40.0) * 1.5;
  // nebula: domain-warped fbm, concentrated along a tilted band
  vec3 q = d * 2.2;
  vec3 w = vec3(fbm3(q + 3.1), fbm3(q + 7.7), fbm3(q + 1.9));
  float n = fbm3(q * 1.6 + w * 1.8);
  float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.85, 0.42))) * 2.6, 2.0));
  float neb = smoothstep(0.42, 0.85, n) * band * smoothstep(-0.1, 0.25, y);
  vec3 nebCol = mix(vec3(0.85, 0.15, 0.55), vec3(0.15, 0.65, 0.85), smoothstep(0.3, 0.8, w.x));
  col += nebCol * neb * 0.9 + vec3(1.0, 0.6, 0.9) * pow(neb, 3.0) * 0.8;
  col += stars(d) * smoothstep(0.02, 0.3, y) * (1.0 - neb * 0.8);

  // giant ringed planet
  vec3 P = normalize(vec3(0.38, 0.42, -0.82));
  float R = 0.2;
  float cp = dot(d, P);
  vec3 e1 = normalize(cross(P, vec3(0.0, 1.0, 0.0)));
  vec3 e2 = cross(e1, P);
  vec3 ringN = normalize(vec3(0.15, 1.0, 0.35));
  float tR = dot(P, ringN) / dot(d, ringN);
  vec3 rp = d * tR - P;
  float rr = length(rp) / sin(R);
  float ringA = 0.0;
  vec3 ringC = vec3(0.0);
  if (tR > 0.0 && rr > 1.25 && rr < 2.4) {
    float bands = 0.5 + 0.5 * sin(rr * 46.0) * sin(rr * 13.0 + 1.0);
    ringA = smoothstep(1.25, 1.35, rr) * smoothstep(2.4, 2.2, rr) * (0.35 + 0.65 * bands) * 0.85;
    ringC = mix(vec3(0.9, 0.62, 0.45), vec3(0.6, 0.5, 0.6), bands) * (0.45 + 0.9 * max(dot(normalize(rp), uSun) * 0.5 + 0.5, 0.0));
  }
  float onDisc = 0.0;
  if (cp > cos(R)) {
    vec3 u = d - P * cp;
    vec2 xy = vec2(dot(u, e1), dot(u, e2)) / sin(R);
    float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
    vec3 nrm = normalize(xy.x * e1 + xy.y * e2 - z * P);
    float lit = max(dot(nrm, uSun), 0.0);
    float rim = pow(1.0 - z, 3.0);
    float stripes = fbm(vec2(xy.y * 9.0, xy.x * 1.5 + xy.y * 2.0));
    vec3 pc = mix(vec3(0.55, 0.32, 0.36), vec3(0.95, 0.72, 0.55), stripes);
    vec3 planet = pc * (0.02 + lit * 1.1) + vec3(1.0, 0.45, 0.35) * rim * 0.8 + vec3(0.2, 0.5, 0.8) * max(dot(nrm, uRim), 0.0) * 0.25;
    // the near half of the rings crosses in front of the disc
    bool ringFront = tR > 0.0 && tR < cp;
    col = mix(col, planet, smoothstep(cos(R), cos(R) + 0.0015, cp));
    onDisc = 1.0;
    if (ringFront) col = mix(col, ringC, ringA);
  }
  if (onDisc < 0.5) col = mix(col, ringC, ringA);

  // suns
  col += vec3(1.0, 0.72, 0.42) * smoothstep(0.99955, 0.99975, sd) * 40.0;
  float rd = max(dot(d, uRim), 0.0);
  col += vec3(0.5, 0.9, 1.0) * (smoothstep(0.99985, 0.99992, rd) * 30.0 + pow(rd, 200.0) * 1.5);

  // endless sea of cloud below the horizon
  if (y < 0.02) {
    float t = -1.0 / min(y, -0.004);
    vec2 cpos = d.xz * t;
    float c = fbm(cpos * 0.9 + vec2(4.0, 1.0)) * 0.7 + fbm(cpos * 3.1) * 0.3;
    float fade = smoothstep(0.02, -0.25, y);
    vec3 cloud = mix(vec3(0.35, 0.12, 0.22), vec3(1.0, 0.58, 0.42), smoothstep(0.35, 0.8, c));
    cloud *= 0.5 + 0.8 * pow(sd, 3.0);
    col = mix(mix(hor, col, 0.4), cloud, smoothstep(0.3, 0.6, c) * 0.85 + 0.15);
    col = mix(col, vec3(0.06, 0.02, 0.05), fade * 0.6 * (1.0 - c));
  }
  gl_FragColor = vec4(col, 1.0);
}
`

export interface OtherWorld {
  scene: Scene
  ambient: Color
  update(t: number, dt: number): void
  setQuality(q: QualityPreset): void
  /** GPU-baked sky + reflections do not survive a lost WebGL context */
  rebake(): void
}

function bakeSky(renderer: WebGLRenderer, size: number) {
  const skyScene = new Scene()
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: OTHER.sunDir }, uRim: { value: OTHER.rimDir } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FRAG,
  })
  skyScene.add(new Mesh(new SphereGeometry(10, 64, 32), mat))
  const rt = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter })
  const cam = new CubeCamera(0.1, 100, rt)
  const prevClip = renderer.clippingPlanes
  renderer.clippingPlanes = []
  cam.update(renderer, skyScene)
  renderer.clippingPlanes = prevClip
  mat.dispose()
  return rt
}

/** Rugged floating island: flat-ish top, noisy rim, long dripping underside. */
function islandGeometry(R: number, depth: number, seed: number, flatR: number) {
  const rnd = rng(seed)
  const seg = 72
  const ringsTop = 8
  const ringsBottom = 18
  const phase = [rnd() * 10, rnd() * 10, rnd() * 10]
  const rim = (a: number) => 1 + 0.12 * Math.sin(a * 3 + phase[0]) + 0.07 * Math.sin(a * 7 + phase[1]) + 0.04 * Math.sin(a * 13 + phase[2])
  const pos: number[] = []
  const col: number[] = []
  const rows = ringsTop + ringsBottom + 1
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2
      let r: number, y: number
      let c: [number, number, number]
      if (i <= ringsTop) {
        const f = i / ringsTop
        r = R * rim(a) * f
        const flat = r < flatR ? 0 : (r - flatR) / Math.max(0.01, R * rim(a) - flatR)
        y = flat > 0 ? Math.sin(flat * Math.PI) * 0.35 * (0.6 + 0.4 * Math.sin(a * 5 + phase[1])) - flat * flat * 0.6 : 0
        c = [0.95, 0.86, 0.74]
      } else {
        const f = (i - ringsTop) / ringsBottom
        const taper = Math.pow(1 - f, 0.85)
        const wob = 0.82 + 0.3 * Math.sin(a * 4 + f * 6 + phase[0]) * Math.sin(a * 9 - f * 3 + phase[2])
        r = R * rim(a) * taper * wob
        y = -0.6 - f * depth * (0.8 + 0.25 * Math.sin(a * 6 + phase[1]))
        const k = 1 - f * 0.55
        c = [k, k * 0.92, k * 0.9]
      }
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r)
      col.push(...c)
    }
  }
  const idx: number[] = []
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function buildOtherSide(renderer: WebGLRenderer, phys: PhysicsWorld, q: QualityPreset): OtherWorld {
  const O = OTHER_ORIGIN
  const scene = new Scene()
  scene.name = 'other-side'
  scene.matrixWorldAutoUpdate = false
  let sky: WebGLCubeRenderTarget | null = null
  let env: ReturnType<PMREMGenerator['fromCubemap']> | null = null
  const bake = () => {
    sky?.dispose()
    env?.dispose()
    sky = bakeSky(renderer, q.shadowMapSize >= 2048 ? 1024 : 512)
    scene.background = sky.texture
    const pmrem = new PMREMGenerator(renderer)
    env = pmrem.fromCubemap(sky.texture)
    pmrem.dispose()
    scene.environment = env.texture
  }
  bake()
  scene.environmentIntensity = 0.75
  scene.fog = new FogExp2(new Color(0.3, 0.14, 0.22), 0.0017)

  const rockTex = rockTexture(1024, 91)
  const rock = patchStandard(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), { tri: { map: rockTex, scale: 1 / 24 } })
  const stone = patchStandard(new MeshStandardMaterial({ color: 0xd9cfc4, roughness: 0.75, metalness: 0 }), { tri: { map: rockTex, scale: 1 / 6 } })
  const darkStone = patchStandard(new MeshStandardMaterial({ color: 0x3d3540, roughness: 0.6, metalness: 0.2 }), { tri: { map: rockTex, scale: 1 / 12 } })
  const obsidian = new MeshStandardMaterial({ color: 0x08070a, roughness: 0.18, metalness: 0.6 })
  const glowMag = new MeshBasicMaterial({ color: new Color(1.0, 0.25, 0.7).multiplyScalar(5) })
  const glowCyan = new MeshBasicMaterial({ color: new Color(0.35, 0.9, 1.0).multiplyScalar(5) })
  const glowWarm = new MeshBasicMaterial({ color: new Color(1.0, 0.6, 0.3).multiplyScalar(6) })
  const glowZig = new MeshBasicMaterial({ color: new Color(0.35, 0.8, 1.0).multiplyScalar(1.6) })

  const root = new Group()
  root.position.copy(O)
  scene.add(root)
  const anim: ((t: number) => void)[] = []

  // ── the portal island ────────────────────────────────────────────────────
  const R = OTHER.islandR
  const main = new Mesh(islandGeometry(R, 46, 3, R * 0.82), rock)
  main.receiveShadow = true
  main.castShadow = true
  root.add(main)
  phys.cylinder(1, R * 0.86, O.x, O.y - 1, O.z)
  // paving around the gate
  const pave: BufferGeometry[] = []
  const pr = rng(12)
  for (let x = -5; x <= 5; x++) {
    for (let z = -9; z <= 6; z++) {
      if (Math.hypot(x * 1.6, z * 1.6) > 15 + pr() * 3) continue
      const g = new BoxGeometry(1.52, 0.16, 1.52)
      g.translate(x * 1.6, 0.02 + pr() * 0.03, z * 1.6 + 2)
      pave.push(g)
    }
  }
  const paveMesh = new Mesh(mergeGeometries(pave), stone)
  paveMesh.receiveShadow = true
  root.add(paveMesh)
  phys.box(null, 9, 0.1, 13, O.x, O.y, O.z + 2)

  // broken colonnade: some columns stand, some hover, some lie fallen
  const colGeo = new CylinderGeometry(0.55, 0.62, 1, 20)
  const cr = rng(44)
  for (let i = 0; i < 9; i++) {
    const a = -0.7 + i * 0.27 * Math.PI * 0.9
    const rr = 14 + cr() * 2
    const x = Math.sin(a) * rr, z = Math.cos(a) * rr * -1 + 1
    const h = 3 + cr() * 7
    const c = new Mesh(colGeo, stone)
    c.scale.set(1, h, 1)
    const hover = cr() < 0.35
    c.position.set(x, h / 2 + (hover ? 1.5 + cr() * 2 : 0), z)
    c.castShadow = c.receiveShadow = true
    root.add(c)
    if (!hover) phys.box(null, 0.5, h / 2, 0.5, O.x + x, O.y + h / 2, O.z + z)
    const cap = new Mesh(new BoxGeometry(1.6, 0.4, 1.6), stone)
    cap.position.set(0, 0.5 + 0.2 / h, 0)
    cap.scale.set(1, 1 / h, 1)
    c.add(cap)
    if (hover) {
      const base = c.position.y
      const ph = cr() * 6
      anim.push((t) => { c.position.y = base + Math.sin(t * 0.5 + ph) * 0.3; c.rotation.y = t * 0.05 + ph })
    }
  }
  // a staircase spiralling off the rim into nowhere
  const stairs = new Group()
  for (let i = 0; i < 26; i++) {
    const a = 2.4 + i * 0.16
    const s = new Mesh(new BoxGeometry(2.6, 0.32, 0.9), stone)
    const rr = R * 0.92 + i * 0.25
    s.position.set(Math.cos(a) * rr, -i * 0.42 + (i > 12 ? (i - 12) * -0.2 : 0), Math.sin(a) * rr)
    s.rotation.y = -a
    s.castShadow = true
    stairs.add(s)
  }
  root.add(stairs)
  // glowing crystal clusters on the rim
  const crystalGeo = new OctahedronGeometry(1, 0)
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.4
    const g = new Group()
    g.position.set(Math.cos(a) * (R - 3), 0, Math.sin(a) * (R - 3))
    for (let k = 0; k < 4; k++) {
      const m = new Mesh(crystalGeo, k % 2 ? glowMag : glowCyan)
      m.scale.set(0.25 + cr() * 0.2, 1 + cr() * 1.8, 0.25 + cr() * 0.2)
      m.position.set((cr() - 0.5) * 1.6, m.scale.y * 0.7, (cr() - 0.5) * 1.6)
      m.rotation.set((cr() - 0.5) * 0.7, cr() * 3, (cr() - 0.5) * 0.7)
      g.add(m)
    }
    root.add(g)
  }

  // ── archipelago ──────────────────────────────────────────────────────────
  const ir = rng(7)
  const islands: { m: Mesh; base: number; ph: number; sp: number }[] = []
  const spots: [number, number, number, number][] = [
    // x, y, z, radius
    [-70, -18, -80, 16], [85, 12, -140, 22], [-160, 40, -260, 42], [210, -30, -320, 55], [-40, 70, -420, 30],
    [40, -60, 120, 26], [-120, -40, 60, 18], [150, 30, 40, 14], [-300, 10, -150, 60], [330, 80, -600, 90],
    [-20, -110, -200, 34], [0, 160, -700, 120],
  ]
  for (const [x, y, z, r] of spots) {
    const m = new Mesh(islandGeometry(r, r * (1.6 + ir()), (ir() * 1000) | 0, r * 0.6), rock)
    m.position.set(x, y, z)
    m.rotation.y = ir() * 6
    m.receiveShadow = true
    root.add(m)
    islands.push({ m, base: y, ph: ir() * 6, sp: 0.1 + ir() * 0.15 })
    // ruins on the bigger ones
    if (r > 20) {
      const n = 2 + ((ir() * 4) | 0)
      for (let k = 0; k < n; k++) {
        const w = r * (0.08 + ir() * 0.12), h = r * (0.3 + ir() * 0.9)
        const ruin = new Mesh(new BoxGeometry(w, h, w * (0.6 + ir())), ir() < 0.5 ? darkStone : stone)
        const a = ir() * 6.28, rr = r * ir() * 0.5
        ruin.position.set(Math.cos(a) * rr, h / 2 - 0.5, Math.sin(a) * rr)
        ruin.rotation.set((ir() - 0.5) * 0.3, ir() * 3, (ir() - 0.5) * 0.3)
        m.add(ruin)
      }
      // an arch
      const arch = new Group()
      const aw = r * 0.35, ah = r * 0.5
      for (const s of [-1, 1]) {
        const p = new Mesh(new BoxGeometry(aw * 0.2, ah, aw * 0.2), stone)
        p.position.set((s * aw) / 2, ah / 2, 0)
        arch.add(p)
      }
      const top = new Mesh(new BoxGeometry(aw * 1.25, aw * 0.2, aw * 0.22), stone)
      top.position.set(0, ah, 0)
      top.rotation.z = (ir() - 0.5) * 0.2
      arch.add(top)
      arch.position.set((ir() - 0.5) * r * 0.5, 0, (ir() - 0.5) * r * 0.5)
      arch.rotation.y = ir() * 3
      m.add(arch)
    }
  }
  anim.push((t) => {
    for (const i of islands) i.m.position.y = i.base + Math.sin(t * i.sp + i.ph) * (1.5 + i.base * 0.0)
  })

  // drifting boulders around the portal island
  const boulders = new InstancedMesh(new IcosahedronGeometry(1, 0), rock, 28)
  boulders.castShadow = true
  const bo = new Object3D()
  const bdat = Array.from({ length: 28 }, () => ({ a: ir() * 6.28, r: 42 + ir() * 80, y: -35 + ir() * 60, s: 0.8 + ir() * 3.2, sx: 0.6 + ir() * 0.8, sz: 0.5 + ir() * 0.9, sp: (ir() - 0.5) * 0.04, rot: ir() * 6 }))
  root.add(boulders)
  anim.push((t) => {
    bdat.forEach((d, i) => {
      const a = d.a + t * d.sp
      bo.position.set(Math.cos(a) * d.r, d.y + Math.sin(t * 0.3 + d.rot) * 1.2, Math.sin(a) * d.r)
      bo.rotation.set(t * 0.1 + d.rot, t * 0.07, d.rot)
      bo.scale.set(d.s * d.sx, d.s, d.s * d.sz)
      bo.updateMatrix()
      boulders.setMatrixAt(i, bo.matrix)
    })
    boulders.instanceMatrix.needsUpdate = true
  })

  // ── colossal geometry ────────────────────────────────────────────────────
  // the Halo: a 520 m ring slowly turning in the distance
  const halo = new Group()
  halo.position.set(-60, 110, -640)
  halo.rotation.set(1.15, 0.2, 0.35)
  const haloRing = new Mesh(new TorusGeometry(260, 9, 16, 220), obsidian)
  const haloGlow = new Mesh(new TorusGeometry(249.5, 0.9, 6, 220), glowWarm)
  halo.add(haloRing, haloGlow)
  for (let i = 0; i < 24; i++) {
    const seg = new Mesh(new BoxGeometry(14, 30, 26), darkStone)
    const a = (i / 24) * Math.PI * 2
    seg.position.set(Math.cos(a) * 260, Math.sin(a) * 260, 0)
    seg.rotation.z = a
    halo.add(seg)
  }
  root.add(halo)
  anim.push((t) => { halo.rotation.z = 0.35 + t * 0.012 })

  // the inverted ziggurat hanging overhead
  const zig = new Group()
  zig.position.set(240, 310, -430)
  for (let i = 0; i < 9; i++) {
    const w = 170 - i * 18
    const layer = new Mesh(new BoxGeometry(w, 13, w), darkStone)
    layer.position.y = -i * 13
    zig.add(layer)
    if (i % 2 === 0) {
      const strip = new Mesh(new BoxGeometry(w + 0.4, 0.6, w + 0.4), glowZig)
      strip.position.y = -i * 13 - 6.6
      zig.add(strip)
    }
  }
  const spire = new Mesh(new CylinderGeometry(0, 6, 60, 4), obsidian)
  spire.position.y = -9 * 13 - 25
  spire.rotation.x = Math.PI
  zig.add(spire)
  root.add(zig)
  anim.push((t) => { zig.rotation.y = t * 0.006 })

  // orbiting monoliths
  const monos = new Group()
  monos.position.set(-210, 30, -300)
  for (let i = 0; i < 7; i++) {
    const m = new Mesh(new BoxGeometry(8, 46, 3), obsidian)
    const a = (i / 7) * Math.PI * 2
    m.position.set(Math.cos(a) * 95, Math.sin(i * 1.7) * 20, Math.sin(a) * 95)
    m.rotation.set(0.2 * Math.sin(i), -a, 0.15 * Math.cos(i * 2))
    const seam = new Mesh(new BoxGeometry(8.2, 0.5, 3.2), glowMag)
    seam.position.y = 10 - i * 3
    m.add(seam)
    monos.add(m)
  }
  root.add(monos)
  anim.push((t) => { monos.rotation.y = t * 0.02 })

  // floating cube shards forming an impossible staircase in the sky
  const shardGeo = new BoxGeometry(1, 1, 1)
  const shard = new InstancedMesh(shardGeo, stone, 60)
  const so = new Object3D()
  root.add(shard)
  anim.push((t) => {
    for (let i = 0; i < 60; i++) {
      const f = i / 60
      const a = f * Math.PI * 3 + t * 0.01
      so.position.set(60 + Math.cos(a) * (40 + f * 30), 20 + f * 90 + Math.sin(t * 0.2 + i) * 0.6, -120 + Math.sin(a) * (40 + f * 30))
      so.rotation.set(0, -a, 0)
      so.scale.set(9, 1.6, 4)
      so.updateMatrix()
      shard.setMatrixAt(i, so.matrix)
    }
    shard.instanceMatrix.needsUpdate = true
  })

  // ── light ────────────────────────────────────────────────────────────────
  const hemi = new HemisphereLight(new Color(0.55, 0.32, 0.62), new Color(0.3, 0.12, 0.1), 0.55)
  scene.add(hemi)
  const sun = new DirectionalLight(new Color(1.0, 0.68, 0.42), 5.2)
  sun.position.copy(O).addScaledVector(OTHER.sunDir, 120)
  sun.target.position.copy(O)
  sun.castShadow = true
  const sc = sun.shadow.camera
  sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 40; sc.far = 220
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
  sun.shadow.bias = -0.0005
  sun.shadow.radius = 3
  sun.shadow.normalBias = 0.04
  scene.add(sun, sun.target)
  const rim = new DirectionalLight(new Color(0.45, 0.82, 1.0), 2.5)
  rim.position.copy(O).addScaledVector(OTHER.rimDir, 100)
  rim.target.position.copy(O)
  scene.add(rim, rim.target)

  const motes = createMotes({
    count: q.moteCount, box: [new Vector3(O.x - 60, O.y - 25, O.z - 60), new Vector3(O.x + 60, O.y + 35, O.z + 60)],
    color: new Color(1.0, 0.62, 0.4), size: 0.06, seed: 9, rise: 0.25, ambient: 1.2,
  })
  scene.add(motes)

  const timeMats: Material[] = [motes.material as Material]
  for (const o of [root]) o.updateMatrixWorld(true)
  return {
    scene,
    ambient: new Color(1.0, 0.55, 0.5),
    update(t) {
      for (const f of anim) f(t)
      for (const m of timeMats) (m as ShaderMaterial).uniforms.uTime.value = t
    },
    rebake: bake,
    setQuality(nq) {
      sun.shadow.mapSize.set(nq.shadowMapSize, nq.shadowMapSize)
      if (sun.shadow.map) {
        sun.shadow.map.dispose()
        sun.shadow.map = null
      }
      motes.geometry.setDrawRange(0, Math.min(nq.moteCount, motes.geometry.attributes.position.count))
    },
  }
}
