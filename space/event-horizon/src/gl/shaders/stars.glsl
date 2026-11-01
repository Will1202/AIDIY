// Crisp procedural point stars evaluated per pixel on the (already lensed) ray
// direction. Width follows the pixel footprint so they stay ~1px at any resolution.
float starHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 starHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

vec3 starTint(float t, float cool) {
  vec3 c = mix(vec3(1.0, 0.66, 0.42), vec3(1.0, 0.94, 0.86), smoothstep(0.0, 0.45, t));
  c = mix(c, vec3(0.72, 0.84, 1.0), smoothstep(0.55, 1.0, t));
  return mix(c, vec3(0.78, 0.86, 1.0), cool);
}

vec3 starLayerPx(vec3 d, float scale, float density, float pixAng, float gain, float cool) {
  vec3 c = floor(d * scale);
  float h = starHash13(c + 0.37);
  if (h > density) return vec3(0.0);
  vec3 sp = normalize(c + 0.3 + starHash33(c + 4.1) * 0.4);
  float ang = length(d - sp);
  float mag = pow(starHash13(c + 9.7), 6.0);
  float w = max(pixAng * 0.5, 0.00012);
  float core = exp(-(ang * ang) / (w * w));
  float halo = exp(-ang / (w * 6.0)) * 0.04 * mag;
  return starTint(starHash13(c + 2.3), cool) * (core + halo) * (0.05 + mag * 6.0) * gain;
}

vec3 starField(vec3 d, float pixAng, float density, float gain, float cool) {
  vec3 col = starLayerPx(d, 190.0, 0.045 * density, pixAng, 0.6 * gain, cool);
  col += starLayerPx(d, 70.0, 0.11 * density, pixAng, 1.2 * gain, cool);
  return col;
}
