// The snapshot texture is uploaded premultiplied (no dark fringes when filtered).
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec2 vGrid;
in vec2 vNoiseUv;
in vec4 vFx;
in float vR;
in float vMask;
in float vG;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uSnap;
uniform sampler2D uNoise;
uniform float uShadowPx;

float shadowMask(float rPx, float maskAmt) {
  return mix(1.0, smoothstep(uShadowPx * 0.97, uShadowPx * 1.04, rPx), maskAmt);
}

void main() {
  vec4 tex = texture(uSnap, vUv);
  float n = texture(uNoise, vNoiseUv).r * 0.65 + texture(uNoise, vNoiseUv * 3.7).b * 0.35;
  float burn = vFx.w;
  float front = n - burn * 1.08;
  float keep = smoothstep(0.0, 0.035, front) * shadowMask(vR, vMask);
  float heat = clamp(vFx.y, 0.0, 1.5);
  // gravitational redshift: light climbing out of the well loses energy — the
  // piece reddens and darkens as it nears the horizon (it never simply fades)
  vec3 red = vec3(1.0, vG * vG, vG * vG * vG * vG);
  float dim = mix(0.08, 1.0, vG * vG);

#ifdef GLOW_PASS
  float rim = (1.0 - smoothstep(0.0, 0.09, front)) * step(-0.03, front) * step(0.002, burn);
  float edge = min(min(vGrid.x, 1.0 - vGrid.x), min(vGrid.y, 1.0 - vGrid.y));
  float torn = 1.0 - smoothstep(0.0, 0.07, edge);
  vec3 hot = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.82, 0.55), clamp(heat * 0.6, 0.0, 1.0));
  float body = tex.a * keep;
  vec3 glow = hot * (rim * 6.0 * max(tex.a, 0.2) + torn * heat * 0.9 * body + body * heat * heat * 0.45);
  glow += tex.rgb * keep * heat * 0.6;
  fragColor = vec4(glow * red * dim * vFx.x, 1.0);
#else
  float m = vFx.x * keep;
  float t = clamp(heat, 0.0, 1.0) * 0.7;
  vec3 rgb = mix(tex.rgb, tex.rgb * vec3(1.18, 0.86, 0.62) + vec3(0.10, 0.03, 0.0) * tex.a, t);
  rgb *= red * dim;
  fragColor = vec4(rgb * m, tex.a * m);
#endif
}
