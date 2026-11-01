import { useFrame, useThree } from '@react-three/fiber'
import { BlendFunction, BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import { useEffect, useMemo } from 'react'
import { HalfFloatType, Uniform } from 'three'
import { engine } from '../engine/engine'
import type { QualityTier } from '../engine/quality'
import { screenCenter } from './Effects'

/**
 * One merged grading pass: climax shockwave refraction, kick-driven chromatic
 * aberration, exposure flash, ACES tone mapping, cool-shadow grade, vignette
 * and film grain. Bloom runs before it in HDR.
 */
const finalFrag = /* glsl */ `
uniform float uExposure;
uniform float uFlash;
uniform float uCA;
uniform float uGrain;
uniform float uVignette;
uniform float uTime;
uniform float uShock;
uniform float uShockStr;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uFade;

vec3 acesFit(vec3 v) {
  v *= 0.6;
  return clamp((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14), 0.0, 1.0);
}
float hashG(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = uv - uCenter;
  d.x *= uAspect;
  float r = length(d);
  vec2 dir = d / max(r, 1e-4);
  dir.x /= uAspect;
  vec2 suv = uv;
  if (uShock >= 0.0) {
    float rad = 0.05 + uShock * 1.35;
    float ring = exp(-pow((r - rad) * 13.0, 2.0)) * (1.0 - uShock);
    suv -= dir * ring * 0.04 * uShockStr;
  }
  vec2 off = (suv - 0.5) * uCA;
  vec3 col;
  col.r = texture2D(inputBuffer, suv + off).r;
  col.g = texture2D(inputBuffer, suv).g;
  col.b = texture2D(inputBuffer, suv - off).b;

  col *= uExposure * (1.0 + uFlash * 1.4);
  col = acesFit(col);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.93, 0.98, 1.07), (1.0 - l) * 0.55);
  col = mix(vec3(l), col, 0.9);

  vec2 vv = (uv - 0.5) * vec2(uAspect, 1.0);
  col *= mix(1.0, smoothstep(1.2, 0.2, length(vv)), uVignette);

  // grain in perceptual space (output is sRGB-encoded after this pass)
  float g = hashG(uv * vec2(1931.0, 1173.0) + fract(uTime * 7.31) * 113.0) - 0.5;
  vec3 s = pow(max(col, 0.0), vec3(1.0 / 2.2));
  s += g * uGrain * (0.35 + (1.0 - l) * 0.65);
  col = pow(max(s, 0.0), vec3(2.2));
  col *= uFade;
  outputColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

class FinalEffect extends Effect {
  constructor() {
    super('FinalEffect', finalFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['uExposure', new Uniform(1.0)],
        ['uFlash', new Uniform(0)],
        ['uCA', new Uniform(0.001)],
        ['uGrain', new Uniform(0.028)],
        ['uVignette', new Uniform(0.85)],
        ['uTime', new Uniform(0)],
        ['uShock', new Uniform(-1)],
        ['uShockStr', new Uniform(1)],
        ['uCenter', new Uniform(screenCenter)],
        ['uAspect', new Uniform(1)],
        ['uFade', new Uniform(1)],
      ]),
    })
  }
}

export function PostFX({ tier }: { tier: QualityTier }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const fx = useMemo(() => {
    const composer = new EffectComposer(gl, { frameBufferType: HalfFloatType, multisampling: 0 })
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.3,
      intensity: 0.8,
      radius: 0.72,
      levels: tier.name === 'low' ? 5 : 7,
    })
    const final = new FinalEffect()
    if (tier.bloom) composer.addPass(new EffectPass(camera, bloom))
    composer.addPass(new EffectPass(camera, final))
    return { composer, bloom, final }
  }, [gl, scene, camera, tier.bloom, tier.name])

  useEffect(() => {
    fx.composer.setSize(size.width, size.height, false)
  }, [fx, size.width, size.height, dpr])

  useEffect(() => () => fx.composer.dispose(), [fx])

  useFrame((_, dt) => {
    const c = engine.climax
    const u = fx.final.uniforms
    u.get('uTime')!.value = engine.time
    u.get('uFlash')!.value = c.flash * 0.9 + engine.kick * 0.06
    u.get('uCA')!.value = 0.0009 + engine.kick * 0.0028 + engine.onset * 0.0018 + c.flash * 0.012 + c.charge * 0.003
    u.get('uShock')!.value = c.shock
    u.get('uAspect')!.value = size.width / Math.max(1, size.height)
    const rv = engine.reveal
    u.get('uFade')!.value = Math.min(1, rv * 1.25)
    fx.bloom.intensity = 0.7 + engine.kick * 0.3 + c.flash * 1.2 + c.charge * 0.3 + engine.modeW[3] * 0.25
    fx.composer.render(dt)
  }, 1)

  return null
}
