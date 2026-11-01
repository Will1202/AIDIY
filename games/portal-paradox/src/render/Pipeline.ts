import {
  Color, HalfFloatType, LinearFilter, NoToneMapping, PCFShadowMap, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, Vector4,
  WebGLRenderTarget, type PerspectiveCamera, type Scene, type Texture, type WebGLRenderer,
} from 'three'
import { FS_VERT, FullscreenPass } from './FullscreenPass'
import { PortalRenderer } from '../portal/PortalRenderer'
import type { Portal, WorldId } from '../portal/Portal'
import type { QualityPreset } from '../engine/Quality'

/** Screen-space look controls, written by the engine / director every frame. */
export interface FxState {
  exposure: number
  bloom: number
  vignette: number
  grain: number
  chroma: number
  /** 0 = picture, 1 = black */
  fade: number
  flash: Color
  /** 0..1 cinematic bars */
  letterbox: number
  /** 0..1 time-rewind look */
  rewind: number
  /** gravity shockwave: x, y (uv), radius, strength */
  shock: Vector4
  saturation: number
  contrast: number
  /** frame aspect for the bars (width / height), 0 = none */
  barAspect: number
}

export function defaultFx(): FxState {
  return {
    exposure: 1, bloom: 0.55, vignette: 0.55, grain: 0.045, chroma: 0.0018, fade: 0, flash: new Color(0, 0, 0),
    letterbox: 0, rewind: 0, shock: new Vector4(0.5, 0.5, 0, 0), saturation: 1, contrast: 1, barAspect: 0,
  }
}

