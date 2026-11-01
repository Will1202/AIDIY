// A torn piece of the web page. Each instance is a jittered quadrilateral cut
// from the page snapshot, drawn on a subdivided grid so gravity can bend it per
// vertex (near vertices pulled harder) and the lens can wrap it into an arc.
precision highp float;

in vec3 position;          // grid coordinate in [0,1]^2
in vec4 iCornA;            // c0 (top-left), c1 (top-right) — px relative to centre
in vec4 iCornB;            // c2 (bottom-right), c3 (bottom-left)
in vec4 iHome;             // xy: home centre (px), z: seed
in vec2 iPos;              // current centre (px)
in vec4 iMat;              // 2x2 matrix, column-major (tidal stretch, spin, perspective)
in vec4 iFx;               // alpha, heat, warp, burn
in vec4 iLens;             // θE px, side/mask (>0 behind), -, gravitational redshift g

uniform vec2 uStage;
uniform vec2 uSnapSize;
uniform float uWarpK;
uniform float uWarpL;

#include <debrislens>

out vec2 vUv;
out vec2 vGrid;
out vec2 vNoiseUv;
out vec4 vFx;
out float vR;
out float vMask;
out float vG;

void main() {
  vec2 g = position.xy;
  vec2 top = mix(iCornA.xy, iCornA.zw, g.x);
  vec2 bot = mix(iCornB.zw, iCornB.xy, g.x);
  vec2 local = mix(top, bot, g.y);
  vec2 homePx = iHome.xy + local;
  vUv = vec2(homePx.x / uSnapSize.x, 1.0 - homePx.y / uSnapSize.y);
  vNoiseUv = homePx / 260.0 + iHome.z * 0.37;
  vGrid = g;
  vFx = iFx;
  vG = iLens.w;

  mat2 M = mat2(iMat.x, iMat.y, iMat.z, iMat.w);
  vec2 p = iPos + M * local;

  // per-vertex gravitational bend toward the hole
  vec2 d = uBh - p;
  float r = max(length(d), 1.0);
  float pull = iFx.z * uWarpK * pow(uWarpL / (r + uWarpL), 2.0);
  p += d / r * min(pull, r * 0.45);

  float maskAmt;
  bool keep = lensVertex(p, iLens, maskAmt);
  vMask = maskAmt;
  vR = length(p - uBh);
  if (!keep || iFx.x <= 0.0) p = vec2(-1e5);
  gl_Position = vec4(p.x / uStage.x * 2.0 - 1.0, 1.0 - p.y / uStage.y * 2.0, 0.0, 1.0);
}
