import { COMMON, ENV, ENV_UNIFORMS } from './chunks'

/**
 * GPGPU metal shards. Position (xyz + spin angle) and velocity (xyz + visible
 * scale) live in float textures; every frame a spring-damper pulls each shard
 * toward a mode-specific home, while beats, the burst, gravity and the mouse
 * add forces. Inertia comes for free — nothing is randomly spawned/destroyed.
 */
const SIM_COMMON = /* glsl */ `
${COMMON}
uniform sampler2D tSeed;
uniform float uDt;
uniform float uTime;
uniform float uFlow;
uniform float uStream;
uniform float uOrbit;
uniform float uModeA;
uniform float uModeB;
uniform float uModeT;
uniform float uExplode;
uniform float uGather;
uniform float uBurst;
uniform float uShock;
uniform float uCollapse;
uniform float uEnergy;
uniform float uBass;
uniform float uKick;
uniform float uRelease;
uniform vec3 uRayO;
uniform vec3 uRayD;
uniform float uMouseStr;
uniform mat3 uObjRot;

// Liquid modes: most shards hide inside the body; treble releases them into a stream.
vec3 homeLiquid(vec4 S, float floatFrac, out float sc) {
  if (S.w < floatFrac) {
    float r = 1.9 + S.x * 1.1;
    float th = S.y * 6.2832 + uOrbit * (0.08 + 0.12 * S.z);
    float ph = (S.z - 0.5) * 2.2;
    sc = 0.6 + S.x * 0.6;
    return vec3(cos(th) * cos(ph), sin(ph) * 0.7, sin(th) * cos(ph)) * r;
  }
  if (S.w < floatFrac + uRelease) {
    float lane = floor(S.z * 3.0);
    float r = 1.45 + S.x * 0.55 + lane * 0.14;
    float th = S.y * 6.2832 + uStream * (0.9 + 0.6 * S.z) * (lane == 1.0 ? -1.0 : 1.0);
    vec3 p = vec3(cos(th) * r, (S.x - 0.5) * 0.16, sin(th) * r);
    p.yz = rot2(0.5 + lane * 0.9) * p.yz;
    p.xy = rot2(lane * 1.1) * p.xy;
    sc = 0.4 + 0.25 * S.x;
    return p;
  }
  vec3 dir = normalize(S.xyz * 2.0 - 1.0 + vec3(1e-3));
  sc = 0.0;
  return uObjRot * (dir * 0.52);
}

vec3 knot(float u) {
  float r = 2.0 + cos(3.0 * u);
  return vec3(r * cos(2.0 * u), sin(3.0 * u) * 1.1, r * sin(2.0 * u)) * 0.52;
}

// SHATTERED REALITY: a trefoil-knot sculpture built from fragments + halo.
vec3 homeShatter(vec4 S, out float sc) {
  if (S.w < 0.16) {
    vec3 dir = normalize(S.xyz * 2.0 - 1.0 + vec3(1e-3));
    dir.xz = rot2(uOrbit * 0.1 * (0.5 + S.y)) * dir.xz;
    sc = 0.45 + S.y * 0.4;
    return dir * (2.3 + S.x * 0.9) * (1.0 + uBass * 0.15);
  }
  float u = S.x * 6.2832;
  vec3 c = knot(u);
  vec3 T = normalize(knot(u + 0.01) - c);
  vec3 B = normalize(cross(T, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 N = cross(B, T);
  float v = S.y * 6.2832 + uFlow * 0.3;
  float tube = (0.16 + 0.16 * S.z) * (1.0 + uEnergy * 0.6);
  float breathe = 1.0 + uBass * 0.22 + uKick * 0.12;
  sc = 0.42 + 0.3 * S.z;
  vec3 p = c * breathe + (N * cos(v) + B * sin(v)) * tube;
  p.yz = rot2(1.05) * p.yz; // present the trefoil to the camera
  return uObjRot * p;
}

// SINGULARITY: Keplerian accretion disk + a polar ring orbit.
vec3 homeSing(vec4 S, out float sc) {
  float collapse = 1.0 - 0.88 * uCollapse;
  if (S.w < 0.18) {
    float r = 1.25 + S.x * 0.25;
    float th = S.y * 6.2832 + uOrbit * 1.1;
    vec3 p = vec3(cos(th) * r, sin(th) * r, (S.z - 0.5) * 0.06);
    p.xz = rot2(0.6) * p.xz;
    sc = 0.4;
    return p * collapse;
  }
  float r = 0.9 + pow(S.x, 1.7) * 2.7;
  float w = 1.5 / pow(r, 1.5);
  float th = S.y * 6.2832 + uOrbit * w * 1.6;
  vec3 p = vec3(cos(th) * r, (S.z - 0.5) * 0.05 * r, sin(th) * r);
  p.yz = rot2(0.32) * p.yz;
  p.xy = rot2(-0.18) * p.xy;
  sc = 0.35 + (1.0 - S.x) * 0.55;
  return p * collapse;
}

// divergence-free swirl field
vec3 swirl(vec3 p, float t) {
  return 0.5 * vec3(
    sin(p.y * 1.3 + t * 0.7) + sin(p.z * 2.1 - t * 0.5),
    sin(p.z * 1.5 - t * 0.6) + sin(p.x * 1.9 + t * 0.4),
    sin(p.x * 1.4 + t * 0.5) + sin(p.y * 2.3 - t * 0.7));
}
`

