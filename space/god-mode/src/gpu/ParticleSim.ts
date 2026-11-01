import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import noise from '../shaders/noise.glsl?raw';
import shapes from '../shaders/shapes.glsl?raw';
import velocitySrc from '../shaders/velocity.glsl?raw';
import positionSrc from '../shaders/position.glsl?raw';

export type U<T> = { value: T };

/** Uniforms shared (by reference) between simulation and particle renderer. */
export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uDt: { value: 1 / 60 },
    uGalaxyAngle: { value: 0 },
    uDiskTime: { value: 0 },
    uDnaAngle: { value: 0 },
    uDnaTilt: { value: 1.2 },
    uMorph: { value: 1 },
    uFormA: { value: 0 },
    uFormB: { value: 0 },
    uBirth: { value: 0 },
    uSpring: { value: 5.0 },
    uDamp: { value: 2.8 },
    uRecover: { value: 1 },
    uTurb: { value: 0.15 },
    uCollapse: { value: 0 },
    uConsume: { value: 0 },
    uBlast: { value: 0 },
    uImplode: { value: 0 },
    uHorizon: { value: 0.3 },
    uDiskNormal: { value: new THREE.Vector3(0, Math.cos(0.17), Math.sin(0.17)) },
    uGalaxyNormal: { value: new THREE.Vector3(0, Math.cos(0.62), Math.sin(0.62)) },
    uCamDir: { value: new THREE.Vector3(0, 0, -1) },
    uPointer: { value: new THREE.Vector3(999, 999, 999) },
    uPointerVel: { value: new THREE.Vector3() },
    uPointerActive: { value: 0 },
    uHoverRadius: { value: 1.1 },
    uGather: { value: 0 },
    uGatherRadius: { value: 3.2 },
  };
}
export type SharedUniforms = ReturnType<typeof createSharedUniforms>;

/**
 * Position/velocity ping-pong simulation running entirely on the GPU.
 * Particle count = size², chosen by the quality tier.
 */
export class ParticleSim {
  readonly size: number;
  readonly count: number;
  readonly seedA: Float32Array;
  readonly seedB: Float32Array;
  private gpu: GPUComputationRenderer;
  private posVar: Variable;
  private velVar: Variable;
  private seedTexA: THREE.DataTexture;
  private seedTexB: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer, size: number, shared: SharedUniforms, dataType: THREE.TextureDataType) {
    this.size = size;
    this.count = size * size;
    this.gpu = new GPUComputationRenderer(size, size, renderer);
    this.gpu.setDataType(dataType);

    this.seedA = randomSeeds(this.count);
    this.seedB = randomSeeds(this.count);
    this.seedTexA = seedTexture(this.seedA, size);
    this.seedTexB = seedTexture(this.seedB, size);

    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    fillScattered(pos0.image.data as Float32Array, vel0.image.data as Float32Array);

    this.posVar = this.gpu.addVariable('texturePosition', positionSrc, pos0);
    this.velVar = this.gpu.addVariable('textureVelocity', noise + shapes + velocitySrc, vel0);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    Object.assign(this.posVar.material.uniforms, shared);
    Object.assign(this.velVar.material.uniforms, shared, {
      tSeedA: { value: this.seedTexA },
      tSeedB: { value: this.seedTexB },
    });

    const err = this.gpu.init();
    if (err) throw new Error(err);
  }

  compute() {
    this.gpu.compute();
  }

  get positionTexture(): THREE.Texture {
    return this.gpu.getCurrentRenderTarget(this.posVar).texture;
  }

  get velocityTexture(): THREE.Texture {
    return this.gpu.getCurrentRenderTarget(this.velVar).texture;
  }

  /** Scatter every particle back into the dark (used for the "big bang" restart). */
  scatter() {
    const pos = this.gpu.createTexture();
    const vel = this.gpu.createTexture();
    fillScattered(pos.image.data as Float32Array, vel.image.data as Float32Array);
    for (const rt of this.posVar.renderTargets) this.gpu.renderTexture(pos, rt);
    for (const rt of this.velVar.renderTargets) this.gpu.renderTexture(vel, rt);
    pos.dispose();
    vel.dispose();
  }

  dispose() {
    this.gpu.dispose();
    this.seedTexA.dispose();
    this.seedTexB.dispose();
  }
}

function randomSeeds(count: number) {
  const a = new Float32Array(count * 4);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  return a;
}

function seedTexture(data: Float32Array, size: number) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function fillScattered(pos: Float32Array, vel: Float32Array) {
  for (let i = 0; i < pos.length; i += 4) {
    // a thin, enormous shell of primordial dust
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 7 + Math.pow(Math.random(), 0.6) * 12;
    pos[i] = Math.cos(th) * s * r;
    pos[i + 1] = u * r * 0.7;
    pos[i + 2] = Math.sin(th) * s * r;
    pos[i + 3] = 0;
    vel[i] = vel[i + 1] = vel[i + 2] = 0;
    vel[i + 3] = 1;
  }
}
