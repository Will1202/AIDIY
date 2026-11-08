import { BufferAttribute, BufferGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, ShaderMaterial, Vector3 } from 'three'
import { NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import { clamp } from '../util/math'
import { Rng } from '../util/rng'

/**
 * LIFE BRUSH → procedural pines (松). Every tree is grown from its seed: a bent trunk,
 * near-horizontal limbs that turn up at the tips, and flat layered needle pads — the
 * classic ink-painting pine. Each vertex carries a birth time and an anchor so the
 * whole tree can grow in the vertex shader: trunk first, then limbs, then needles.
 */

type Style = 'tall' | 'leaning' | 'twisted' | 'broad'
const STYLES: Style[] = ['tall', 'leaning', 'twisted', 'broad']

interface Builder {
  pos: number[]
  anchor: number[]
  birth: number[]
  sway: number[]
  idx: number[]
}

function tube(b: Builder, spine: Vector3[], radii: number[], births: number[], anchor0: Vector3, sides: number) {
  const n = spine.length
  // parallel-transport frame
  const T: Vector3[] = []
  for (let i = 0; i < n; i++) {
    const a = spine[Math.max(0, i - 1)]
    const c = spine[Math.min(n - 1, i + 1)]
    T.push(c.clone().sub(a).normalize())
  }
  let N = new Vector3(1, 0, 0)
  if (Math.abs(T[0].dot(N)) > 0.9) N = new Vector3(0, 0, 1)
  N = N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize()
  const base = b.pos.length / 3
  const H = spine[n - 1].y || 1
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = T[i - 1].clone().cross(T[i])
      const s = axis.length()
      if (s > 1e-5) {
        const ang = Math.asin(clamp(s, -1, 1))
        N.applyAxisAngle(axis.normalize(), ang)
      }
    }
    const B = T[i].clone().cross(N).normalize()
    const anc = i === 0 ? anchor0 : spine[i - 1]
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2
      const r = radii[i]
      const px = spine[i].x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r
      const py = spine[i].y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r
      const pz = spine[i].z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r
      b.pos.push(px, py, pz)
      b.anchor.push(anc.x, anc.y, anc.z)
      b.birth.push(births[i])
      b.sway.push(clamp(spine[i].y / H, 0, 1.5))
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = base + i * sides + k
      const bb = base + i * sides + ((k + 1) % sides)
      const c = a + sides
      const d = bb + sides
      b.idx.push(a, c, bb, bb, c, d)
    }
  }
}

export interface PineGeometry {
  wood: BufferGeometry
  pads: BufferGeometry
  height: number
  trunkRadius: number
  style: Style
}

