// 13-tap downsample (Jimenez 2014)
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uTexel;

void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(uSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 c = texture(uSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 e = texture(uSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 f = texture(uSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 g = texture(uSrc, vUv).rgb;
  vec3 h = texture(uSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 i = texture(uSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 k = texture(uSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 m = texture(uSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 col = (d + e + i + j) * 0.125 + (a + b + f + g) * 0.03125 + (b + c + g + h) * 0.03125
           + (f + g + k + l) * 0.03125 + (g + h + l + m) * 0.03125;
  fragColor = vec4(col, 1.0);
}
