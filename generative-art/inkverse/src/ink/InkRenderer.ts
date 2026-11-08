import {
  AddEquation,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  GLSL3,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  RGBAFormat,
  ZeroFactor,
  OneMinusSrcColorFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Float32BufferAttribute,
  Vector2,
  WebGLRenderTarget,
  ClampToEdgeWrapping,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { FullscreenPass, FULLSCREEN_VERT, fullscreenCamera } from '../render/FullscreenPass'
import { NOISE } from '../render/glsl'
import { U } from '../render/uniforms'
import { HALF, WORLD } from '../core/constants'
import type { QualitySettings } from '../engine/Quality'

/**
 * INK PHYSICS
 * ───────────
 * Two GPU layers in paper-UV space:
 *  • crisp  (inkRes²)  – the bristle-level brush marks: width, dry-brush gaps (飞白),
 *                        ragged edges, overlap darkening. Never diffuses.
 *  • sim    (simRes², MRT ping-pong) – wet pigment + water. Each step water wicks
 *    along paper fibres (anisotropic, fibre texture driven), carries pigment upwind
 *    with its flux, evaporates fastest at the drying front (which pulls pigment to the
 *    edge → dark tide lines), and deposits pigment into the dry attachment.
 * Slow strokes load more water → visible blooming; a dwelling brush keeps feeding the
 * bloom; rain re-wets the sheet so dry ink bleeds a little again.
 */

export interface Stamp {
  x: number // world xz
  z: number
  dx: number // stroke direction (unit)
  dz: number
  halfLen: number // world units
  halfWidth: number
  black: number // pigment amounts (already normalised for spacing)
  indigo: number
  water: number
  dryness: number // 0 = wet full brush, 1 = very dry 飞白
  bleed: number // share of pigment that goes into the wet sim
  arc: number // arc length along the stroke (world units), keeps bristle streaks continuous
  seed: number
  round: number // 1 = round drop (no bristles)
}

const MAX_STAMPS = 4096

const STAMP_VERT = /* glsl */ `
attribute vec4 iA; // x, z (world), dirx, dirz
attribute vec4 iB; // halfLen, halfWidth, arc, seed
attribute vec4 iC; // black, indigo, water, dryness
attribute vec2 iD; // bleed, round
uniform vec2 uWorld; // HALF, WORLD
varying vec2 vLocal;
varying float vArc;
varying float vSeed;
varying vec4 vInk;
varying vec2 vMisc;
void main() {
  vec2 dir = iA.zw;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 corner = position.xy;
  vec2 p = iA.xy + dir * corner.x * iB.x + perp * corner.y * iB.y;
  vec2 uv = (p + uWorld.x) / uWorld.y;
  vLocal = corner;
  vArc = iB.z + corner.x * iB.x;
  vSeed = iB.w;
  vInk = iC;
  vMisc = iD;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`

const STAMP_SHAPE = /* glsl */ `
${NOISE}
varying vec2 vLocal;
varying float vArc;
varying float vSeed;
varying vec4 vInk;
varying vec2 vMisc;
// returns footprint coverage and bristle mask
vec2 brushMask() {
  float r = length(vLocal);
  float rag = vnoise(vLocal * 3.5 + vSeed * 17.0) - 0.5;
  float round_ = vMisc.y;
  float edge = 1.0 - smoothstep(0.62 + rag * 0.22 * (1.0 - round_ * 0.6), 1.0, r);
  // bristle streaks run along the stroke: across-coordinate is stable from stamp to stamp
  float across = vLocal.y;
  float b1 = vnoise(vec2(across * 7.0 + vSeed * 3.1, vArc * 0.22));
  float b2 = vnoise(vec2(across * 19.0 + vSeed * 7.7, vArc * 0.75));
  float br = b1 * 0.62 + b2 * 0.38;
  float dry = vInk.w * (1.0 - round_);
  float thr = dry * (0.42 + 0.42 * abs(across));
  float bristle = mix(1.0, smoothstep(thr - 0.06, thr + 0.1, br), step(0.001, dry));
  // slight density ripple even for wet strokes (bristles hold ink unevenly)
  float density = 0.82 + 0.36 * br;
  return vec2(edge, bristle * density);
}
`

const STAMP_CRISP_FRAG = /* glsl */ `
${STAMP_SHAPE}
void main() {
  vec2 m = brushMask();
  float a = m.x * m.y * (1.0 - vMisc.x);
  gl_FragColor = vec4(vInk.x * a, vInk.y * a, 0.0, 0.0);
}
`

const STAMP_SIM_FRAG = /* glsl */ `
layout(location = 0) out vec4 outWet;
layout(location = 1) out vec4 outDry;
${STAMP_SHAPE}
void main() {
  vec2 m = brushMask();
  float a = m.x * mix(1.0, m.y, 0.5) * vMisc.x;
  outWet = vec4(vInk.x * a, vInk.y * a, vInk.z * m.x, 0.0);
  outDry = vec4(0.0);
}
`

// erase strength = footprint × amount (0..1), used with dst·(1 − src) blending
const ERASE_CRISP_FRAG = /* glsl */ `
${STAMP_SHAPE}
void main() {
  float m = brushMask().x;
  gl_FragColor = vec4(vInk.x * m, vInk.y * m, 0.0, 0.0);
}
`
const ERASE_SIM_FRAG = /* glsl */ `
layout(location = 0) out vec4 outWet;
layout(location = 1) out vec4 outDry;
${STAMP_SHAPE}
void main() {
  float m = brushMask().x;
  outWet = vec4(vInk.x * m, vInk.y * m, 0.0, 0.0);
  outDry = vec4(vInk.x * m, vInk.y * m, 0.0, 0.0);
}
`

const SIM_FRAG = /* glsl */ `
layout(location = 0) out vec4 outWet;
layout(location = 1) out vec4 outDry;
${NOISE}
uniform sampler2D tWet;
uniform sampler2D tDry;
uniform sampler2D uPaperTex;
uniform vec2 uTexel;
uniform float uDiff;
uniform float uDt;
uniform float uRain;
uniform float uTime;
uniform float uFibreScale;
varying vec2 vUv;

float cond(vec2 uv) {
  // fibres wick water; the fibre map is tiled in world units
  float f = texture(uPaperTex, uv * uFibreScale).g;
  return mix(0.25, 1.0, clamp(f, 0.0, 1.0));
}

void main() {
  vec4 w = texture(tWet, vUv);
  vec4 d = texture(tDry, vUv);
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  vec4 wl = texture(tWet, vUv - dx);
  vec4 wr = texture(tWet, vUv + dx);
  vec4 wd = texture(tWet, vUv - dy);
  vec4 wu = texture(tWet, vUv + dy);
  float kl = cond(vUv - dx * 0.5);
  float kr = cond(vUv + dx * 0.5);
  float kd = cond(vUv - dy * 0.5);
  float ku = cond(vUv + dy * 0.5);

  float water = w.b;
  vec2 pig = w.rg;
  vec2 c = pig / max(water, 0.02);
  c = min(c, vec2(3.0));

  // water flux between neighbours (only wet paper conducts)
  float D = uDiff;
  float fl = D * kl * (wl.b - water);
  float fr = D * kr * (wr.b - water);
  float fd = D * kd * (wd.b - water);
  float fu = D * ku * (wu.b - water);
  float newWater = water + fl + fr + fd + fu;

  // pigment is carried upwind by that flux
  vec2 cl = min(wl.rg / max(wl.b, 0.02), vec2(3.0));
  vec2 cr = min(wr.rg / max(wr.b, 0.02), vec2(3.0));
  vec2 cd = min(wd.rg / max(wd.b, 0.02), vec2(3.0));
  vec2 cu = min(wu.rg / max(wu.b, 0.02), vec2(3.0));
  vec2 dp = vec2(0.0);
  dp += fl * (fl > 0.0 ? cl : c);
  dp += fr * (fr > 0.0 ? cr : c);
  dp += fd * (fd > 0.0 ? cd : c);
  dp += fu * (fu > 0.0 ? cu : c);
  vec2 newPig = max(pig + dp * 0.92, vec2(0.0));

  // evaporation: faster at the thin drying front → water (and pigment) is pulled outward
  float grad = abs(wr.b - wl.b) + abs(wu.b - wd.b);
  float front = (1.0 - smoothstep(0.0, 0.35, newWater)) * smoothstep(0.0, 0.05, grad);
  float evap = (0.045 + 0.35 * front) * uDt;
  float lost = min(newWater, evap);
  newWater -= lost;

  // rain re-wets the sheet in scattered drops
  if (uRain > 0.001) {
    vec2 cell = floor(vUv * 180.0);
    float h = hash12(cell + floor(uTime * 3.0));
    float drop = step(1.0 - uRain * 0.02, h) * (1.0 - smoothstep(0.0, 0.5, length(fract(vUv * 180.0) - 0.5)));
    newWater += drop * 0.8 + uRain * 0.004;
    // dry pigment slowly lifts back into the water → slight re-bleeding
    vec2 lift = d.rg * uRain * 0.0035 * smoothstep(0.05, 0.4, newWater);
    newPig += lift;
    d.rg -= lift;
  }
  newWater = min(newWater, 2.2);

  // deposition: slow while wet, fast as the paper dries; granulates into fibre valleys
  float grain = texture(uPaperTex, vUv * uFibreScale * 1.7).b;
  float rate = (0.08 + 3.2 * (1.0 - smoothstep(0.0, 0.18, newWater))) * uDt * (0.7 + 0.6 * grain);
  vec2 dep = newPig * min(rate, 1.0);
  newPig -= dep;
  d.rg += dep;
  // faint water stain left by the evaporating front (水渍)
  d.b = min(d.b + lost * front * 0.25, 0.6);

  outWet = vec4(newPig, newWater, 0.0);
  outDry = d;
}
`

const COPY_FRAG = /* glsl */ `
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;
uniform sampler2D t0;
uniform sampler2D t1;
varying vec2 vUv;
void main() { out0 = texture(t0, vUv); out1 = texture(t1, vUv); }
`
const COPY1_FRAG = /* glsl */ `
uniform sampler2D t0;
varying vec2 vUv;
void main() { gl_FragColor = texture(t0, vUv); }
`

function makeRT(size: number, count = 1) {
  const rt = new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    format: RGBAFormat,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    count,
  })
  return rt
}

