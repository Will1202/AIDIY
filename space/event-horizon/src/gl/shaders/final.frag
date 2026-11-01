// Final grade: glow + bloom → exposure → ACES → sRGB → vignette, then the LDR
// web-page debris is composited *after* tone mapping, so DOM pixels handed to
// WebGL keep their exact colours. Debris behind the hole sits under the near side
// of the disk (world alpha = near-disk coverage); debris in front sits on top.
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uWorld;
uniform sampler2D uBloom;
uniform sampler2D uTrail;
uniform sampler2D uDebrisBack;
uniform sampler2D uDebrisFront;
uniform sampler2D uGlowFront;
uniform vec2 uRes;
uniform vec2 uShake;
uniform float uExposure;
uniform float uBloomStr;
uniform float uTrailGain;
uniform float uCA;
uniform float uVignette;
uniform float uFlash;
uniform vec3 uFlashCol;
uniform float uFade;
uniform float uGrain;
uniform float uTime;
uniform float uDebrisOn;

#include <lens>

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hdrAt(vec2 uv) {
  float m;
  vec2 luv = lensUv(uv, m);
  vec4 w = texture(uWorld, uv);
  vec3 c = w.rgb;
  // behind-the-hole glow + its trails: swallowed by the shadow, hidden by the near disk
  c += texture(uTrail, luv).rgb * m * (1.0 - w.a) * uTrailGain;
  c += texture(uGlowFront, uv).rgb * uTrailGain;
  c += texture(uBloom, uv).rgb * uBloomStr;
  return c;
}

void main() {
  vec2 uv = vUv + uShake;
  vec2 cd = uv - 0.5;
  float ca = uCA * (0.002 + dot(cd, cd) * 0.03);
  vec3 hdr;
  if (uCA > 0.001) {
    hdr.r = hdrAt(uv + cd * ca * 1.0).r;
    hdr.g = hdrAt(uv).g;
    hdr.b = hdrAt(uv - cd * ca * 1.2).b;
  } else {
    hdr = hdrAt(uv);
  }
  vec3 col = toSRGB(aces(hdr * uExposure));

  // vignette on the world only — the page pieces arrive untouched
  vec2 vq = (vUv - 0.5) * vec2(1.0, 0.85);
  col *= mix(1.0, 1.0 - smoothstep(0.32, 0.95, length(vq) * 1.2) * 0.75, uVignette);

  if (uDebrisOn > 0.5) {
    float fgA = texture(uWorld, uv).a;
    vec4 back = texture(uDebrisBack, uv) * (1.0 - fgA);
    col = back.rgb + col * (1.0 - back.a);
    vec4 front = texture(uDebrisFront, uv);
    col = front.rgb + col * (1.0 - front.a);
  }

  col = mix(col, uFlashCol, clamp(uFlash, 0.0, 1.0));
  col *= 1.0 - uFade;

  float g = hash(vUv * uRes + fract(uTime * 13.7) * 341.0) - 0.5;
  col += g * uGrain * 0.045 * (0.35 + 0.65 * (1.0 - col));
  col += (hash(vUv * uRes + 0.5) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
