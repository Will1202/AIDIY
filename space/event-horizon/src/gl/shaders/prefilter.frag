// Bloom prefilter: 13-tap downsample of the HDR world + the lensed glow layer,
// with a soft knee and a firefly clamp.
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uWorld;
uniform sampler2D uTrail;
uniform sampler2D uGlowFront;
uniform vec2 uTexel;
uniform float uTrailGain;
uniform float uThreshold;

#include <lens>

vec3 tap(vec2 uv) {
  return texture(uWorld, uv).rgb;
}

void main() {
  vec2 t = uTexel;
  vec3 a = tap(vUv + t * vec2(-2.0, -2.0));
  vec3 b = tap(vUv + t * vec2(0.0, -2.0));
  vec3 c = tap(vUv + t * vec2(2.0, -2.0));
  vec3 d = tap(vUv + t * vec2(-1.0, -1.0));
  vec3 e = tap(vUv + t * vec2(1.0, -1.0));
  vec3 f = tap(vUv + t * vec2(-2.0, 0.0));
  vec3 g = tap(vUv);
  vec3 h = tap(vUv + t * vec2(2.0, 0.0));
  vec3 i = tap(vUv + t * vec2(-1.0, 1.0));
  vec3 j = tap(vUv + t * vec2(1.0, 1.0));
  vec3 k = tap(vUv + t * vec2(-2.0, 2.0));
  vec3 l = tap(vUv + t * vec2(0.0, 2.0));
  vec3 m = tap(vUv + t * vec2(2.0, 2.0));
  vec3 col = (d + e + i + j) * 0.125 + (a + b + f + g) * 0.03125 + (b + c + g + h) * 0.03125
           + (f + g + k + l) * 0.03125 + (g + h + l + m) * 0.03125;
  float msk;
  vec2 luv = lensUv(vUv, msk);
  float fgA = texture(uWorld, vUv).a;
  col += texture(uTrail, luv).rgb * msk * (1.0 - fgA) * uTrailGain;
  col += texture(uGlowFront, vUv).rgb * uTrailGain;
  float lum = max(col.r, max(col.g, col.b));
  float knee = 0.6;
  float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, lum - uThreshold) / max(lum, 1e-4);
  col *= w;
  col = min(col, vec3(40.0));
  fragColor = vec4(col, 1.0);
}