export function buildPine(seed: number, sides: number, padDetail: number): PineGeometry {
  const rng = new Rng(seed)
  const style = rng.pick(STYLES)
  const H = style === 'broad' ? rng.range(5.5, 8) : style === 'tall' ? rng.range(9, 13) : rng.range(7, 11)
  const r0 = H * rng.range(0.04, 0.055)
  const wood: Builder = { pos: [], anchor: [], birth: [], sway: [], idx: [] }
  const pads: { c: Vector3; r: number; birth: number; flat: number; tilt: number; ink: number }[] = []

  // trunk spine
  const segs = 11
  const leanDir = rng.range(0, Math.PI * 2)
  const leanAmt = style === 'leaning' ? rng.range(0.35, 0.55) : style === 'twisted' ? rng.range(0.15, 0.3) : rng.range(0.03, 0.12)
  const spine: Vector3[] = []
  const radii: number[] = []
  const births: number[] = []
  for (let i = 0; i <= segs; i++) {
    const u = i / segs
    let ox = Math.cos(leanDir) * leanAmt * H * u * u
    let oz = Math.sin(leanDir) * leanAmt * H * u * u
    if (style === 'twisted') {
      ox += Math.sin(u * 7 + seed) * 0.5 * u
      oz += Math.cos(u * 6 + seed * 0.3) * 0.5 * u
    } else {
      ox += Math.sin(u * 9 + seed) * 0.15 * u
      oz += Math.cos(u * 8 + seed) * 0.15 * u
    }
    spine.push(new Vector3(ox, u * H * (style === 'leaning' ? 0.9 : 1), oz))
    radii.push(r0 * (1 - u * 0.82) * (i === 0 ? 1.35 : 1))
    births.push(u * 0.5)
  }
  tube(wood, spine, radii, births, spine[0], sides)

  // limbs from the upper trunk
  const limbCount = style === 'broad' ? rng.int(5, 8) : rng.int(4, 7)
  for (let l = 0; l < limbCount; l++) {
    const u = rng.range(style === 'broad' ? 0.35 : 0.45, 0.94)
    const k = Math.min(segs - 1, Math.floor(u * segs))
    const f = u * segs - k
    const at = spine[k].clone().lerp(spine[k + 1], f)
    let ang = rng.range(0, Math.PI * 2)
    // the "welcoming" long limb of a leaning pine reaches away from the lean
    let len = rng.range(1.6, 3.6) * (1 - u * 0.4) * (style === 'broad' ? 1.4 : 1)
    if (style === 'leaning' && l === 0) {
      ang = leanDir + Math.PI + rng.range(-0.4, 0.4)
      len *= 1.8
    }
    const dx = Math.cos(ang)
    const dz = Math.sin(ang)
    const drop = rng.range(-0.25, 0.1)
    const ls: Vector3[] = []
    const lr: number[] = []
    const lb: number[] = []
    const ln = 5
    const birth0 = 0.35 + u * 0.3
    for (let i = 0; i <= ln; i++) {
      const t = i / ln
      ls.push(new Vector3(at.x + dx * len * t, at.y + (drop * t + t * t * 0.45) * len * 0.5, at.z + dz * len * t))
      lr.push(r0 * 0.38 * (1 - u * 0.5) * (1 - t * 0.75))
      lb.push(birth0 + t * 0.2)
    }
    tube(wood, ls, lr, lb, at, Math.max(4, sides - 2))
    const tip = ls[ln]
    const pr = rng.range(1.2, 2.2) * (style === 'broad' ? 1.25 : 1) * (1 - u * 0.25)
    pads.push({ c: tip.clone().add(new Vector3(0, 0.25, 0)), r: pr, birth: birth0 + 0.25, flat: rng.range(0.28, 0.4), tilt: rng.range(-0.15, 0.15), ink: rng.range(0.7, 1) })
    // a second, smaller pad halfway along long limbs
    if (len > 2.4) {
      const mid = ls[3]
      pads.push({ c: mid.clone().add(new Vector3(0, 0.3, 0)), r: pr * 0.7, birth: birth0 + 0.2, flat: 0.36, tilt: rng.range(-0.2, 0.2), ink: rng.range(0.55, 0.9) })
    }
  }
  // crown
  const top = spine[segs]
  pads.push({ c: top.clone().add(new Vector3(0, 0.2, 0)), r: rng.range(1.3, 2.0) * (style === 'tall' ? 0.9 : 1.1), birth: 0.62, flat: 0.42, tilt: 0, ink: rng.range(0.85, 1) })
  pads.push({ c: spine[segs - 2].clone().add(new Vector3(rng.range(-0.6, 0.6), 0.1, rng.range(-0.6, 0.6))), r: rng.range(1.2, 1.8), birth: 0.58, flat: 0.38, tilt: rng.range(-0.1, 0.1), ink: rng.range(0.6, 0.95) })

  const wg = new BufferGeometry()
  wg.setAttribute('position', new BufferAttribute(new Float32Array(wood.pos), 3))
  wg.setAttribute('aAnchor', new BufferAttribute(new Float32Array(wood.anchor), 3))
  wg.setAttribute('aBirth', new BufferAttribute(new Float32Array(wood.birth), 1))
  wg.setAttribute('aSway', new BufferAttribute(new Float32Array(wood.sway), 1))
  wg.setIndex(wood.idx)
  wg.computeVertexNormals()
  wg.computeBoundingSphere()

  // needle pads: flattened, noisy ellipsoids, alpha-cut into needle fans in the shader
  const ico = new IcosahedronGeometry(1, padDetail)
  const ip = ico.attributes.position as BufferAttribute
  const pp: number[] = []
  const pc: number[] = []
  const pl: number[] = []
  const pb: number[] = []
  const pi: number[] = []
  const pw: number[] = []
  // each pad is a cloud of 3–4 overlapping flattened lobes, so no clump reads as a disc
  let lobeCount = 0
  for (const pad of pads) {
    const lobes = rng.int(3, 4)
    for (let L = 0; L < lobes; L++) {
      const a = rng.range(0, Math.PI * 2)
      const off = L === 0 ? 0 : pad.r * rng.range(0.38, 0.6)
      const cx = pad.c.x + Math.cos(a) * off
      const cy = pad.c.y + (L === 0 ? 0.05 : rng.range(-0.12, 0.18)) * pad.r
      const cz = pad.c.z + Math.sin(a) * off
      const lr = pad.r * (L === 0 ? 0.78 : rng.range(0.5, 0.68))
      const fl = pad.flat * rng.range(0.9, 1.25)
      const ink = pad.ink * rng.range(0.85, 1.1)
      for (let i = 0; i < ip.count; i++) {
        const x = ip.getX(i)
        const y = ip.getY(i)
        const z = ip.getZ(i)
        pp.push(cx + x * lr, cy + y * lr * fl + x * pad.tilt * lr, cz + z * lr * 0.9)
        pc.push(cx, cy, cz)
        pl.push(x, y, z)
        pb.push(pad.birth + L * 0.03)
        pi.push(ink)
        pw.push(clamp(cy / H, 0, 1.5))
      }
      lobeCount++
    }
  }
  const nI = ico.index ? ico.index.count : ip.count
  const idx: number[] = []
  for (let p = 0; p < lobeCount; p++) {
    for (let i = 0; i < nI; i++) idx.push(p * ip.count + (ico.index ? ico.index.getX(i) : i))
  }
  ico.dispose()
  const pg = new BufferGeometry()
  pg.setAttribute('position', new BufferAttribute(new Float32Array(pp), 3))
  pg.setAttribute('aCenter', new BufferAttribute(new Float32Array(pc), 3))
  pg.setAttribute('aLocal', new BufferAttribute(new Float32Array(pl), 3))
  pg.setAttribute('aBirth', new BufferAttribute(new Float32Array(pb), 1))
  pg.setAttribute('aInk', new BufferAttribute(new Float32Array(pi), 1))
  pg.setAttribute('aSway', new BufferAttribute(new Float32Array(pw), 1))
  pg.setIndex(idx)
  pg.computeVertexNormals()
  pg.computeBoundingSphere()
  return { wood: wg, pads: pg, height: H, trunkRadius: r0, style }
}

