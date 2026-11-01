// Post-processing and backdrop shader sources.

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Max-blend feedback: leaves short luminous trails behind fast particles.
export const trailFrag = /* glsl */ `
uniform sampler2D tNew;
uniform sampler2D tOld;
uniform float uDamp;
varying vec2 vUv;
void main() {
  vec4 n = texture2D(tNew, vUv);
  vec4 o = texture2D(tOld, vUv) * uDamp;
  gl_FragColor = max(n, o);
}
`;

// Screen-space gravitational lens + event-horizon shadow + photon ring + shockwave.
export const lensFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uStrength;
uniform float uRs;
uniform float uShockR;
uniform float uShockAmp;
uniform float uTime;
uniform vec2 uPtr;
uniform float uPtrStr;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  // the user's touch bends spacetime: a small gravitational lens under the pointer
  if (uPtrStr > 0.001) {
    vec2 pd = uv - uPtr;
    pd.x *= uAspect;
    float pr = length(pd);
    float k = uPtrStr * exp(-pr * pr / 0.012);
    pd *= 1.0 - 0.55 * k;
    uv = uPtr + vec2(pd.x / uAspect, pd.y);
  }
  vec2 d = uv - uCenter;
  d.x *= uAspect;
  float r = length(d);
  vec2 n = d / max(r, 1e-4);
  vec4 base = texture2D(tDiffuse, uv);

  float sh = uShockAmp * exp(-pow((r - uShockR) / (0.03 + uShockR * 0.05), 2.0));
  float rs = uRs * uStrength;
  vec2 sd = d;
  if (rs > 1e-4) {
    float thetaE = rs * 1.85;
    float beta = r - thetaE * thetaE / max(r, 1e-4);
    // fade the deflection out far from the hole so the frame edges never smear
    float reach = exp(-r / (thetaE * 6.0));
    sd = mix(d, n * beta, reach);
  }
  sd += n * sh * 0.05;
  vec2 suv = uCenter + vec2(sd.x / uAspect, sd.y);

  float ca = sh * 0.012 + uStrength * 0.003 * exp(-r / max(rs * 3.0, 1e-3));
  vec2 cav = vec2(n.x / uAspect, n.y) * ca;
  vec3 col;
  col.r = texture2D(tDiffuse, suv + cav).r;
  col.g = texture2D(tDiffuse, suv).g;
  col.b = texture2D(tDiffuse, suv - cav).b;

  // particles in front of the hole stay undistorted and occlude its shadow
  if (uPtrStr > 0.001) {
    vec2 pd = vUv - uPtr;
    pd.x *= uAspect;
    float pr = length(pd);
    col += vec3(1.0, 0.84, 0.6) * uPtrStr * 0.05 * exp(-pow((pr - 0.07) / 0.006, 2.0));
  }

  float front = clamp(base.a * 1.5, 0.0, 1.0) * step(1e-4, rs);
  col = mix(col, base.rgb, front);
  if (rs > 1e-4) {
    float shadow = smoothstep(rs * 0.9, rs * 1.06, r);
    col *= mix(shadow, 1.0, front);
    float flicker = 0.9 + 0.1 * sin(uTime * 7.0 + atan(n.y, n.x) * 3.0);
    float ring = exp(-pow((r - rs * 1.1) / (rs * 0.05 + 0.0008), 2.0)) * uStrength * flicker;
    float halo = exp(-pow((r - rs * 1.25) / (rs * 0.35), 2.0)) * uStrength * 0.18;
    col += vec3(1.0, 0.78, 0.48) * (ring * 1.05 + halo * 0.8) * (1.0 - front * 0.8);
  }
  col += vec3(1.0, 0.86, 0.66) * sh * 0.22;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Exposure, flash, ACES, split-tone grading, vignette, grain, edge aberration.
export const finalFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uFlash;
uniform float uTime;
uniform float uAspect;
uniform float uGrain;
uniform float uAberration;
uniform sampler2D tFlare;
uniform float uFlare;
uniform float uLetterbox;
uniform float uImplode;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 c = vUv - 0.5;
  vec2 cc = vec2(c.x * uAspect, c.y);
  float r2 = dot(cc, cc);
  vec2 off = c * r2 * uAberration;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv + off).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv - off).b;

  // anamorphic streak: a cool horizontal lens flare from the brightest light
  col += texture2D(tFlare, vUv).rgb * vec3(0.38, 0.62, 1.0) * uFlare;

  col *= uExposure * (1.0 - 0.6 * uImplode);
  col += uFlash * (vec3(1.0, 0.9, 0.78) * 0.85 + col * 2.5);
  col = aces(col);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.9, 1.0, 1.1), (1.0 - l) * 0.3);
  col = mix(col, col * vec3(1.07, 1.0, 0.9), l * 0.35);

  float vig = smoothstep(1.05, 0.25, length(cc) * (1.15 + uImplode * 0.9));
  col *= mix(0.5, 1.0, vig);

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // grain in display space so it stays a whisper in the blacks
  float g = hash(vUv * 1024.0 + fract(uTime * 13.7) * 91.0) - 0.5;
  col += g * uGrain;

  // cinemascope bars (2.39:1) slide in for the climax
  float bar = uLetterbox * max(0.0, 0.5 - (1.0 / 2.39) * uAspect * 0.5);
  float inside = smoothstep(bar - 0.0015, bar + 0.0015, vUv.y) * smoothstep(bar - 0.0015, bar + 0.0015, 1.0 - vUv.y);
  col *= inside;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Backdrop: faint deep-space dust drawn on a fullscreen quad, sampled by view ray.
export const backdropVert = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const backdropFrag = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uTime;
uniform float uIntensity;
varying vec2 vNdc;

float fbm(vec3 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += amp * snoise(p);
    p = p * 2.03 + vec3(1.7, -3.1, 2.3);
    amp *= 0.5;
  }
  return v * 0.5 + 0.5;
}

void main() {
  vec4 vp = uInvProj * vec4(vNdc, 1.0, 1.0);
  vp /= vp.w;
  vec3 dir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
  float n = fbm(dir * 2.1 + vec3(0.0, 0.0, uTime * 0.003));
  float band = exp(-pow(dot(dir, normalize(vec3(0.3, 1.0, 0.2))) * 3.0, 2.0));
  vec3 col = vec3(0.004, 0.007, 0.016) * (0.5 + n);
  col += vec3(0.05, 0.034, 0.018) * band * smoothstep(0.4, 0.95, n);
  float m = fbm(dir * 3.6 + vec3(3.0, 1.0, -2.0));
  col += vec3(0.008, 0.02, 0.05) * smoothstep(0.5, 1.0, m);
  gl_FragColor = vec4(col * uIntensity, 0.0);
}
`;

export const starVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
uniform float uIntensity;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aPhase * 2.2) + aPhase * 40.0);
  vColor = aColor * tw * uIntensity;
  gl_PointSize = max(aSize * uPixelRatio, 1.0);
}
`;

export const starFrag = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-d * 4.0), 0.0);
}
`;

// Anamorphic flare: bright-pass into a squashed buffer, then wide horizontal blurs.
export const flarePrefilterFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(vec3(max(l - uThreshold, 0.0)), 1.0);
}
`;

export const flareBlurFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uStep;
varying vec2 vUv;
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / 18.0);
    acc += texture2D(tDiffuse, vUv + vec2(float(i) * uStep, 0.0)).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;
