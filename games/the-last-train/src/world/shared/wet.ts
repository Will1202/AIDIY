// 湿地面材质：在 MeshStandardMaterial 上注入积水遮罩、雨点涟漪法线与平面反射。
import { Matrix4, Vector2, type MeshStandardMaterial, type Texture } from 'three'
import type { PlanarReflection } from './Reflection'

export interface WetUniforms {
  uTime: { value: number }
  uRain: { value: number }
  uReflOn: { value: number }
}

export function makeWet(m: MeshStandardMaterial, puddles: Texture, refl: PlanarReflection | null, o: { scale?: number; wetness?: number; ripples?: boolean; reflStrength?: number } = {}): WetUniforms {
  const u = {
    uTime: { value: 0 },
    uRain: { value: 1 },
    uReflOn: { value: refl ? 1 : 0 },
    tPuddle: { value: puddles },
    tRefl: { value: refl ? refl.rt.texture : null },
    uTexM: { value: refl ? refl.texMatrix : new Matrix4() },
    uScale: { value: o.scale ?? 0.07 },
    uWet: { value: o.wetness ?? 1 },
    uReflK: { value: o.reflStrength ?? 1 },
    uRes: { value: new Vector2(1, 1) },
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWetPos;
        uniform sampler2D tPuddle; uniform sampler2D tRefl; uniform mat4 uTexM;
        uniform float uTime, uRain, uReflOn, uScale, uWet, uReflK;
        float wetH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // 雨点涟漪：网格里每格一个随机相位的扩散圆环，返回 xz 方向的法线扰动
        vec2 ripple(vec2 p) {
          vec2 acc = vec2(0.0);
          for (int k = 0; k < 2; k++) {
            vec2 q = p * (k == 0 ? 2.2 : 3.1) + float(k) * 7.3;
            vec2 id = floor(q);
            vec2 f = fract(q) - 0.5;
            float r = wetH(id);
            vec2 c = vec2(wetH(id + 3.1), wetH(id + 5.7)) - 0.5;
            float ph = fract(uTime * (0.9 + r) + r * 7.0);
            vec2 d = f - c * 0.6;
            float dist = length(d);
            float ring = sin((dist - ph * 0.45) * 60.0) * smoothstep(0.0, 0.05, ph * 0.45 - dist + 0.05) * (1.0 - ph) * smoothstep(0.5, 0.2, dist);
            acc += normalize(d + 1e-4) * ring;
          }
          return acc * 0.35;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float wetMask = clamp(texture2D(tPuddle, vWetPos.xz * uScale).r * uWet, 0.0, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.06, wetMask);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec2 rp = ripple(vWetPos.xz) * uRain * wetMask;
        normal = normalize(normal + (viewMatrix * vec4(rp.x, 0.0, rp.y, 0.0)).xyz);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.55, clamp(texture2D(tPuddle, vWetPos.xz * uScale).r * uWet, 0.0, 1.0));`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        if (uReflOn > 0.5) {
          vec4 rc = uTexM * vec4(vWetPos, 1.0);
          vec2 ruv = rc.xy / rc.w + rp * 0.02;
          vec3 refl = texture2D(tRefl, ruv).rgb;
          vec3 V = normalize(cameraPosition - vWetPos);
          float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
          gl_FragColor.rgb += refl * wetMask * mix(0.25, 1.0, fres) * uReflK;
        }`,
      )
  }
  m.customProgramCacheKey = () => `wet-${refl ? 1 : 0}`
  return u
}
