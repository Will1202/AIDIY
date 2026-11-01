// Particle renderer. Prepended with shapes.glsl. Reads simulated state from GPGPU textures.
attribute vec2 ref;
attribute vec4 seedA;
attribute vec4 seedB;

uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPointSize;
uniform float uPixelRatio;
uniform float uViewScale;
uniform float uAlphaScale;
uniform float uBirth;
uniform float uCollapse;
uniform float uHoleViewZ;
uniform float uEnergy;
uniform float uFocusDist;
uniform float uAperture;
uniform float uSpikes;

varying vec3 vColor;
varying float vAlpha;
varying float vFront;
varying float vBokeh;
varying float vSpike;

void main() {
  vec4 P = texture2D(tPos, ref);
  vec4 V = texture2D(tVel, ref);
  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;

  float mt = morphProgress(seedA, seedB);
  vec3 col;
  float size;
  float alpha;
  if (mt <= 0.0) {
    Shape s = getShape(uFormA, seedA, seedB);
    col = s.color; size = s.size; alpha = s.alpha;
  } else if (mt >= 1.0) {
    Shape s = getShape(uFormB, seedA, seedB);
    col = s.color; size = s.size; alpha = s.alpha;
  } else {
    Shape sa = getShape(uFormA, seedA, seedB);
    Shape sb = getShape(uFormB, seedA, seedB);
    col = mix(sa.color, sb.color, mt);
    size = mix(sa.size, sb.size, mt);
    alpha = mix(sa.alpha, sb.alpha, mt);
  }

  if (uCollapse > 0.001) {
    Shape h = holeShape(seedA, seedB, 1.0);
    float cs = smoothstep(0.0, 0.55, uCollapse);
    col = mix(col, h.color, cs);
    size = mix(size, h.size, cs);
    alpha = mix(alpha, h.alpha, cs);
    float heat = uCollapse * smoothstep(2.6, 0.3, length(P.xyz));
    col = mix(col, vec3(1.0, 0.62, 0.28) * 1.3, heat * 0.5);
  }

  // stellar luminosity function: a sea of faint stars, a handful of brilliant ones
  float h1 = hash11(seedB.x * 71.3 + seedA.w * 17.9);
  float lum = 0.62 + 2.4 * pow(h1, 7.0);
  // per-star temperature jitter so no two regions share a flat tone
  float tj = hash11(seedA.z * 53.1 + seedB.y * 9.7) - 0.5;
  col *= lum * vec3(1.0 + tj * 0.28, 1.0 + tj * 0.04, 1.0 - tj * 0.32);

  // kinetic energy → white-hot ice-blue streaks
  float spd = length(V.xyz);
  float hot = smoothstep(3.0, 22.0, spd);
  col = mix(col, vec3(0.78, 0.9, 1.0) * 1.5, hot * 0.55);
  col *= 1.0 + sin(PI * mt) * 0.7 + uEnergy;

  float birth = smoothstep(seedB.y * 0.75, seedB.y * 0.75 + 0.25, uBirth);
  alpha *= birth * (1.0 - P.w) * uAlphaScale;

  // ── optics: depth of field. Out-of-focus stars spread into dim discs. ──
  float depth = -mv.z;
  float defocus = depth - uFocusDist;
  float coc = abs(defocus) * uAperture * uViewScale * uPixelRatio;
  // aerial perspective: the far side of a structure cools and recedes
  col *= mix(vec3(1.0), vec3(0.62, 0.74, 1.0), smoothstep(1.5, 9.0, defocus) * 0.6);

  float px = uPointSize * size * uPixelRatio * uViewScale * (9.0 / max(depth, 0.1));
  px *= (1.0 + hot * 0.5) * (0.85 + 0.15 * lum);
  if (px < 1.3) { alpha *= px / 1.3; px = 1.3; }

  // the brightest in-focus stars catch the telescope's diffraction spikes
  float spike = step(0.9984, hash11(seedA.y * 113.7 + seedB.z * 29.3)) * (1.0 - smoothstep(1.0, 4.0, coc)) * uSpikes;
  float total = sqrt(px * px + coc * coc);
  alpha *= max((px * px) / (total * total), 0.035); // energy is conserved as the disc grows
  if (spike > 0.0) {
    total = max(total, 26.0 * uPixelRatio * uViewScale);
    alpha *= 5.0;
    col *= 1.4;
  }
  gl_PointSize = min(total, 96.0);

  vColor = col;
  vAlpha = alpha;
  vBokeh = smoothstep(3.0, 12.0, coc) * (1.0 - spike);
  vSpike = spike;
  vFront = smoothstep(uHoleViewZ - 0.05, uHoleViewZ + 0.6, mv.z);
}
