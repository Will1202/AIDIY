import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Sphere, Vector3 } from 'three'
import { BASE_LEVEL, CELL, HALF } from '../core/constants'
import { NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import { Noise2D } from '../util/noise'

/**
 * Everything beyond the sheet: the endless blank paper ground (留白) and three rings of
 * distant mountains, each paler and taller than the last (层层叠叠). They rise out of
 * the paper during AWAKEN and are otherwise invisible from the drawing view.
 */

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const GROUND_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
varying vec3 vWorld;
void main() {
  vec2 puv = vWorld.xz / 30.0;
  vec3 pt = texture(uPaperTex, puv).rgb;
  vec3 pt2 = texture(uPaperTex, puv * 0.37 + 0.31).rgb;
  vec3 col = uPaper * (1.0 + (pt.r - 0.5) * 0.2 + (pt2.r - 0.5) * 0.12);
  // same faint ground wash and light as the terrain at the paper's edge
  float w = fbm3o(vWorld.xz * 0.045) * 0.5 + 0.5;
  col = mix(col, uInk, w * 0.035);
  float ndl = normalize(uSunDir).y;
  col *= mix(vec3(1.0), uLightTint, clamp(ndl, 0.0, 1.0) * 0.6 + 0.4);
  col += uLightTint * clamp(ndl, 0.0, 1.0) * uNight * 0.06;
  gl_FragColor = vec4(col, 1.0);
}
`

const RANGE_VERT = /* glsl */ `
attribute float aV;
attribute float aRidge;
varying float vV;
varying float vRidge;
varying vec3 vWorld;
uniform float uRise;
void main() {
  vec3 p = position;
  p.y = mix(-6.0, p.y, uRise);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vV = aV;
  vRidge = aRidge;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const RANGE_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
uniform float uLayer;
varying float vV;
varying float vRidge;
varying vec3 vWorld;
void main() {
  // ink is densest at the crest, washing out into mist toward the foot
  float crest = smoothstep(0.0, 1.0, vV);
  float wash = pow(crest, 1.6);
  float streak = vnoise(vec2(vWorld.x * 0.05 + vWorld.z * 0.05, vWorld.y * 0.2)) * 0.25;
  float tone = (0.18 + 0.55 * wash + streak * wash) * (1.0 - uLayer * 0.28);
  tone *= mix(1.0, 1.25, vRidge);
  vec3 col = mix(uMist, uInk, clamp(tone, 0.0, 1.0));
  col = mix(col, uMist, (1.0 - smoothstep(0.0, 0.45, vV)) * 0.85);
  col += uLightTint * uNight * 0.03;
  gl_FragColor = vec4(col, 1.0);
}
`

function ringGeometry(radius: number, hMin: number, hMax: number, seed: number) {
  const nz = new Noise2D(seed)
  const segs = 360
  const rows = 4
  const pos = new Float32Array((segs + 1) * (rows + 1) * 3)
  const v = new Float32Array((segs + 1) * (rows + 1))
  const ridge = new Float32Array((segs + 1) * (rows + 1))
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const cx = Math.cos(a)
    const cz = Math.sin(a)
    // periodic profile: sample noise around a circle
    const r1 = nz.ridged(cx * 2.2 + 5, cz * 2.2 - 3, 4)
    const r2 = nz.fbm(cx * 6 + 1, cz * 6 + 9, 3)
    const peak = Math.pow(Math.max(0, nz.noise(cx * 4.5, cz * 4.5)), 2) * 0.5
    const hN = Math.min(1, Math.max(0, r1 * 0.85 + r2 * 0.25 + peak))
    const top = hMin + (hMax - hMin) * hN
    const rr = radius * (1 + nz.noise(cx * 3, cz * 3) * 0.08)
    for (let j = 0; j <= rows; j++) {
      const t = j / rows
      const k = i * (rows + 1) + j
      // gentle slope toward the viewer so lower rows sit in front
      const rj = rr * (1 + (1 - t) * 0.06)
      pos[k * 3] = cx * rj
      pos[k * 3 + 1] = BASE_LEVEL - 4 + (top + 4) * t
      pos[k * 3 + 2] = cz * rj
      v[k] = t
      ridge[k] = r1
    }
  }
  const idx: number[] = []
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j
      const b = (i + 1) * (rows + 1) + j
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aV', new BufferAttribute(v, 1))
  g.setAttribute('aRidge', new BufferAttribute(ridge, 1))
  g.setIndex(idx)
  g.boundingSphere = new Sphere(new Vector3(), radius * 1.2)
  return g
}

function groundGeometry() {
  const inner = HALF - CELL * 0.5
  const outer = 3500
  const p = [-inner, -inner, inner, -inner, inner, inner, -inner, inner, -outer, -outer, outer, -outer, outer, outer, -outer, outer]
  const pos = new Float32Array(8 * 3)
  for (let i = 0; i < 8; i++) {
    pos[i * 3] = p[i * 2]
    pos[i * 3 + 1] = BASE_LEVEL
    pos[i * 3 + 2] = p[i * 2 + 1]
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  // frame between the inner square (the paper) and the outer square, facing up
  g.setIndex([0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7, 0, 4, 7])
  g.computeBoundingSphere()
  return g
}

export class Backdrop {
  readonly group = new Group()
  readonly ground: Mesh
  readonly ranges: Mesh[] = []
  private mats: ShaderMaterial[] = []
  rise = 0

  constructor() {
    const gm = new ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms: { ...U } })
    this.ground = new Mesh(groundGeometry(), gm)
    this.ground.name = 'paperGround'
    this.mats.push(gm)
    const layers = [
      { r: 360, h0: 26, h1: 82, seed: 11 },
      { r: 560, h0: 45, h1: 128, seed: 23 },
      { r: 860, h0: 80, h1: 175, seed: 37 },
    ]
    layers.forEach((l, i) => {
      const m = new ShaderMaterial({
        vertexShader: RANGE_VERT,
        fragmentShader: RANGE_FRAG,
        uniforms: { ...U, uRise: { value: 0 }, uLayer: { value: i } },
        side: DoubleSide,
      })
      const mesh = new Mesh(ringGeometry(l.r, l.h0, l.h1, l.seed), m)
      mesh.name = 'range' + i
      mesh.visible = false
      this.ranges.push(mesh)
      this.mats.push(m)
      this.group.add(mesh)
    })
  }

  /** 0 = flat in the paper, 1 = fully risen; staggered per layer (far rises last) */
  setRise(v: number) {
    this.rise = v
    this.ranges.forEach((m, i) => {
      const k = Math.min(1, Math.max(0, v * 1.6 - i * 0.3))
      const e = k * k * (3 - 2 * k)
      ;(m.material as ShaderMaterial).uniforms.uRise.value = e
      m.visible = e > 0.001
    })
  }

  dispose() {
    this.ground.geometry.dispose()
    for (const r of this.ranges) r.geometry.dispose()
    for (const m of this.mats) m.dispose()
  }
}
