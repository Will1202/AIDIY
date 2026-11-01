// The parallel universe: a rotating nebula vortex (baked cubemap), a colossal
// luminous ring framing a blue-white star, and three lit worlds — all analytic.
precision highp float;
precision highp sampler2D;
precision highp samplerCube;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uTanHalf;
uniform samplerCube uSky;
uniform sampler2D uNoise;
uniform mat3 uSkyRot;
uniform float uTime;
uniform float uGain;

const float TAU = 6.28318530718;

#include <stars>

const vec3 STAR = vec3(0.0, 40.0, -1400.0);
const vec3 RING_N = vec3(0.13, 0.50, 0.856);         // normalised below
const float RING_A = 492.0;
const float RING_B = 548.0;

const vec3 PA = vec3(-360.0, -235.0, -720.0);        // violet gas giant
const float RA = 215.0;
const vec3 PB = vec3(430.0, 120.0, -1150.0);         // ringed silver world
const float RB = 68.0;
const vec3 PC = vec3(165.0, -70.0, -390.0);          // small moon
const float RC = 15.0;

float sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}

float planeHit(vec3 ro, vec3 rd, vec3 c, vec3 n) {
  float dn = dot(rd, n);
  if (abs(dn) < 1e-5) return -1.0;
  return dot(c - ro, n) / dn;
}

vec3 tex3(vec2 uv, float lod) {
  return textureLod(uNoise, uv, lod).rgb;
}

vec3 shadePlanet(vec3 p, vec3 c, float r, vec3 rd, int kind) {
  vec3 n = normalize(p - c);
  // key light from an off-screen sun (front-right) + the ring star as back light
  vec3 L = normalize(mix(normalize(STAR - p), normalize(vec3(0.75, 0.35, 0.55)), 0.72));
  float ndl = dot(n, L);
  float lit = smoothstep(-0.18, 0.55, ndl);
  vec3 axis = normalize(kind == 0 ? vec3(0.22, 1.0, 0.1) : vec3(-0.25, 1.0, 0.18));
  float lat = dot(n, axis);
  float lon = atan(n.z, n.x) / TAU;
  vec3 base;
  if (kind == 0) {
    float bands = tex3(vec2(lon * 2.0 + uTime * 0.004, lat * 2.6), 1.0).r;
    float storms = tex3(vec2(lon * 6.0 - uTime * 0.006, lat * 7.0), 0.5).g;
    base = mix(vec3(0.16, 0.10, 0.36), vec3(0.42, 0.30, 0.78), bands);
    base = mix(base, vec3(0.80, 0.55, 0.95), smoothstep(0.62, 0.9, storms) * 0.5);
    base = mix(base, vec3(0.08, 0.16, 0.42), smoothstep(0.55, 0.95, abs(lat)));
  } else if (kind == 1) {
    float bands = tex3(vec2(lon * 3.0, lat * 5.0), 1.0).b;
    base = mix(vec3(0.55, 0.62, 0.72), vec3(0.86, 0.90, 0.96), bands);
  } else {
    float cr = tex3(vec2(lon * 4.0, lat * 4.0), 0.0).g;
    base = mix(vec3(0.30, 0.30, 0.34), vec3(0.62, 0.60, 0.64), cr);
  }
  vec3 col = base * lit * 1.25;
  // atmospheric rim: back-scattered starlight on the limb
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  vec3 atm = kind == 0 ? vec3(0.45, 0.55, 1.0) : vec3(0.6, 0.85, 1.0);
  col += atm * fres * (0.25 + 1.4 * smoothstep(-0.35, 0.4, ndl)) * (kind == 2 ? 0.2 : 1.0);
  // faint bounce light from the nebula on the night side
  col += vec3(0.010, 0.008, 0.024) * (1.0 - lit);
  // thin back-lit limb from the ring star behind the worlds
  float back = pow(1.0 - max(dot(n, -rd), 0.0), 6.0) * max(dot(n, normalize(STAR - p)), 0.0);
  col += vec3(0.7, 0.8, 1.0) * back * 1.6;
  return col;
}

