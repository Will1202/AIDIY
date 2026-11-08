import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Sphere, Vector3, type Texture } from 'three'
import { BASE_LEVEL, CELL, GRID, HALF, WORLD } from '../core/constants'
import { INK, NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import type { Heightfield } from './Heightfield'

/**
 * The paper and the land are one surface: this mesh samples the heightfield texture in
 * its vertex shader (so rising mountains cost no CPU geometry work) and the fragment
 * shader paints it as an ink-wash landscape, with the actual ink map layered on top.
 */

const DEFS = /* glsl */ `
#define GRID ${GRID}
#define CELL ${CELL.toFixed(6)}
#define HALF ${HALF.toFixed(1)}
#define WORLD ${WORLD.toFixed(1)}
#define BASE_LEVEL ${BASE_LEVEL.toFixed(3)}
`

const VERT = /* glsl */ `
${DEFS}
${WORLD_UNIFORMS}
${NOISE}
uniform sampler2D uHeight;
uniform float uStride;
attribute vec2 aCell;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vData;
varying float vCurv;
varying vec2 vXZ;

float Hc(ivec2 c) { return texelFetch(uHeight, clamp(c, ivec2(0), ivec2(GRID - 1)), 0).r; }

void main() {
  ivec2 c = ivec2(aCell + 0.5);
  vec4 d = texelFetch(uHeight, c, 0);
  int s = int(uStride);
  float hl = Hc(c - ivec2(s, 0));
  float hr = Hc(c + ivec2(s, 0));
  float hd = Hc(c - ivec2(0, s));
  float hu = Hc(c + ivec2(0, s));
  float dx = CELL * float(s);
  float sy = uScaleY;
  vN = normalize(vec3(-(hr - hl) * sy / (2.0 * dx), 1.0, -(hu - hd) * sy / (2.0 * dx)));
  vCurv = -(hl + hr + hu + hd - 4.0 * d.r) * sy / (dx * dx) * float(s);
  vec3 p = vec3(position.x, d.r, position.z);
  // AWAKEN tremble: the inked land shivers before it rises
  float rise = max(d.r - BASE_LEVEL, 0.0);
  p.y += uTremble * (gnoise(position.xz * 0.35 + uTime * 9.0) * 0.12 + 0.04) * (0.3 + rise * 0.08);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vData = d;
  vXZ = position.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const TERRAIN_INK_FN = /* glsl */ `
uniform sampler2D uInkCrisp;
uniform sampler2D uInkWet;
uniform sampler2D uInkDry;
const vec3 INDIGO = vec3(0.24, 0.31, 0.37);
// applies the actual brush marks (paper-UV ink map) onto a surface colour
vec3 applyInk(vec3 col, vec2 xz, float tremble, float time) {
  vec2 iuv = (xz + HALF) / WORLD;
  iuv += (vec2(gnoise(iuv * 90.0 + time * 7.0), gnoise(iuv * 90.0 - time * 6.0))) * 0.0016 * tremble;
  float inside = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);
  vec4 ic = texture(uInkCrisp, iuv);
  vec4 iw = texture(uInkWet, iuv);
  vec4 id = texture(uInkDry, iuv);
  float black = (ic.r + id.r + iw.r * 0.9) * inside;
  float indigo = (ic.g + id.g + iw.g * 0.9) * inside;
  float cb = inkCover(black);
  float ci = inkCover(indigo);
  vec3 inkCol = uInk * (0.95 - 0.25 * smoothstep(0.6, 2.5, black));
  col = mix(col, INDIGO * mix(1.0, 0.35, uNight), ci * 0.85);
  col = mix(col, inkCol, cb);
  col *= 1.0 - id.b * 0.16 * inside;
  col *= 1.0 - min(iw.b, 1.0) * 0.07 * inside;
  return col;
}
`

const FRAG = /* glsl */ `
${DEFS}
${WORLD_UNIFORMS}
${NOISE}
${INK}
uniform sampler2D uHeight;
uniform int uShadowSteps;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vData;
varying float vCurv;
varying vec2 vXZ;
${TERRAIN_INK_FN}

