import * as THREE from 'three';
import type { ParticleField } from './ParticleField';
import type { SharedUniforms } from './ParticleSim';

/**
 * Interstellar dust: a subset of the swarm drawn with *subtractive* blending,
 * slightly trailing the spiral arms. It absorbs light (blue more than red),
 * carving the dark lanes that make real galaxies read as volumes, not glows.
 */
export class DustLanes {
  readonly points: THREE.Points;
  readonly uniforms = {
    uDust: { value: 0 },
    uDustAlpha: { value: 0.05 },
  };
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(field: ParticleField, shared: SharedUniforms, count: number) {
    this.geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'ref', 'seedA', 'seedB']) this.geometry.setAttribute(name, field.geometry.getAttribute(name));
    // dust sprites are large, so cap their number to bound fill-rate; compensate opacity
    const drawn = Math.min(Math.floor(count / 3), 40000);
    this.geometry.setDrawRange(0, drawn);
    this.uniforms.uDustAlpha.value = 0.011 * Math.sqrt(65536 / count) * (count / 3 / drawn);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        tPos: field.uniforms.tPos,
        uPixelRatio: field.uniforms.uPixelRatio,
        uViewScale: field.uniforms.uViewScale,
        ...this.uniforms,
      },
      vertexShader: /* glsl */ `
        attribute vec2 ref;
        attribute vec4 seedA;
        attribute vec4 seedB;
        uniform sampler2D tPos;
        uniform vec3 uGalaxyNormal;
        uniform float uPixelRatio;
        uniform float uViewScale;
        uniform float uDust;
        uniform float uDustAlpha;
        varying float vA;
        void main() {
          vec4 P = texture2D(tPos, ref);
          vec3 n = uGalaxyNormal;
          // trail the arms by a few degrees (Rodrigues rotation about the disk axis)
          float a = -0.3;
          vec3 p = P.xyz * cos(a) + cross(n, P.xyz) * sin(a) + n * dot(n, P.xyz) * (1.0 - cos(a));
          p -= n * dot(n, p) * 0.35; // dust settles into the mid-plane
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float r = length(P.xyz);
          float radial = smoothstep(0.45, 1.1, r) * smoothstep(5.2, 2.2, r);
          float lane = step(0.24, fract(seedA.y * 2.0)); // only arm material becomes dust
          vA = uDust * uDustAlpha * radial * lane * (1.0 - P.w);
          gl_PointSize = clamp(26.0 * uPixelRatio * uViewScale * (9.0 / max(-mv.z, 0.1)), 4.0, 90.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float d = dot(c, c);
          if (d > 1.0) discard;
          // reddening: blue light is absorbed harder than red
          gl_FragColor = vec4(vec3(0.5, 0.72, 1.0) * (1.0 - d) * (1.0 - d) * vA, 0.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Foreground motes: a few hundred specks of dust between the lens and the subject.
 * Always out of focus, they parallax hard against every camera move and are
 * hurled past the lens by a detonation — the strongest depth cue in the frame.
 */
export class Motes {
  readonly points: THREE.Points;
  readonly uniforms = {
    uFocusDist: { value: 9 },
    uAperture: { value: 1.3 },
    uPixelRatio: { value: 1 },
    uViewScale: { value: 1 },
    uIntensity: { value: 1 },
  };
  private readonly n = 220;
  private home: Float32Array;
  private pos: Float32Array;
  private vel: Float32Array;
  private attr: THREE.BufferAttribute;

  constructor() {
    const n = this.n;
    this.home = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    const tint = new Float32Array(n * 3);
    const bright = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 3.2 + Math.pow(Math.random(), 0.7) * 13;
      this.home.set([Math.cos(th) * s * r, u * r * 0.6, Math.sin(th) * s * r], i * 3);
      const gold = Math.random() < 0.45;
      tint.set(gold ? [1.0, 0.72, 0.4] : [0.55, 0.75, 1.0], i * 3);
      bright[i] = 0.25 + Math.pow(Math.random(), 3) * 1.2;
    }
    this.pos = this.home.slice();
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aTint;
        attribute float aBright;
        uniform float uFocusDist;
        uniform float uAperture;
        uniform float uPixelRatio;
        uniform float uViewScale;
        uniform float uIntensity;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = -mv.z;
          float coc = abs(depth - uFocusDist) * uAperture * 2.4 * uViewScale * uPixelRatio;
          float size = clamp(3.0 + coc, 3.0, 220.0);
          float nearFade = smoothstep(0.6, 2.2, depth);
          vColor = aTint * aBright * uIntensity * nearFade * 9.0 / (size * size * 0.05 + 9.0) * 0.32;
          gl_PointSize = size;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = length(c);
          if (r > 1.0) discard;
          float disc = smoothstep(1.0, 0.86, r) * (0.55 + 0.6 * smoothstep(0.5, 0.96, r));
          gl_FragColor = vec4(vColor * disc, 0.0);
        }
      `,
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
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  explode(power: number) {
    for (let i = 0; i < this.n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      const s = (5 + Math.random() * 14) * power;
      this.vel[i * 3] += (x / l) * s;
      this.vel[i * 3 + 1] += (y / l) * s;
      this.vel[i * 3 + 2] += (z / l) * s;
    }
  }

  update(dt: number, t: number, implode: number) {
    for (let i = 0; i < this.n * 3; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = i + k;
        let a = (this.home[j] - this.pos[j]) * 0.35 - this.vel[j] * 0.8 - this.pos[j] * implode * 6;
        a += Math.sin(t * 0.21 + j * 1.7) * 0.05;
        this.vel[j] += a * dt;
        this.pos[j] += this.vel[j] * dt;
      }
    }
    this.attr.needsUpdate = true;
  }
}
