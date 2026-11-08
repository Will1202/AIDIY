import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Object3D, ShaderMaterial } from 'three'
import { NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import { Noise2D } from '../util/noise'
import { Rng } from '../util/rng'
import type { Heightfield } from './Heightfield'
import type { RiverSpec } from './RiverGenerator'

/** river-bank rocks and reeds: two instanced meshes shared by every river */

const ROCK_VERT = /* glsl */ `
${WORLD_UNIFORMS}
attribute float aBirth;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
void main() {
  float k = smoothstep(aBirth, aBirth + 0.9, uTime);
  vec3 p = position * k;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(p, 1.0);
  vN = normalize(mat3(m) * normal);
  vW = wp.xyz;
  vL = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const ROCK_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
void main() {
  vec3 n = normalize(vN);
  float ndl = dot(n, normalize(uSunDir));
  float shade = 1.0 - clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  float jit = vnoise(vL.xz * 3.0 + vL.y * 2.0) * 0.2;
  float tone = 0.12 + 0.3 * smoothstep(0.3, 0.6, shade + jit) + 0.35 * smoothstep(0.62, 0.85, shade + jit);
  // dark crown, pale foot
  tone += smoothstep(0.2, 0.9, vL.y) * 0.12;
  tone *= 0.6 + 0.4 * smoothstep(-0.4, 0.3, vL.y);
  vec3 col = mix(uPaper, uInk, clamp(tone, 0.0, 1.0));
  col += uLightTint * clamp(ndl, 0.0, 1.0) * uNight * 0.05;
  gl_FragColor = vec4(col, 1.0);
}
`

const REED_VERT = /* glsl */ `
${WORLD_UNIFORMS}
attribute float aBirth;
attribute float aT;
varying float vT;
varying vec3 vW;
void main() {
  float k = smoothstep(aBirth, aBirth + 1.2, uTime);
  vec3 p = position;
  p.y *= k;
  vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ph = base.x * 0.31 + base.z * 0.17;
  float sway = (sin(uTime * (1.6 + uWind * 2.5) + ph) * 0.5 + 0.5) * (0.15 + uWind * 0.6);
  p.x += sway * aT * aT;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vT = aT;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const REED_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
varying float vT;
varying vec3 vW;
void main() {
  float tone = mix(0.75, 0.35, vT);
  vec3 col = mix(uPaper, uInk, tone);
  gl_FragColor = vec4(col, 1.0);
}
`

function rockGeometry() {
  const g = new IcosahedronGeometry(1, 2)
  const nz = new Noise2D(5)
  const p = g.attributes.position as BufferAttribute
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i)
    let y = p.getY(i)
    let z = p.getZ(i)
    const d = 1 + nz.noise(x * 1.7 + 3, z * 1.7 + y * 1.3) * 0.22 + nz.noise(x * 4, y * 4 + z) * 0.06
    x *= d
    y *= d
    z *= d
    if (y < -0.25) y = -0.25 + (y + 0.25) * 0.2
    p.setXYZ(i, x, y * 0.8, z)
  }
  g.computeVertexNormals()
  return g
}

