// Glowing matter stripped off the page: a velocity-aligned streak per particle,
// lensed like the shards when it is behind the hole.
precision highp float;

in vec3 position;          // quad corner in [-1,1]^2
in vec4 iPV;               // screen pos (px), screen velocity (px/s)
in vec4 iCol;              // linear rgb, size (px)
in vec4 iFx;               // fade, redshift g, θE px, side/mask

uniform vec2 uStage;
uniform float uStreak;

#include <debrislens>

out vec2 vQ;
out vec3 vCol;
out float vFade;
out float vR;
out float vMask;

void main() {
  vec4 lens = vec4(iFx.z, iFx.w, 0.0, iFx.y);
  vec2 c = iPV.xy;
  vec2 c2 = iPV.xy + iPV.zw * 0.03;
  float m0;
  float m1;
  bool keep = lensVertex(c, lens, m0);
  lensVertex(c2, lens, m1);
  vec2 vel = (c2 - c) / 0.03;
  float sp = length(vel);
  vec2 dir = sp > 1e-3 ? vel / sp : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float size = iCol.w;
  float len = size + min(sp * uStreak, 160.0);
  vec2 p = c - dir * position.x * len * 0.5 + nrm * position.y * size * 0.5;
  if (!keep || iFx.x <= 0.002) p = vec2(-1e5);
  vQ = position.xy;
  float g = iFx.y;
  vCol = iCol.rgb * vec3(1.0, g * g, g * g * g * g) * mix(0.1, 1.0, g * g);
  vFade = iFx.x;
  vR = length(p - uBh);
  vMask = m0;
  gl_Position = vec4(p.x / uStage.x * 2.0 - 1.0, 1.0 - p.y / uStage.y * 2.0, 0.0, 1.0);
}
