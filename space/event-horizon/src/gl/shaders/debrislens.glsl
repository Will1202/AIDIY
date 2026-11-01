// Matter behind the hole is imaged through a point-mass lens, per vertex, so torn
// pieces bend into arcs around the shadow. θE depends on how far behind the hole
// the piece is (computed on the CPU). uMode: 0 = matter in front of the hole
// (drawn as-is, over the shadow), 1 = primary image of matter behind,
// 2 = secondary (inverted) image on the opposite side.
uniform float uMode;
uniform vec2 uBh;
uniform float uShadowPx;

// returns false when this instance does not belong to the current pass
bool lensVertex(inout vec2 p, vec4 lens, out float maskAmt) {
  float sm = lens.y;
  maskAmt = 0.0;
  bool back = sm > 0.0;
  if ((uMode < 0.5) == back) return false;
  if (!back) return true;
  maskAmt = sm;
  float tE = lens.x;
  if (uMode > 1.5 && tE < 2.0) return false;
  vec2 d = p - uBh;
  float b = length(d);
  vec2 dh = b > 1e-3 ? d / b : vec2(0.0, -1.0);
  float s = sqrt(b * b + 4.0 * tE * tE);
  float th = uMode < 1.5 ? 0.5 * (b + s) : 0.5 * (b - s);
  p = uBh + dh * th;
  return true;
}

// images that land on the shadow are swallowed
float shadowMask(float rPx, float maskAmt) {
  return mix(1.0, smoothstep(uShadowPx * 0.97, uShadowPx * 1.04, rPx), maskAmt);
}
