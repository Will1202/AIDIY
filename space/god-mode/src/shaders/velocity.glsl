// GPGPU velocity integration. Prepended with noise.glsl + shapes.glsl.
uniform sampler2D tSeedA;
uniform sampler2D tSeedB;
uniform float uDt;
uniform float uBirth;
uniform float uSpring;
uniform float uDamp;
uniform float uRecover;
uniform float uTurb;
uniform float uCollapse;
uniform float uConsume;
uniform float uBlast;
uniform float uImplode;
uniform vec3 uDiskNormal;
uniform vec3 uGalaxyNormal;
uniform vec3 uCamDir;
uniform vec3 uPointer;
uniform vec3 uPointerVel;
uniform float uPointerActive;
uniform float uHoverRadius;
uniform float uGather;
uniform float uGatherRadius;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec4 a = texture2D(tSeedA, uv);
  vec4 b = texture2D(tSeedB, uv);
  vec3 p = P.xyz;
  vec3 v = V.xyz;

  // ── target from (blended) form ──
  float mt = morphProgress(a, b);
  vec3 target;
  if (mt <= 0.0) target = getShape(uFormA, a, b).pos;
  else if (mt >= 1.0) target = getShape(uFormB, a, b).pos;
  else target = mix(getShape(uFormA, a, b).pos, getShape(uFormB, a, b).pos, mt);
  float transition = sin(PI * mt);

  // ── gravitational collapse: everything is pulled into a shrinking accretion disk ──
  float c = uCollapse;
  float cs = smoothstep(0.0, 0.55, c);
  if (cs > 0.0) {
    vec3 disk = holeShape(a, b, mix(1.0, 0.5, c)).pos;
    target = mix(target, disk, cs);
  }
  float doomed = step(b.z, uConsume);
  target *= 1.0 - doomed;

  float k = uSpring * uRecover * mix(0.1, 1.0, uBirth) * (1.0 - 0.6 * transition);
  vec3 acc = (target - p) * k;
  acc -= v * uDamp;

  // birth: dust spirals inward
  if (uBirth < 1.0) {
    vec3 tb = cross(uGalaxyNormal, p);
    acc += tb * (1.0 - uBirth) * 0.9 / (length(p) * 0.15 + 1.0);
  }

  float turb = uTurb + transition * 2.2 + (1.0 - uRecover) * 2.6 + (1.0 - uBirth) * 1.5;
  if (turb > 0.02) acc += flowNoise(p * 0.32 + vec3(0.0, uTime * 0.06, uTime * 0.02)) * turb;

  if (c > 0.001) {
    float r = length(p);
    vec3 inward = -p / max(r, 1e-3);
    acc += inward * c * (3.0 + 18.0 * doomed) / (r * 0.6 + 0.35);
    vec3 tang = cross(uDiskNormal, p);
    float tl = length(tang);
    if (tl > 1e-4) acc += (tang / tl) * c * 10.0 / (r + 0.5);
    acc -= uDiskNormal * dot(p, uDiskNormal) * c * 2.5;
  }

  // ── hand / pointer: disturbance wake + gathering vortex ──
  if (uPointerActive > 0.001 || uGather > 0.001) {
    vec3 d = p - uPointer;
    vec3 dp = d - uCamDir * dot(d, uCamDir);
    float dist = length(dp) + 1e-4;
    vec3 n = dp / dist;
    float fh = exp(-dist * dist / (uHoverRadius * uHoverRadius));
    acc += (n * 14.0 + uPointerVel * 2.2) * fh * uPointerActive;
    float fg = exp(-dist * dist / (uGatherRadius * uGatherRadius));
    vec3 tg = cross(uCamDir, n);
    acc += (-n * 9.0 * smoothstep(0.0, 0.6, dist) + tg * 26.0) * fg * uGather;
  }

  // last breath before detonation: everything is yanked toward the core
  if (uImplode > 0.0) {
    acc += -p * uImplode * 13.0;
    acc -= v * uImplode * 4.0;
  }

  v += acc * uDt;

  // ── detonation impulse (single frame) ──
  if (uBlast > 0.0) {
    vec3 jitter = (vec3(a.z, b.y, a.y) - 0.5) * 0.8;
    vec3 dir = normalize(p + jitter + 1e-4);
    float planar = step(b.x, 0.55);
    dir = normalize(mix(dir, dir - uDiskNormal * dot(dir, uDiskNormal) * 0.94, planar));
    float rnd = hash11(a.w * 91.7 + b.x * 13.1);
    float speed = uBlast * (4.0 + 17.0 * pow(rnd, 2.2)) * (1.0 + P.w * 1.1);
    v = v * 0.15 + dir * speed;
  }

  float sp = length(v);
  if (!(sp == sp) || sp > 1e5) v = vec3(0.0);
  else if (sp > 70.0) v *= 70.0 / sp;
  gl_FragColor = vec4(v, 1.0);
}
