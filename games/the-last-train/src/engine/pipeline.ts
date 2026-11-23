import {
  BufferGeometry, Color, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, NoToneMapping, OrthographicCamera, PCFShadowMap,
  ShaderMaterial, SRGBColorSpace, Vector2, WebGLRenderTarget, type Camera, type Scene, type Texture, type WebGLRenderer,
} from 'three'
import type { QualityPreset } from './quality'

/** 屏幕空间的“调色台”：每帧由游戏总控 / 导演 / 世界写入，最终在合成 Shader 里一次完成 */
export interface FxState {
  exposure: number
  bloom: number
  bloomThreshold: number
  vignette: number
  grain: number
  chroma: number
  /** 0 = 画面，1 = 全黑 */
  fade: number
  flash: Color
  saturation: number
  contrast: number
  /** 乘法色调（统一调色） */
  tint: Color
  /** 暗部抬升色 */
  lift: Color
  /** 时间冻结：去饱和 + 金色高光 + 轻微径向拉丝 */
  freeze: number
  /** 水下：色散波动 */
  underwater: number
  /** 电影黑边 0..1 */
  letterbox: number
  /** 睁眼：0 = 闭眼，1 = 完全睁开 */
  eyes: number
  /** 异常故障闪烁 */
  glitch: number
}

export const defaultFx = (): FxState => ({
  exposure: 1, bloom: 0.55, bloomThreshold: 1.1, vignette: 0.45, grain: 0.03, chroma: 0.0006, fade: 0, flash: new Color(0, 0, 0),
  saturation: 1, contrast: 1.03, tint: new Color(1, 1, 1), lift: new Color(0, 0, 0), freeze: 0, underwater: 0, letterbox: 0, eyes: 1, glitch: 0,
})

export function copyFx(dst: FxState, src: FxState) {
  dst.exposure = src.exposure; dst.bloom = src.bloom; dst.bloomThreshold = src.bloomThreshold; dst.vignette = src.vignette
  dst.grain = src.grain; dst.chroma = src.chroma; dst.fade = src.fade; dst.flash.copy(src.flash); dst.saturation = src.saturation
  dst.contrast = src.contrast; dst.tint.copy(src.tint); dst.lift.copy(src.lift); dst.freeze = src.freeze; dst.underwater = src.underwater
  dst.letterbox = src.letterbox; dst.eyes = src.eyes; dst.glitch = src.glitch
}

