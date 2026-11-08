import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  Object3D,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three'
import { NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import { clamp, damp } from '../util/math'

/**
 * 小侠客 — a small procedural wuxia figure: black robe, cinnabar sash and hat ribbon,
 * a bamboo hat (斗笠) and a sword across the back. No skinned assets: the body is a
 * hierarchy of simple solids moved by procedural animation.
 */

const FIG_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const FIG_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
uniform vec3 uColor;
uniform float uRim;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  float lit = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  float wash = 0.78 + 0.34 * smoothstep(0.25, 0.75, lit + (vnoise(vW.xy * 9.0) - 0.5) * 0.15);
  vec3 col = uColor * wash;
  col = mix(col, uPaper, rim * uRim * (1.0 - uNight * 0.5));
  col += uLightTint * rim * uNight * 0.12;
  gl_FragColor = vec4(col, 1.0);
}
`

const SHADOW_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float n = vnoise(p * 9.0) * 0.25;
  float a = (1.0 - smoothstep(0.25, 1.0, r + n)) * uOpacity;
  gl_FragColor = vec4(uInk, a);
}
`
const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

const RING_FRAG = /* glsl */ `
${WORLD_UNIFORMS}
uniform float uPhase;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(uInk, (1.0 - uPhase) * 0.35);
}
`

export type Pose = 'walk' | 'meditate' | 'observe'

interface Joint {
  o: Object3D
  x: number
  y: number
  z: number
}

export class Character {
  readonly root = new Group()
  readonly shadow: Mesh
  readonly ring: Mesh
  private mats: ShaderMaterial[] = []
  private geos: BufferGeometry[] = []
  private j: Record<string, Joint> = {}
  private hips: Object3D
  private skirt: Object3D
  private ribbon: Object3D
  private tassel: Object3D
  private phase = 0
  private t = 0
  private ringT = 1
  /** blend weights */
  private wMed = 0
  private wObs = 0
  private hipY = 0.93

