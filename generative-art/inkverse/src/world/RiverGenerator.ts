import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, ShaderMaterial, type Texture } from 'three'
import { CELL, GRID, HALF, WATER_LEVEL, WORLD } from '../core/constants'
import { NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import { clamp, smoothstep } from '../util/math'
import { noise } from '../util/noise'
import { arcLengths, pathLength, resample, smooth, smoothAttr, type P2, type StrokePoint } from '../util/path'
import type { Patch } from './Heightfield'

/**
 * RIVER BRUSH → a channel carved along the stroke (gorge walls where it cuts through
 * mountains) and a flowing water ribbon that follows the exact drawn path downstream.
 */

export interface RiverSpec {
  path: P2[]
  widths: Float32Array
  arcs: Float32Array
  length: number
}

export function buildRiver(raw: StrokePoint[]): { patch: Patch; spec: RiverSpec } | null {
  let path = smooth(resample(raw, 1.0), 3, 3)
  if (path.length < 4 || pathLength(path) < 8) return null
  smoothAttr(path, 'w', 6)
  smoothAttr(path, 'p', 6)
  path = path.map((p) => ({ ...p }))
  const arcs = arcLengths(path)
  const L = arcs[arcs.length - 1]
  const widths = new Float32Array(path.length)
  for (let i = 0; i < path.length; i++) {
    const s = arcs[i]
    const base = clamp(1.4 + path[i].w * 1.05 + path[i].p * 0.8, 1.8, 5.6) * (1 + 0.28 * (s / L))
    // narrow source and mouth so the river emerges from and vanishes into the paper
    const taper = 0.45 + 0.55 * smoothstep(0, 7, Math.min(s, L - s))
    widths[i] = base * taper
  }
  let wMax = 0
  for (const w of widths) wMax = Math.max(wMax, w)
  const pad = wMax + 28

  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const p of path) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.z)
    z1 = Math.max(z1, p.z)
  }
  const i0 = Math.max(0, Math.floor((x0 - pad + HALF) / CELL))
  const i1 = Math.min(GRID - 1, Math.ceil((x1 + pad + HALF) / CELL))
  const j0 = Math.max(0, Math.floor((z0 - pad + HALF) / CELL))
  const j1 = Math.min(GRID - 1, Math.ceil((z1 + pad + HALF) / CELL))
  const w = i1 - i0 + 1
  const h = j1 - j0 + 1
  const n = w * h
  const dist = new Float32Array(n).fill(Infinity)
  const segI = new Int32Array(n)
  const frac = new Float32Array(n)
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]
    const b = path[k + 1]
    const ci0 = Math.max(i0, Math.floor((Math.min(a.x, b.x) - pad + HALF) / CELL))
    const ci1 = Math.min(i1, Math.floor((Math.max(a.x, b.x) + pad + HALF) / CELL))
    const cj0 = Math.max(j0, Math.floor((Math.min(a.z, b.z) - pad + HALF) / CELL))
    const cj1 = Math.min(j1, Math.floor((Math.max(a.z, b.z) + pad + HALF) / CELL))
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz || 1e-6
    for (let j = cj0; j <= cj1; j++) {
      const z = -HALF + (j + 0.5) * CELL
      for (let i = ci0; i <= ci1; i++) {
        const x = -HALF + (i + 0.5) * CELL
        let f = ((x - a.x) * dx + (z - a.z) * dz) / l2
        f = f < 0 ? 0 : f > 1 ? 1 : f
        const px = a.x + dx * f - x
        const pz = a.z + dz * f - z
        const d = Math.sqrt(px * px + pz * pz)
        const l = (j - j0) * w + (i - i0)
        if (d < dist[l]) {
          dist[l] = d
          segI[l] = k
          frac[l] = f
        }
      }
    }
  }
  const base = new Float32Array(n).fill(Infinity)
  const detail = new Float32Array(n)
  const mask = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = y * w + x
      const d = dist[l]
      if (!(d < pad)) continue
      const k = segI[l]
      const f = frac[l]
      const wr = widths[k] + (widths[Math.min(k + 1, path.length - 1)] - widths[k]) * f
      const s = arcs[k] + (arcs[Math.min(k + 1, path.length - 1)] - arcs[k]) * f
      const cx = -HALF + (i0 + x + 0.5) * CELL
      const cz = -HALF + (j0 + y + 0.5) * CELL
      const bed = 1.0 + 0.24 * wr
      const bank = WATER_LEVEL + 0.12
      let surf: number
      if (d < wr) surf = bank - (bed + 0.12) * (1 - (d / wr) ** 2)
      else {
        // gorge walls: steep, a little irregular
        const slope = 1.45 + 0.55 * noise.noise(cx * 0.06, cz * 0.06)
        surf = bank + (d - wr) * slope
      }
      base[l] = surf
      detail[l] = s / L
      mask[l] = 1 - smoothstep(wr * 0.9, wr * 1.12, d)
    }
  }
  return {
    patch: { i0, j0, w, h, base, detail, mask, pale: 0, grow: 0, detailGrow: 0, kind: 'river' },
    spec: { path, widths, arcs, length: L },
  }
}