function reedGeometry() {
  const pos: number[] = []
  const t: number[] = []
  const idx: number[] = []
  const rng = new Rng(9)
  for (let b = 0; b < 6; b++) {
    const a = rng.range(0, Math.PI * 2)
    const lean = rng.range(0.1, 0.45)
    const hgt = rng.range(0.9, 1.7)
    const w = 0.045
    const base = pos.length / 3
    const segs = 4
    for (let s = 0; s <= segs; s++) {
      const u = s / segs
      const bend = lean * u * u
      const cx = Math.cos(a) * bend
      const cz = Math.sin(a) * bend
      const ww = w * (1 - u * 0.85)
      pos.push(cx - Math.sin(a) * ww, u * hgt, cz + Math.cos(a) * ww, cx + Math.sin(a) * ww, u * hgt, cz - Math.cos(a) * ww)
      t.push(u, u)
    }
    for (let s = 0; s < segs; s++) {
      const i = base + s * 2
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('aT', new BufferAttribute(new Float32Array(t), 1))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

export class Decor {
  readonly rocks: InstancedMesh
  readonly reeds: InstancedMesh
  private rockBirth: InstancedBufferAttribute
  private reedBirth: InstancedBufferAttribute
  private dummy = new Object3D()
  private m = new Matrix4()

  constructor(private max = { rocks: 360, reeds: 720 }) {
    const rg = rockGeometry()
    this.rockBirth = new InstancedBufferAttribute(new Float32Array(max.rocks), 1).setUsage(DynamicDrawUsage)
    rg.setAttribute('aBirth', this.rockBirth)
    this.rocks = new InstancedMesh(rg, new ShaderMaterial({ vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG, uniforms: { ...U } }), max.rocks)
    this.rocks.count = 0
    this.rocks.frustumCulled = false
    const dg = reedGeometry()
    this.reedBirth = new InstancedBufferAttribute(new Float32Array(max.reeds), 1).setUsage(DynamicDrawUsage)
    dg.setAttribute('aBirth', this.reedBirth)
    this.reeds = new InstancedMesh(dg, new ShaderMaterial({ vertexShader: REED_VERT, fragmentShader: REED_FRAG, uniforms: { ...U }, side: DoubleSide }), max.reeds)
    this.reeds.count = 0
    this.reeds.frustumCulled = false
  }

  /** scatter rocks and reeds along both banks of a finished river */
  decorateRiver(spec: RiverSpec, hf: Heightfield, seed: number, now: number) {
    const rng = new Rng(seed)
    const { path, widths, arcs } = spec
    let nextS = rng.range(1, 4)
    for (let i = 1; i < path.length - 1; i++) {
      if (arcs[i] < nextS) continue
      nextS = arcs[i] + rng.range(2.5, 5)
      const a = path[i - 1]
      const b = path[i + 1]
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const nx = -(b.z - a.z) / l
      const nz = (b.x - a.x) / l
      for (const side of [-1, 1]) {
        const birth = now + 0.2 + (arcs[i] / spec.length) * 1.5 + rng.range(0, 0.3)
        if (rng.next() < 0.42 && this.rocks.count < this.max.rocks) {
          const d = widths[i] + rng.range(-0.2, 2.4)
          const x = path[i].x + nx * side * d
          const z = path[i].z + nz * side * d
          const s = rng.range(0.35, 1.25)
          this.dummy.position.set(x, hf.sample(x, z) - 0.1 * s, z)
          this.dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2))
          this.dummy.scale.set(s * rng.range(0.8, 1.5), s * rng.range(0.6, 1.2), s * rng.range(0.8, 1.3))
          this.dummy.updateMatrix()
          this.rocks.setMatrixAt(this.rocks.count, this.dummy.matrix)
          this.rockBirth.setX(this.rocks.count, birth)
          this.rocks.count++
        }
        if (rng.next() < 0.7 && this.reeds.count < this.max.reeds) {
          const d = widths[i] + rng.range(0.1, 1.8)
          const x = path[i].x + nx * side * d
          const z = path[i].z + nz * side * d
          const hy = hf.sample(x, z)
          if (hy > 3) continue
          const s = rng.range(0.7, 1.4)
          this.dummy.position.set(x, hy - 0.05, z)
          this.dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0)
          this.dummy.scale.set(s, s * rng.range(0.8, 1.3), s)
          this.dummy.updateMatrix()
          this.reeds.setMatrixAt(this.reeds.count, this.dummy.matrix)
          this.reedBirth.setX(this.reeds.count, birth + 0.3)
          this.reeds.count++
        }
      }
    }
    this.rocks.instanceMatrix.needsUpdate = true
    this.reeds.instanceMatrix.needsUpdate = true
    this.rockBirth.needsUpdate = true
    this.reedBirth.needsUpdate = true
    void this.m
  }

  reset() {
    this.rocks.count = 0
    this.reeds.count = 0
  }

  dispose() {
    this.rocks.geometry.dispose()
    this.reeds.geometry.dispose()
    ;(this.rocks.material as ShaderMaterial).dispose()
    ;(this.reeds.material as ShaderMaterial).dispose()
  }
}
