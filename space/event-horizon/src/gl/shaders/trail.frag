// Glow persistence: last frame's light is decayed, dragged around the hole in
// the disk's rotation sense and pulled inward — trails curl into the abyss.
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uPrev;
uniform sampler2D uGlow;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uDecay;
uniform float uSpin;
uniform float uInflow;

void main() {
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = length(d);
  float a = uSpin / (r * 4.0 + 0.35);
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 q = R * d * (1.0 + uInflow / (r * 3.0 + 0.4));
  vec2 puv = uCenter + q / vec2(uAspect, 1.0);
  vec3 prev = texture(uPrev, puv).rgb * uDecay;
  vec3 glow = texture(uGlow, vUv).rgb;
  fragColor = vec4(min(prev + glow, vec3(60.0)), 1.0);
}