  constructor() {
    const mat = (hex: string, rim = 0.35) => {
      const m = new ShaderMaterial({ vertexShader: FIG_VERT, fragmentShader: FIG_FRAG, uniforms: { ...U, uColor: { value: new Color(hex) }, uRim: { value: rim } } })
      this.mats.push(m)
      return m
    }
    const robe = mat('#171513', 0.3)
    const inner = mat('#2c2824', 0.3)
    const skin = mat('#d9c8ad', 0.15)
    const straw = mat('#b49c72', 0.2)
    const red = mat('#b3261e', 0.2)
    const steel = mat('#8f8d88', 0.4)
    const g = <T extends BufferGeometry>(geo: T) => {
      this.geos.push(geo)
      return geo
    }
    const mesh = (geo: BufferGeometry, m: ShaderMaterial, x = 0, y = 0, z = 0) => {
      const me = new Mesh(geo, m)
      me.position.set(x, y, z)
      return me
    }
    const joint = (name: string, parent: Object3D, x: number, y: number, z: number) => {
      const o = new Object3D()
      o.position.set(x, y, z)
      parent.add(o)
      this.j[name] = { o, x: 0, y: 0, z: 0 }
      return o
    }

    const hips = new Object3D()
    hips.position.y = this.hipY
    this.root.add(hips)
    this.hips = hips

    // robe skirt (open cone) hangs from the waist and swings with the stride
    const skirt = new Object3D()
    hips.add(skirt)
    const sk = mesh(g(new CylinderGeometry(0.19, 0.4, 0.8, 14, 1, true)), robe, 0, -0.4, 0)
    ;(sk.material as ShaderMaterial).side = DoubleSide
    skirt.add(sk)
    this.skirt = skirt
    // cinnabar sash
    hips.add(mesh(g(new CylinderGeometry(0.185, 0.19, 0.07, 14)), red, 0, 0.03, 0))
    const sashTail = mesh(g(new BoxGeometry(0.06, 0.32, 0.02)), red, 0.08, -0.12, 0.19)
    sashTail.rotation.z = 0.15
    hips.add(sashTail)

    // legs
    for (const [side, sx] of [
      ['L', 0.1],
      ['R', -0.1],
    ] as const) {
      const thigh = joint('thigh' + side, hips, sx, -0.02, 0)
      thigh.add(mesh(g(new CylinderGeometry(0.075, 0.065, 0.44, 8)), inner, 0, -0.22, 0))
      const shin = joint('shin' + side, thigh, 0, -0.44, 0)
      shin.add(mesh(g(new CylinderGeometry(0.06, 0.05, 0.42, 8)), inner, 0, -0.21, 0))
      shin.add(mesh(g(new BoxGeometry(0.1, 0.07, 0.25)), robe, 0, -0.43, 0.05))
    }

    // torso
    const chest = joint('chest', hips, 0, 0.04, 0)
    chest.add(mesh(g(new CylinderGeometry(0.16, 0.2, 0.56, 12)), robe, 0, 0.3, 0))
    // crossed collar (交领) in pale inner robe
    const collar = mesh(g(new BoxGeometry(0.05, 0.28, 0.02)), skin, 0.03, 0.48, 0.15)
    collar.rotation.z = -0.5
    chest.add(collar)
    const neck = joint('neck', chest, 0, 0.6, 0)
    neck.add(mesh(g(new SphereGeometry(0.105, 14, 10)), skin, 0, 0.11, 0.01))
    // hair knot
    neck.add(mesh(g(new SphereGeometry(0.05, 8, 6)), robe, 0, 0.21, -0.06))
    // 斗笠 bamboo hat with a red ribbon
    const hat = mesh(g(new ConeGeometry(0.38, 0.19, 18, 1)), straw, 0, 0.24, 0)
    neck.add(hat)
    neck.add(mesh(g(new CylinderGeometry(0.11, 0.11, 0.03, 12)), red, 0, 0.17, 0))
    const ribbon = new Object3D()
    ribbon.position.set(0, 0.17, -0.1)
    neck.add(ribbon)
    ribbon.add(mesh(g(new BoxGeometry(0.035, 0.42, 0.01)), red, 0.04, -0.21, 0))
    ribbon.add(mesh(g(new BoxGeometry(0.035, 0.36, 0.01)), red, -0.04, -0.18, 0))
    this.ribbon = ribbon

    // arms with wide sleeves
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      const sh = joint('shoulder' + side, chest, 0.21 * sx, 0.52, 0)
      sh.add(mesh(g(new CylinderGeometry(0.07, 0.11, 0.32, 10)), robe, 0, -0.16, 0))
      const el = joint('elbow' + side, sh, 0, -0.32, 0)
      el.add(mesh(g(new CylinderGeometry(0.05, 0.045, 0.26, 8)), inner, 0, -0.13, 0))
      el.add(mesh(g(new SphereGeometry(0.048, 8, 6)), skin, 0, -0.29, 0))
    }

    // sword across the back, cinnabar tassel at the hilt
    const sword = new Object3D()
    sword.position.set(0, 0.36, -0.2)
    sword.rotation.z = 0.62
    chest.add(sword)
    sword.add(mesh(g(new BoxGeometry(0.06, 0.95, 0.045)), robe, 0, 0, 0))
    sword.add(mesh(g(new BoxGeometry(0.16, 0.035, 0.06)), steel, 0, 0.49, 0))
    sword.add(mesh(g(new CylinderGeometry(0.02, 0.02, 0.18, 6)), inner, 0, 0.6, 0))
    const tassel = new Object3D()
    tassel.position.set(0, 0.69, 0)
    sword.add(tassel)
    tassel.add(mesh(g(new ConeGeometry(0.045, 0.2, 6)), red, 0, -0.1, 0))
    this.tassel = tassel

