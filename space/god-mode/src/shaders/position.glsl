// GPGPU position integration. w = "consumed by the event horizon" (0 visible → 1 swallowed).
uniform float uDt;
uniform float uCollapse;
uniform float uHorizon;
uniform float uBlast;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec3 p = P.xyz + V.xyz * uDt;
  float w = P.w;
  float r = length(p);
  if (uBlast > 0.0) w = 0.0;
  else if (uCollapse > 0.02 && r < uHorizon) w = min(1.0, w + uDt * 2.5);
  else if (uCollapse < 0.02) w = max(0.0, w - uDt * 0.6);
  // self-heal: a NaN/inf particle would otherwise be lost forever
  if (!(p.x == p.x && p.y == p.y && p.z == p.z) || dot(p, p) > 1e6) {
    p = vec3(uv.x - 0.5, uv.y - 0.5, fract(uv.x * 37.0 + uv.y * 91.0) - 0.5) * 12.0;
    w = 0.0;
  }
  gl_FragColor = vec4(p, w);
}
