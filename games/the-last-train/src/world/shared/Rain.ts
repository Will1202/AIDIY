// GPU 雨：实例化雨丝在相机周围的循环体积里下落（顶点着色器里取模），被附近灯光照亮；
// 地面溅起的水花也由着色器生成；雨棚、车厢等遮挡区域不下雨。
import {
  AdditiveBlending, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Vector3, Vector4,
} from 'three'

export interface RainOpts {
  count: number
  /** 遮雨区域：xz 矩形 + 顶高 (x0, z0, x1, z1) 与 y */
  roofs: { x0: number; z0: number; x1: number; z1: number; y: number }[]
  /** 地面高度：z 在 [z0,z1] 内为 h1，否则 h0 */
  ground: (x: number, z: number) => number
  groundShader: string
  lights: Vector3[]
}

const MAX_ROOFS = 6
const MAX_LIGHTS = 8

export class Rain {
  readonly group = new Group()
  private mat: ShaderMaterial
  private splashMat: ShaderMaterial
  intensity = 1
  readonly wind = new Vector3(0.6, 0, -0.3)

  constructor(o: RainOpts) {
    this.group.name = 'rain'
    const roofs = new Array(MAX_ROOFS).fill(0).map((_, i) => {
      const r = o.roofs[i]
      return r ? new Vector4(r.x0, r.z0, r.x1, r.z1) : new Vector4(0, 0, 0, 0)
    })
    const roofY = new Array(MAX_ROOFS).fill(0).map((_, i) => o.roofs[i]?.y ?? -999)
    const lights = new Array(MAX_LIGHTS).fill(0).map((_, i) => {
      const l = o.lights[i]
      return l ? new Vector4(l.x, l.y, l.z, 1) : new Vector4(0, -999, 0, 0)
    })
    const common = {
      uTime: { value: 0 }, uCam: { value: new Vector3() }, uWind: { value: this.wind }, uRoof: { value: roofs }, uRoofY: { value: roofY },
      uLights: { value: lights }, uFlash: { value: 0 }, uInt: { value: 1 }, uHead: { value: new Vector4(0, -999, 0, 0) },
      uColor: { value: new Color(0.75, 0.82, 0.95) },
    }
    const roofFn = /* glsl */ `
      uniform vec4 uRoof[${MAX_ROOFS}];
      uniform float uRoofY[${MAX_ROOFS}];
      float covered(vec3 p) {
        for (int i = 0; i < ${MAX_ROOFS}; i++) {
          vec4 r = uRoof[i];
          if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w && p.y < uRoofY[i]) return 1.0;
        }
        return 0.0;
      }
      uniform vec4 uLights[${MAX_LIGHTS}];
      uniform vec4 uHead;
      float lit(vec3 p) {
        float l = 0.0;
        for (int i = 0; i < ${MAX_LIGHTS}; i++) {
          vec3 d = p - uLights[i].xyz;
          l += uLights[i].w * 7.0 / (1.0 + dot(d, d) * 0.35);
        }
        // 车头灯光锥（沿 +x）
        vec3 h = p - uHead.xyz;
        if (h.x > 0.0) l += uHead.w * 40.0 * smoothstep(0.35, 0.05, length(h.yz) / (h.x + 0.5)) / (1.0 + h.x * 0.05);
        return l;
      }
      ${o.groundShader}
    `
    // ---- 雨丝 ----
    const geo = new InstancedBufferGeometry()
    const quad = new PlaneGeometry(1, 1)
    geo.index = quad.index
    geo.setAttribute('position', quad.getAttribute('position'))
    geo.setAttribute('uv', quad.getAttribute('uv'))
    const seeds = new Float32Array(o.count * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
    geo.instanceCount = o.count
    this.mat = new ShaderMaterial({
      uniforms: common,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uWind; uniform float uInt;
        varying float vB; varying vec2 vUv;
        ${roofFn}
        void main() {
          vec3 box = vec3(36.0, 18.0, 36.0);
          float speed = 11.0 + aSeed.w * 4.0;
          vec3 p = vec3(aSeed.x, aSeed.y, aSeed.z) * box;
          p.y -= uTime * speed;
          p.xz += uWind.xz * uTime * (0.6 + aSeed.w * 0.2);
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          vec3 vel = normalize(vec3(uWind.x, -speed, uWind.z));
          float len = 0.55 + aSeed.w * 0.5;
          // 面向相机的长条公告板
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(vel, toCam)) * 0.012;
          vec3 wp = p + vel * position.y * len + side * position.x * 2.0;
          float g = groundY(p.x, p.z);
          float hidden = covered(p) + step(p.y, g) + step(aSeed.w, 1.0 - uInt);
          float camD = distance(p, cameraPosition);
          vB = (0.25 + lit(p)) * (1.0 - min(hidden, 1.0)) * smoothstep(0.8, 2.2, camD);
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uFlash;
        varying float vB; varying vec2 vUv;
        void main() {
          if (vB <= 0.0) discard;
          float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          gl_FragColor = vec4(uColor * a * (vB * 0.08 + uFlash * 0.6), 1.0);
        }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false,
    })
    const streaks = new Mesh(geo, this.mat)
    streaks.frustumCulled = false
    streaks.renderOrder = 4
    this.group.add(streaks)
    // ---- 水花 ----
    const sCount = Math.round(o.count * 0.25)
    const sg = new InstancedBufferGeometry()
    const sq = new PlaneGeometry(1, 1)
    sq.rotateX(-Math.PI / 2)
    sg.index = sq.index
    sg.setAttribute('position', sq.getAttribute('position'))
    sg.setAttribute('uv', sq.getAttribute('uv'))
    const ss = new Float32Array(sCount * 4)
    for (let i = 0; i < ss.length; i++) ss[i] = Math.random()
    sg.setAttribute('aSeed', new InstancedBufferAttribute(ss, 4))
    sg.instanceCount = sCount
    this.splashMat = new ShaderMaterial({
      uniforms: common,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCam; uniform float uInt;
        varying float vB; varying vec2 vUv; varying float vPh;
        ${roofFn}
        float h1(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float period = 0.45 + aSeed.w * 0.4;
          float t = uTime / period + aSeed.z * 10.0;
          float cyc = floor(t);
          vPh = fract(t);
          vec2 r = vec2(h1(cyc * 12.9898 + aSeed.x * 78.233), h1(cyc * 39.346 + aSeed.y * 11.135)) - 0.5;
          vec3 p = vec3(uCam.x + r.x * 22.0, 0.0, uCam.z + r.y * 22.0);
          p.y = groundY(p.x, p.z) + 0.015;
          float size = 0.05 + vPh * 0.18;
          vec3 wp = p + position * size;
          vB = (0.4 + lit(p + vec3(0.0, 0.3, 0.0))) * (1.0 - covered(p + vec3(0.0, 0.2, 0.0))) * step(aSeed.w, uInt);
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uFlash;
        varying float vB; varying vec2 vUv; varying float vPh;
        void main() {
          if (vB <= 0.0) discard;
          float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.12, 0.0, abs(d - 0.75)) * (1.0 - vPh);
          gl_FragColor = vec4(uColor * ring * (vB * 0.1 + uFlash * 0.4), 1.0);
        }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false,
    })
    const splashes = new Mesh(sg, this.splashMat)
    splashes.frustumCulled = false
    splashes.renderOrder = 4
    this.group.add(splashes)
  }

  /** cam：相机在雨所在坐标系里的位置；head：车头灯位置（w = 强度） */
  update(t: number, cam: Vector3, flash: number, head?: Vector4) {
    for (const m of [this.mat, this.splashMat]) {
      m.uniforms.uTime.value = t
      ;(m.uniforms.uCam.value as Vector3).copy(cam)
      m.uniforms.uFlash.value = flash
      m.uniforms.uInt.value = this.intensity
      if (head) (m.uniforms.uHead.value as Vector4).copy(head)
    }
  }

  setLight(i: number, p: Vector3, w: number) {
    const v = (this.mat.uniforms.uLights.value as Vector4[])[i]
    v.set(p.x, p.y, p.z, w)
  }
}
