import { COMMON, ENV, ENV_UNIFORMS } from './chunks'

/**
 * Silver dust streams. Stateless: every particle's orbit is an analytic
 * function of an *integrated* phase uniform (the CPU accumulates speed × dt),
 * so speed changes with the treble never jump. Each particle is a thin quad
 * stretched between its current and a slightly earlier orbit position —
 * a short light trail.
 */
export const dustVertex = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
uniform float uPhase;
uniform float uTrail;
uniform float uExplode;
uniform float uSing;
uniform float uWidth;
uniform float uTime;
uniform float uCollapse;
varying vec2 vUv;
varying float vBright;

vec3 dustPos(vec4 s, float ph) {
  float group = floor(s.w * 3.0);
  float r = 1.55 + s.x * s.x * 2.1;
  float speed = (0.35 + 0.65 * s.y) * 1.3 / sqrt(r);
  float a = s.z * 6.2832 + ph * speed * (group == 1.0 ? -1.0 : 1.0);
  vec3 p = vec3(cos(a) * r, (s.y - 0.5) * 0.08 * r, sin(a) * r);
  p.yz = rot2(0.22 + group * 0.32) * p.yz;
  p.xy = rot2(group * 0.45 - 0.3) * p.xy;
  p += 0.08 * sin(p.yzx * 1.3 + ph * 0.25 + s.w * 6.0);

  // SINGULARITY: spiral infall towards the core, respawning at the rim
  float cyc = fract(s.x + ph * 0.045 * (0.5 + s.y));
  float rin = mix(3.9, 0.42, cyc * cyc) * (1.0 - 0.6 * uCollapse);
  float ai = s.z * 6.2832 + ph * 1.6 / rin;
  vec3 pin = vec3(cos(ai) * rin, (s.y - 0.5) * 0.08 * rin, sin(ai) * rin);
  pin.yz = rot2(0.32) * pin.yz;
  return mix(p, pin, uSing);
}

void main() {
  vec3 p0 = dustPos(aSeed, uPhase);
  vec3 p1 = dustPos(aSeed, uPhase - uTrail * (0.6 + aSeed.y));
  vec3 out0 = normalize(p0) * uExplode * (0.5 + aSeed.x * 1.5);
  p0 += out0;
  p1 += out0 * 0.93;
  vec4 c0 = viewMatrix * vec4(p0, 1.0);
  vec4 c1 = viewMatrix * vec4(p1, 1.0);
  vec3 axis = c0.xyz - c1.xyz;
  float len = length(axis);
  vec3 dir = len > 1e-5 ? axis / len : vec3(1.0, 0.0, 0.0);
  vec3 side = normalize(cross(dir, normalize(c0.xyz)) + vec3(1e-5)) * uWidth * (0.6 + aSeed.w * 0.8);
  vec3 vp = mix(c1.xyz, c0.xyz, position.x + 0.5) + side * position.y;
  vUv = position.xy + 0.5;
  float tw = 0.55 + 0.45 * sin(uTime * (3.0 + aSeed.z * 9.0) + aSeed.x * 40.0);
  vBright = tw * (0.35 + aSeed.y * 0.65);
  gl_Position = projectionMatrix * vec4(vp, 1.0);
}
`

export const dustFragment = /* glsl */ `
uniform float uIntensity;
varying vec2 vUv;
varying float vBright;
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.85, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  float a = across * across * along * vBright * uIntensity;
  gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * a, 1.0);
}
`

/** Expanding energy ring on strong kicks and on the burst. */
export const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
export const ringFragment = /* glsl */ `
uniform float uProg;
uniform float uStr;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float radius = 0.12 + (1.0 - pow(1.0 - uProg, 2.6)) * 0.86;
  float w = 0.0035 + uProg * 0.016;
  float ring = exp(-pow((r - radius) / w, 2.0));
  float inner = exp(-pow((r - radius * 0.94) / (w * 4.0), 2.0)) * 0.12;
  float fade = pow(1.0 - uProg, 1.8) * uStr;
  gl_FragColor = vec4(uColor * (ring * 2.4 + inner) * fade, 1.0);
}
`

/** Chrome orbit rings (SINGULARITY). */
export const orbitVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
export const orbitFragment = /* glsl */ `
${COMMON}
${ENV_UNIFORMS}
${ENV}
uniform float uGlow;
uniform float uTime;
uniform float uSpeed;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 rd = normalize(vWorld - cameraPosition);
  if (dot(n, rd) > 0.0) n = -n;
  vec3 col = chrome(n, rd, 0.03, 1.0);
  // a pulse of light running around the ring
  float run = fract(vUv.x - uTime * uSpeed);
  float pulse = pow(smoothstep(0.75, 1.0, run), 6.0);
  col += mix(vec3(0.75, 0.86, 1.0), uAccent, 0.4) * pulse * uGlow * 6.0;
  gl_FragColor = vec4(col, 1.0);
}
`

/** Full-screen backdrop: near-black void with a soft cool core haze. */
export const backdropVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`
export const backdropFragment = /* glsl */ `
uniform float uAspect;
uniform float uFlash;
uniform float uEnergy;
uniform float uReveal;
uniform vec2 uCenter;
uniform vec3 uAccent;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = length(p);
  vec3 col = vec3(0.006, 0.0065, 0.008);
  col += vec3(0.03, 0.034, 0.045) * exp(-r * r * 2.2) * (0.6 + uEnergy * 0.5) * uReveal;
  col += mix(vec3(0.6, 0.68, 0.85), uAccent, 0.3) * 0.05 * exp(-r * 1.4) * uEnergy * uReveal;
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.22 * exp(-r * 0.9);
  gl_FragColor = vec4(col, 1.0);
}
`
