import { MeshPhysicalMaterial, MeshStandardMaterial, ShaderChunk, Vector3, Vector4, type Texture } from 'three'

/**
 * Shared uniforms for the lab's skylight. The sun only reaches a fragment if
 * the ray towards the sun leaves through the ceiling slit — evaluated
 * analytically, so the long sunlit stripe stays razor sharp at any shadow-map
 * resolution and only props need to be rendered into the shadow map.
 */
export const SUN_SLIT = {
  uSunOn: { value: 0 },
  /** x0, x1, z0, z1 of the slit opening */
  uSlit: { value: new Vector4(4.75, 7.25, -92, 26) },
  uSlitY: { value: 26 },
  /** direction towards the sun */
  uSunDir: { value: new Vector3(0.36, 1, 0.12).normalize() },
  /** ceiling beams crossing the slit: period, z offset, half width, height */
  uBeam: { value: new Vector4(12, 0, 0.7, 24.8) },
}

export interface PatchOptions {
  /** triplanar albedo (rgb) + roughness multiplier (a, ×2) */
  tri?: { map: Texture; scale: number; space?: 'world' | 'object'; tint?: [number, number, number] }
  /** darken towards the floor / ceiling junctions (cheap baked-looking AO) */
  ao?: { floorY: number; height: number; strength: number; ceilY?: number }
  sunMask?: boolean
}

type AnyStd = MeshStandardMaterial | MeshPhysicalMaterial

export function patchStandard<T extends AnyStd>(mat: T, o: PatchOptions): T {
  const key = `pp:${o.tri ? 't' + (o.tri.space ?? 'world') : ''}${o.ao ? 'a' + (o.ao.ceilY !== undefined ? 'c' : '') : ''}${o.sunMask ? 's' : ''}`
  mat.customProgramCacheKey = () => key
  mat.onBeforeCompile = (shader) => {
    const needPos = !!o.tri || !!o.ao || !!o.sunMask
    if (o.tri) {
      shader.uniforms.uTriScale = { value: o.tri.scale }
      shader.uniforms.uTriTint = { value: new Vector3(...(o.tri.tint ?? [1, 1, 1])) }
    }
    if (o.ao) shader.uniforms.uAo = { value: new Vector4(o.ao.floorY, o.ao.height, o.ao.strength, o.ao.ceilY ?? 1e5) }
    if (o.sunMask) Object.assign(shader.uniforms, SUN_SLIT)

    if (needPos) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vPPWorld;\nvarying vec3 vPPTriPos;\nvarying vec3 vPPTriNrm;`)
        .replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
          vPPWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          ${o.tri?.space === 'object'
            ? 'vPPTriPos = transformed; vPPTriNrm = objectNormal;'
            : 'vPPTriPos = vPPWorld; vPPTriNrm = mat3(modelMatrix) * objectNormal;'}`,
        )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vPPWorld;\nvarying vec3 vPPTriPos;\nvarying vec3 vPPTriNrm;
        ${o.tri ? 'uniform float uTriScale; uniform vec3 uTriTint;' : ''}
        ${o.ao ? 'uniform vec4 uAo;' : ''}
        ${o.sunMask ? `uniform float uSunOn; uniform vec4 uSlit; uniform float uSlitY; uniform vec3 uSunDir; uniform vec4 uBeam;
        float ppSunMask(vec3 p) {
          if (uSunOn < 0.5) return 1.0;
          if (p.y > uSlitY - 0.05) return 1.0;
          float t = (uSlitY - p.y) / uSunDir.y;
          vec2 q = p.xz + uSunDir.xz * t;
          float pen = 0.015 + t * 0.0095; // penumbra of a ~0.55° sun disc
          float mx = smoothstep(uSlit.x - pen, uSlit.x + pen, q.x) * (1.0 - smoothstep(uSlit.y - pen, uSlit.y + pen, q.x));
          float mz = smoothstep(uSlit.z - pen, uSlit.z + pen, q.y) * (1.0 - smoothstep(uSlit.w - pen, uSlit.w + pen, q.y));
          // the transverse ceiling beams cut the stripe into bays
          float tb = max(0.0, (uBeam.w - p.y) / uSunDir.y);
          float bz = p.z + uSunDir.z * tb;
          float db = abs(mod(bz - uBeam.y + uBeam.x * 0.5, uBeam.x) - uBeam.x * 0.5);
          float pb = 0.015 + tb * 0.0095;
          return mx * mz * smoothstep(uBeam.z - pb, uBeam.z + pb, db);
        }` : ''}`,
      )
    }
    if (o.tri) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `vec3 ppN = normalize(vPPTriNrm);
          vec3 ppW = pow(abs(ppN), vec3(5.0));
          ppW /= (ppW.x + ppW.y + ppW.z);
          vec3 ppP = vPPTriPos * uTriScale;
          vec4 ppS = texture2D(map, ppP.zy) * ppW.x + texture2D(map, ppP.xz) * ppW.y + texture2D(map, ppP.xy) * ppW.z;
          diffuseColor.rgb *= ppS.rgb * uTriTint;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = clamp(roughness * ppS.a * 2.0, 0.03, 1.0);`,
        )
    }
    if (o.ao) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        {
          float hf = clamp((vPPWorld.y - uAo.x) / uAo.y, 0.0, 1.0);
          float hc = clamp((uAo.w - vPPWorld.y) / (uAo.y * 0.7), 0.0, 1.0);
          float occ = mix(1.0 - uAo.z, 1.0, sqrt(hf)) * mix(1.0 - uAo.z * 0.8, 1.0, sqrt(hc));
          reflectedLight.indirectDiffuse *= occ;
          reflectedLight.indirectSpecular *= mix(occ, 1.0, 0.4);
        }`,
      )
    }
    if (o.sunMask) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        THREE_LIGHTS_BEGIN_WITH_MASK,
      )
    }
  }
  // the triplanar lookup reuses three's own map sampler slot: a custom sampler uniform can end up
  // sharing a texture unit with the shadow-map sampler on some drivers, which silently kills the draw
  if (o.tri) mat.map = o.tri.map
  mat.needsUpdate = true
  return mat
}

// three's lights_fragment_begin, with the directional-light colour multiplied by the slit mask.
const THREE_LIGHTS_BEGIN_WITH_MASK = ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ppSunMask( vPPWorld );',
)
if (THREE_LIGHTS_BEGIN_WITH_MASK === ShaderChunk.lights_fragment_begin) {
  console.warn('[portal-paradox] sun mask patch did not apply; three.js light chunk changed')
}
