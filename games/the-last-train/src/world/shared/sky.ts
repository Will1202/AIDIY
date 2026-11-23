// 渐变天空、太阳、云海 —— 多个世界共用的天空着色器
import { BackSide, Color, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3 } from 'three'

export interface SkyOpts {
  top: Color
  mid: Color
  bottom: Color
  sun?: Vector3
  sunColor?: Color
  sunSize?: number
  stars?: number
  radius?: number
}

export function makeSky(o: SkyOpts) {
  const mat = new ShaderMaterial({
    uniforms: {
      uTop: { value: o.top }, uMid: { value: o.mid }, uBot: { value: o.bottom }, uSun: { value: (o.sun ?? new Vector3(0, 1, 0)).clone().normalize() },
      uSunCol: { value: o.sunColor ?? new Color(1, 0.9, 0.7) }, uSunSize: { value: o.sunSize ?? 0.02 }, uStars: { value: o.stars ?? 0 }, uFlip: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uBot, uSun, uSunCol; uniform float uSunSize, uStars, uFlip, uTime;
      varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vP);
        float y = mix(d.y, -d.y, uFlip);
        vec3 col = y > 0.0 ? mix(uMid, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uMid, uBot, pow(clamp(-y, 0.0, 1.0), 0.45));
        vec3 sd = normalize(mix(uSun, uSun * vec3(1.0, -1.0, 1.0), uFlip));
        float s = max(dot(d, sd), 0.0);
        col += uSunCol * (pow(s, 1.0 / max(uSunSize, 1e-4) * 0.05) * 0.6 + smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, s) * 6.0);
        if (uStars > 0.0) {
          vec3 q = floor(d * 380.0);
          float st = step(0.9975, h(q)) * smoothstep(-0.1, 0.4, y);
          col += vec3(st) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + h(q + 1.0) * 30.0));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: BackSide, depthWrite: false, fog: false,
  })
  const mesh = new Mesh(new SphereGeometry(o.radius ?? 1500, 48, 24), mat)
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return { mesh, mat }
}

/** 云海：一张大平面，fbm 云在着色器里流动，边缘融进雾里 */
export function makeCloudSea(y: number, color: Color, shade: Color, size = 4000) {
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCol: { value: color }, uShade: { value: shade }, uFogCol: { value: new Color() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCol, uShade, uFogCol; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p*=2.02; a*=0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fbm(p);
        float c2 = fbm(p * 2.3 + 4.0);
        float k = smoothstep(0.35, 0.75, c * 0.7 + c2 * 0.4);
        vec3 col = mix(uShade, uCol, k);
        float d = length(vW.xz - cameraPosition.xz);
        float a = smoothstep(2000.0, 600.0, d);
        gl_FragColor = vec4(mix(uFogCol, col, a), 1.0);
      }`,
    fog: false,
  })
  const g = new PlaneGeometry(size, size, 1, 1)
  g.rotateX(-Math.PI / 2)
  const mesh = new Mesh(g, mat)
  mesh.position.y = y
  mesh.frustumCulled = false
  return { mesh, mat }
}

/** 楼宇窗户：在标准材质上按世界坐标画出窗格，随机亮灯 */
export function windowize(m: import('three').MeshStandardMaterial, glow: Color, density = 0.45, floor = 3.2, bay = 2.2) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = { value: glow }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinP; varying vec3 vWinN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWinP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWinN = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWinP; varying vec3 vWinN; uniform vec3 uGlow;
        float winH(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 an = abs(vWinN);
          if (an.y < 0.5) {
            float u = an.x > an.z ? vWinP.z : vWinP.x;
            vec2 cell = vec2(floor(u / ${bay.toFixed(2)}), floor(vWinP.y / ${floor.toFixed(2)}));
            vec2 f = vec2(fract(u / ${bay.toFixed(2)}), fract(vWinP.y / ${floor.toFixed(2)}));
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.82);
            float lit = step(1.0 - ${density.toFixed(2)}, winH(cell + floor(vWinP.xz * 0.05)));
            totalEmissiveRadiance += uGlow * win * lit * (0.6 + 0.8 * winH(cell * 1.7));
            diffuseColor.rgb *= mix(1.0, 0.35, win);
          }
        }`)
  }
  m.customProgramCacheKey = () => `win-${density}-${floor}-${bay}`
  return m
}