float hAt(vec2 xz) {
  ivec2 c = ivec2(clamp(floor((xz + HALF) / CELL), vec2(0.0), vec2(float(GRID) - 1.0)));
  return texelFetch(uHeight, c, 0).r;
}
float terrainShadow(vec3 pw, vec3 L) {
  if (uShadowSteps == 0) return 1.0;
  float res = 1.0;
  float t = 0.8;
  for (int i = 0; i < 32; i++) {
    if (i >= uShadowSteps) break;
    vec3 q = pw + L * t;
    if (abs(q.x) > HALF || abs(q.z) > HALF) break;
    float h = hAt(q.xz) * uScaleY;
    float dh = q.y - h;
    res = min(res, 5.0 * dh / t);
    if (res < 0.0) return 0.0;
    t += 1.0 + t * 0.22;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(uSunDir);
  float ndl = dot(n, L);
  float rock = clamp(vData.g, 0.0, 1.0);
  float water = clamp(vData.b, 0.0, 1.0);
  float pale = clamp(vData.a, 0.0, 1.0);
  float rise = max(vData.r - BASE_LEVEL, 0.0) * mix(1.0, 1.0 / max(uScaleY, 0.1), 0.0);

  // paper
  vec2 puv = vXZ / 30.0;
  vec3 pt = texture(uPaperTex, puv).rgb;
  vec3 pt2 = texture(uPaperTex, puv * 0.37 + 0.31).rgb;
  vec3 paper = uPaper * (1.0 + (pt.r - 0.5) * 0.2 + (pt2.r - 0.5) * 0.12);

  // light, self-shadow
  float sh = terrainShadow(vWorld + n * 0.3, L);
  float lit = clamp(0.5 * ndl + 0.5, 0.0, 1.0) * mix(0.45, 1.0, sh);
  float shadeT = 1.0 - lit;
  float jit = fbm3o(vXZ * 0.2) * 0.13 + (pt.g - 0.5) * 0.08;
  float wash = washBands(shadeT, jit);

  float slope = 1.0 - n.y;
  float foot = smoothstep(0.4, 7.0, rise);
  // 上实下虚: ink gathers toward the summits and dissolves into mist at the foot
  float hRel = smoothstep(1.5, 30.0, rise);
  float tone = (wash * 0.12 + (fbm3o(vXZ * 0.045) * 0.5 + 0.5) * 0.035) * (1.0 - rock);
  float body = mix(0.06, 0.42, hRel);
  float rockTone = (body + wash * 0.55) * mix(0.12, 1.0, foot) * mix(1.0, 0.4, pale);
  tone = mix(tone, rockTone, rock);

  // 披麻皴: long hemp-fibre strokes that follow the fall line, mostly on the shadow side
  vec2 g = n.xz / max(length(n.xz), 1e-3);
  vec2 perp = vec2(-g.y, g.x);
  float steep = smoothstep(0.3, 0.8, slope);
  float along = mix(dot(vXZ, g), vWorld.y * 1.1, steep);
  float across = dot(vXZ, perp);
  float s1 = vnoise(vec2(across * 1.05, along * 0.075));
  float s2 = vnoise(vec2(across * 2.9 + 7.0, along * 0.2));
  float cun = smoothstep(0.58, 0.84, s1 * 0.66 + s2 * 0.34);
  tone += cun * rock * smoothstep(0.12, 0.5, slope) * (0.08 + 0.5 * shadeT * shadeT) * mix(1.0, 0.3, pale) * foot;
  // 斧劈皴: angular dark planes on the cliffs
  float axe = smoothstep(0.6, 0.8, vnoise(vec2(across * 0.45 + 3.0, vWorld.y * 0.32)));
  tone += axe * rock * smoothstep(0.55, 0.88, slope) * 0.24 * (1.0 - pale * 0.6) * (0.25 + shadeT);
  // ridge lines (勾) on convex crests
  float ridge = smoothstep(0.08, 0.6, vCurv) * rock * hRel;
  tone += ridge * 0.38 * (1.0 - pale * 0.5);
  // 点苔 moss dots on crests
  vec2 dcell = floor(vXZ * 0.9);
  vec2 dfr = fract(vXZ * 0.9) - 0.5 - (hash22(dcell) - 0.5) * 0.5;
  float mossDot = step(0.78, hash12(dcell)) * (1.0 - smoothstep(0.1, 0.2, length(dfr)));
  tone += mossDot * smoothstep(0.05, 0.4, vCurv + 0.1 * hRel) * rock * (1.0 - pale) * foot * 0.8;
  // damp river banks
  tone += water * 0.08;
  // close-up detail for walking: sparse grass strokes and ink specks (fade with distance)
  float near = 1.0 - smoothstep(18.0, 55.0, length(cameraPosition - vWorld));
  if (near > 0.01) {
    vec2 gc = floor(vXZ * 0.8);
    vec2 gf = fract(vXZ * 0.8) - 0.5 - (hash22(gc + 3.0) - 0.5) * 0.6;
    float h1 = hash12(gc + 9.0);
    float blade = (1.0 - smoothstep(0.015, 0.04, abs(gf.x + gf.y * (h1 - 0.5) * 1.6))) * (1.0 - smoothstep(0.0, 0.32, abs(gf.y))) * step(0.62, h1);
    float speck = (1.0 - smoothstep(0.03, 0.07, length(fract(vXZ * 2.3 + 0.5) - 0.5 - (hash22(floor(vXZ * 2.3)) - 0.5) * 0.7))) * step(0.9, hash12(floor(vXZ * 2.3)));
    tone += (blade * 0.32 + speck * 0.22) * near * (1.0 - rock * 0.7) * (1.0 - water) * smoothstep(0.75, 0.95, n.y);
  }
  tone = clamp(tone, 0.0, 1.0);

  vec3 col = mix(paper, uInk, tone);
  // restrained 青绿 mineral wash on lit, upward-facing rock
  float qing = rock * smoothstep(0.5, 0.92, n.y) * lit * smoothstep(1.0, 9.0, rise) * (1.0 - pale * 0.5);
  col = mix(col, vec3(0.43, 0.56, 0.5) * (paper / max(uPaper, vec3(0.01))), qing * 0.26 * (1.0 - uNight * 0.8));
  // warm ochre (赭石) at the feet of mountains
  float ochre = rock * (1.0 - foot) * smoothstep(0.05, 0.5, rise);
  col = mix(col, col * vec3(1.04, 0.95, 0.84), ochre * 0.5);

  col = applyInk(col, vXZ, uTremble, uTime);

  // light colour, moonlight on lit faces at night
  col *= mix(vec3(1.0), uLightTint, clamp(ndl, 0.0, 1.0) * sh * 0.6 + 0.4);
  col += uLightTint * clamp(ndl, 0.0, 1.0) * sh * uNight * (0.06 + rock * 0.12);
  gl_FragColor = vec4(col, 1.0);
}
`

export function createTerrainMaterial(hf: Heightfield, ink: { crisp: Texture; wet: Texture; dry: Texture }, stride: number, shadowSteps: number) {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...U,
      uHeight: { value: hf.texture },
      uStride: { value: stride },
      uShadowSteps: { value: shadowSteps },
      uInkCrisp: { value: ink.crisp },
      uInkWet: { value: ink.wet },
      uInkDry: { value: ink.dry },
    },
  })
}

export function createTerrainGeometry(stride: number) {
  const idx: number[] = []
  for (let i = 0; i < GRID; i += stride) idx.push(i)
  if (idx[idx.length - 1] !== GRID - 1) idx.push(GRID - 1)
  const n = idx.length
  const pos = new Float32Array(n * n * 3)
  const cell = new Float32Array(n * n * 2)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x
      pos[k * 3] = -HALF + (idx[x] + 0.5) * CELL
      pos[k * 3 + 1] = 0
      pos[k * 3 + 2] = -HALF + (idx[y] + 0.5) * CELL
      cell[k * 2] = idx[x]
      cell[k * 2 + 1] = idx[y]
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6)
  let t = 0
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const a = y * n + x
      const b = a + 1
      const c = a + n
      const d = c + 1
      index[t++] = a
      index[t++] = c
      index[t++] = b
      index[t++] = b
      index[t++] = c
      index[t++] = d
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aCell', new BufferAttribute(cell, 2))
  g.setIndex(new BufferAttribute(index, 1))
  g.boundingSphere = new Sphere(new Vector3(0, 20, 0), HALF * 1.6)
  return g
}

export class TerrainMesh {
  mesh: Mesh
  material: ShaderMaterial
  private stride: number
  constructor(private hf: Heightfield, ink: { crisp: Texture; wet: Texture; dry: Texture }, stride: number, shadowSteps: number) {
    this.stride = stride
    this.material = createTerrainMaterial(hf, ink, stride, shadowSteps)
    this.mesh = new Mesh(createTerrainGeometry(stride), this.material)
    this.mesh.frustumCulled = false
    this.mesh.name = 'terrain'
  }
  setInk(ink: { crisp: Texture; wet: Texture; dry: Texture }) {
    this.material.uniforms.uInkCrisp.value = ink.crisp
    this.material.uniforms.uInkWet.value = ink.wet
    this.material.uniforms.uInkDry.value = ink.dry
  }
  setQuality(stride: number, shadowSteps: number) {
    this.material.uniforms.uShadowSteps.value = shadowSteps
    if (stride !== this.stride) {
      this.stride = stride
      this.mesh.geometry.dispose()
      this.mesh.geometry = createTerrainGeometry(stride)
      this.material.uniforms.uStride.value = stride
    }
    void this.hf
  }
  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
