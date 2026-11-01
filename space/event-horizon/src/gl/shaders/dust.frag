precision highp float;

in vec3 vCol;
in float vA;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  float a = exp(-d * 4.0) * vA;
  fragColor = vec4(vCol * a, 1.0);
}
