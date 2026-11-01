// 9-tap tent upsample, blended additively onto the next larger mip
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;

void main() {
  vec2 t = uTexel;
  vec3 col = texture(uSrc, vUv).rgb * 4.0;
  col += (texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb + texture(uSrc, vUv + vec2(t.x, 0.0)).rgb
        + texture(uSrc, vUv + vec2(0.0, -t.y)).rgb + texture(uSrc, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  col += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb
       + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb + texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  fragColor = vec4(col / 16.0 * uWeight, 1.0);
}
