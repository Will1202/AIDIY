// Procedural universe forms. Every particle carries 8 random seeds (a, b);
// each form maps those seeds to a target position + colour. Shared by the
// simulation (positions) and the renderer (colour/size), so nothing is stored per form.
#define PI 3.14159265359
#define TAU 6.28318530718

uniform float uTime;
uniform float uGalaxyAngle;
uniform float uDiskTime;
uniform float uDnaAngle;
uniform float uDnaTilt;
uniform float uMorph;
uniform int uFormA;
uniform int uFormB;

const float GALAXY_TILT = 0.62;
const float DISK_TILT = 0.17;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

vec2 gauss2(vec2 u) {
  float r = sqrt(-2.0 * log(max(u.x, 1e-5)));
  float a = TAU * u.y;
  return r * vec2(cos(a), sin(a));
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

struct Shape {
  vec3 pos;
  vec3 color;
  float size;
  float alpha;
};

// ── 0 · GALAXY ────────────────────────────────────────────────────────────────
Shape galaxyShape(vec4 a, vec4 b) {
  Shape s = Shape(vec3(0.0), vec3(0.0), 1.0, 1.0);
  vec2 g1 = gauss2(b.xy);
  vec2 g2 = gauss2(vec2(b.z, a.z));
  mat3 tilt = rotX(GALAXY_TILT);
  if (a.w < 0.14) {
    // bulge
    vec3 p = vec3(g1.x, g1.y * 0.6, g2.x) * 0.38;
    p *= 1.0 + 0.6 * pow(a.x, 3.0);
    s.pos = tilt * (rotY(uGalaxyAngle * 1.7) * p);
    float k = clamp(length(p) / 0.9, 0.0, 1.0);
    s.color = mix(vec3(1.0, 0.88, 0.66) * 2.3, vec3(1.0, 0.7, 0.38) * 1.1, k);
    s.size = 0.9;
    s.alpha = 1.0;
    return s;
  }
  float r = 0.28 - log(1.0 - a.x * 0.982) * 1.12;
  float arm = floor(a.y * 2.0);
  float inArm = step(0.24, fract(a.y * 2.0));
  float theta = arm * PI + 3.1 * log(r / 0.28 + 1.0);
  theta += g1.x * mix(1.4, 0.2 + 0.05 * r, inArm);
  float h = g1.y * 0.1 * exp(-r * 0.3);
  vec3 p = vec3(cos(theta) * r, h, sin(theta) * r);
  p.xz += g2 * (0.05 + 0.03 * r);
  s.pos = tilt * (rotY(uGalaxyAngle) * p);
  float warm = smoothstep(2.2, 0.5, r);
  float dust = step(0.8, hash11(a.z * 917.0 + b.w * 31.0));
  vec3 blue = vec3(0.4, 0.64, 1.0);
  vec3 gold = vec3(1.0, 0.66, 0.32);
  s.color = mix(blue, gold, max(warm, dust * 0.9)) * mix(0.55, 1.15, inArm);
  s.size = 1.0;
  s.alpha = mix(0.5, 1.0, inArm) * (0.15 + 0.85 * smoothstep(5.8, 3.0, r));
  if (b.w > 0.988) {
    s.color = vec3(0.85, 0.93, 1.0) * 3.0;
    s.size = 2.3;
    s.alpha = 1.0;
  }
  return s;
}

// ── 1 · BLACK HOLE (accretion disk + polar jets) ──────────────────────────────
Shape holeShape(vec4 a, vec4 b, float scale) {
  Shape s = Shape(vec3(0.0), vec3(0.0), 1.0, 1.0);
  vec2 g1 = gauss2(b.yz);
  mat3 tilt = rotX(DISK_TILT);
  if (a.w < 0.07) {
    float side = a.y < 0.5 ? -1.0 : 1.0;
    float t = a.x;
    float rad = (0.05 + t * 0.38) * (0.35 + 0.65 * b.x);
    float ang = b.y * TAU + uTime * 3.0;
    vec3 p = vec3(cos(ang) * rad, side * (0.4 + t * 5.6), sin(ang) * rad);
    s.pos = tilt * p * scale;
    float pulse = pow(0.5 + 0.5 * sin(t * 18.0 - uTime * 7.0), 6.0);
    s.color = vec3(0.5, 0.75, 1.0) * (1.0 + 2.5 * pulse);
    s.size = 0.8;
    s.alpha = pow(1.0 - t, 1.5) * 0.9;
    return s;
  }
  float r = 1.0 + pow(a.x, 1.7) * 4.4;
  float omega = 2.4 * pow(r, -1.5);
  float theta = b.x * TAU + uDiskTime * omega;
  float h = g1.x * (0.012 + 0.018 * r);
  vec3 local = vec3(cos(theta) * r, h, sin(theta) * r);
  s.pos = tilt * local * scale;
  float T = pow(1.0 / r, 0.8);
  vec3 col = mix(vec3(0.75, 0.24, 0.06) * 0.7, vec3(1.0, 0.68, 0.3) * 1.4, smoothstep(0.2, 0.6, T));
  col = mix(col, vec3(1.0, 0.95, 0.86) * 2.6, smoothstep(0.62, 1.0, T));
  vec3 vel = tilt * vec3(-sin(theta), 0.0, cos(theta));
  float doppler = 1.0 + 0.6 * vel.z;
  col *= doppler * (0.78 + 0.22 * sin(r * 13.0 + g1.y));
  s.color = col;
  s.size = 0.85;
  s.alpha = 0.1 + 0.9 * smoothstep(5.4, 3.4, r);
  return s;
}

// ── 2 · DNA double helix ──────────────────────────────────────────────────────
Shape dnaShape(vec4 a, vec4 b) {
  Shape s = Shape(vec3(0.0), vec3(0.0), 1.0, 1.0);
  const float L = 10.0;
  const float R = 0.95;
  const float TW = 1.05;
  const float GROOVE = 2.3;
  vec2 g1 = gauss2(b.xy);
  vec2 g2 = gauss2(vec2(b.z, a.z));
  vec3 p;
  vec3 col;
  float size = 1.0;
  float alpha = 1.0;
  if (a.w < 0.76) {
    float strand = step(0.38, a.w);
    float t = (a.x - 0.5) * L;
    float ang = t * TW + uDnaAngle + strand * GROOVE;
    p = vec3(cos(ang) * R, t, sin(ang) * R) + vec3(g1, g2.x) * 0.055;
    float pulse = pow(0.5 + 0.5 * sin(t * 1.4 - uTime * 2.6 + strand * PI), 10.0);
    col = mix(vec3(1.0, 0.68, 0.32), vec3(0.45, 0.72, 1.0), strand) * (1.1 + 2.4 * pulse);
  } else if (a.w < 0.93) {
    float k = floor(a.x * 40.0);
    float t = ((k + 0.5) / 40.0 - 0.5) * L;
    float ang = t * TW + uDnaAngle;
    vec3 pa = vec3(cos(ang) * R, t, sin(ang) * R);
    vec3 pb = vec3(cos(ang + GROOVE) * R, t, sin(ang + GROOVE) * R);
    float f = a.y;
    p = mix(pa, pb, f) + vec3(g2.x, g1.y, g2.y) * 0.02;
    col = mix(vec3(1.0, 0.72, 0.4), vec3(0.5, 0.75, 1.0), f) * 0.8;
    size = 0.8;
    alpha = 0.55 + 0.45 * sin(f * PI);
  } else {
    float t = (a.x - 0.5) * L * 1.25;
    float rr = 1.6 + pow(a.y, 0.7) * 2.6;
    float ang = b.y * TAU + uTime * 0.15 + t * 0.2;
    p = vec3(cos(ang) * rr, t, sin(ang) * rr);
    col = vec3(0.35, 0.55, 1.0) * 0.7;
    alpha = 0.45;
    size = 0.9;
  }
  s.pos = rotZ(uDnaTilt) * p;
  s.color = col;
  s.size = size;
  s.alpha = alpha;
  return s;
}

// ── 3 · NEBULA (domain-warped gas lobes) ──────────────────────────────────────
Shape nebulaShape(vec4 a, vec4 b) {
  Shape s = Shape(vec3(0.0), vec3(0.0), 1.0, 1.0);
  vec2 g1 = gauss2(b.xy);
  vec2 g2 = gauss2(vec2(b.z, a.z));
  float lobe = floor(a.w * 6.0);
  vec3 c = vec3(0.0);
  float rad = 3.4;
  if (lobe < 1.0) { c = vec3(-2.3, 0.5, -0.4); rad = 1.6; }
  else if (lobe < 2.0) { c = vec3(1.9, -0.3, 0.2); rad = 1.8; }
  else if (lobe < 3.0) { c = vec3(0.1, 1.2, -1.4); rad = 1.4; }
  else if (lobe < 4.0) { c = vec3(-0.6, -1.2, 1.0); rad = 1.3; }
  else if (lobe < 5.0) { c = vec3(3.0, 1.2, -1.8); rad = 1.2; }
  vec3 p = c + vec3(g1, g2.x) * rad * 0.55;
  float t = uTime * 0.12;
  float sheet = step(0.45, a.x);
  p.y = mix(p.y, c.y + 0.7 * sin(p.x * 1.1 + p.z * 0.7 + t * 2.0) + g2.y * 0.12, sheet * 0.85);
  p += 0.75 * vec3(sin(p.y * 1.25 + t * 1.7), sin(p.z * 1.05 + t * 1.3 + 1.7), sin(p.x * 1.15 + t * 1.5 + 3.1));
  p += 0.32 * vec3(sin(p.z * 2.4 - t * 2.3), sin(p.x * 2.1 + t * 1.9), sin(p.y * 2.7 - t * 2.1 + 0.5));
  float dens = exp(-dot(p - c, p - c) / (rad * rad));
  s.pos = rotY(uTime * 0.035) * (p - vec3(0.4, 0.15, 0.0));
  vec3 deep = vec3(0.06, 0.16, 0.75);
  vec3 ice = vec3(0.3, 0.72, 1.0);
  vec3 gold = vec3(1.0, 0.6, 0.26);
  vec3 col = mix(deep, ice, smoothstep(0.1, 0.8, dens));
  // warm emission knots where the gas is densest
  col = mix(col, gold, max(step(0.78, fract(b.w * 11.0)), smoothstep(0.75, 0.95, dens) * step(0.5, a.y)) * 0.9);
  s.color = col * (0.75 + 1.2 * dens);
  s.size = 1.6;
  s.alpha = 0.32 + 0.6 * dens;
  if (b.w > 0.993) {
    s.color = vec3(0.9, 0.95, 1.0) * 3.0;
    s.size = 2.0;
    s.alpha = 1.0;
  }
  return s;
}

// ── 4 · SINGULARITY (energy core, gyroscopic rings, light rays) ───────────────
Shape singularityShape(vec4 a, vec4 b) {
  Shape s = Shape(vec3(0.0), vec3(0.0), 1.0, 1.0);
  vec2 g1 = gauss2(b.xy);
  vec2 g2 = gauss2(vec2(b.z, a.z));
  vec3 dir = normalize(vec3(g1, g2.x) + 1e-4);
  float pulse = 1.0 + 0.1 * sin(uTime * 3.2);
  if (a.w < 0.42) {
    float r = pow(a.x, 2.4) * 0.95 * pulse;
    s.pos = dir * r;
    s.color = mix(vec3(1.0, 0.95, 0.85) * 3.0, vec3(1.0, 0.7, 0.35) * 1.6, a.x);
    s.size = 0.8;
    s.alpha = 0.8;
  } else if (a.w < 0.78) {
    float idx = floor(a.y * 3.0);
    float dirSign = mod(idx, 2.0) < 0.5 ? 1.0 : -1.0;
    float rr = 1.55 + idx * 0.5 + g2.y * 0.025;
    float ang = a.x * TAU + uTime * (1.4 - idx * 0.35) * dirSign;
    vec3 p = vec3(cos(ang) * rr, g1.x * 0.02, sin(ang) * rr);
    mat3 m = rotX(0.5 + idx * 1.1 + uTime * 0.21 * (idx + 1.0)) * rotZ(idx * 0.9 + uTime * 0.13);
    s.pos = m * p;
    s.color = (dirSign > 0.0 ? vec3(0.45, 0.72, 1.0) : vec3(1.0, 0.7, 0.36)) * 1.4;
    s.size = 0.75;
    s.alpha = 0.9;
  } else {
    float ray = floor(a.y * 48.0);
    vec3 rd = normalize(vec3(hash11(ray * 1.7) - 0.5, hash11(ray * 3.1 + 0.4) - 0.5, hash11(ray * 5.3 + 0.9) - 0.5));
    float len = 2.2 + 2.0 * hash11(ray * 9.7);
    float r = 0.9 + a.x * len;
    s.pos = rd * r + dir * 0.035 * (1.0 + a.x * 3.0);
    float wave = pow(0.5 + 0.5 * sin(a.x * 12.0 - uTime * 6.0 + ray), 6.0);
    s.color = mix(vec3(1.0, 0.8, 0.5) * 2.0, vec3(0.4, 0.65, 1.0), a.x) * (0.7 + 2.0 * wave);
    s.size = 0.7;
    s.alpha = (1.0 - a.x) * 0.9;
  }
  return s;
}

Shape getShape(int id, vec4 a, vec4 b) {
  if (id == 0) return galaxyShape(a, b);
  if (id == 1) return holeShape(a, b, 1.0);
  if (id == 2) return dnaShape(a, b);
  if (id == 3) return nebulaShape(a, b);
  return singularityShape(a, b);
}

// Per-particle staggered morph progress: transitions ripple through the swarm.
float morphProgress(vec4 a, vec4 b) {
  float d = b.w * 0.32 + a.x * 0.28;
  return smoothstep(d, d + 0.4, uMorph);
}
