// =============================================================================
//  EVENT HORIZON — black hole renderer
//
//  What is physical:
//    Every pixel's light ray is integrated backwards through Schwarzschild
//    space-time with the exact photon-orbit equation in Binet form
//        x'' = -3/2 * h^2 * x / r^5       (units: Schwarzschild radius r_s = 1)
//    with RK4 steps. The shadow size, the photon ring, the arcs of the far disk
//    bent over and under the hole, and the lensing of the background sky all
//    fall out of that integration — nothing is painted on.
//    Disk light gets relativistic Doppler beaming and gravitational redshift.
//
//  What is artistic approximation:
//    The disk is infinitely thin with an emissive "haze" slab, its turbulence is
//    textured noise advected at Keplerian speed, and brightness curves are tuned.
// =============================================================================
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
uniform vec2 uShift;
uniform float uAspect;
uniform vec2 uBhUv;

uniform samplerCube uSky;
uniform sampler2D uNoise;

uniform float uTime;
uniform float uDiskTime;
uniform float uDiskBright;
uniform float uBeaming;
uniform float uHaze;
uniform float uRingBoost;
uniform float uSkyGain;
uniform float uEscape;
uniform float uHoleDepth;

uniform float uRipple;
uniform float uRippleR;
uniform float uWaves;

uniform vec3 uHotPos;
uniform float uHot;

#ifndef STEPS
#define STEPS 140
#endif
#ifndef DISK_LAYERS
#define DISK_LAYERS 3
#endif

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float R_IN = 2.35;
const float R_OUT = 13.5;
const float NOISE_RES = 512.0;

#include <stars>

vec3 heatRamp(float t) {
  t = clamp(t, 0.0, 1.3) * 4.0;
  vec3 c0 = vec3(0.26, 0.018, 0.006);
  vec3 c1 = vec3(0.92, 0.20, 0.035);
  vec3 c2 = vec3(1.00, 0.52, 0.15);
  vec3 c3 = vec3(1.00, 0.80, 0.52);
  vec3 c4 = vec3(1.00, 0.95, 0.88);
  vec3 c5 = vec3(0.80, 0.88, 1.00);
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  return mix(c4, c5, min(t - 4.0, 1.0));
}

vec2 hash21(float n) {
  return fract(sin(vec2(n * 12.9898, n * 78.233)) * 43758.5453);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One advected noise layer. Frequencies are chosen so features are only mildly
// elongated along the flow (differential rotation shears them further over time)
// instead of looking like brushed concentric rings.
float diskLayer(float turns, float lr, vec2 off, float fu, float fv) {
  float n = 0.0;
  vec2 uv1 = vec2(turns * 4.0, lr * 1.25) + off;
  n += textureGrad(uNoise, uv1, vec2(fu * 4.0, 0.0), vec2(0.0, fv * 1.25)).r * 0.5;
#if DISK_LAYERS > 1
  vec2 uv2 = vec2(turns * 13.0, lr * 3.6) + off * 1.7;
  n += textureGrad(uNoise, uv2, vec2(fu * 13.0, 0.0), vec2(0.0, fv * 3.6)).g * 0.32;
#endif
#if DISK_LAYERS > 2
  vec2 uv3 = vec2(turns * 37.0, lr * 10.0) + off * 2.3;
  n += textureGrad(uNoise, uv3, vec2(fu * 37.0, 0.0), vec2(0.0, fv * 10.0)).b * 0.18;
#else
  n += 0.09;
#endif
  return n;
}

// Compact flares orbiting at their own Keplerian rate (like the hot spots seen
// in Sgr A* flares). They make the differential rotation of the gas readable.
float hotSpots(float r, float phi) {
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float rr = 2.9 + fi * 1.45 + sin(fi * 12.7) * 0.35;
    if (abs(r - rr) > 1.6) continue;
    float om = 2.6 * pow(rr, -1.5);
    float ph = fi * 2.4 + om * uDiskTime;
    float dphi = mod(phi - ph + PI, TAU) - PI;
    // trailing tail: sheared backwards by the faster inner flow
    float trail = max(-dphi, 0.0) * 0.55 + max(dphi, 0.0) * 2.2;
    float dr = (r - rr + dphi * 0.18) / (0.22 + 0.05 * rr);
    float da = trail * rr / (0.5 + 0.12 * rr);
    h += exp(-dr * dr - da * da) * (0.55 + 0.45 * sin(fi * 3.3 + uDiskTime * 0.21));
  }
  return h;
}