export class InkRenderer {
  crisp!: WebGLRenderTarget
  simA!: WebGLRenderTarget
  simB!: WebGLRenderTarget
  private simSteps = 2
  private simDiff = 0.22

  private geo: InstancedBufferGeometry
  private aA: InstancedBufferAttribute
  private aB: InstancedBufferAttribute
  private aC: InstancedBufferAttribute
  private aD: InstancedBufferAttribute
  private crispMat: ShaderMaterial
  private simStampMat: ShaderMaterial
  private eraseCrispMat: ShaderMaterial
  private eraseSimMat: ShaderMaterial
  private stampMesh: Mesh
  private simPass: FullscreenPass
  private copyPass: FullscreenPass
  private copy1Pass: FullscreenPass

  private queue: Stamp[] = []
  private eraseQueue: Stamp[] = []
  /** seconds of simulation still needed (wet paper) */
  private wetTimer = 0
  /** total stamps rendered (dev stats) */
  stats = { stamps: 0, simSteps: 0 }

  constructor(private renderer: WebGLRenderer, q: QualitySettings) {
    const geo = new InstancedBufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    this.aA = new InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(DynamicDrawUsage)
    this.aB = new InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(DynamicDrawUsage)
    this.aC = new InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(DynamicDrawUsage)
    this.aD = new InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 2), 2).setUsage(DynamicDrawUsage)
    geo.setAttribute('iA', this.aA)
    geo.setAttribute('iB', this.aB)
    geo.setAttribute('iC', this.aC)
    geo.setAttribute('iD', this.aD)
    geo.instanceCount = 0
    this.geo = geo

    const world = { value: new Vector2(HALF, WORLD) }
    const add = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendEquationAlpha: AddEquation, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor }
    // erasing multiplies the layer by (1 − strength): it can lift ink but never go negative
    const mul = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: ZeroFactor, blendDst: OneMinusSrcColorFactor, blendEquationAlpha: AddEquation, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneMinusSrcAlphaFactor }
    const common = { vertexShader: STAMP_VERT, depthTest: false, depthWrite: false, transparent: false }
    this.crispMat = new ShaderMaterial({ ...common, uniforms: { uWorld: world }, ...add, fragmentShader: STAMP_CRISP_FRAG })
    this.simStampMat = new ShaderMaterial({ ...common, uniforms: { uWorld: world }, ...add, fragmentShader: STAMP_SIM_FRAG, glslVersion: GLSL3 })
    this.eraseCrispMat = new ShaderMaterial({ ...common, uniforms: { uWorld: world }, ...mul, fragmentShader: ERASE_CRISP_FRAG })
    this.eraseSimMat = new ShaderMaterial({ ...common, uniforms: { uWorld: world }, ...mul, fragmentShader: ERASE_SIM_FRAG, glslVersion: GLSL3 })
    this.stampMesh = new Mesh(geo, this.crispMat)
    this.stampMesh.frustumCulled = false

    this.simPass = new FullscreenPass(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: SIM_FRAG,
        uniforms: {
          tWet: { value: null },
          tDry: { value: null },
          uPaperTex: U.uPaperTex,
          uTexel: { value: new Vector2() },
          uDiff: { value: 0.22 },
          uDt: { value: 1 / 60 },
          uRain: U.uRain,
          uTime: U.uTime,
          // paper texture repeats every 30 world units
          uFibreScale: { value: WORLD / 30 },
        },
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
      }),
    )
    this.copyPass = new FullscreenPass(new ShaderMaterial({ glslVersion: GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: COPY_FRAG, uniforms: { t0: { value: null }, t1: { value: null } }, blending: NoBlending, depthTest: false, depthWrite: false }))
    this.copy1Pass = new FullscreenPass(new ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: COPY1_FRAG, uniforms: { t0: { value: null } }, blending: NoBlending, depthTest: false, depthWrite: false }))

    this.allocate(q, false)
  }

  /** (re)allocate the layers for a quality level, carrying existing ink over */
  allocate(q: QualitySettings, carry = true) {
    const oldCrisp = this.crisp
    const oldSim = this.simA
    const oldSimB = this.simB
    if (oldCrisp && oldCrisp.width === q.inkRes && oldSim.width === q.simRes) {
      this.simSteps = q.simSteps
      this.simDiff = Math.min(0.24, 0.22 * (q.simRes / 1024) ** 2 * (2 / q.simSteps))
      return
    }
    this.crisp = makeRT(q.inkRes)
    this.simA = makeRT(q.simRes, 2)
    this.simB = makeRT(q.simRes, 2)
    this.simSteps = q.simSteps
    // keep the physical spreading speed independent of resolution
    this.simDiff = Math.min(0.24, 0.22 * (q.simRes / 1024) ** 2 * (2 / q.simSteps))
    this.clearTargets()
    if (carry && oldCrisp && oldSim) {
      const r = this.renderer
      const prev = r.getRenderTarget()
      ;(this.copy1Pass.material as ShaderMaterial).uniforms.t0.value = oldCrisp.texture
      this.copy1Pass.render(r, this.crisp)
      const cm = this.copyPass.material as ShaderMaterial
      cm.uniforms.t0.value = oldSim.textures[0]
      cm.uniforms.t1.value = oldSim.textures[1]
      this.copyPass.render(r, this.simA)
      r.setRenderTarget(prev)
    }
    oldCrisp?.dispose()
    oldSim?.dispose()
    oldSimB?.dispose()
  }

  /** textures for world materials */
  get crispTexture(): Texture {
    return this.crisp.texture
  }
  get wetTexture(): Texture {
    return this.simA.textures[0]
  }
  get dryTexture(): Texture {
    return this.simA.textures[1]
  }

  stamp(s: Stamp) {
    if (this.queue.length < MAX_STAMPS) this.queue.push(s)
    if (s.bleed > 0 || s.water > 0) this.wetTimer = Math.max(this.wetTimer, 4 + s.water * 3)
  }
  erase(s: Stamp) {
    if (this.eraseQueue.length < MAX_STAMPS) this.eraseQueue.push(s)
    this.wetTimer = Math.max(this.wetTimer, 2)
  }
  /** keep simulating (e.g. while it rains) */
  keepWet(seconds: number) {
    this.wetTimer = Math.max(this.wetTimer, seconds)
  }
  get simulating() {
    return this.wetTimer > 0
  }

  private upload(list: Stamp[]) {
    const n = Math.min(list.length, MAX_STAMPS)
    const A = this.aA.array as Float32Array
    const B = this.aB.array as Float32Array
    const C = this.aC.array as Float32Array
    const D = this.aD.array as Float32Array
    for (let i = 0; i < n; i++) {
      const s = list[i]
      A[i * 4] = s.x
      A[i * 4 + 1] = s.z
      A[i * 4 + 2] = s.dx
      A[i * 4 + 3] = s.dz
      B[i * 4] = s.halfLen
      B[i * 4 + 1] = s.halfWidth
      B[i * 4 + 2] = s.arc
      B[i * 4 + 3] = s.seed
      C[i * 4] = s.black
      C[i * 4 + 1] = s.indigo
      C[i * 4 + 2] = s.water
      C[i * 4 + 3] = s.dryness
      D[i * 2] = s.bleed
      D[i * 2 + 1] = s.round
    }
    for (const a of [this.aA, this.aB, this.aC, this.aD]) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, n * a.itemSize)
      a.needsUpdate = true
    }
    this.geo.instanceCount = n
    return n
  }

  private drawStamps(list: Stamp[], crispMat: ShaderMaterial, simMat: ShaderMaterial) {
    if (!list.length) return
    const r = this.renderer
    this.upload(list)
    this.stampMesh.material = crispMat
    r.setRenderTarget(this.crisp)
    r.render(this.stampMesh, fullscreenCamera)
    this.stampMesh.material = simMat
    r.setRenderTarget(this.simA)
    r.render(this.stampMesh, fullscreenCamera)
    this.stats.stamps += list.length
    list.length = 0
  }

  update(dt: number) {
    const r = this.renderer
    const prev = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    this.drawStamps(this.queue, this.crispMat, this.simStampMat)
    this.drawStamps(this.eraseQueue, this.eraseCrispMat, this.eraseSimMat)

    if (U.uRain.value > 0.02) this.wetTimer = Math.max(this.wetTimer, 3)
    if (this.wetTimer > 0) {
      this.wetTimer -= dt
      const m = this.simPass.material as ShaderMaterial
      m.uniforms.uTexel.value.set(1 / this.simA.width, 1 / this.simA.height)
      m.uniforms.uDiff.value = this.simDiff
      m.uniforms.uDt.value = 1 / 60
      for (let i = 0; i < this.simSteps; i++) {
        m.uniforms.tWet.value = this.simA.textures[0]
        m.uniforms.tDry.value = this.simA.textures[1]
        this.simPass.render(r, this.simB)
        const t = this.simA
        this.simA = this.simB
        this.simB = t
        this.stats.simSteps++
      }
    }
    r.autoClear = autoClear
    r.setRenderTarget(prev)
  }

  private clearTargets() {
    const r = this.renderer
    const prev = r.getRenderTarget()
    const cc = r.getClearAlpha()
    const col = r.getClearColor(new Color())
    r.setClearColor(0x000000, 0)
    for (const t of [this.crisp, this.simA, this.simB]) {
      r.setRenderTarget(t)
      r.clear(true, false, false)
    }
    r.setClearColor(col, cc)
    r.setRenderTarget(prev)
  }

  clear() {
    this.queue.length = 0
    this.eraseQueue.length = 0
    this.wetTimer = 0
    this.clearTargets()
  }

  dispose() {
    this.crisp.dispose()
    this.simA.dispose()
    this.simB.dispose()
    this.geo.dispose()
    for (const m of [this.crispMat, this.simStampMat, this.eraseCrispMat, this.eraseSimMat]) m.dispose()
    this.simPass.dispose()
    this.copyPass.dispose()
    this.copy1Pass.dispose()
  }
}