/** 线性插值两个调色状态（世界切换时平滑过渡） */
export function lerpFx(dst: FxState, a: FxState, b: FxState, t: number) {
  const l = (x: number, y: number) => x + (y - x) * t
  dst.exposure = l(a.exposure, b.exposure); dst.bloom = l(a.bloom, b.bloom); dst.bloomThreshold = l(a.bloomThreshold, b.bloomThreshold)
  dst.vignette = l(a.vignette, b.vignette); dst.grain = l(a.grain, b.grain); dst.chroma = l(a.chroma, b.chroma)
  dst.saturation = l(a.saturation, b.saturation); dst.contrast = l(a.contrast, b.contrast)
  dst.tint.copy(a.tint).lerp(b.tint, t); dst.lift.copy(a.lift).lerp(b.lift, t)
  dst.underwater = l(a.underwater, b.underwater)
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

// 双重滤波 Bloom：13 tap 降采样（首级带 Karis 平均和软阈值，防止高光闪烁）
const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 c) { return c / (1.0 + luma(c) * 0.25); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uPrefilter > 0.5) {
    vec3 g0 = karis((a + b + d + e) * 0.25), g1 = karis((b + c + e + f) * 0.25);
    vec3 g2 = karis((d + e + g + h) * 0.25), g3 = karis((e + f + h + i) * 0.25);
    vec3 g4 = karis((j + k + l + m) * 0.25);
    col = g4 * 0.5 + (g0 + g1 + g2 + g3) * 0.125;
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-5);
    col = min(col * max(soft, br - uThreshold) / max(br, 1e-5), vec3(30.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`

const UP = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(tLow, vUv).rgb * 4.0;
  c += (texture2D(tLow, vUv + vec2(-t.x, 0)).rgb + texture2D(tLow, vUv + vec2(t.x, 0)).rgb + texture2D(tLow, vUv + vec2(0, -t.y)).rgb + texture2D(tLow, vUv + vec2(0, t.y)).rgb) * 2.0;
  c += texture2D(tLow, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + c / 16.0 * 0.8, 1.0);
}
`

// 最终合成：色散 → Bloom → 曝光 → ACES → 调色 → 时间冻结 / 水下 → 暗角 → 黑边 / 睁眼 → 颗粒
const COMPOSITE = /* glsl */ `
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform float uHasBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure, uBloom, uVignette, uGrain, uChroma, uFade, uSaturation, uContrast;
uniform float uFreeze, uUnderwater, uLetterbox, uEyes, uGlitch;
uniform vec3 uFlash, uTint, uLift;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * rrtOdt(inM * c), 0.0, 1.0);
}
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  // 水下：缓慢的折射波动
  if (uUnderwater > 0.0) {
    uv += vec2(sin(uv.y * 18.0 + uTime * 1.3), cos(uv.x * 14.0 + uTime * 1.1)) * 0.0016 * uUnderwater;
  }
  // 异常故障：水平错位条带
  if (uGlitch > 0.0) {
    float row = floor(uv.y * 48.0);
    float g = step(1.0 - uGlitch * 0.35, hash(vec2(row, floor(uTime * 24.0))));
    uv.x += (hash(vec2(row * 1.7, floor(uTime * 31.0))) - 0.5) * 0.06 * g * uGlitch;
  }
  vec2 cc = uv - 0.5;
  float ca = uChroma + uGlitch * 0.006 + uUnderwater * 0.0015;
  vec3 col;
  col.r = texture2D(tHdr, uv - cc * ca).r;
  col.g = texture2D(tHdr, uv).g;
  col.b = texture2D(tHdr, uv + cc * ca).b;
  // 时间冻结：向画面中心的径向拉丝（像被定格的长曝光）
  if (uFreeze > 0.0) {
    vec3 acc = vec3(0.0);
    for (int i = 1; i <= 6; i++) acc += texture2D(tHdr, uv - cc * float(i) * 0.006 * uFreeze).rgb;
    col = mix(col, acc / 6.0, 0.45 * uFreeze);
  }
  if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  col = col * uTint + uLift * (1.0 - col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  // 时间冻结：冷暗部 + 金色高光
  col = mix(col, mix(vec3(0.16, 0.17, 0.2) * l * 2.0, vec3(1.05, 0.86, 0.55) * l * 1.25, smoothstep(0.15, 0.85, l)), uFreeze * 0.55);
  // 水下：远端吸收红光
  col = mix(col, col * vec3(0.55, 0.92, 1.08), uUnderwater * 0.5);
  vec2 vv = cc * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, smoothstep(1.25, 0.18, length(vv)), uVignette);
  col = clamp(col, 0.0, 1.0) + uFlash;
  col = mix(col, vec3(0.0), uFade);
  // 睁眼：上下眼睑，边缘柔和并带一点弧度
  if (uEyes < 1.0) {
    float open = uEyes * 0.62;
    float lid = abs(vUv.y - 0.5) + pow(abs(vUv.x - 0.5), 2.0) * 0.35;
    col *= smoothstep(open + 0.04, open - 0.06, lid) * smoothstep(0.0, 0.25, uEyes);
  }
  // 电影黑边（2.39:1 左右）
  if (uLetterbox > 0.0) {
    float bar = uLetterbox * 0.12;
    col *= step(bar, vUv.y) * step(vUv.y, 1.0 - bar);
  }
  vec3 o = toSrgb(clamp(col, 0.0, 1.0));
  float g = hash(gl_FragCoord.xy + fract(uTime * 13.7) * 311.0) - 0.5;
  o += g * uGrain + (hash(gl_FragCoord.xy * 1.3 + 7.1) - 0.5) / 255.0;
  gl_FragColor = vec4(o, 1.0);
}
`

const tri = new BufferGeometry()
tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
tri.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))

class Pass {
  readonly mesh: Mesh
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  constructor(public material: ShaderMaterial) {
    this.mesh = new Mesh(tri, material)
    this.mesh.frustumCulled = false
  }
  render(r: WebGLRenderer, t: WebGLRenderTarget | null) {
    r.setRenderTarget(t)
    r.render(this.mesh, this.cam)
  }
}

/** HDR 场景渲染 → 双重滤波 Bloom → ACES 合成 */
export class Pipeline {
  private hdr: WebGLRenderTarget
  private down: WebGLRenderTarget[] = []
  private up: WebGLRenderTarget[] = []
  private readonly dp: Pass
  private readonly upp: Pass
  private readonly cp: Pass
  private w = 2
  private h = 2
  readonly size = new Vector2(2, 2)

