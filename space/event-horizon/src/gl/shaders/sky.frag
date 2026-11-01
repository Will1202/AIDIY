// Procedural sky, baked once into a cubemap (one face per draw).
// VARIANT 0: the observatory universe — dark, dusty, a warm galactic band crossing
//            behind the black hole so the lensing has structure to bend.
// VARIANT 1: the parallel universe — deep blue / violet / magenta nebulae,
//            dense silver star fields and a vast spiral vortex.
precision highp float;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform int uFace;
uniform float uFaceRes;

#ifndef VARIANT
#define VARIANT 0
#endif

vec3 faceDir(vec2 uv, int face) {
  float s = uv.x * 2.0 - 1.0;
  float t = uv.y * 2.0 - 1.0;
  if (face == 0) return vec3(1.0, -t, -s);
  if (face == 1) return vec3(-1.0, -t, s);
  if (face == 2) return vec3(s, 1.0, t);
  if (face == 3) return vec3(s, -1.0, -t);
  if (face == 4) return vec3(s, -t, 1.0);
  return vec3(-s, -t, -1.0);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}

float fbm3(vec3 p, int oct) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

vec3 starColor(float t) {
  // t: 0 = cool red dwarf, 1 = hot blue giant
  vec3 c = mix(vec3(1.0, 0.62, 0.38), vec3(1.0, 0.93, 0.84), smoothstep(0.0, 0.45, t));
  return mix(c, vec3(0.70, 0.82, 1.0), smoothstep(0.55, 1.0, t));
}

// One star per cell, evaluated over the 8 nearest cells so big stars never clip.
vec3 starLayer(vec3 d, float scale, float density, float sizeMin, float sizeMax, float gain, float tint) {
  vec3 p = d * scale;
  vec3 base = floor(p - 0.5);
  vec3 col = vec3(0.0);
  for (int z = 0; z < 2; z++)
  for (int y = 0; y < 2; y++)
  for (int x = 0; x < 2; x++) {
    vec3 c = base + vec3(float(x), float(y), float(z));
    float h = hash13(c + 0.37);
    if (h > density) continue;
    vec3 jitter = hash33(c + 4.1);
    vec3 sp = normalize(c + 0.15 + jitter * 0.7);
    float ang = length(d - sp);                     // ~ angle in radians
    float rnd = hash13(c + 9.7);
    float mag = pow(rnd, 7.0);                      // power law: few bright stars
    float size = mix(sizeMin, sizeMax, mag);
    float core = exp(-(ang * ang) / (size * size));
    float halo = exp(-ang / (size * 5.0)) * 0.035 * mag;
    vec3 sc = mix(vec3(1.0), starColor(hash13(c + 2.3)), tint);
    col += sc * (core + halo) * (0.18 + mag * 6.0) * gain;
  }
  return col;
}

