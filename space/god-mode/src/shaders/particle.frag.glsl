varying vec3 vColor;
varying float vAlpha;
varying float vFront;
varying float vBokeh;
varying float vSpike;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float r = sqrt(d);

  // in focus: hot core + soft halo
  float shape = exp(-d * 5.5) + exp(-d * 1.8) * 0.18;
  // defocused: a flat lens disc with a faintly brighter rim, like real bokeh
  float disc = smoothstep(1.0, 0.82, r) * (0.7 + 0.7 * smoothstep(0.55, 0.95, r));
  shape = mix(shape, disc * 0.6, vBokeh);

  if (vSpike > 0.0) {
    // six-point diffraction spikes + a faint horizontal strut
    float fall = (1.0 - r) * (1.0 - r);
    float sp = exp(-abs(c.x) * 80.0)
      + exp(-abs(dot(c, vec2(0.5, 0.8660254))) * 80.0)
      + exp(-abs(dot(c, vec2(0.5, -0.8660254))) * 80.0);
    sp += exp(-abs(c.y) * 140.0) * 0.45;
    shape = exp(-d * 110.0) * 7.0 + exp(-d * 22.0) * 0.6 + sp * fall * 0.9;
  }

  // alpha channel = "in front of the black hole" mask, consumed by the lensing pass
  gl_FragColor = vec4(vColor * shape * vAlpha, vFront * min(shape, 1.0) * vAlpha);
}
