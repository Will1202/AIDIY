// Generates a seamlessly tileable RGBA noise atlas (once, at startup).
// R: soft fbm (large structures)   G: ridged fbm (filaments)
// B: fine fbm (grain)              A: stretched cellular streaks
precision highp float;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// periodic value noise, period `per` cells
float vnoise(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 uv, float per, int oct) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  vec2 p = uv * per;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    s += a * vnoise(p, per);
    n += a;
    p *= 2.0;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

float ridged(vec2 uv, float per) {
  float s = 0.0;
  float a = 0.55;
  float n = 0.0;
  vec2 p = uv * per;
  for (int i = 0; i < 6; i++) {
    float v = 1.0 - abs(vnoise(p, per) * 2.0 - 1.0);
    s += a * v * v;
    n += a;
    p *= 2.0;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

float cells(vec2 uv, float per) {
  vec2 p = uv * per;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(mod(i + g, per));
      vec2 r = g + o - f;
      d = min(d, dot(r, r));
    }
  }
  return sqrt(d);
}

void main() {
  vec2 uv = vUv;
  // domain warp keeps the large structures organic, still periodic
  vec2 w = vec2(fbm(uv + 0.31, 4.0, 4), fbm(uv + 0.77, 4.0, 4)) - 0.5;
  float r = fbm(uv + w * 0.08, 4.0, 6);
  float g = ridged(uv + w * 0.05, 8.0);
  float b = fbm(uv, 32.0, 4);
  float a = 1.0 - smoothstep(0.0, 0.9, cells(uv, 12.0));
  a = a * 0.6 + fbm(uv, 16.0, 3) * 0.4;
  fragColor = vec4(r, g, b, a);
}
