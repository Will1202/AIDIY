import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3, Vector4 } from 'three'
import { ROOM, rng } from '../core/config'

const MAX = 12000

/**
 * Air-borne dust in the lab (and, once the screen is broken, in front of it).
 * Motion is evaluated in the vertex shader: slow curl-ish drift, a radial shove
 * from pulses, and the swirl of the gravity-collapse vortex.
 */
export class Dust {
  readonly points: Points
  readonly front: Points
  readonly mat: ShaderMaterial
  readonly frontMat: ShaderMaterial

  constructor() {
    const make = (n: number, box: { x: [number, number]; y: [number, number]; z: [number, number] }, seed: number) => {
      const r = rng(seed)
      const pos = new Float32Array(n * 3)
      const s = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        pos[i * 3] = box.x[0] + r() * (box.x[1] - box.x[0])
        pos[i * 3 + 1] = box.y[0] + r() * (box.y[1] - box.y[0])
        pos[i * 3 + 2] = box.z[0] + r() * (box.z[1] - box.z[0])
        s[i] = r()
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(pos, 3))
      g.setAttribute('aS', new BufferAttribute(s, 1))
      return g
    }
    const shader = () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPx: { value: 1 },
          uPulse: { value: new Vector4(0, 0, 0, -10) },
          uVortex: { value: new Vector4(0, 0, -9, 0) },
          uAlpha: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute float aS; uniform float uTime; uniform float uPx; uniform vec4 uPulse; uniform vec4 uVortex; varying float vA;
          void main(){
            vec3 p = position;
            float t = uTime * (0.15 + aS * 0.25);
            p += vec3(sin(t + aS*40.0), sin(t*0.7 + aS*17.0)*0.6, cos(t*0.8 + aS*29.0)) * (0.6 + aS);
            // pulse shove
            float pt = uTime - uPulse.w;
            if (pt > 0.0 && pt < 3.0) {
              vec3 d = p - uPulse.xyz; float l = length(d) + 1e-3;
              float wave = smoothstep(pt*16.0 + 2.0, pt*16.0 - 2.0, l) * exp(-pt*1.2) * exp(-l*0.05);
              p += d / l * wave * 3.0;
            }
            // vortex swirl around a vertical axis through the core
            if (uVortex.w > 0.0) {
              vec2 r = p.xz - uVortex.xz; float l = length(r) + 1e-3;
              float a = uVortex.w * uTime * (2.5 / (1.0 + l*0.15));
              float c = cos(a), s = sin(a);
              r = mat2(c, -s, s, c) * r * mix(1.0, 0.6, uVortex.w);
              p.xz = uVortex.xz + r;
              p.y = mix(p.y, uVortex.y + sin(aS*50.0 + uTime)*4.0, uVortex.w*0.5);
            }
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = -mv.z;
            vA = (0.25 + aS * 0.75) * smoothstep(1.0, 4.0, d) * smoothstep(90.0, 30.0, d);
            gl_PointSize = (0.8 + aS * 2.4) * uPx * 32.0 / d;
          }`,
        fragmentShader: /* glsl */ `uniform float uAlpha; varying float vA;
          void main(){ vec2 p = gl_PointCoord*2.-1.; float d = dot(p,p); if (d > 1.0) discard;
            float a = exp(-d*3.0) * vA * uAlpha * 0.5; gl_FragColor = vec4(vec3(0.85,0.9,1.0)*a, a); }`,
      })
    this.mat = shader()
    this.points = new Points(make(MAX, { x: [-ROOM.halfX, ROOM.halfX], y: [ROOM.floor, ROOM.ceil], z: [ROOM.back, -1] }, 31), this.mat)
    this.points.frustumCulled = false
    this.frontMat = shader()
    this.frontMat.uniforms.uAlpha.value = 0
    this.front = new Points(make(2500, { x: [-14, 14], y: [-8, 8], z: [0.5, 18] }, 37), this.frontMat)
    this.front.frustumCulled = false
  }

  setCount(n: number) {
    this.points.geometry.setDrawRange(0, Math.min(MAX, n))
    this.front.geometry.setDrawRange(0, Math.min(2500, Math.round(n / 4)))
  }

  pulse(c: Vector3, time: number) {
    for (const m of [this.mat, this.frontMat]) m.uniforms.uPulse.value.set(c.x, c.y, c.z, time)
  }

  update(time: number, px: number, vortex: Vector4, frontAlpha: number) {
    for (const m of [this.mat, this.frontMat]) {
      m.uniforms.uTime.value = time
      m.uniforms.uPx.value = px
      m.uniforms.uVortex.value.copy(vortex)
    }
    this.frontMat.uniforms.uAlpha.value = frontAlpha
    this.front.visible = frontAlpha > 0.01
  }
}