    this.root.traverse((o) => {
      o.frustumCulled = false
    })
    this.root.name = 'character'

    // ink-blot shadow and the meditation ripple
    const sm = new ShaderMaterial({ vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, uniforms: { ...U, uOpacity: { value: 0.55 } }, transparent: true, depthWrite: false })
    this.mats.push(sm)
    this.shadow = new Mesh(g(new CircleGeometry(0.75, 24)), sm)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 3
    const rm = new ShaderMaterial({ vertexShader: SHADOW_VERT, fragmentShader: RING_FRAG, uniforms: { ...U, uPhase: { value: 1 } }, transparent: true, depthWrite: false, side: DoubleSide })
    this.mats.push(rm)
    this.ring = new Mesh(g(new RingGeometry(0.92, 1, 48)), rm)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.visible = false
  }

  private set(name: string, x: number, y: number, z: number, dt: number, rate = 12) {
    const jt = this.j[name]
    jt.x = damp(jt.x, x, rate, dt)
    jt.y = damp(jt.y, y, rate, dt)
    jt.z = damp(jt.z, z, rate, dt)
    jt.o.rotation.set(jt.x, jt.y, jt.z)
  }

  /**
   * speed: horizontal m/s · air: airborne · vy: vertical velocity · pose: walk/meditate/observe
   */
  animate(dt: number, speed: number, air: boolean, vy: number, pose: Pose, groundY: number) {
    this.t += dt
    const run = clamp((speed - 4.5) / 4)
    const move = clamp(speed / 3)
    const stride = 1.15 + run * 0.9
    this.phase += (speed / stride) * Math.PI * dt
    const s = Math.sin(this.phase)
    const c = Math.cos(this.phase)
    this.wMed = damp(this.wMed, pose === 'meditate' ? 1 : 0, 4, dt)
    this.wObs = damp(this.wObs, pose === 'observe' ? 1 : 0, 5, dt)
    const still = 1 - Math.max(this.wMed, this.wObs)

    // legs
    const swing = 0.55 + run * 0.35
    let tL = -s * swing * move
    let tR = s * swing * move
    let kL = Math.max(0, Math.sin(this.phase + 1.2)) * (0.8 + run * 0.7) * move
    let kR = Math.max(0, Math.sin(this.phase + 1.2 + Math.PI)) * (0.8 + run * 0.7) * move
    let thz = 0
    if (air) {
      const tuck = clamp(0.6 - vy * 0.08)
      tL = -0.9 * tuck - 0.2
      tR = -0.3 * tuck
      kL = 1.4 * tuck
      kR = 0.7 * tuck + 0.2
    }
    // cross-legged seat (打坐)
    tL = tL * (1 - this.wMed) + -1.45 * this.wMed
    tR = tR * (1 - this.wMed) + -1.45 * this.wMed
    kL = kL * (1 - this.wMed) + 2.5 * this.wMed
    kR = kR * (1 - this.wMed) + 2.5 * this.wMed
    thz = 0.75 * this.wMed
    this.set('thighL', tL, 0, thz, dt, 16)
    this.set('thighR', tR, 0, -thz, dt, 16)
    this.set('shinL', kL, -0.6 * this.wMed, 0, dt, 16)
    this.set('shinR', kR, 0.6 * this.wMed, 0, dt, 16)

    // torso: lean into the run, breathe when still
    const lean = 0.08 * move + 0.32 * run + (air ? 0.15 : 0)
    const breathe = Math.sin(this.t * 1.8) * 0.02 * (1 - move)
    this.set('chest', lean * still + breathe + 0.04 * this.wMed - 0.06 * this.wObs, s * 0.08 * move * still, c * 0.03 * move, dt)
    // head: look around while idle, up when observing, bowed in meditation
    const look = Math.sin(this.t * 0.35) * 0.5 * (1 - move) * still
    this.set('neck', -lean * 0.6 * still + 0.25 * this.wMed - 0.25 * this.wObs, look + 0.2 * this.wObs, 0, dt, 6)

    // arms: opposite swing when walking, swept back when running (轻功), resting when seated
    let aL = s * 0.5 * move * (1 - run) + run * 1.15
    let aR = -s * 0.5 * move * (1 - run) + run * 1.15
    let eL = -0.25 * move - run * 0.3
    let eR = -0.25 * move - run * 0.3
    let azL = 0.08 + run * 0.25
    let azR = -0.08 - run * 0.25
    if (air) {
      aL = -0.4
      aR = 0.6
      azL = 0.9
      azR = -0.9
    }
    aL = aL * (1 - this.wMed) + -0.55 * this.wMed
    aR = aR * (1 - this.wMed) + -0.55 * this.wMed
    eL = eL * (1 - this.wMed) + -0.9 * this.wMed
    eR = eR * (1 - this.wMed) + -0.9 * this.wMed
    azL = azL * (1 - this.wMed) + 0.3 * this.wMed
    azR = azR * (1 - this.wMed) - 0.3 * this.wMed
    // observe: right hand shading the brow
    aR = aR * (1 - this.wObs) + -2.3 * this.wObs
    eR = eR * (1 - this.wObs) + -1.5 * this.wObs
    azR = azR * (1 - this.wObs) + -0.35 * this.wObs
    aL = aL * (1 - this.wObs) + 0.15 * this.wObs
    this.set('shoulderL', aL, 0, azL, dt)
    this.set('shoulderR', aR, 0, azR, dt)
    this.set('elbowL', eL, 0, 0, dt)
    this.set('elbowR', eR, 0, 0, dt)

    // hips: bob with the stride, sink into the seat
    const bob = Math.abs(c) * 0.05 * move * (1 + run)
    this.hips.position.y = damp(this.hips.position.y, this.hipY - 0.03 * move + bob - 0.55 * this.wMed, 14, dt)
    // skirt trails the motion and flares
    const flare = 1 + run * 0.25 + this.wMed * 0.45
    this.skirt.rotation.x = damp(this.skirt.rotation.x, 0.12 * move + 0.3 * run + (air ? 0.2 : 0), 8, dt)
    this.skirt.scale.set(flare, 1 - this.wMed * 0.45, flare)
    // cloth: ribbon and tassel stream behind
    const stream = 0.25 + speed * 0.12 + U.uWind.value * 0.5
    this.ribbon.rotation.x = damp(this.ribbon.rotation.x, clamp(stream, 0, 1.3) + Math.sin(this.t * 7) * 0.08, 6, dt)
    this.tassel.rotation.x = damp(this.tassel.rotation.x, clamp(stream * 0.8, 0, 1.2) + Math.sin(this.t * 6 + 1) * 0.12, 6, dt)

    // ink shadow on the ground under the feet
    const above = Math.max(0, this.root.position.y - groundY)
    this.shadow.position.set(this.root.position.x, groundY + 0.04, this.root.position.z)
    const sc = 1 + above * 0.25
    this.shadow.scale.setScalar(sc)
    ;(this.shadow.material as ShaderMaterial).uniforms.uOpacity.value = 0.5 / (1 + above * 0.6)

    // meditation ripples
    if (this.wMed > 0.8) {
      this.ringT += dt / 2.6
      if (this.ringT > 1) this.ringT = 0
    } else this.ringT = Math.min(1, this.ringT + dt)
    this.ring.visible = this.wMed > 0.5
    this.ring.position.set(this.root.position.x, groundY + 0.05, this.root.position.z)
    this.ring.scale.setScalar(0.4 + this.ringT * 3.2)
    ;(this.ring.material as ShaderMaterial).uniforms.uPhase.value = this.ringT
  }

  dispose() {
    for (const g of this.geos) g.dispose()
    for (const m of this.mats) m.dispose()
  }
}
