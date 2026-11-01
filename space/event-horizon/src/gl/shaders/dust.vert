precision highp float;

in vec3 position;
in vec4 aCol;              // rgb, size

uniform mat4 uView;
uniform mat4 uProj;
uniform float uPxScale;
uniform float uTime;

out vec3 vCol;
out float vA;

void main() {
  vec3 p = position;
  p.y += sin(uTime * 0.11 + position.x * 0.013) * 3.0;
  vec4 vp = uView * vec4(p, 1.0);
  float depth = -vp.z;
  gl_Position = uProj * vp;
  gl_PointSize = clamp(aCol.w * uPxScale / max(depth, 1.0), 1.0, 14.0);
  vA = smoothstep(2.0, 18.0, depth) * (1.0 - smoothstep(500.0, 900.0, depth));
  vCol = aCol.rgb;
}
