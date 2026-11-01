import * as THREE from 'three';
import shapes from '../shaders/shapes.glsl?raw';
import vert from '../shaders/particle.vert.glsl?raw';
import frag from '../shaders/particle.frag.glsl?raw';
import type { ParticleSim, SharedUniforms } from './ParticleSim';

/** Additive point sprites whose positions are fetched from the simulation textures. */
export class ParticleField {
  readonly points: THREE.Points;
  readonly uniforms: {
    tPos: { value: THREE.Texture | null };
    tVel: { value: THREE.Texture | null };
    uPointSize: { value: number };
    uPixelRatio: { value: number };
    uViewScale: { value: number };
    uAlphaScale: { value: number };
    uHoleViewZ: { value: number };
    uEnergy: { value: number };
    uFocusDist: { value: number };
    uAperture: { value: number };
    uSpikes: { value: number };
  };
  readonly geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(sim: ParticleSim, shared: SharedUniforms) {
    const { count, size } = sim;
    const ref = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      ref[i * 2] = ((i % size) + 0.5) / size;
      ref[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
    this.geometry.setAttribute('seedA', new THREE.BufferAttribute(sim.seedA, 4));
    this.geometry.setAttribute('seedB', new THREE.BufferAttribute(sim.seedB, 4));

    this.uniforms = {
      tPos: { value: null },
      tVel: { value: null },
      uPointSize: { value: 2.3 },
      uPixelRatio: { value: 1 },
      uViewScale: { value: 1 },
      // keep perceived density roughly constant across quality tiers
      uAlphaScale: { value: 0.14 * Math.sqrt(65536 / count) },
      uHoleViewZ: { value: -9 },
      uEnergy: { value: 0 },
      uFocusDist: { value: 9 },
      uAperture: { value: 1.3 },
      uSpikes: { value: 1 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...this.uniforms },
      vertexShader: shapes + vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  bind(sim: ParticleSim) {
    this.uniforms.tPos.value = sim.positionTexture;
    this.uniforms.tVel.value = sim.velocityTexture;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