// Emission + opacity of the disk where a ray crosses the equatorial plane.
vec4 diskSample(vec3 p, vec3 rd, float travel, float pixAng) {
  float r = length(p.xz);
  if (r < 1.25 || r > R_OUT) return vec4(0.0);

  float phi = atan(p.z, p.x);
  float lr = log(r);
  float omega = 2.6 * pow(r, -1.5);

  // footprint of one pixel on the disk (for anisotropic filtering)
  float foot = travel * pixAng;
  float fu = foot / (TAU * r);
  float fv = foot / (r * max(abs(rd.y), 0.06));

  // relativistic Doppler factor + gravitational redshift (both used below)
  float beta = clamp(sqrt(0.5 / max(r - 1.0, 0.35)), 0.0, 0.74);
  vec3 vdir = vec3(-p.z, 0.0, p.x) / r;
  float mu = dot(vdir, -rd);
  float gam = inversesqrt(1.0 - beta * beta);
  float dop = 1.0 / (gam * (1.0 - beta * mu));
  float grav = sqrt(max(1.0 - 1.0 / r, 0.0));
  float shift = mix(1.0, dop * grav, uBeaming);

  // ---- plunging region inside the ISCO: thin, fast, infalling spiral streams
  if (r < R_IN) {
    float sp = phi + 3.2 * lr - omega * uDiskTime * 1.4;
    float streams = textureGrad(uNoise, vec2(sp / TAU * 5.0, lr * 2.0), vec2(fu * 5.0, 0.0), vec2(0.0, fv * 2.0)).g;
    float pd = smoothstep(1.3, R_IN, r) * smoothstep(0.55, 0.85, streams) * 0.55;
    vec3 pc = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.9, 0.75), smoothstep(0.9, 1.4, shift));
    return vec4(pc * pd * pow(shift, 4.0) * 2.4 * uDiskBright * grav, pd * 0.35);
  }

  // Two crossfaded flow layers: shear stays bounded however long the page runs.
  const float PER = 9.0;
  float c1 = uDiskTime / PER;
  float c2 = c1 + 0.5;
  float t1 = fract(c1);
  float t2 = fract(c2);
  float w1 = 1.0 - abs(2.0 * t1 - 1.0);
  float w2 = 1.0 - w1;
  vec2 o1 = hash21(floor(c1));
  vec2 o2 = hash21(floor(c2) + 31.0);
  float a1 = (phi - omega * (t1 - 0.5) * PER) / TAU;
  float a2 = (phi - omega * (t2 - 0.5) * PER) / TAU;
  float n = diskLayer(a1, lr, o1, fu, fv) * w1 + diskLayer(a2, lr, o2, fu, fv) * w2;

  // trailing two-armed spiral density wave, rotating slower than the gas
  float arms = 0.5 + 0.5 * sin(2.0 * (phi - 0.35 * omega * uDiskTime) + 5.2 * lr);
  // radial gaps and rings (low contrast)
  float rings = textureGrad(uNoise, vec2(0.13, lr * 5.5), vec2(0.0), vec2(0.0, fv * 5.5)).a;
  float spots = hotSpots(r, phi);

  float inner = smoothstep(R_IN, R_IN + 0.55, r);
  float outer = 1.0 - smoothstep(R_OUT * 0.26, R_OUT, r);
  float turb = smoothstep(0.36, 0.74, n);
  float dens = inner * outer * (0.06 + 1.35 * turb) * (0.62 + 0.62 * rings) * (0.62 + 0.7 * arms);
  dens += inner * outer * spots * 0.9;

  // Shakura–Sunyaev-like temperature profile, normalised to ~1 near the inner edge
  float x = r / R_IN;
  float temp = 1.5 * pow(x, -0.75) * pow(max(1.0 - 0.8 / sqrt(x), 0.0), 0.25);
  temp *= 0.8 + 0.34 * turb + 0.5 * spots;

  // observed temperature shifts with the Doppler factor: the approaching side runs
  // blue-white and hot, the receding side deep red and dim (I ∝ D^4 bolometric)
  vec3 col = heatRamp(temp * 0.82 * shift);
  float boost = pow(shift, 4.0);
  float hot = exp(-dot(p - uHotPos, p - uHotPos) / 10.0) * uHot;
  float emis = dens * (0.1 + temp * temp * 1.7) * boost * uDiskBright * (1.0 + hot * 0.9);

  float alpha = clamp(dens * (0.6 + 0.4 * turb) * 1.05, 0.0, 0.97);
  return vec4(col * emis * 1.25, alpha);
}

vec3 accel(vec3 x, float h2) {
  float r2 = dot(x, x);
  return -1.5 * h2 * x / (r2 * r2 * sqrt(r2));
}