const DOWN_FRAG = /* glsl */ `
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
    // Karis-weighted groups suppress single-pixel fireflies (specular sparkles)
    vec3 g0 = karis((a + b + d + e) * 0.25), g1 = karis((b + c + e + f) * 0.25);
    vec3 g2 = karis((d + e + g + h) * 0.25), g3 = karis((e + f + h + i) * 0.25);
    vec3 g4 = karis((j + k + l + m) * 0.25);
    col = g4 * 0.5 + (g0 + g1 + g2 + g3) * 0.125;
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-5);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
    col = min(col * contrib, vec3(60.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D(tLow, vUv).rgb * 4.0;
  c += (texture2D(tLow, vUv + vec2(-t.x, 0)).rgb + texture2D(tLow, vUv + vec2(t.x, 0)).rgb + texture2D(tLow, vUv + vec2(0, -t.y)).rgb + texture2D(tLow, vUv + vec2(0, t.y)).rgb) * 2.0;
  c += texture2D(tLow, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + c / 16.0, 1.0);
}
`

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform float uHasBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure, uBloom, uVignette, uGrain, uChroma, uFade, uLetterbox, uRewind, uSaturation, uContrast, uBarAspect;
uniform vec3 uFlash;
uniform vec4 uShock;
varying vec2 vUv;

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// Stephen Hill's fitted ACES (RRT + ODT), applied in linear sRGB-primaries space
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * rrtOdt(inM * c), 0.0, 1.0);
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  // gravity shockwave: a refractive ring travelling outwards
  if (uShock.w > 0.0) {
    vec2 d = uv - uShock.xy;
    d.x *= uRes.x / uRes.y;
    float r = length(d);
    float ring = exp(-pow((r - uShock.z) * 14.0, 2.0)) * uShock.w;
    uv -= normalize(d + 1e-5) * ring * 0.035 * vec2(uRes.y / uRes.x, 1.0);
  }
  // rewind: horizontal tape wobble
  if (uRewind > 0.0) {
    // two soft tracking bands roll up the frame; between them only a faint shimmer
    float band = smoothstep(0.0, 0.02, fract(uv.y * 1.3 - uTime * 0.9)) * smoothstep(0.06, 0.02, fract(uv.y * 1.3 - uTime * 0.9));
    uv.x += (hash(vec2(floor(uv.y * 90.0), floor(uTime * 24.0))) - 0.5) * 0.0012 * uRewind + band * 0.006 * uRewind;
  }
  vec2 cc = uv - 0.5;
  float ca = uChroma * (1.0 + uRewind * 3.0);
  vec3 col;
  col.r = texture2D(tHdr, uv - cc * ca).r;
  col.g = texture2D(tHdr, uv).g;
  col.b = texture2D(tHdr, uv + cc * ca).b;
  if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  // grade
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation * (1.0 - uRewind * 0.55));
  col = (col - 0.5) * uContrast + 0.5;
  col = mix(col, col * vec3(0.86, 0.98, 1.12) + vec3(0.0, 0.01, 0.03) * (1.0 - l), uRewind * 0.6);
  // vignette
  vec2 vv = cc * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, smoothstep(1.25, 0.25, length(vv)), uVignette);
  col = clamp(col, 0.0, 1.0);
  col += uFlash;
  // rewind scanlines
  col *= 1.0 - uRewind * 0.12 * (0.5 + 0.5 * sin(gl_FragCoord.y * 1.7));
  col = mix(col, vec3(0.0), uFade);
  vec3 outc = toSrgb(clamp(col, 0.0, 1.0));
  // film grain + dither (after encoding, so it is perceptually uniform)
  float g = hash(gl_FragCoord.xy + fract(uTime * 13.7) * 311.0) - 0.5;
  outc += g * uGrain + (hash(gl_FragCoord.xy * 1.3 + 7.1) - 0.5) / 255.0;
  // cinematic bars
  if (uLetterbox > 0.0) {
    float target = uBarAspect > 0.0 ? uBarAspect : 2.39;
    float frameAspect = uRes.x / uRes.y;
    float barH = max(0.0, 0.5 - 0.5 * frameAspect / target) * uLetterbox;
    if (vUv.y < barH || vUv.y > 1.0 - barH) outc = vec3(0.0);
  }
  gl_FragColor = vec4(outc, 1.0);
}
`

export class Pipeline {
  readonly portalRenderer: PortalRenderer
  private hdr: WebGLRenderTarget
  private down: WebGLRenderTarget[] = []
  private up: WebGLRenderTarget[] = []
  private readonly downPass: FullscreenPass
  private readonly upPass: FullscreenPass
  private readonly compPass: FullscreenPass
  private q: QualityPreset
  private width = 1
  private height = 1
  /** frame counter for staggered shadow updates */
  private frame = 0
  private shadowedThisFrame = [false, false]
  readonly size = new Vector2()

  constructor(readonly renderer: WebGLRenderer, portals: Portal[], q: QualityPreset) {
    this.q = q
    renderer.autoClear = false
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = SRGBColorSpace
    renderer.localClippingEnabled = true
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    this.hdr = this.makeHdr()
    this.portalRenderer = new PortalRenderer(renderer, portals)
    const mk = (frag: string, uniforms: Record<string, { value: unknown }>) =>
      new FullscreenPass(new ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false }))
    this.downPass = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 1.1 } })
    this.upPass = mk(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new Vector2() }, uRadius: { value: 1 } })
    this.compPass = mk(COMPOSITE_FRAG, {
      tHdr: { value: null }, tBloom: { value: null }, uHasBloom: { value: 1 }, uRes: { value: new Vector2() }, uTime: { value: 0 },
      uExposure: { value: 1 }, uBloom: { value: 0.5 }, uVignette: { value: 0.5 }, uGrain: { value: 0.04 }, uChroma: { value: 0.002 },
      uFade: { value: 0 }, uLetterbox: { value: 0 }, uRewind: { value: 0 }, uSaturation: { value: 1 }, uContrast: { value: 1 },
      uBarAspect: { value: 0 }, uFlash: { value: new Vector3() }, uShock: { value: new Vector4() },
    })
  }

  private makeHdr() {
    const t = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, samples: this.q.msaa, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter })
    t.texture.generateMipmaps = false
    return t
  }

  setQuality(q: QualityPreset) {
    const msaaChanged = q.msaa !== this.q.msaa
    this.q = q
    if (msaaChanged) {
      this.hdr.dispose()
      this.hdr = this.makeHdr()
    }
    this.resize()
  }

  /** drawing-buffer size of the canvas (already includes devicePixelRatio) */
  setSize(w: number, h: number) {
    this.size.set(w, h)
    this.resize()
  }

  private resize() {
    const w = Math.max(2, Math.round(this.size.x * this.q.renderScale))
    const h = Math.max(2, Math.round(this.size.y * this.q.renderScale))
    this.width = w
    this.height = h
    this.hdr.setSize(w, h)
    this.portalRenderer.setSize(w * this.q.portalScale, h * this.q.portalScale)
    for (const t of [...this.down, ...this.up]) t.dispose()
    this.down = []
    this.up = []
    let bw = w, bh = h
    for (let i = 0; i < this.q.bloomLevels; i++) {
      bw = Math.max(1, bw >> 1)
      bh = Math.max(1, bh >> 1)
      const opts = { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter }
      const d = new WebGLRenderTarget(bw, bh, opts)
      d.texture.generateMipmaps = false
      this.down.push(d)
      const u = new WebGLRenderTarget(bw, bh, opts)
      u.texture.generateMipmaps = false
      this.up.push(u)
    }
  }

  get hdrSize() {
    return [this.width, this.height] as const
  }

  /** shadow maps are global renderer state: refresh them once per scene per frame */
  private prepareScene = (w: WorldId) => {
    const r = this.renderer
    if (!this.shadowedThisFrame[w] && this.frame % this.q.shadowInterval === 0) {
      r.shadowMap.needsUpdate = true
      this.shadowedThisFrame[w] = true
    } else {
      r.shadowMap.needsUpdate = false
    }
  }

  render(camera: PerspectiveCamera, world: WorldId, scenes: Scene[], portals: Portal[], fx: FxState, time: number, onScene?: (w: WorldId) => void) {
    const r = this.renderer
    this.frame++
    this.shadowedThisFrame[0] = this.shadowedThisFrame[1] = false
    for (const s of scenes) s.updateMatrixWorld()
    camera.updateMatrixWorld()

    const before = (w: WorldId) => {
      onScene?.(w)
      this.prepareScene(w)
    }
    // 1 — every view through every visible portal, deepest first
    this.portalRenderer.render(camera, world, scenes, this.q.recursion, this.q.minPortalPixels, before)

    // 2 — main view
    for (const p of portals) {
      p.fitSurfaceTo(camera.position)
      p.surfaceMat.uniforms.uTarget.value.set(this.width, this.height)
    }
    before(world)
    r.setRenderTarget(this.hdr)
    r.clear(true, true, false)
    r.render(scenes[world], camera)

    // 3 — bloom
    let bloomTex: Texture | null = null
    if (this.q.bloom && fx.bloom > 0 && this.down.length > 1) {
      const dm = this.downPass.material
      let src: Texture = this.hdr.texture
      let sw = this.width, sh = this.height
      for (let i = 0; i < this.down.length; i++) {
        dm.uniforms.tSrc.value = src
        dm.uniforms.uTexel.value.set(1 / sw, 1 / sh)
        dm.uniforms.uPrefilter.value = i === 0 ? 1 : 0
        this.downPass.render(r, this.down[i])
        src = this.down[i].texture
        sw = this.down[i].width
        sh = this.down[i].height
      }
      const um = this.upPass.material
      let low: Texture = this.down[this.down.length - 1].texture
      for (let i = this.down.length - 2; i >= 0; i--) {
        um.uniforms.tLow.value = low
        um.uniforms.tHigh.value = this.down[i].texture
        um.uniforms.uTexel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height)
        um.uniforms.uRadius.value = 1
        this.upPass.render(r, this.up[i])
        low = this.up[i].texture
      }
      bloomTex = low
    }

    // 4 — composite to screen
    const u = this.compPass.material.uniforms
    u.tHdr.value = this.hdr.texture
    u.tBloom.value = bloomTex
    u.uHasBloom.value = bloomTex ? 1 : 0
    u.uRes.value.copy(this.size)
    u.uTime.value = time
    u.uExposure.value = fx.exposure
    u.uBloom.value = fx.bloom
    u.uVignette.value = fx.vignette
    u.uGrain.value = fx.grain
    u.uChroma.value = fx.chroma
    u.uFade.value = fx.fade
    u.uLetterbox.value = fx.letterbox
    u.uRewind.value = fx.rewind
    u.uSaturation.value = fx.saturation
    u.uContrast.value = fx.contrast
    u.uBarAspect.value = fx.barAspect
    u.uFlash.value.set(fx.flash.r, fx.flash.g, fx.flash.b)
    u.uShock.value.copy(fx.shock)
    r.setRenderTarget(null)
    r.setViewport(0, 0, this.size.x / r.getPixelRatio(), this.size.y / r.getPixelRatio())
    this.compPass.render(r, null)
  }

  dispose() {
    this.hdr.dispose()
    this.portalRenderer.dispose()
    for (const t of [...this.down, ...this.up]) t.dispose()
  }
}