const SWAY = /* glsl */ `
vec3 windSway(vec3 p, float sway, float seed) {
  float amp = (0.05 + uWind * 0.55) * pow(sway, 1.6);
  float t = uTime * (1.1 + uWind * 1.6) + seed;
  float gust = sin(t * 0.37) * 0.5 + 0.5;
  p.x += (sin(t) * 0.6 + sin(t * 2.3 + p.y) * 0.25 + gust * uWind * 0.8) * amp;
  p.z += (cos(t * 0.8) * 0.4) * amp * 0.6;
  return p;
}
`

const WOOD_VERT = /* glsl */ `
${WORLD_UNIFORMS}
uniform float uGrow;
uniform float uSeed;
attribute vec3 aAnchor;
attribute float aBirth;
attribute float aSway;
varying vec3 vN;
varying vec3 vLocal;
${SWAY}
void main() {
  float k = smoothstep(aBirth, aBirth + 0.12, uGrow);
  vec3 p = aAnchor + (position - aAnchor) * k;
  p = windSway(p, aSway, uSeed);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const WOOD_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
uniform float uInkAmt;
varying vec3 vN;
varying vec3 vLocal;
void main() {
  vec3 n = normalize(vN);
  float ndl = dot(n, normalize(uSunDir));
  float shade = 1.0 - clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  // bark: dry-brush streaks along the trunk, scaly dark patches (鳞皴)
  float streak = vnoise(vec2(atan(n.z, n.x) * 3.0, vLocal.y * 0.6));
  float scales = smoothstep(0.55, 0.8, vnoise(vLocal.xz * 6.0 + vLocal.y * 3.0));
  float tone = 0.45 + 0.4 * smoothstep(0.35, 0.75, shade + (streak - 0.5) * 0.4) + scales * 0.15;
  tone *= uInkAmt;
  vec3 col = mix(uPaper, uInk, clamp(tone, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`

