// 巨鲸：车床体身躯 + 顶点着色器里的游动波形 + 侧线上的生物发光斑点。深海与终点世界共用。
import {
  AdditiveBlending, Color, Group, InstancedBufferAttribute, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, PointLight,
  ShaderMaterial, SphereGeometry, Vector2, Vector3, BufferGeometry, Float32BufferAttribute, Points,
} from 'three'

const SWIM = /* glsl */ `
  uniform float uSwim;
  vec3 swim(vec3 p) {
    // 身体沿 x 轴，头在 +x。越靠近尾部摆动越大（上下摆动，像鲸鱼）
    float t = clamp((15.0 - p.x) / 30.0, 0.0, 1.0);
    float a = t * t * 1.6;
    p.y += sin(uSwim - p.x * 0.18) * a;
    return p;
  }
`

export class Whale {
  readonly group = new Group()
  private mats: MeshStandardMaterial[] = []
  readonly light: PointLight
  private t = Math.random() * 10
  /** 发光强度 0..1 */
  glow = 1

  constructor(length = 30) {
    const s = length / 30
    // 身体轮廓（半径随长度变化）：x 从尾 -15 到头 +15
    const prof: Vector2[] = []
    const N = 40
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const x = -15 + u * 30
      let r: number
      if (u < 0.12) r = 0.25 + u * 6
      else if (u < 0.75) r = 0.97 + Math.sin(((u - 0.12) / 0.63) * Math.PI) * 1.6
      else r = 1.0 + Math.cos(((u - 0.75) / 0.25) * Math.PI * 0.5) * 1.6
      if (u > 0.97) r *= (1 - u) / 0.03
      prof.push(new Vector2(Math.max(0.01, r * 1.1), x))
    }
    const body = new LatheGeometry(prof, 36)
    body.rotateZ(-Math.PI / 2)
    body.scale(1, 0.82, 1)
    const skin = this.skinMat(new Color(0x26384a), new Color(0x8fa8b8))
    const bodyMesh = new Mesh(body, skin)
    this.group.add(bodyMesh)
    // 胸鳍
    const finGeo = new SphereGeometry(1, 16, 10)
    finGeo.scale(1.6, 0.18, 4.2)
    for (const z of [-1, 1]) {
      const fin = new Mesh(finGeo, skin)
      fin.position.set(6.5, -1.4, z * 3.2)
      fin.rotation.set(z * 0.35, z * 0.5, -0.25)
      this.group.add(fin)
    }
    // 尾鳍
    const flukeGeo = new SphereGeometry(1, 16, 10)
    flukeGeo.scale(2.2, 0.16, 3.6)
    for (const z of [-1, 1]) {
      const f = new Mesh(flukeGeo, skin)
      f.position.set(-15.6, 0, z * 2.6)
      f.rotation.y = z * 0.5
      this.group.add(f)
    }
    this.group.scale.setScalar(s)
    this.light = new PointLight(0x7fe8ff, 0, 60 * s, 1.4)
    this.light.position.set(4, -2, 0)
    this.group.add(this.light)
  }

  private skinMat(dark: Color, belly: Color) {
    const m = new MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.05, emissive: 0x000000 })
    const u = { uSwim: { value: 0 }, uGlow: { value: 1 }, uBelly: { value: belly } }
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${SWIM}\nvarying vec3 vBodyP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBodyP = position;\ntransformed = swim(transformed);`)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vBodyP; uniform float uGlow; uniform vec3 uBelly;\nfloat wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // 腹部浅色
          diffuseColor.rgb = mix(diffuseColor.rgb, uBelly, smoothstep(-0.2, -1.2, vBodyP.y) * 0.8);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // 侧线上的发光斑点
            vec2 g = vec2(vBodyP.x * 1.4, atan(vBodyP.z, vBodyP.y) * 3.0);
            vec2 id = floor(g);
            vec2 f = fract(g) - 0.5;
            float r = wh(id);
            float spot = smoothstep(0.22, 0.05, length(f)) * step(0.72, r);
            float band = smoothstep(1.4, 0.4, abs(vBodyP.y + 0.2));
            totalEmissiveRadiance += vec3(0.35, 0.95, 1.1) * spot * band * uGlow * (2.0 + 2.0 * r);
          }`)
    }
    m.customProgramCacheKey = () => 'whale'
    m.userData.u = u
    this.mats.push(m)
    return m
  }

  update(dt: number) {
    this.t += dt
    for (const m of this.mats) {
      const u = m.userData.u as { uSwim: { value: number }; uGlow: { value: number } }
      u.uSwim.value = this.t * 1.1
      u.uGlow.value = this.glow
    }
    this.light.intensity = this.glow * 120
  }
}