  constructor(readonly renderer: WebGLRenderer, private q: QualityPreset) {
    renderer.autoClear = false
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = SRGBColorSpace
    renderer.shadowMap.enabled = true
    // 注：r187 已移除 PCFSoftShadowMap：一开始就用 PCF + shadow.radius，否则先编译的材质会全黑
    renderer.shadowMap.type = PCFShadowMap
    this.hdr = this.makeHdr()
    const mk = (frag: string, uniforms: Record<string, { value: unknown }>) =>
      new Pass(new ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false }))
    this.dp = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 1.1 } })
    this.upp = mk(UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new Vector2() } })
    this.cp = mk(COMPOSITE, {
      tHdr: { value: null }, tBloom: { value: null }, uHasBloom: { value: 1 }, uRes: { value: new Vector2() }, uTime: { value: 0 },
      uExposure: { value: 1 }, uBloom: { value: 0.5 }, uVignette: { value: 0.5 }, uGrain: { value: 0.04 }, uChroma: { value: 0.001 },
      uFade: { value: 0 }, uSaturation: { value: 1 }, uContrast: { value: 1 }, uFlash: { value: new Color() }, uTint: { value: new Color(1, 1, 1) },
      uLift: { value: new Color() }, uFreeze: { value: 0 }, uUnderwater: { value: 0 }, uLetterbox: { value: 0 }, uEyes: { value: 1 }, uGlitch: { value: 0 },
    })
  }

  private makeHdr() {
    const t = new WebGLRenderTarget(this.w, this.h, { type: HalfFloatType, samples: this.q.msaa, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter })
    t.texture.generateMipmaps = false
    return t
  }

  setQuality(q: QualityPreset) {
    const remake = q.msaa !== this.q.msaa
    this.q = q
    if (remake) {
      this.hdr.dispose()
      this.hdr = this.makeHdr()
    }
    this.resize()
  }

  setSize(w: number, h: number) {
    this.size.set(w, h)
    this.resize()
  }

  get renderSize() {
    return { w: this.w, h: this.h }
  }

  private resize() {
    this.w = Math.max(2, Math.round(this.size.x * this.q.renderScale))
    this.h = Math.max(2, Math.round(this.size.y * this.q.renderScale))
    this.hdr.setSize(this.w, this.h)
    for (const t of [...this.down, ...this.up]) t.dispose()
    this.down = []
    this.up = []
    let bw = this.w, bh = this.h
    for (let i = 0; i < this.q.bloomLevels; i++) {
      bw = Math.max(1, bw >> 1)
      bh = Math.max(1, bh >> 1)
      const o = { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter }
      const d = new WebGLRenderTarget(bw, bh, o)
      d.texture.generateMipmaps = false
      const u = new WebGLRenderTarget(bw, bh, o)
      u.texture.generateMipmaps = false
      this.down.push(d)
      this.up.push(u)
    }
  }

  render(scene: Scene, camera: Camera, fx: FxState, time: number) {
    const r = this.renderer
    r.setRenderTarget(this.hdr)
    r.clear(true, true, false)
    r.render(scene, camera)
    let bloom: Texture | null = null
    if (this.q.bloom && fx.bloom > 0 && this.down.length > 1) {
      let src: Texture = this.hdr.texture
      let sw = this.w, sh = this.h
      const dm = this.dp.material.uniforms
      dm.uThreshold.value = fx.bloomThreshold
      for (let i = 0; i < this.down.length; i++) {
        dm.tSrc.value = src
        dm.uTexel.value.set(1 / sw, 1 / sh)
        dm.uPrefilter.value = i === 0 ? 1 : 0
        this.dp.render(r, this.down[i])
        src = this.down[i].texture
        sw = this.down[i].width
        sh = this.down[i].height
      }
      const um = this.upp.material.uniforms
      let low: Texture = this.down[this.down.length - 1].texture
      for (let i = this.down.length - 2; i >= 0; i--) {
        um.tLow.value = low
        um.tHigh.value = this.down[i].texture
        um.uTexel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height)
        this.upp.render(r, this.up[i])
        low = this.up[i].texture
      }
      bloom = low
    }
    const u = this.cp.material.uniforms
    u.tHdr.value = this.hdr.texture
    u.tBloom.value = bloom
    u.uHasBloom.value = bloom ? 1 : 0
    u.uRes.value.copy(this.size)
    u.uTime.value = time
    u.uExposure.value = fx.exposure
    u.uBloom.value = fx.bloom
    u.uVignette.value = fx.vignette
    u.uGrain.value = fx.grain
    u.uChroma.value = fx.chroma
    u.uFade.value = fx.fade
    u.uSaturation.value = fx.saturation
    u.uContrast.value = fx.contrast
    u.uFreeze.value = fx.freeze
    u.uUnderwater.value = fx.underwater
    u.uLetterbox.value = fx.letterbox
    u.uEyes.value = fx.eyes
    u.uGlitch.value = fx.glitch
    ;(u.uFlash.value as Color).copy(fx.flash)
    ;(u.uTint.value as Color).copy(fx.tint)
    ;(u.uLift.value as Color).copy(fx.lift)
    r.setRenderTarget(null)
    this.cp.render(r, null)
  }

  dispose() {
    this.hdr.dispose()
    for (const t of [...this.down, ...this.up]) t.dispose()
    this.dp.material.dispose()
    this.upp.material.dispose()
    this.cp.material.dispose()
  }
}