const PAD_VERT = /* glsl */ `
${WORLD_UNIFORMS}
uniform float uGrow;
uniform float uSeed;
attribute vec3 aCenter;
attribute vec3 aLocal;
attribute float aBirth;
attribute float aInk;
attribute float aSway;
varying vec3 vLocal;
varying vec3 vN;
varying float vInk;
varying vec3 vW;
${SWAY}
void main() {
  float k = smoothstep(aBirth, aBirth + 0.28, uGrow);
  k = k * k * (3.0 - 2.0 * k);
  vec3 p = aCenter + (position - aCenter) * k;
  p = windSway(p, aSway * 1.15, uSeed);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vLocal = aLocal;
  vN = normalize(mat3(modelMatrix) * normal);
  vInk = aInk;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const PAD_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
uniform float uInkAmt;
uniform float uSeed;
varying vec3 vLocal;
varying vec3 vN;
varying float vInk;
varying vec3 vW;
void main() {
  // dense needle mass with a tufted, spiky rim (松针): the silhouette is the lobe's equator
  float r = length(vLocal.xz);
  float ang = atan(vLocal.z, vLocal.x);
  float tuft = vnoise(vec2(ang * 6.0 + uSeed, vLocal.y * 2.0)) * 0.6 + vnoise(vec2(ang * 17.0 + uSeed * 2.0, 1.5)) * 0.4;
  float needle = vnoise(vec2(ang * 46.0 + uSeed * 5.0, r * 2.0));
  float rimLimit = 0.7 + 0.26 * tuft;
  if (r > rimLimit && needle < 0.55 + (r - rimLimit) * 2.5) discard;
  vec3 n = normalize(vN);
  float top = smoothstep(-0.1, 0.9, vLocal.y);
  float lit = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
  float lines = smoothstep(0.55, 0.8, vnoise(vec2(ang * 30.0 + uSeed, r * 6.0)));
  float tone = (0.66 + 0.26 * (1.0 - lit) - 0.22 * top) * vInk * uInkAmt;
  tone += lines * 0.12 - (1.0 - smoothstep(0.0, 0.35, r)) * top * 0.08;
  float needles = 1.0;
  vec3 col = mix(uPaper, uInk * vec3(0.95, 1.02, 0.97), clamp(tone, 0.0, 1.0));
  // a breath of 石绿 on the lit tops
  col = mix(col, col * vec3(0.92, 1.04, 0.98), top * lit * 0.5 * (1.0 - uNight));
  gl_FragColor = vec4(col, 1.0);
}
`

export class PineEntity {
  readonly group = new Group()
  readonly wood: Mesh
  readonly pads: Mesh
  readonly height: number
  readonly trunkRadius: number
  t = 0
  done = false
  private woodMat: ShaderMaterial
  private padMat: ShaderMaterial

  constructor(
    readonly x: number,
    readonly z: number,
    seed: number,
    sides: number,
    padDetail: number,
    /** delay before growth starts (ink drop blooms first) */
    readonly delay = 0.55,
  ) {
    const g = buildPine(seed, sides, padDetail)
    this.height = g.height
    this.trunkRadius = g.trunkRadius
    const ink = 0.8 + ((seed >>> 3) % 100) / 500
    const shared = { uGrow: { value: 0 }, uSeed: { value: (seed % 1000) * 0.137 }, uInkAmt: { value: ink } }
    this.woodMat = new ShaderMaterial({ vertexShader: WOOD_VERT, fragmentShader: WOOD_FRAG, uniforms: { ...U, ...shared } })
    this.padMat = new ShaderMaterial({ vertexShader: PAD_VERT, fragmentShader: PAD_FRAG, uniforms: { ...U, ...shared }, side: DoubleSide })
    this.wood = new Mesh(g.wood, this.woodMat)
    this.pads = new Mesh(g.pads, this.padMat)
    this.wood.frustumCulled = this.pads.frustumCulled = true
    this.group.add(this.wood, this.pads)
    this.group.rotation.y = ((seed >>> 5) % 628) / 100
    this.group.name = 'pine'
  }

  update(dt: number) {
    if (this.done) return
    this.t += dt
    const g = clamp((this.t - this.delay) / 3.0)
    this.woodMat.uniforms.uGrow.value = g < 1 ? (1 - Math.pow(1 - g, 2.2)) * 1.22 : 1.4
    if (g >= 1) this.done = true
  }

  dispose() {
    this.wood.geometry.dispose()
    this.pads.geometry.dispose()
    this.woodMat.dispose()
    this.padMat.dispose()
  }
}
