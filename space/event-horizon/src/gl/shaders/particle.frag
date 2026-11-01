precision highp float;

in vec2 vQ;
in vec3 vCol;
in float vFade;
in float vR;
in float vMask;
layout(location = 0) out vec4 fragColor;

uniform float uGain;
uniform float uShadowPx;

void main() {
  float across = exp(-vQ.y * vQ.y * 3.2);
  float along = 1.0 - smoothstep(0.2, 1.0, abs(vQ.x));
  float hide = mix(1.0, smoothstep(uShadowPx * 0.97, uShadowPx * 1.04, vR), vMask);
  fragColor = vec4(vCol * across * along * vFade * hide * uGain, 1.0);
}
