// World composite: black hole (optionally smeared radially as the camera dives),
// the space-time tunnel past the horizon, the wormhole mouth opening onto the
// parallel universe, and the implosion used when reality is rebuilt.
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uBH;
uniform sampler2D uUni;
uniform sampler2D uNoise;
uniform float uBhMix;
uniform float uUniMix;
uniform float uStreak;
uniform float uTunnel;
uniform float uTravel;
uniform float uHue;
uniform float uAperture;
uniform float uImplode;
uniform float uTime;
uniform float uAspect;
uniform vec2 uBhUv;
uniform float uResY;

const float TAU = 6.28318530718;

vec3 tunnelPalette(float k, float hue) {
  vec3 goldA = vec3(1.0, 0.42, 0.08);
  vec3 goldB = vec3(1.0, 0.74, 0.36);
  vec3 violet = vec3(0.42, 0.16, 1.0);
  vec3 cyan = vec3(0.2, 0.62, 1.0);
  vec3 a = mix(goldA, violet, smoothstep(0.15, 0.75, hue));
  vec3 b = mix(goldB, cyan, smoothstep(0.35, 1.0, hue));
  return mix(a, b, k);
}

float streaks(float ang, float z, float travel, float lod) {
  float u = ang / TAU;
  float s1 = textureLod(uNoise, vec2(u * 36.0, z * 0.020 - travel * 0.11), lod).b;
  float s2 = textureLod(uNoise, vec2(u * 11.0 + 0.37, z * 0.012 - travel * 0.07), lod).r;
  return smoothstep(0.6, 0.78, s1) * 2.2 + smoothstep(0.58, 0.8, s2) * 0.7;
}

vec3 tunnel(vec2 p, float shiftR) {
  float r = length(p) * shiftR;
  float ang = atan(p.y, p.x);
  float z = 1.0 / max(r, 0.015);                        // depth along the tube
  float twist = z * 0.045 + uTravel * 0.25;
  ang += twist;
  // mip level from the true per-pixel footprint (angular and depth directions)
  float du = 36.0 * 512.0 / (TAU * max(r, 0.01) * uResY);
  float dv = 0.02 * 512.0 / (max(r * r, 1e-4) * uResY);
  float lod = clamp(log2(max(max(du * 0.3, dv * 0.5), 1.0)), 0.0, 8.0);
  float s = streaks(ang, z, uTravel, lod);
  float neb = textureLod(uNoise, vec2(ang / TAU * 3.0, z * 0.05 - uTravel * 0.04), lod + 1.0).r;
  float k = textureLod(uNoise, vec2(ang / TAU * 7.0, 0.31), 0.0).g;
  vec3 col = tunnelPalette(k, uHue) * s * 0.75;
  col += tunnelPalette(0.2, uHue) * neb * neb * 0.16;
  // time-distortion pulses rushing past
  float ring = exp(-pow((fract(z * 0.035 - uTravel * 0.35) - 0.5) * 9.0, 2.0));
  col += tunnelPalette(0.8, uHue) * ring * 0.35 * smoothstep(1.0, 6.0, z);
  // fog towards the far end, bright throat at the centre
  col *= smoothstep(0.0, 0.08, r) * (0.35 + 0.65 * smoothstep(0.9, 0.15, r));
  col += mix(vec3(1.0, 0.7, 0.4), vec3(0.75, 0.85, 1.0), uHue) * exp(-r * 11.0) * 0.9;
  return col;
}

void main() {
  vec2 c = vec2(0.5);
  vec2 p = (vUv - c) * vec2(uAspect, 1.0);
  float r = length(p);
  vec3 col = vec3(0.0);
  float fgA = 0.0;

  if (uBhMix > 0.001) {
    fgA = texture(uBH, vUv).a * uBhMix * (1.0 - uStreak);
    vec3 b;
    if (uStreak > 0.002) {
      // radial zoom smear towards the dive point: bright features stretch outward
      b = vec3(0.0);
      for (int i = 0; i < 18; i++) {
        float s = 1.0 - uStreak * 0.42 * (float(i) / 17.0);
        b += texture(uBH, uBhUv + (vUv - uBhUv) * s).rgb;
      }
      b /= 18.0;
    } else {
      b = texture(uBH, vUv).rgb;
    }
    col += b * uBhMix;
  }

  if (uTunnel > 0.001) {
    // chromatic separation of the tunnel streaks
    vec3 t;
    t.r = tunnel(p, 1.0).r;
    t.g = tunnel(p, 1.012).g;
    t.b = tunnel(p, 1.026).b;
    col += t * uTunnel;
  }

  if (uUniMix > 0.001) {
    vec2 uv = vUv;
    float inside = 1.0;
    float rim = 0.0;
    if (uAperture < 1.9) {
      float R = max(uAperture, 1e-3);
      inside = 1.0 - smoothstep(R * 0.93, R, r);
      float k = clamp(r / R, 0.0, 1.0);
      // the wormhole mouth refracts the universe behind it like a fisheye
      uv = c + (vUv - c) * mix(0.42, 1.0, k * k);
      rim = exp(-pow((r - R) / (0.012 + R * 0.05), 2.0));
    }
    if (uImplode > 0.001) {
      float k = uImplode;
      float pull = 1.0 + k * k * 6.0 / (r * 3.0 + 0.25);
      float sw = k * k * 2.6 / (r * 5.0 + 0.3);
      vec2 q = (vUv - c) * pull;
      q = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * q;
      uv = c + q;
    }
    vec3 u = texture(uUni, uv).rgb;
    if (uImplode > 0.001) {
      u *= 1.0 - smoothstep(0.05, 0.9, uImplode) * smoothstep(0.02, 0.5, r);
      u += vec3(0.8, 0.88, 1.0) * exp(-r * 18.0) * uImplode * 3.0;
    }
    col = mix(col, u, inside * uUniMix);
    col += mix(vec3(1.0, 0.8, 0.6), vec3(0.6, 0.78, 1.0), uHue) * rim * 1.3 * uUniMix;
  }

  fragColor = vec4(col, fgA * (1.0 - uUniMix));
}
