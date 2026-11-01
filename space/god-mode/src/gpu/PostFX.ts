import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { finalFrag, flareBlurFrag, flarePrefilterFrag, fullscreenVert, lensFrag, trailFrag } from '../shaders/postShaders';

/** Feedback pass: max(new, old·damp) gives fast particles luminous energy trails. */
class TrailPass extends Pass {
  damp = 0.7;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private comp: FullScreenQuad;
  private copy: FullScreenQuad;
  private compMat: THREE.ShaderMaterial;
  private copyMat: THREE.ShaderMaterial;

  constructor(type: THREE.TextureDataType) {
    super();
    const opts = { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, opts);
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, uDamp: { value: 0.7 } },
      vertexShader: fullscreenVert,
      fragmentShader: trailFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, uDamp: { value: 0 } },
      vertexShader: fullscreenVert,
      fragmentShader: trailFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.comp = new FullScreenQuad(this.compMat);
    this.copy = new FullScreenQuad(this.copyMat);
  }

  setSize(w: number, h: number) {
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.compMat.uniforms.tNew.value = readBuffer.texture;
    this.compMat.uniforms.tOld.value = this.a.texture;
    this.compMat.uniforms.uDamp.value = this.damp;
    renderer.setRenderTarget(this.b);
    this.comp.render(renderer);
    this.copyMat.uniforms.tNew.value = this.b.texture;
    this.copyMat.uniforms.tOld.value = this.b.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.compMat.dispose();
    this.copyMat.dispose();
    this.comp.dispose();
    this.copy.dispose();
  }
}

/**
 * Anamorphic streak: bright-pass into a buffer squashed 4×/8×, then three widening
 * horizontal blurs. Reads the frame without writing it; the final pass composites.
 */
class AnamorphicPass extends Pass {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private pre: FullScreenQuad;
  private blur: FullScreenQuad;
  private preMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;

  constructor(type: THREE.TextureDataType, private out: { value: THREE.Texture | null }) {
    super();
    this.needsSwap = false;
    const opts = { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, opts);
    this.preMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.1 } },
      vertexShader: fullscreenVert,
      fragmentShader: flarePrefilterFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: 0 } },
      vertexShader: fullscreenVert,
      fragmentShader: flareBlurFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.pre = new FullScreenQuad(this.preMat);
    this.blur = new FullScreenQuad(this.blurMat);
  }

  setSize(w: number, h: number) {
    this.a.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 8)));
    this.b.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 8)));
  }

  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.preMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.a);
    this.pre.render(renderer);
    const texel = 1 / this.a.width;
    for (const spread of [1.5, 4, 10]) {
      this.blurMat.uniforms.tDiffuse.value = this.a.texture;
      this.blurMat.uniforms.uStep.value = texel * spread;
      renderer.setRenderTarget(this.b);
      this.blur.render(renderer);
      const t = this.a;
      this.a = this.b;
      this.b = t;
    }
    this.out.value = this.a.texture;
  }
}

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly trail: TrailPass;
  readonly lens: ShaderPass;
  readonly final: ShaderPass;
  readonly flare: AnamorphicPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, rtType: THREE.TextureDataType) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: rtType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    const renderPass = new RenderPass(scene, camera, undefined, new THREE.Color(0x000000), 0);
    this.trail = new TrailPass(rtType);
    this.lens = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uCenter: { value: new THREE.Vector2(0.5, 0.5) },
          uAspect: { value: 1 },
          uStrength: { value: 0 },
          uRs: { value: 0.05 },
          uShockR: { value: 0 },
          uShockAmp: { value: 0 },
          uTime: { value: 0 },
          uPtr: { value: new THREE.Vector2(0.5, 0.5) },
          uPtrStr: { value: 0 },
        },
        vertexShader: fullscreenVert,
        fragmentShader: lensFrag,
      }),
    );
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, 0.22);
    this.final = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uExposure: { value: 0 },
          uFlash: { value: 0 },
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uGrain: { value: 0.018 },
          uAberration: { value: 0.012 },
          tFlare: { value: null },
          uFlare: { value: 0.2 },
          uLetterbox: { value: 0 },
          uImplode: { value: 0 },
        },
        vertexShader: fullscreenVert,
        fragmentShader: finalFrag,
      }),
    );
    this.composer.addPass(renderPass);
    this.composer.addPass(this.trail);
    this.composer.addPass(this.lens);
    this.flare = new AnamorphicPass(rtType, this.final.uniforms.tFlare);
    this.composer.addPass(this.flare);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
  }

  setTrails(enabled: boolean) {
    this.trail.enabled = enabled;
  }

  setSize(w: number, h: number, pixelRatio: number, bloomScale: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    // bloom is resolution-bound: render it at a reduced size on weaker tiers
    this.bloom.setSize(Math.round(w * pixelRatio * bloomScale), Math.round(h * pixelRatio * bloomScale));
    this.lens.uniforms.uAspect.value = w / h;
    this.final.uniforms.uAspect.value = w / h;
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
