import { COMMON, ENV, ENV_UNIFORMS } from './chunks'

/**
 * Raymarched liquid chrome. The SDFs of CHROME HEART, MERCURY OCEAN and the
 * SINGULARITY core are blended by mode weights, so switching modes is a
 * continuous liquid morph. Smooth-min unions give real metaball behaviour:
 * satellites and droplets genuinely split off and re-merge.
 *
 * Rendered inside a bounding sphere (BackSide) with analytic entry/exit, writes
 * gl_FragDepth so shards/particles depth-sort correctly, and anti-aliases the
 * silhouette from the closest-approach distance.
 */
export const liquidVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const liquidFragment = /* glsl */ `
${COMMON}
${ENV_UNIFORMS}
${ENV}

uniform float uTime;
uniform float uFlow;
uniform float uSeed;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;
uniform float uKick;
uniform float uBreath;
uniform vec2 uWaves[4];
uniform vec4 uModeW;
uniform float uTwist;
uniform float uCharge;
uniform float uScale;
uniform float uCollapse;
uniform float uHeat;
uniform mat3 uRot;
uniform vec3 uMouseObj;
uniform float uMouseStr;
uniform float uBound;
uniform float uPixel;
uniform mat4 uViewProj;

varying vec3 vWorld;

float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdCapsuleY(vec3 p, float h, float r) { p.y -= clamp(p.y, -h, h); return length(p) - r; }

vec3 warp(vec3 p, float t, float a) {
  p += a * sin(p.yzx * 2.3 + vec3(t * 0.9, t * 1.1, t * 0.7));
  p += a * 0.5 * sin(p.zxy * 4.1 - vec3(t * 1.3, t * 0.8, t * 1.05));
  return p;
}

// ---- MODE 01 · CHROME HEART: interlinked ribbons fused into a core ----------
float sdHeart(vec3 p) {
  float t = uFlow;
  float sd = uSeed * 1.618;
  float inflate = 1.0 + uKick * 0.14 + uBass * 0.07 + uBreath * 0.025;
  vec3 q = warp(p, t, 0.045 + uMid * 0.075);

  // pulsing core
  float core = length(q * vec3(1.0, 0.9, 1.0)) - (0.44 + 0.05 * sin(t * 0.7)) * inflate;

  // three interlaced chrome ribbons (flattened tori), each on its own slow gimbal
  vec3 a = q; a.yz *= rot2(0.9 + 0.35 * sin(t * 0.37) + sd); a.xy *= rot2(t * 0.21 + sd * 0.7);
  float d1 = sdTorus(a * vec3(1.0, 1.6, 1.0), vec2(0.98 * inflate, 0.1 + 0.05 * uBass)) * 0.7;
  vec3 b = q; b.xy *= rot2(-0.85 + 0.3 * sin(t * 0.29 + 1.0) - sd * 0.5); b.yz *= rot2(t * 0.17 + 2.0 + sd);
  float d2 = sdTorus(b, vec2(0.8 * inflate, 0.085 + 0.04 * uMid));
  vec3 c = q; c.xz *= rot2(t * 0.13 + sd * 1.3); c.yz *= rot2(1.57 + 0.45 * sin(t * 0.23));
  float d3 = sdTorus(c, vec2(1.17 * inflate, 0.055 + 0.03 * uTreble));

  float d = smin(core, d1, 0.2);
  d = smin(d, d2, 0.18);
  d = smin(d, d3, 0.14);

  // satellites drift in, fuse with the ribbons, and tear away again
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec3 sp = vec3(sin(t * 0.52 + fi * 1.7 + sd), cos(t * 0.43 + fi * 2.3), sin(t * 0.37 + fi * 0.9 + sd * 0.5));
    sp *= 1.0 + 0.36 * sin(t * 0.61 + fi * 1.3) + uKick * 0.16;
    float sr = 0.13 + 0.05 * sin(fi * 3.1) + 0.04 * uBass;
    d = smin(d, length(q - sp) - sr, 0.3);
  }
  return d;
}

// ---- MODE 02 · MERCURY OCEAN: a floating body of quicksilver -----------------
float sdMercury(vec3 p) {
  float t = uFlow;
  float r = length(p);
  vec3 q = p;
  float sw = (0.5 + uMid * 1.4) * exp(-r * 0.5);
  q.xz *= rot2(sw * sin(t * 0.35) * 2.0 + q.y * (0.4 + uMid * 0.8));
  vec3 n = q / max(r, 1e-4);

  float big = sin(n.x * 2.1 + t * 0.8) * sin(n.y * 2.4 - t * 0.6) * sin(n.z * 1.8 + t * 0.55);
  float swell = sin(n.y * 3.0 + t * 0.9) * 0.5 + 0.5;
  float waves = (0.06 + uBass * 0.17 + uKick * 0.15) * big + 0.05 * swell * uMid;
  float ang = atan(n.z, n.x);
  float lat = acos(clamp(n.y, -1.0, 1.0));
  float ripple = sin(lat * 16.0 - t * 7.0 + ang * 2.0) * (0.005 + uTreble * 0.02);
  float sp = sin(n.x * 9.0 + t * 0.4) * sin(n.y * 9.0 - t * 0.3) * sin(n.z * 9.0 + t * 0.35);
  float spikes = pow(max(sp, 0.0), 5.0) * (uTreble * 0.26 + uKick * 0.2 + 0.01);
  float d = (r - 1.0 * (1.0 + uKick * 0.08 + uBreath * 0.02) - waves - ripple - spikes) * 0.62;

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ph = t * 0.33 + fi * 1.37 + uSeed;
    float o = pow(max(sin(ph), 0.0), 3.0);
    vec3 dir = normalize(vec3(sin(fi * 2.4 + 0.3), cos(fi * 1.7) * 0.8 + 0.2, sin(fi * 3.1 + 1.0)));
    vec3 cp = dir * (1.0 + o * (0.5 + uBass * 0.6));
    float rr = 0.1 + 0.05 * fract(fi * 0.618) + 0.03 * o;
    d = smin(d, length(p - cp) - rr, 0.3);
  }
  return d;
}

// ---- MODE 04 · SINGULARITY: spinning energy core with polar jets -------------
float sdSingular(vec3 p) {
  float t = uFlow;
  float R = 0.46 * (1.0 + uKick * 0.25 + uBass * 0.08) * (1.0 - 0.7 * uCollapse);
  vec3 q = p;
  q.xz *= rot2(t * 1.4 + q.y * 2.5);
  q += 0.05 * sin(q.yzx * 8.0 + t * 3.0) * (0.6 + uTreble);
  float d = length(q) - R;
  float jl = (0.15 + uEnergy * 0.8) * (1.0 - uCollapse);
  d = smin(d, sdCapsuleY(p, R + jl, 0.016 + 0.02 * uKick), 0.18);
  return d;
}

float mapShape(vec3 p) {
  float acc = 0.0;
  if (uModeW.x > 0.002) acc += uModeW.x * sdHeart(p);
  if (uModeW.y > 0.002) acc += uModeW.y * sdMercury(p);
  if (uModeW.z > 0.002) acc += uModeW.z * (length(p) + 0.05);
  if (uModeW.w > 0.002) acc += uModeW.w * sdSingular(p);
  return acc;
}

float map(vec3 pw) {
  vec3 p = (uRot * pw) / uScale;
  float r = length(p);
  // bass shockwaves travelling outward across the surface
  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 w = uWaves[i];
    float front = 0.3 + w.x * 2.8;
    wave += w.y * exp(-pow((r - front) * 4.5, 2.0)) * exp(-w.x * 2.4);
  }
  p.xz *= rot2(p.y * uTwist * 2.4);
  float d = mapShape(p);
  d -= wave * 0.085;
  float vib = uTreble * 0.004 + uCharge * 0.012;
  d -= vib * sin(p.x * 31.0 + uTime * 41.0) * sin(p.y * 29.0 - uTime * 37.0) * sin(p.z * 33.0 + uTime * 35.0);
  vec3 mp = p - uMouseObj;
  d -= uMouseStr * 0.15 * exp(-dot(mp, mp) * 5.0);
  return d * uScale * 0.8;
}

vec3 calcNormal(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * e) +
    k.yyx * map(p + k.yyx * e) +
    k.yxy * map(p + k.yxy * e) +
    k.xxx * map(p + k.xxx * e));
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = 0.03 + 0.12 * float(i);
    float d = map(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.8;
  }
  return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uBound * uBound;
  float h = b * b - c;
  if (h < 0.0) discard;
  h = sqrt(h);
  float t = max(-b - h, 0.0);
  float tEnd = -b + h;

  float best = 1e9;
  float tBest = t;
  bool hit = false;
  for (int i = 0; i < STEPS; i++) {
    float d = map(ro + rd * t);
    if (d < 0.0006 * t) { hit = true; break; }
    float ratio = d / t;
    if (ratio < best) { best = ratio; tBest = t; }
    t += d;
    if (t > tEnd) break;
  }
  float alpha = 1.0;
  if (!hit) {
    alpha = 1.0 - smoothstep(0.0, uPixel * 1.5, best);
    if (alpha < 0.004) discard;
    t = tBest;
  }

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p, 0.0012 + 0.0003 * t);
  vec3 po = uRot * p;

  // high-frequency shimmer from the treble, as a normal perturbation
  float mv = uTreble * 0.1 + uCharge * 0.16;
  n = normalize(n + mv * 0.3 * vec3(
    sin(po.y * 48.0 + uTime * 30.0),
    sin(po.z * 51.0 - uTime * 27.0),
    sin(po.x * 46.0 + uTime * 33.0)));

  float occ = calcAO(p, n);
  float NoV = clamp(dot(n, -rd), 0.0, 1.0);
  vec3 col = chrome(n, rd, 0.02, mix(1.0, occ, 0.85));

#ifdef BOUNCE
  vec3 r = reflect(rd, n);
  float t2 = 0.03;
  bool hit2 = false;
  for (int i = 0; i < 24; i++) {
    float d = map(p + r * t2);
    if (d < 0.002) { hit2 = true; break; }
    t2 += d;
    if (t2 > 2.6) break;
  }
  if (hit2) {
    vec3 p2 = p + r * t2;
    vec3 n2 = calcNormal(p2, 0.003);
    vec3 c2 = chrome(n2, r, 0.05, 0.75) * chromeF(n, rd);
    col = mix(col, c2 * occ, 0.9);
  }
#endif

  // inner energy veins: charge before the burst, always alive in the singularity
  float vt = uTime * 0.6;
  float v = abs(sin(po.x * 5.0 + sin(po.y * 4.0 + vt)) * sin(po.y * 6.0 + sin(po.z * 5.0 - vt)) * sin(po.z * 5.5 + sin(po.x * 4.5 + vt * 1.3)));
  float veins = smoothstep(0.045, 0.0, v);
  float glow = uCharge + uModeW.w * (0.2 + uEnergy * 0.6 + uKick * 0.5) + uHeat * 0.3;
  vec3 eCol = mix(vec3(0.74, 0.86, 1.0), uAccent, 0.4);
  col += eCol * veins * glow * 5.5;
  col += eCol * uModeW.w * pow(NoV, 3.0) * (0.5 + uEnergy * 1.4 + uKick * 2.0) * (1.0 + uCollapse * 4.0);
  col += vec3(1.0, 0.93, 0.86) * (uHeat * 1.2 + uCharge * 0.5) * pow(1.0 - NoV, 3.0);

  gl_FragColor = vec4(col, alpha);
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
}
`
