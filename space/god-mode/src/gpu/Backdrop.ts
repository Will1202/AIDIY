import * as THREE from 'three';
import noise from '../shaders/noise.glsl?raw';
import { backdropFrag, backdropVert, starFrag, starVert } from '../shaders/postShaders';

const additiveColorOnly = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** Distant star field + faint procedural dust. Both get warped by the lensing pass. */
export class Backdrop {
  readonly group = new THREE.Group();
  readonly uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uPixelRatio: { value: 1 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
  };
  private sky: THREE.Mesh;
  private stars: THREE.Points;

  constructor(octaves: number) {
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: backdropVert,
      fragmentShader: noise + backdropFrag,
      defines: { OCTAVES: octaves },
      ...additiveColorOnly,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -2;

    const N = 7000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const phase = new Float32Array(N);
    const palette = [
      [0.75, 0.85, 1.0],
      [1.0, 0.86, 0.62],
      [0.9, 0.93, 1.0],
      [0.55, 0.72, 1.0],
    ];
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 45 + Math.random() * 25;
      pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      const c = palette[(Math.random() * palette.length) | 0];
      const b = Math.pow(Math.random(), 3) * 1.4 + 0.08;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
      size[i] = 0.8 + Math.pow(Math.random(), 8) * 3.2;
      phase[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: starVert,
      fragmentShader: starFrag,
      ...additiveColorOnly,
    });
    this.stars = new THREE.Points(g, starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;

    this.group.add(this.sky, this.stars);
  }

  setOctaves(octaves: number) {
    const m = this.sky.material as THREE.ShaderMaterial;
    if (m.defines.OCTAVES === octaves) return;
    m.defines.OCTAVES = octaves;
    m.needsUpdate = true;
  }

  update(camera: THREE.PerspectiveCamera, time: number, intensity: number, pixelRatio: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uIntensity.value = intensity;
    this.uniforms.uPixelRatio.value = pixelRatio;
    this.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  }
}
