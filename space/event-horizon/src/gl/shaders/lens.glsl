// Point-mass thin-lens remap used for everything that falls into the hole
// (debris, particles, trails): image position θ maps back to source β = θ − θE²/θ.
// For θ < θE the source lies on the opposite side — the secondary image — so
// debris near the hole smears into Einstein arcs. Inside the shadow: nothing.
uniform vec2 uBhUv;
uniform float uAspect;
uniform float uLens;
uniform float uEinstein;
uniform float uShadowR;
uniform float uMaskOn;

vec2 lensUv(vec2 uv, out float mask) {
  vec2 d = (uv - uBhUv) * vec2(uAspect, 1.0);
  float r2 = max(dot(d, d), 1e-6);
  float th2 = uEinstein * uEinstein * uLens;
  vec2 src = d - th2 * d / r2;
  float r = sqrt(r2);
  mask = mix(1.0, smoothstep(uShadowR * 0.9, uShadowR * 1.06, r), uMaskOn);
  return uBhUv + src / vec2(uAspect, 1.0);
}