void main() {
  vec3 d = normalize(faceDir(vUv, uFace));
  float px = 2.0 / uFaceRes;                        // ~ angular size of a texel
  vec3 col = vec3(0.0);

#if VARIANT == 0
  // ---------------------------------------------------------------- observatory
  // The galactic band passes almost straight behind the black hole as seen
  // from the observatory camera (looking towards -z), tilted ~28 degrees on screen.
  vec3 back = normalize(vec3(0.0, -0.13, -1.0));
  vec3 along = normalize(vec3(0.88, 0.47, 0.0));
  vec3 n = normalize(cross(back, along));
  float lat = dot(d, n);
  float lon = dot(d, along);
  float band = exp(-pow(lat / 0.20, 2.0));
  float core = exp(-pow(lat / 0.075, 2.0));

  vec3 q = d * 3.2;
  float warp = fbm3(q * 0.8, 4);
  float neb = fbm3(q + warp * 1.6, 7);
  float fine = fbm3(d * 22.0 + warp, 5);
  float dust = smoothstep(0.42, 0.68, fbm3(d * 7.0 + vec3(warp * 2.0), 6));

  vec3 glowA = vec3(0.52, 0.40, 0.31);              // old warm stellar light
  vec3 glowB = vec3(0.30, 0.33, 0.42);              // faint cool scattering
  vec3 galaxy = mix(glowB, glowA, smoothstep(0.2, 0.8, neb)) * band * (0.25 + neb * 0.9);
  galaxy += vec3(0.85, 0.62, 0.42) * core * fine * 0.55 * (0.6 + 0.4 * sin(lon * 3.0 + 1.0));
  galaxy *= 1.0 - dust * band * 0.85;               // dark dust lanes
  col += galaxy * 0.055;

  // a few faint, far emission clouds outside the band
  float cloud = smoothstep(0.55, 0.85, fbm3(d * 2.2 + 11.0, 6));
  col += vec3(0.30, 0.10, 0.06) * cloud * 0.02;
  col += vec3(0.06, 0.12, 0.16) * smoothstep(0.6, 0.9, fbm3(d * 2.6 + 41.0, 6)) * 0.018;

  // unresolved star haze only — resolved stars are drawn per pixel in the raymarch
  float bandBoost = 1.0 + band * 4.0;
  col += starLayer(d, 520.0, 0.05 * bandBoost, px * 0.6, px * 0.9, 0.025, 0.6);
#else
  // ---------------------------------------------------------------- parallel universe
  // the vortex is centred on the direction of the giant ring
  vec3 axis = normalize(vec3(0.0, 0.035, -1.0));
  vec3 ref = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 ref2 = cross(axis, ref);
  float ca = dot(d, axis);
  float rr = acos(clamp(ca, -1.0, 1.0));            // angle from the vortex centre
  float th = atan(dot(d, ref2), dot(d, ref));
  // logarithmic spiral arms
  float arm = sin(th * 2.0 + log(rr + 0.02) * 4.2);
  float spiral = smoothstep(-0.2, 1.0, arm) * exp(-rr * 1.15) * smoothstep(0.02, 0.25, rr);

  vec3 q = d * 2.4;
  float w1 = fbm3(q * 0.9 + 3.0, 5);
  float w2 = fbm3(q * 1.1 + 17.0, 5);
  vec3 wq = q + vec3(w1, w2, w1 * w2) * 2.2;
  float neb = fbm3(wq, 7);
  float neb2 = fbm3(wq * 1.9 + 5.0, 6);
  float filaments = pow(1.0 - abs(fbm3(d * 9.0 + wq * 0.5, 6) * 2.0 - 1.0), 6.0);

  vec3 deep = vec3(0.012, 0.018, 0.055);
  vec3 blue = vec3(0.10, 0.28, 0.85);
  vec3 violet = vec3(0.45, 0.16, 0.85);
  vec3 magenta = vec3(0.95, 0.20, 0.55);
  vec3 cyan = vec3(0.35, 0.85, 1.0);

  col = deep * (0.6 + 0.4 * neb);
  vec3 cloudCol = mix(blue, violet, smoothstep(0.35, 0.65, neb2));
  cloudCol = mix(cloudCol, magenta, smoothstep(0.62, 0.85, neb) * 0.8);
  float cloud = smoothstep(0.38, 0.85, neb);
  col += cloudCol * cloud * 0.22;
  col += mix(cyan, vec3(1.0), 0.3) * filaments * cloud * 0.10;
  col += mix(violet, cyan, 0.5 + 0.5 * arm) * spiral * (0.25 + neb * 0.6) * 0.55;
  col += vec3(0.75, 0.80, 1.0) * exp(-rr * 9.0) * 0.25;        // vortex heart
  float dark = smoothstep(0.5, 0.75, fbm3(d * 5.0 + 23.0, 6));
  col *= 1.0 - dark * 0.55 * cloud;

  col += starLayer(d, 560.0, 0.12 * (0.5 + cloud), px * 0.6, px * 0.9, 0.04, 0.25);
#endif

  fragColor = vec4(col, 1.0);
}
