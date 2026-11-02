import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRadial: { value: 0 },
    uCA: { value: 0.0015 },
    uFlash: { value: 0 },
    uVig: { value: 0.9 },
    uGrain: { value: 0.035 },
    uCenter: { value: new Vector2(0.5, 0.5) },
    uSamples: { value: 10 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uRadial; uniform float uCA; uniform float uFlash;
    uniform float uVig; uniform float uGrain; uniform vec2 uCenter; uniform int uSamples;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime*3.1) * 43758.5453); }
    void main(){
      vec2 d = vUv - uCenter;
      float r = length(d);
      // chromatic aberration grows towards the edges
      vec2 off = d * uCA * (1.0 + r * 4.0);
      vec3 c = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      // radial (zoom) blur for the overflow rush
      if (uRadial > 0.001) {
        vec3 acc = c; float w = 1.0;
        for (int i = 1; i < 16; i++) {
          if (i >= uSamples) break;
          float k = float(i) / float(uSamples);
          vec2 uv = vUv - d * uRadial * k * 0.18;
          float ww = 1.0 - k * 0.6;
          acc += texture2D(tDiffuse, uv).rgb * ww; w += ww;
        }
        c = acc / w;
      }
      c += vec3(0.75, 0.88, 1.0) * uFlash;
      float vig = smoothstep(1.05, 0.25, r * uVig * 1.35);
      c *= mix(0.55, 1.0, vig);
      c += (hash(vUv * 1000.0) - 0.5) * uGrain * (0.4 + c * 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
}

const ClampShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 3.0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(max(c.r, c.g), c.b);
      gl_FragColor = vec4(l > uMax ? c * (uMax / l) : c, 1.0); }`,
}

/** HDR scene → bloom → lens pass (CA, radial blur, flash, vignette, grain) → tone map + sRGB */
export class PostFX {
  readonly composer: EffectComposer
  readonly bloom: UnrealBloomPass
  readonly final: ShaderPass
  private readonly render: RenderPass
  private samples: number

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    samples: number,
  ) {
    this.samples = samples
    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples })
    this.composer = new EffectComposer(renderer, rt)
    this.render = new RenderPass(scene, camera)
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.42, 0.22, 1.0)
    this.final = new ShaderPass(FinalShader)
    this.composer.addPass(this.render)
    this.composer.addPass(new ShaderPass(ClampShader))
    this.composer.addPass(this.bloom)
    this.composer.addPass(this.final)
    this.composer.addPass(new OutputPass())
  }

  setMSAA(samples: number) {
    if (samples === this.samples) return
    this.samples = samples
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      t.samples = samples
      t.dispose()
    }
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(w, h)
  }

  frame(dt: number) {
    this.final.uniforms.uTime.value += dt
    this.composer.render(dt)
  }

  get u() {
    return this.final.uniforms
  }

  dispose() {
    this.composer.dispose()
  }
}
