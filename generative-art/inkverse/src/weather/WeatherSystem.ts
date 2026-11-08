import { BufferAttribute, BufferGeometry, Color, LineSegments, ShaderMaterial, Vector3, type Camera } from 'three'
import { U } from '../render/uniforms'
import { clamp, damp, lerp } from '../util/math'
import type { TimeOfDay } from '../state/store'

/**
 * WORLD CONTROL: time of day (day → sunset → night) and rain / wind, all blended
 * continuously into the shared uniforms. Nothing is swapped: the palette, the light,
 * the sky disc and the fog drift toward their targets over a few seconds.
 */

interface Key {
  sun: Vector3
  paper: Color
  ink: Color
  mist: Color
  tint: Color
}

const KEYS: Key[] = [
  // day — warm white xuan paper, neutral sumi
  { sun: new Vector3(-0.5, 0.75, 0.42).normalize(), paper: new Color(0.937, 0.905, 0.84), ink: new Color(0.075, 0.07, 0.068), mist: new Color(0.93, 0.91, 0.86), tint: new Color(1, 0.98, 0.94) },
  // sunset — the sheet warms, a vermilion sun sinks behind the far ranges
  { sun: new Vector3(-0.22, 0.17, -1).normalize(), paper: new Color(0.945, 0.875, 0.765), ink: new Color(0.12, 0.08, 0.065), mist: new Color(0.95, 0.865, 0.765), tint: new Color(1.06, 0.9, 0.75) },
  // night — indigo paper, moonlit ridges
  { sun: new Vector3(0.42, 0.5, -0.76).normalize(), paper: new Color(0.2, 0.215, 0.265), ink: new Color(0.025, 0.03, 0.045), mist: new Color(0.25, 0.27, 0.33), tint: new Color(0.78, 0.86, 1.05) },
]

const RAIN_VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec3 uCam;
attribute vec4 aSeed; // x,z offset, phase, length
attribute float aEnd;
varying float vA;
void main() {
  float box = 70.0;
  float h = 50.0;
  float speed = 46.0;
  vec3 p;
  p.x = uCam.x + (fract(aSeed.x - uCam.x / box) - 0.5) * box;
  p.z = uCam.z + (fract(aSeed.y - uCam.z / box) - 0.5) * box;
  p.y = uCam.y - h * 0.5 + fract(aSeed.z - uTime * speed / h) * h;
  vec3 dir = normalize(vec3(uWind * 0.45, -1.0, uWind * 0.12));
  p += dir * aSeed.w * aEnd;
  vA = 1.0 - aEnd * 0.6;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`
const RAIN_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uRain;
varying float vA;
void main() { gl_FragColor = vec4(uInk, 0.32 * uRain * vA); }
`

export class WeatherSystem {
  time: TimeOfDay = 'day'
  rain = false
  wind = false
  /** continuous state */
  t = 0
  rainK = 0
  windK = 0
  readonly rainLines: LineSegments
  private rainMat: ShaderMaterial
  private tmpC = new Color()
  private tmpV = new Vector3()
  fogMul = 1

  constructor(count: number) {
    const geo = this.rainGeometry(count)
    this.rainMat = new ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: { uTime: U.uTime, uWind: U.uWind, uInk: U.uInk, uRain: U.uRain, uCam: { value: new Vector3() } },
      transparent: true,
      depthWrite: false,
    })
    this.rainLines = new LineSegments(geo, this.rainMat)
    this.rainLines.frustumCulled = false
    this.rainLines.visible = false
    this.rainLines.renderOrder = 5
  }

  private rainGeometry(count: number) {
    const seed = new Float32Array(count * 2 * 4)
    const end = new Float32Array(count * 2)
    const pos = new Float32Array(count * 2 * 3)
    for (let i = 0; i < count; i++) {
      const a = Math.random()
      const b = Math.random()
      const c = Math.random()
      const len = 0.8 + Math.random() * 1.2
      for (let k = 0; k < 2; k++) {
        seed.set([a, b, c, len], (i * 2 + k) * 4)
        end[i * 2 + k] = k
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new BufferAttribute(seed, 4))
    g.setAttribute('aEnd', new BufferAttribute(end, 1))
    return g
  }

  setRainCount(count: number) {
    this.rainLines.geometry.dispose()
    this.rainLines.geometry = this.rainGeometry(count)
  }

  /** jump to a state without blending (reset / cinematic start) */
  snap() {
    this.t = this.time === 'day' ? 0 : this.time === 'sunset' ? 1 : 2
    this.rainK = this.rain ? 1 : 0
    this.windK = this.wind ? 1 : 0
    this.apply()
  }

  update(dt: number, cam: Camera) {
    const target = this.time === 'day' ? 0 : this.time === 'sunset' ? 1 : 2
    // go through sunset when moving between day and night, like real dusk
    this.t = damp(this.t, target, 0.55, dt)
    if (Math.abs(this.t - target) < 0.002) this.t = target
    this.rainK = damp(this.rainK, this.rain ? 1 : 0, 0.7, dt)
    this.windK = damp(this.windK, this.wind ? 1 : 0, 0.8, dt)
    this.apply()
    this.rainLines.visible = this.rainK > 0.01
    this.rainMat.uniforms.uCam.value.copy(cam.position)
  }

  private apply() {
    const t = clamp(this.t, 0, 2)
    const i = Math.min(1, Math.floor(t))
    const f = t - i
    const a = KEYS[i]
    const b = KEYS[i + 1]
    U.uSunDir.value.copy(this.tmpV.copy(a.sun).lerp(b.sun, f).normalize())
    U.uPaper.value.copy(a.paper).lerp(b.paper, f)
    U.uInk.value.copy(a.ink).lerp(b.ink, f)
    U.uMist.value.copy(a.mist).lerp(b.mist, f)
    U.uLightTint.value.copy(a.tint).lerp(b.tint, f)
    U.uSunset.value = t <= 1 ? t : 2 - t
    U.uNight.value = clamp(t - 1)
    // rain greys the sheet and thickens the air
    const r = this.rainK
    if (r > 0.001) {
      const lum = U.uMist.value.r * 0.3 + U.uMist.value.g * 0.59 + U.uMist.value.b * 0.11
      this.tmpC.setRGB(lum * 0.9, lum * 0.92, lum * 0.94)
      U.uMist.value.lerp(this.tmpC, r * 0.8)
      U.uPaper.value.multiplyScalar(1 - r * 0.06)
      U.uLightTint.value.lerp(this.tmpC.setRGB(0.9, 0.93, 0.97), r * 0.5)
    }
    U.uRain.value = r
    U.uWind.value = lerp(0.15, 1, this.windK)
    this.fogMul = 1 + r * 1.6 + U.uNight.value * 0.3
  }

  dispose() {
    this.rainLines.geometry.dispose()
    this.rainMat.dispose()
  }
}