vec3 starGlow(vec3 rd, vec3 ro) {
  vec3 sd = normalize(STAR - ro);
  float c = dot(rd, sd);
  float a = acos(clamp(c, -1.0, 1.0));
  vec3 col = vec3(0.0);
  col += vec3(0.80, 0.90, 1.0) * (0.0009 / (a * a + 0.00012));
  col += vec3(0.55, 0.65, 1.0) * exp(-a * 9.0) * 0.6;
  col += vec3(0.85, 0.55, 1.0) * exp(-a * 2.2) * 0.12;
  // screen-aligned diffraction spikes + anamorphic streak (in camera space)
  float sx = dot(rd - sd * c, uRight);
  float sy = dot(rd - sd * c, uUp);
  float spike = exp(-abs(sy) * 900.0) * exp(-abs(sx) * 9.0) + exp(-abs(sx) * 900.0) * exp(-abs(sy) * 14.0);
  col += vec3(0.75, 0.85, 1.0) * spike * 0.9 * step(0.0, c);
  float streak = exp(-abs(sy) * 260.0) * exp(-abs(sx) * 2.4);
  col += vec3(0.45, 0.6, 1.0) * streak * 0.35 * step(0.0, c);
  return col;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uFwd + uRight * ndc.x * uTanHalf.x + uUp * ndc.y * uTanHalf.y);
  vec3 ro = uCamPos;

  float pixAng = 2.0 * uTanHalf.y / uRes.y;
  vec3 sd = uSkyRot * rd;
  vec3 col = texture(uSky, sd).rgb * 0.72 + starField(sd, pixAng, 0.6, 1.0, 0.45);

  // ---- the ring: a vast luminous annulus framing the star
  vec3 rn = normalize(RING_N);
  float tr = planeHit(ro, rd, STAR, rn);
  float tPlanet = 1e9;
  float tA = sphereHit(ro, rd, PA, RA);
  float tB = sphereHit(ro, rd, PB, RB);
  float tC = sphereHit(ro, rd, PC, RC);
  int kind = -1;
  if (tA > 0.0 && tA < tPlanet) { tPlanet = tA; kind = 0; }
  if (tB > 0.0 && tB < tPlanet) { tPlanet = tB; kind = 1; }
  if (tC > 0.0 && tC < tPlanet) { tPlanet = tC; kind = 2; }

  if (tr > 0.0 && tr < tPlanet) {
    vec3 q = ro + rd * tr - STAR;
    float rr = length(q);
    vec3 e1 = normalize(cross(rn, vec3(0.0, 1.0, 0.0)));
    vec3 e2 = cross(rn, e1);
    float az = atan(dot(q, e2), dot(q, e1)) / TAU;
    float band = smoothstep(RING_A, RING_A + 10.0, rr) * (1.0 - smoothstep(RING_B - 14.0, RING_B, rr));
    float fine = textureLod(uNoise, vec2(0.41, rr * 0.011), 0.0).g;
    float fine2 = textureLod(uNoise, vec2(0.77, rr * 0.043), 0.0).b;
    float flow = textureLod(uNoise, vec2(az * 3.0 + uTime * 0.0035, rr * 0.003), 0.0).r;
    float gaps = smoothstep(0.38, 0.62, fine) * (0.35 + 0.65 * fine2);
    float tEdge = (rr - RING_A) / (RING_B - RING_A);
    vec3 ringCol = mix(vec3(0.35, 0.8, 1.0), vec3(0.9, 0.92, 1.0), smoothstep(0.15, 0.5, tEdge));
    ringCol = mix(ringCol, vec3(1.0, 0.38, 0.8), smoothstep(0.62, 1.0, tEdge));
    float bright = band * gaps * (0.45 + 0.9 * flow);
    // forward-scattering: the side facing the star's light toward us glows harder
    float halo = exp(-abs(rr - (RING_A + RING_B) * 0.5) / 60.0) * 0.07;
    float inner = exp(-max(RING_A - rr, 0.0) / 40.0) * step(rr, RING_A) * 0.05;
    col += ringCol * (bright * 0.55 + halo * 0.25 + inner * 0.2);
  }

  col += starGlow(rd, ro);

  if (kind >= 0) {
    vec3 p = ro + rd * tPlanet;
    vec3 c = kind == 0 ? PA : (kind == 1 ? PB : PC);
    float r = kind == 0 ? RA : (kind == 1 ? RB : RC);
    col = shadePlanet(p, c, r, rd, kind);
  } else {
    // atmospheric halos just outside the limbs
    vec3 ocA = PA - ro;
    float dA = length(cross(ocA, rd));
    if (dot(ocA, rd) > 0.0) col += vec3(0.35, 0.45, 1.0) * exp(-(dA - RA) / (RA * 0.035)) * 0.35 * step(RA, dA);
    vec3 ocB = PB - ro;
    float dB = length(cross(ocB, rd));
    if (dot(ocB, rd) > 0.0) col += vec3(0.5, 0.8, 1.0) * exp(-(dB - RB) / (RB * 0.05)) * 0.3 * step(RB, dB);
  }

  // rings of planet B (drawn over or under the planet by depth)
  vec3 bn = normalize(vec3(0.28, 1.0, 0.12));
  float tb = planeHit(ro, rd, PB, bn);
  if (tb > 0.0 && tb < tPlanet) {
    float rr = length(ro + rd * tb - PB);
    float band = smoothstep(RB * 1.45, RB * 1.5, rr) * (1.0 - smoothstep(RB * 2.6, RB * 2.75, rr));
    float rings = textureLod(uNoise, vec2(0.2, rr * 0.05), 0.0).g;
    vec3 rc = mix(vec3(0.55, 0.62, 0.78), vec3(0.95, 0.92, 1.0), rings);
    float a = band * smoothstep(0.25, 0.7, rings) * 0.75;
    col = mix(col, rc * 0.9, a);
  }

  fragColor = vec4(col * uGain, 1.0);
}