const WATER_VERT = /* glsl */ `
${WORLD_UNIFORMS}
uniform sampler2D uHeight;
attribute vec3 aRiver; // across (-1..1), arc s, half width
varying vec3 vWorld;
varying vec3 vRiver;
varying float vDepth;
#define GRID ${GRID}
#define CELL ${CELL.toFixed(6)}
#define HALF ${HALF.toFixed(1)}
void main() {
  ivec2 c = ivec2(clamp(floor((position.xz + HALF) / CELL), vec2(0.0), vec2(float(GRID) - 1.0)));
  vDepth = ${WATER_LEVEL.toFixed(2)} - texelFetch(uHeight, c, 0).r;
  vRiver = aRiver;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const WATER_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform float uFlow;
uniform float uLen;
varying vec3 vWorld;
varying vec3 vRiver;
varying float vDepth;
const vec3 INDIGO = vec3(0.24, 0.31, 0.37);

float rainRings(vec2 p, float t) {
  vec2 cell = floor(p);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    float h = hash12(c);
    float ph = fract(t * 0.9 + h);
    vec2 ctr = c + hash22(c);
    float d = length(p - ctr);
    float r = ph * 0.9;
    acc += (1.0 - smoothstep(0.0, 0.06, abs(d - r))) * (1.0 - ph);
  }
  return acc;
}

void main() {
  float u = vRiver.y / max(uLen, 1.0);
  float front = clamp((uFlow * 1.3 - u) / 0.3, 0.0, 1.0);
  if (front <= 0.001) discard;
  float across = vRiver.x;
  float hw = vRiver.z;
  float t = uTime;
  float speed = 2.0 + uWind * 1.5;
  vec2 fp = vec2(across * hw, vRiver.y - t * speed);
  float r1 = gnoise(fp * vec2(0.8, 0.3));
  float r2 = gnoise(fp * vec2(2.2, 0.9) + 3.0);
  // flowing 水纹: sparse, thin ink wave-lines (short arcs) drifting downstream
  float wv = sin((vRiver.y - t * speed * 0.8) * 0.9 + r1 * 1.8 + across * across * hw * 0.35);
  float lines = 1.0 - smoothstep(0.0, 0.035 + 0.02 * r2, abs(wv - 0.93));
  lines *= smoothstep(0.55, 0.75, vnoise(fp * vec2(0.45, 0.16) + 9.0));
  float wv2 = sin((vRiver.y - t * speed) * 2.1 + r2 * 2.5 - across * hw * 0.6);
  float lines2 = (1.0 - smoothstep(0.0, 0.03, abs(wv2 - 0.95))) * smoothstep(0.62, 0.8, vnoise(fp * 0.5));
  // reflection of mountains and sky, rippled
  vec3 rp = vWorld + vec3(r1, 0.0, r2) * (0.25 + uWind * 0.5 + uRain * 0.6);
  vec4 rc = uReflMat * vec4(rp, 1.0);
  vec3 refl = texture(uRefl, rc.xy / rc.w).rgb;
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.25 + 0.75 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  vec3 base = mix(uPaper, INDIGO, 0.16 + 0.1 * smoothstep(0.3, 2.5, vDepth));
  // reflections in a painting are pale echoes, never mirrors
  vec3 echo = mix(refl, uPaper, 0.35);
  vec3 sky = mix(uMist, uPaper, 0.4);
  vec3 col = mix(base, uReflOn > 0.5 ? echo : sky * 0.97, fres * 0.75 + 0.1);
  col = mix(col, uInk, lines * 0.42 + lines2 * 0.22 * (0.4 + uWind));
  // moonlight / sun glitter path
  vec3 H = normalize(V + normalize(uSunDir));
  float spec = pow(max(dot(vec3(r1 * 0.12, 1.0, r2 * 0.12), H), 0.0), 260.0);
  col += (uLightTint * 0.5 + 0.2) * spec * (0.25 + uNight * 0.6 + uSunset * 0.4) * (1.0 - uRain * 0.7);
  // rain rings
  if (uRain > 0.01) col = mix(col, uInk, rainRings(vWorld.xz * 0.9, t) * 0.4 * uRain);
  // the advancing water head carries a little foam
  float head = smoothstep(0.0, 0.25, front) * (1.0 - smoothstep(0.25, 0.9, front));
  col = mix(col, uPaper * 1.04, head * 0.6);
  // shores and ends fade into the paper
  float shore = smoothstep(0.0, 0.45, vDepth);
  float ends = smoothstep(0.0, 5.0, vRiver.y) * smoothstep(0.0, 5.0, uLen - vRiver.y);
  // on the flat paper the water is a thin glaze, so the indigo stroke still reads beneath
  float a = shore * front * ends * mix(0.5, 1.0, uAwaken);
  gl_FragColor = vec4(col, a);
}
`