export const velocitySim = /* glsl */ `
${SIM_COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(tPos, uv);
  vec4 V = texture2D(tVel, uv);
  vec4 S = texture2D(tSeed, uv);
  vec3 pos = P.xyz;
  vec3 vel = V.xyz;
  float scale = V.w;

  float m = (uModeT > S.y * 0.9) ? uModeB : uModeA;
  float sc;
  vec3 target;
  float k;
  float damp;
  float shockGain = 1.4;
  float turb = 0.0;
  if (m < 0.5) { target = homeLiquid(S, 0.022, sc); k = 9.0; damp = 4.5; }
  else if (m < 1.5) { target = homeLiquid(S, 0.014, sc); k = 9.0; damp = 4.5; }
  else if (m < 2.5) { target = homeShatter(S, sc); k = 7.5 - uEnergy * 3.5; damp = 3.0; shockGain = 3.4; turb = uEnergy * 2.6; }
  else { target = homeSing(S, sc); k = 30.0; damp = 7.5; }

  target *= 1.0 - 0.3 * uCollapse;

  float freeF = uExplode * (1.0 - uGather);
  vec3 toT = target - pos;
  float dist = length(toT);
  // free flight keeps a faint tether so the cloud hovers instead of leaving the frame
  vec3 acc = toT * k * (1.0 - freeF * 0.975);
  if (uExplode > 0.0) {
    vec3 tang = normalize(cross(toT + vec3(1e-4), vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
    acc += tang * dist * 3.2 * uGather * (1.0 - uGather) * (0.5 + S.x);
    acc += toT * 7.0 * uGather * uGather;
  }
  acc += swirl(pos * 0.9, uTime) * (0.35 + uEnergy * 1.4 + freeF * 1.1 + turb);

  // magnetic repulsion from the cursor ray
  vec3 w = pos - uRayO;
  vec3 away = pos - (uRayO + uRayD * dot(w, uRayD));
  float ad = length(away);
  acc += away / (ad + 1e-3) * uMouseStr * 16.0 * exp(-ad * ad * 4.0);

  vel += acc * uDt;

  // one-frame impulses
  vec3 radial = normalize(pos + (S.xyz - 0.5) * 0.3 + vec3(1e-4));
  vel += radial * uShock * shockGain * (0.5 + S.z) * (1.0 - 0.7 * freeF);
  if (uBurst > 0.0) {
    vec3 dir = normalize(pos + (S.xyz - 0.5) * 0.9 + vec3(1e-4));
    vel += dir * uBurst * (2.2 + 5.0 * S.z * S.z);
    vel += normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4)) * uBurst * (S.w - 0.5) * 3.0;
  }

  vel *= exp(-mix(damp, 1.5, freeF) * uDt);
  float sp = length(vel);
  if (sp > 22.0) vel *= 22.0 / sp;

  float tsc = max(sc, uExplode * (0.75 + 0.5 * S.x));
  scale += (tsc - scale) * (1.0 - exp(-uDt * (tsc > scale ? 14.0 : 3.5)));
  gl_FragColor = vec4(vel, scale);
}
`

export const positionSim = /* glsl */ `
uniform float uDt;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(tPos, uv);
  vec4 V = texture2D(tVel, uv);
  P.xyz += V.xyz * uDt;
  float h = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  P.w = mod(P.w + uDt * (0.3 + length(V.xyz) * 1.2) * (h > 0.5 ? 1.0 : -1.0), 6.2831853);
  gl_FragColor = P;
}
`

export const shardVertex = /* glsl */ `
attribute vec2 aRef;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tSeed;
uniform float uSize;
varying vec3 vWorld;
varying float vSeed;

mat3 axisAngle(vec3 a, float ang) {
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(
    oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
    oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
    oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
}

void main() {
  vec4 P = texture2D(tPos, aRef);
  vec4 V = texture2D(tVel, aRef);
  vec4 S = texture2D(tSeed, aRef);
  float sc = V.w * uSize * (0.55 + S.x * 1.1);
  vSeed = S.w;
  vWorld = P.xyz;
  if (sc < 0.0004) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 axis = normalize(S.yzw * 2.0 - 1.0 + vec3(1e-3));
  mat3 R = axisAngle(axis, P.w + S.x * 6.28);
  vec3 stretch = vec3(0.55 + S.z * 0.9, 1.0 + S.w * 1.8, 0.35 + S.y * 0.5);
  vec3 wp = P.xyz + R * (position * stretch) * sc;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

export const shardFragment = /* glsl */ `
${COMMON}
${ENV_UNIFORMS}
${ENV}
uniform float uHeat;
varying vec3 vWorld;
varying float vSeed;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 rd = normalize(vWorld - cameraPosition);
  if (dot(n, rd) > 0.0) n = -n;
  vec3 col = chrome(n, rd, 0.04, 0.82);
  float NoV = clamp(dot(n, -rd), 0.0, 1.0);
  col += vec3(1.0, 0.9, 0.8) * uHeat * (0.3 + vSeed) * 1.4 * (0.2 + pow(1.0 - NoV, 2.0));
  gl_FragColor = vec4(col, 1.0);
}
`
