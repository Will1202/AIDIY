/**
 * Shared GLSL. Every chrome surface in the scene (raymarched liquid, shards,
 * orbit rings) reflects the same analytic studio environment, so highlights
 * sweep consistently across all of them and react to the music together.
 *
 * The environment is procedural instead of a cubemap: infinitely sharp
 * strip-light reflections (what makes chrome read as chrome), and every light
 * can be animated per frame — flashes on kicks, sweeps with the highs.
 */
export const COMMON = /* glsl */ `
#define PI 3.14159265359
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`

export const ENV_UNIFORMS = /* glsl */ `
uniform mat3 uEnvRot;
uniform float uEnvI;
uniform float uEnvFlash;
uniform float uEnvPhase;
uniform vec3 uRimDir;
uniform float uRimStr;
uniform vec3 uKeyDir;
uniform vec3 uAccent;
`

export const ENV = /* glsl */ `
float sRect(vec2 p, vec2 b, float w) {
  vec2 q = abs(p) - b;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - smoothstep(-w, w, d);
}
float angDiff(float a, float b) { float d = a - b; return atan(sin(d), cos(d)); }

vec3 studioEnv(vec3 dir, float rough) {
  vec3 d = uEnvRot * dir;
  float w = 0.006 + rough * 0.45;
  float y = d.y;
  float az = atan(d.z, d.x);
  vec3 c = vec3(0.008, 0.009, 0.011);

  // dim grey dome above, cool haze at the horizon, dark ground below
  c += vec3(0.07, 0.074, 0.082) * smoothstep(-0.05, 0.95, y);
  c += vec3(0.035, 0.04, 0.05) * exp(-abs(y + 0.03) * 6.0);
  c *= mix(1.0, 0.35, smoothstep(0.0, -0.35, y));
  c += vec3(0.022, 0.022, 0.024) * smoothstep(-0.15, -0.6, y);

  // thin horizon line: the classic chrome read
  c += vec3(0.85, 0.9, 1.0) * 1.6 * exp(-pow((y + 0.045) / (0.008 + w * 0.6), 2.0));

  // big overhead softbox projected on the y = 1 plane
  vec2 tp = d.xz / max(y, 0.05);
  float top = sRect(tp - vec2(0.12, 0.0), vec2(0.95, 0.42), w * 3.0 + 0.04) * smoothstep(0.25, 0.5, y);
  c += vec3(1.0, 0.975, 0.95) * 3.0 * top;

  // large soft key panel: broad silver sheen on one flank
  float key = sRect(vec2(angDiff(az, 0.75), y - 0.22), vec2(0.42, 0.3), 0.12 + w);
  c += vec3(1.0, 0.98, 0.96) * 0.95 * key;

  // tall strip lights orbiting slowly: the flowing highlights
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float a0 = fi * 2.094 + 1.9 + uEnvPhase * (i == 1 ? -0.8 : 1.0);
    float strip = sRect(vec2(angDiff(az, a0), y - 0.1), vec2(0.04 + 0.018 * fi, 0.72), w);
    vec3 tint = i == 0 ? vec3(1.0) : i == 1 ? mix(vec3(0.8, 0.88, 1.0), uAccent, 0.5) : vec3(1.0, 0.94, 0.88);
    c += tint * (2.8 + uEnvFlash * 5.0) * strip;
  }

  // low cool fill bar for the underside
  c += vec3(0.6, 0.7, 0.9) * 0.9 * sRect(vec2(angDiff(az, 3.7), y + 0.28), vec2(0.9, 0.035), w);

  // kick flash halo near the zenith
  c += vec3(0.9, 0.95, 1.0) * uEnvFlash * 0.8 * exp(-pow((y - 0.78) / (0.025 + w), 2.0));

  c *= uEnvI;

  // rim light that always sits behind the subject relative to the camera
  float rim = pow(max(dot(dir, uRimDir), 0.0), 9.0);
  c += mix(vec3(0.78, 0.87, 1.0), uAccent, 0.35) * rim * uRimStr;
  return c;
}

// Polished chrome: Schlick Fresnel over a silver F0, mirror env + sharp key spec.
vec3 chromeF(vec3 n, vec3 rd) {
  float NoV = clamp(dot(n, -rd), 0.0, 1.0);
  vec3 F0 = vec3(0.84, 0.86, 0.89);
  return F0 + (vec3(1.0) - F0) * pow(1.0 - NoV, 5.0);
}
vec3 chrome(vec3 n, vec3 rd, float rough, float occ) {
  vec3 r = reflect(rd, n);
  vec3 col = studioEnv(r, rough) * chromeF(n, rd);
  vec3 h = normalize(uKeyDir - rd);
  float nh = max(dot(n, h), 0.0);
  col += vec3(1.0, 0.98, 0.95) * (pow(nh, 700.0) * 16.0 + pow(nh, 70.0) * 0.25) * uEnvI;
  return col * occ;
}
`