export function createWaterMaterial(height: Texture, refl: Texture, reflMat: Matrix4) {
  return new ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      ...U,
      uHeight: { value: height },
      uRefl: { value: refl },
      uReflMat: { value: reflMat },
      uReflOn: { value: 0 },
      uFlow: { value: 0 },
      uLen: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
}

/** water ribbon along the centreline, extended past the banks (terrain hides the excess) */
export function createWaterGeometry(spec: RiverSpec) {
  const { path, widths, arcs } = spec
  const across = 10
  const n = path.length
  const pos = new Float32Array(n * (across + 1) * 3)
  const riv = new Float32Array(n * (across + 1) * 3)
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(n - 1, i + 1)]
    let dx = b.x - a.x
    let dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    const nx = -dz
    const nz = dx
    const hw = widths[i] + 1.6
    for (let k = 0; k <= across; k++) {
      const c = (k / across) * 2 - 1
      const v = i * (across + 1) + k
      pos[v * 3] = path[i].x + nx * c * hw
      pos[v * 3 + 1] = WATER_LEVEL
      pos[v * 3 + 2] = path[i].z + nz * c * hw
      riv[v * 3] = c
      riv[v * 3 + 1] = arcs[i]
      riv[v * 3 + 2] = hw
    }
  }
  const idx: number[] = []
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * (across + 1) + k
      const b = a + across + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aRiver', new BufferAttribute(riv, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

export class RiverEntity {
  readonly mesh: Mesh
  readonly material: ShaderMaterial
  t = 0
  done = false
  decorated = false
  seed = 1
  constructor(
    readonly patch: Patch,
    readonly spec: RiverSpec,
    height: Texture,
    refl: Texture,
    reflMat: Matrix4,
  ) {
    this.material = createWaterMaterial(height, refl, reflMat)
    this.material.uniforms.uLen.value = spec.length
    this.mesh = new Mesh(createWaterGeometry(spec), this.material)
    this.mesh.renderOrder = 2
    this.mesh.name = 'river'
  }
  /** flow front 0..1 (also drives the progressive carve) */
  update(dt: number) {
    this.t += dt
    const g = clamp((this.t - 0.35) / 3.2)
    const e = g * g * (3 - 2 * g)
    this.patch.grow = e
    this.material.uniforms.uFlow.value = e
    if (this.t > 3.8) this.done = true
    return !this.done
  }
  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

export const RIVER_WORLD = WORLD