/** 水母群：实例化的伞盖，着色器里脉动、漂浮、发光 */
export function jellyfish(count: number, area: { x: number; y: number; z: number; sx: number; sy: number; sz: number }, colorA = new Color(1.0, 0.45, 0.8), colorB = new Color(0.4, 0.9, 1.0), avoid?: (x: number, y: number, z: number) => boolean) {
  const geo = new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: colorA }, uB: { value: colorB }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec4 aJ;
      uniform float uTime;
      varying float vK; varying float vMix; varying vec3 vN; varying vec3 vV;
      void main(){
        float ph = uTime * (0.8 + aJ.w * 0.6) + aJ.w * 30.0;
        float pulse = 0.85 + 0.15 * sin(ph * 2.0);
        vec3 p = position;
        p.xz *= pulse;
        p.y *= 1.0 / pulse;
        vec4 w = instanceMatrix * vec4(p, 1.0);
        w.y += sin(ph * 0.4) * 1.5;
        w.x += sin(ph * 0.13 + aJ.x) * 2.0;
        vec4 mw = modelMatrix * w;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vV = normalize(cameraPosition - mw.xyz);
        vK = 0.6 + 0.4 * sin(ph * 2.0);
        vMix = aJ.y;
        gl_Position = projectionMatrix * viewMatrix * mw;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB; uniform float uBoost;
      varying float vK; varying float vMix; varying vec3 vN; varying vec3 vV;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        vec3 c = mix(uA, uB, step(0.5, vMix));
        gl_FragColor = vec4(c * (rim * 1.4 + 0.12) * vK * (1.0 + uBoost * 3.0), 1.0);
      }`,
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  })
  const mesh = new InstancedMesh(geo, mat, count)
  const m4 = new Matrix4()
  const aj = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const sc = 0.3 + Math.random() * 0.9
    m4.makeScale(sc, sc * 0.8, sc)
    let x = 0, y = 0, z = 0
    for (let k = 0; k < 20; k++) {
      x = area.x + (Math.random() - 0.5) * area.sx
      y = area.y + (Math.random() - 0.5) * area.sy
      z = area.z + (Math.random() - 0.5) * area.sz
      if (!avoid || !avoid(x, y, z)) break
    }
    m4.setPosition(x, y, z)
    mesh.setMatrixAt(i, m4)
    aj[i * 4] = Math.random() * 6
    aj[i * 4 + 1] = Math.random()
    aj[i * 4 + 2] = Math.random()
    aj[i * 4 + 3] = Math.random()
  }
  geo.setAttribute('aJ', new InstancedBufferAttribute(aj, 4))
  mesh.frustumCulled = false
  return { mesh, mat }
}

/** 漂浮微粒（海雪 / 沙尘 / 尘埃）：点精灵，在着色器里缓慢漂移并在相机周围循环 */
export function motes(count: number, box: number, color: Color, size = 0.06, drift = new Vector2(0.05, -0.12)) {
  const g = new BufferGeometry()
  const p = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i++) p[i] = Math.random() * box
  g.setAttribute('position', new Float32BufferAttribute(p, 3))
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBox: { value: box }, uCol: { value: color }, uSize: { value: size }, uDrift: { value: drift }, uFreeze: { value: 0 }, uC: { value: new Vector3() } },
    vertexShader: /* glsl */ `
      uniform float uTime, uBox, uSize, uFreeze; uniform vec2 uDrift; uniform vec3 uC;
      varying float vA;
      void main(){
        vec3 q = position;
        float t = uTime * (1.0 - uFreeze);
        q += vec3(uDrift.x * t + sin(t * 0.3 + position.y) * 0.3, uDrift.y * t, sin(t * 0.2 + position.x) * 0.3);
        q = mod(q - uC + uBox * 0.5, uBox) + uC - uBox * 0.5;
        vec4 mv = modelViewMatrix * vec4(q, 1.0);
        float d = -mv.z;
        vA = smoothstep(uBox * 0.5, uBox * 0.2, d) * smoothstep(0.2, 1.0, d);
        gl_PointSize = uSize * 900.0 / max(d, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(uCol * vA * smoothstep(0.5, 0.0, r), 1.0); }`,
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  })
  const pts = new Points(g, mat)
  pts.frustumCulled = false
  return { points: pts, mat }
}