void main() {
  // --- gravitational-wave ripples distort the incoming rays (screen space)
  vec2 sp = (vUv - uBhUv) * vec2(uAspect, 1.0);
  float sr = length(sp);
  vec2 sdir = sp / max(sr, 1e-4);
  float front = uRipple * exp(-pow((sr - uRippleR) / 0.045, 2.0)) * 0.035;
  float waves = uWaves * sin(sr * 46.0 - uTime * 7.0) * 0.0045 * smoothstep(0.05, 0.25, sr) * exp(-sr * 1.6);
  vec2 uv = vUv + sdir / vec2(uAspect, 1.0) * (front + waves);

  vec2 ndc = uv * 2.0 - 1.0 - uShift;
  vec3 rd = normalize(uFwd + uRight * ndc.x * uTanHalf.x + uUp * ndc.y * uTanHalf.y);
  float pixAng = 2.0 * uTanHalf.y / uRes.y;

  vec3 x = uCamPos;
  vec3 v = rd;
  vec3 hv = cross(x, v);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float fg = 0.0;          // opacity of disk matter in front of the hole's plane
  float travel = 0.0;
  float absorbed = 0.0;

  if (dot(x, x) < 1.0) absorbed = 1.0;
  float hca = cos(uDiskTime * 0.05);
  float hsa = sin(uDiskTime * 0.05);
  mat2 hazeRot = mat2(hca, -hsa, hsa, hca);

  for (int i = 0; i < STEPS; i++) {
    if (absorbed > 0.5) break;
    float r = length(x);
    if (r < 1.0) { absorbed = 1.0; break; }
    if (r > uEscape && dot(x, v) > 0.0) break;

    float dt = clamp(0.09 * r, 0.03, 1.8);
    dt *= mix(0.55, 1.0, smoothstep(1.4, 3.2, r));

    vec3 k1x = v;
    vec3 k1v = accel(x, h2);
    vec3 k2x = v + 0.5 * dt * k1v;
    vec3 k2v = accel(x + 0.5 * dt * k1x, h2);
    vec3 k3x = v + 0.5 * dt * k2v;
    vec3 k3v = accel(x + 0.5 * dt * k2x, h2);
    vec3 k4x = v + dt * k3v;
    vec3 k4v = accel(x + dt * k3x, h2);
    vec3 nx = x + dt / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
    vec3 nv = v + dt / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);

    float segLen = length(nx - x);

    // equatorial plane crossing -> accretion disk
    if (x.y * nx.y <= 0.0) {
      float f = x.y / (x.y - nx.y + 1e-9);
      vec3 hp = mix(x, nx, f);
      vec4 d = diskSample(hp, normalize(mix(v, nv, f)), travel + f * segLen, pixAng);
      col += (1.0 - alpha) * d.rgb;
      if (dot(hp - uCamPos, uFwd) < uHoleDepth) fg += (1.0 - fg) * d.a;
      alpha += (1.0 - alpha) * d.a;
    }

    // emissive haze slab above/below the disk: gives the disk thickness and glow
    float rc = length(nx.xz);
    float hh = 0.07 + 0.055 * rc;
    float slab = exp(-abs(nx.y) / hh) * pow(smoothstep(R_OUT * 0.9, R_IN * 1.1, rc), 2.0) * smoothstep(R_IN * 0.75, R_IN * 1.35, rc);
    // turbulent, co-rotating vapour above and below the midplane gives the disk volume
    if (slab > 0.12) {
      float hn = textureLod(uNoise, hazeRot * nx.xz * 0.045 + vec2(nx.y * 0.05), 2.0).r;
      slab *= 0.3 + 1.4 * hn * hn;
    }
    float side = 1.0 + 0.55 * dot(vec3(-nx.z, 0.0, nx.x) / max(rc, 0.1), -normalize(nv));
    vec3 hazeCol = mix(vec3(1.0, 0.55, 0.22), vec3(0.85, 0.22, 0.06), smoothstep(R_IN * 1.5, R_OUT * 0.8, rc));
    col += (1.0 - alpha) * hazeCol * slab * segLen * uHaze * 0.045 * side * side;

    // photon sphere glow (rays skimming r = 1.5 r_s)
    float graze = 1.0 - abs(dot(x / r, normalize(v)));
    float ps = exp(-pow((r - 1.5) / 0.07, 2.0)) * pow(graze, 10.0);
    col += (1.0 - alpha) * vec3(1.0, 0.8, 0.56) * ps * segLen * uRingBoost * 0.5;

    travel += segLen;
    x = nx;
    v = nv;
    if (alpha > 0.985) break;
  }

  vec3 dirOut = normalize(v);
  // the lensed sky: nebula/galactic light from the cubemap + crisp stars; the lens
  // mapping itself stretches stars into tangential arcs near the Einstein ring
  vec3 sky = (texture(uSky, dirOut).rgb + starField(dirOut, pixAng, 1.0, 1.0, 0.0)) * uSkyGain;
  col += (1.0 - alpha) * sky * (1.0 - absorbed);

  // alpha carries how much near-side disk stands in front of the hole: debris that
  // falls behind the hole is occluded by it in the final composite
  fragColor = vec4(col, fg);
}
