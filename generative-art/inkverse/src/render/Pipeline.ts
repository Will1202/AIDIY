import {
  DepthTexture,
  LinearFilter,
  NearestFilter,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three'
import { FullscreenPass, FULLSCREEN_VERT } from './FullscreenPass'
import { NOISE } from './glsl'
import { U } from './uniforms'
import type { QualitySettings } from '../engine/Quality'

/**
 * NPR composite: turns the lit scene into an ink painting.
 *  - brush outlines from depth discontinuities (width/breaks jittered like a dry brush)
 *  - atmospheric perspective: ink fades toward the paper colour with distance (墨分远近)
 *  - stacked mist sheets intersected per pixel (云锁山腰 / 云海) with soft contact
 *  - paper sky with a vermilion sun or pale moon, wash clouds
 *  - screen-space paper grain + aged vignette
 */
const COMPOSITE = /* glsl */ `
${NOISE}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D uPaperTex;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCam;
uniform float uNear;
uniform float uFar;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uMist;
uniform float uNight;
uniform float uSunset;
uniform float uRain;
uniform float uWind;
uniform float uAwaken;
uniform float uScaleY;
uniform float uFog;
uniform int uEdgeTaps;
uniform int uMistLayers;
uniform float uMistAmount;
uniform float uEdgeWidth;
uniform float uFade;
varying vec2 vUv;

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
vec3 worldFrom(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * c;
  v /= v.w;
  return (uViewInv * v).xyz;
}

vec3 sky(vec3 rd) {
  float h = rd.y;
  vec3 hor = uMist;
  vec3 zen = mix(uMist * vec3(0.93, 0.95, 0.985), uMist * vec3(0.78, 0.8, 0.86), uNight);
  vec3 c = mix(hor, zen, smoothstep(0.0, 0.65, h));
  // sunset glow along the horizon
  float toward = max(dot(normalize(rd.xz + 1e-4), normalize(uSunDir.xz + 1e-4)), 0.0);
  c = mix(c, c * vec3(1.05, 0.86, 0.72), uSunset * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.7);
  // sun / moon disc with an ink-wash edge
  float ang = acos(clamp(dot(rd, normalize(uSunDir)), -1.0, 1.0));
  float r = mix(mix(0.045, 0.06, uSunset), 0.035, uNight);
  float rag = (vnoise(rd.xy * 70.0 + rd.z * 30.0) - 0.5) * 0.12;
  float disc = 1.0 - smoothstep(r * (0.9 + rag), r * 1.06, ang);
  vec3 dc = mix(vec3(0.9, 0.86, 0.78), vec3(0.78, 0.2, 0.12), uSunset);
  dc = mix(dc, vec3(0.95, 0.94, 0.88), uNight);
  float da = disc * mix(mix(0.18, 0.92, uSunset), 0.95, uNight) * (1.0 - uRain * 0.85);
  c = mix(c, dc, da);
  c += dc * exp(-ang * ang * 26.0) * (0.12 * uSunset + 0.1 * uNight) * (1.0 - uRain);
  // ink-wash cloud bands
  vec2 cp = rd.xz / max(h + 0.15, 0.06);
  float flow = uTime * (0.012 + uWind * 0.06);
  float cl = fbm2(cp * vec2(0.55, 1.1) + vec2(flow, flow * 0.3));
  float band = smoothstep(0.05, 0.6, cl + uRain * 0.4) * smoothstep(-0.02, 0.12, h) * (1.0 - smoothstep(0.3, 0.85, h));
  c = mix(c, c * mix(0.88, 0.72, uRain), band * 0.55);
  // stars
  if (uNight > 0.01) {
    vec2 sc = rd.xz / max(h, 0.05) * 60.0;
    float st = step(0.996, hash12(floor(sc))) * smoothstep(0.1, 0.4, h);
    c += st * uNight * (1.0 - uRain) * 0.5;
  }
  return c;
}

float edgeAt(vec2 uv, float zc) {
  float w = uEdgeWidth * (0.55 + 0.9 * vnoise(uv * uRes / 7.0));
  vec2 px = w / uRes;
  // inverse depth is linear across a plane in screen space, so flat ground at grazing
  // angles produces no false lines; only silhouettes and sharp creases do
  float ic = 1.0 / zc;
  float sum = 0.0;
  float maxd = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uEdgeTaps) break;
    float a = float(i) * 6.2831853 / float(uEdgeTaps) + 0.4;
    vec2 o = vec2(cos(a), sin(a)) * px;
    float iz = 1.0 / linDepth(texture(tDepth, uv + o).r);
    float dz = (ic - iz) / ic;
    sum += dz;
    maxd = max(maxd, dz);
  }
  float lap = sum / float(uEdgeTaps);
  float e = smoothstep(0.01, 0.045, lap) * 0.65 + smoothstep(0.04, 0.22, maxd) * 0.45;
  // dry-brush breaks along the line
  float brk = smoothstep(0.18, 0.6, vnoise(uv * uRes / 3.0 + 11.0));
  return clamp(e, 0.0, 1.0) * mix(0.45, 1.0, brk);
}

void main() {
  vec2 uv = vUv;
  // absorbent-paper wobble on every edge
  vec2 wob = (vec2(vnoise(uv * uRes / 5.0), vnoise(uv * uRes / 5.0 + 17.0)) - 0.5) * 1.6 / uRes;
  float d = texture(tDepth, uv).r;
  vec3 wp = worldFrom(uv, d);
  vec3 rdv = worldFrom(uv, 1.0) - uCam;
  vec3 rd = normalize(rdv);
  bool isSky = d >= 0.999999;
  float dist = isSky ? 1e5 : length(wp - uCam);
  vec3 col = isSky ? sky(rd) : texture(tColor, uv + wob).rgb;

  if (!isSky) {
    float zc = linDepth(d);
    float e = edgeAt(uv, zc);
    float far = smoothstep(40.0, 900.0, dist);
    col = mix(col, uInk * 1.1, e * (0.9 - far * 0.7));
    // atmospheric perspective (远景淡化)
    float fog = 1.0 - exp(-pow(dist * uFog, 1.25));
    fog *= mix(1.0, 0.55, smoothstep(10.0, 140.0, wp.y));
    // 留白: beyond the painted sheet the land dissolves into blank mist
    float beyond = smoothstep(${(120 - 30).toFixed(1)}, ${(120 + 70).toFixed(1)}, max(abs(wp.x), abs(wp.z))) * (1.0 - smoothstep(20.0, 160.0, wp.y));
    fog = max(fog, beyond * 0.92);
    col = mix(col, uMist, clamp(fog, 0.0, 1.0) * uAwaken);
  }

  // stacked mist sheets
  if (uAwaken > 0.01 && uMistLayers > 0) {
    float drift = uTime * (0.6 + uWind * 3.5);
    for (int i = 0; i < 3; i++) {
      if (i >= uMistLayers) break;
      float fi = float(i);
      float hL = (2.4 + fi * 8.0 + fi * fi * 3.0) * uScaleY;
      float t = (hL - uCam.y) / rd.y;
      if (t > 0.0 && t < dist) {
        vec3 p = uCam + rd * t;
        vec2 q = p.xz * (0.016 - fi * 0.003) + vec2(drift * 0.004 * (1.0 + fi * 0.5), fi * 3.7);
        float n = fbm3o(q) + fbm3o(q * 2.7 + 5.0) * 0.35;
        float a = smoothstep(0.12 - fi * 0.05 - uRain * 0.25, 0.55, n) * (fi < 0.5 ? 0.32 : mix(0.5, 0.4, fi / 2.0)) * uMistAmount;
        a *= smoothstep(6.0, 60.0, t) * (1.0 - smoothstep(500.0, 1400.0, t));
        a *= smoothstep(0.0, 12.0 + fi * 6.0, dist - t);
        col = mix(col, uMist, clamp(a, 0.0, 1.0) * uAwaken);
      }
    }
  }

  // rain veil
  col = mix(col, uMist * 0.92, uRain * 0.12 * uAwaken);

  // paper grain over everything (the whole frame stays a painting)
  vec2 suv = uv * uRes / 820.0;
  vec3 pg = texture(uPaperTex, suv).rgb;
  float grain = (pg.r - 0.5) * 0.09 + (pg.b - 0.5) * 0.025;
  col *= 1.0 + grain;
  float stain = fbm3o(uv * vec2(uRes.x / uRes.y, 1.0) * 2.2 + 3.0);
  col *= 1.0 + stain * 0.025;
  // aged vignette
  vec2 vq = uv - 0.5;
  float vig = smoothstep(0.35, 0.95, length(vq * vec2(uRes.x / uRes.y, 1.0) * 0.82));
  col = mix(col, col * vec3(0.86, 0.8, 0.72), vig * mix(0.55, 0.85, uNight));
  col = mix(uPaper, col, uFade);
  gl_FragColor = vec4(col, 1.0);
}
`

export class Pipeline {
  readonly sceneRT: WebGLRenderTarget
  readonly composite: FullscreenPass
  readonly mat: ShaderMaterial
  private size = new Vector2()

  constructor(private renderer: WebGLRenderer, q: QualitySettings) {
    const depth = new DepthTexture(16, 16, UnsignedIntType)
    this.sceneRT = new WebGLRenderTarget(16, 16, { magFilter: LinearFilter, minFilter: LinearFilter, depthTexture: depth, depthBuffer: true })
    depth.magFilter = NearestFilter
    depth.minFilter = NearestFilter
    this.mat = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.sceneRT.texture },
        tDepth: { value: depth },
        uPaperTex: U.uPaperTex,
        uProjInv: { value: null },
        uViewInv: { value: null },
        uCam: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 3000 },
        uRes: { value: new Vector2(1, 1) },
        uTime: U.uTime,
        uSunDir: U.uSunDir,
        uPaper: U.uPaper,
        uInk: U.uInk,
        uMist: U.uMist,
        uNight: U.uNight,
        uSunset: U.uSunset,
        uRain: U.uRain,
        uWind: U.uWind,
        uAwaken: U.uAwaken,
        uScaleY: U.uScaleY,
        uFog: { value: 0.0026 },
        uEdgeTaps: { value: q.edgeTaps },
        uMistLayers: { value: q.mistLayers },
        uMistAmount: { value: 1 },
        uEdgeWidth: { value: 1.6 },
        uFade: { value: 1 },
      },
    })
    this.composite = new FullscreenPass(this.mat)
  }

  setQuality(q: QualitySettings) {
    this.mat.uniforms.uEdgeTaps.value = q.edgeTaps
    this.mat.uniforms.uMistLayers.value = q.mistLayers
  }

  setSize(w: number, h: number, pixelRatio: number) {
    const W = Math.max(2, Math.round(w * pixelRatio))
    const H = Math.max(2, Math.round(h * pixelRatio))
    this.size.set(W, H)
    this.sceneRT.setSize(W, H)
    this.mat.uniforms.uRes.value.set(W, H)
    this.mat.uniforms.uEdgeWidth.value = 1.25 * Math.max(1, pixelRatio * Math.min(1.4, h / 900))
  }

  render(scene: Scene, camera: PerspectiveCamera) {
    const r = this.renderer
    r.setRenderTarget(this.sceneRT)
    r.clear()
    r.render(scene, camera)
    const u = this.mat.uniforms
    u.uProjInv.value = camera.projectionMatrixInverse
    u.uViewInv.value = camera.matrixWorld
    u.uCam.value = camera.position
    u.uNear.value = camera.near
    u.uFar.value = camera.far
    this.composite.render(r, null)
  }

  dispose() {
    this.sceneRT.depthTexture?.dispose()
    this.sceneRT.dispose()
    this.composite.dispose()
  }
}
