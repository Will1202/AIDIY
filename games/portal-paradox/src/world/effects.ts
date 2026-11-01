import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Matrix4, Mesh,
  Plane, Points, ShaderMaterial, Vector3, Vector4, type Material, type WebGLRenderer,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CLIP_FRAG, CLIP_FRAG_PARS, CLIP_VERT, CLIP_VERT_PARS, NOISE } from '../render/shaderUtil'
import { rng } from './textures'
import { SUN_SLIT } from './materials'

/** Emissive light strips that can power on in a travelling wave (per-strip delay). */
export class LightStrips {
  private readonly parts: BufferGeometry[] = []
  readonly material: ShaderMaterial
  mesh: Mesh | null = null

  constructor(color: Color, intensity: number) {
    this.material = new ShaderMaterial({
      clipping: true,
      uniforms: { uColor: { value: color.clone().multiplyScalar(intensity) }, uPower: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aDelay;
        varying float vDelay;
        ${CLIP_VERT_PARS}
        void main() {
          vDelay = aDelay;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          ${CLIP_VERT}
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uPower;
        uniform float uTime;
        varying float vDelay;
        ${CLIP_FRAG_PARS}
        float h(float x) { return fract(sin(x * 91.7) * 43758.5453); }
        void main() {
          ${CLIP_FRAG}
          float x = (uPower - vDelay) * 9.0;
          float on = clamp(x, 0.0, 1.0);
          // fluorescent strike: a few hard flickers right after switching on
          float fl = step(0.35, h(floor(uTime * 24.0) + vDelay * 100.0));
          on *= mix(fl, 1.0, smoothstep(1.0, 2.5, x));
          gl_FragColor = vec4(uColor * on, 1.0);
        }`,
    })
  }

  add(w: number, h: number, d: number, x: number, y: number, z: number, delay: number) {
    const g = new BoxGeometry(w, h, d)
    g.translate(x, y, z)
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k)
    g.setAttribute('aDelay', new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(delay), 1))
    this.parts.push(g)
  }

  build() {
    const g = mergeGeometries(this.parts)!
    this.mesh = new Mesh(g, this.material)
    this.mesh.matrixAutoUpdate = false
    for (const p of this.parts) p.dispose()
    return this.mesh
  }
}

/**
 * Volumetric light shaft through the ceiling slit: the shaft is a sheared box
 * (slit rectangle swept along the sun direction). Each fragment intersects the
 * view ray with that box analytically and accumulates in-scattering over the
 * true path length, with drifting dust density — no ray marching.
 */
export function createSunShaft(slit: Vector4, slitY: number, sunDir: Vector3, color: Color, floorY = 0.02) {
  const height = slitY - floorY
  const sweep = sunDir.clone().multiplyScalar(height / sunDir.y)
  // unit cube [-0.5,0.5]^3 → shaft: x across slit, y along sweep, z along slit
  const w = slit.y - slit.x
  const l = slit.w - slit.z
  const cx = (slit.x + slit.y) / 2
  const cz = (slit.z + slit.w) / 2
  const base = new Vector3(cx, slitY, cz).sub(sweep) // centre of the floor footprint
  const shear = new Matrix4().set(
    w, sweep.x, 0, base.x + sweep.x * 0.5,
    0, sweep.y, 0, base.y + sweep.y * 0.5,
    0, sweep.z, l, base.z + sweep.z * 0.5,
    0, 0, 0, 1,
  )
  const inv = shear.clone().invert()
  const geo = new BoxGeometry(1, 1, 1)
  geo.applyMatrix4(shear)
  const mat = new ShaderMaterial({
    clipping: true,
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    uniforms: {
      uInv: { value: inv },
      uColor: { value: color.clone() },
      uTime: { value: 0 },
      uPower: { value: 1 },
      uClip: { value: new Vector4(0, 0, 0, 1) },
      uBeam: SUN_SLIT.uBeam,
      uSunDir: SUN_SLIT.uSunDir,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      ${CLIP_VERT_PARS}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        ${CLIP_VERT}
      }`,
    fragmentShader: /* glsl */ `
      uniform mat4 uInv;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uPower;
      uniform vec4 uClip;
      uniform vec4 uBeam;
      uniform vec3 uSunDir;
      varying vec3 vWorld;
      ${CLIP_FRAG_PARS}
      ${NOISE}
      void main() {
        ${CLIP_FRAG}
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        float tEnd = length(vWorld - ro);
        vec3 o = (uInv * vec4(ro, 1.0)).xyz;
        vec3 d = (uInv * vec4(rd, 0.0)).xyz;
        vec3 inv = 1.0 / d;
        vec3 t0 = (vec3(-0.5) - o) * inv, t1 = (vec3(0.5) - o) * inv;
        vec3 tmin = min(t0, t1), tmax = max(t0, t1);
        float a = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
        float b = min(min(tmax.x, tmax.y), min(tmax.z, tEnd));
        // never integrate behind a portal's exit plane
        float dn = dot(uClip.xyz, rd);
        float c0 = dot(uClip.xyz, ro) + uClip.w;
        if (abs(dn) > 1e-5) { float tp = -c0 / dn; if (c0 < 0.0) a = max(a, tp); else if (tp > 0.0) b = min(b, tp); }
        else if (c0 < 0.0) discard;
        if (b <= a) discard;
        float len = b - a;
        vec3 mid = o + d * (a + b) * 0.5;
        // soft edges across the slit and fade towards the ceiling
        float edge = smoothstep(0.5, 0.18, abs(mid.x)) * smoothstep(0.5, 0.44, abs(mid.z));
        float vert = smoothstep(0.5, 0.25, mid.y) * (0.55 + 0.45 * smoothstep(-0.5, 0.2, -mid.y));
        vec3 wm = ro + rd * (a + b) * 0.5;
        float dust = 0.6 + 0.8 * fbm3(wm * 0.22 + vec3(0.0, -uTime * 0.08, uTime * 0.05));
        // god-ray streaks: constant along the sun direction, varying across the slit
        float streak = 0.35 + 1.3 * smoothstep(0.25, 0.85, fbm(vec2(mid.x * 5.0 + 3.0, mid.z * 70.0)));
        // the transverse ceiling beams cast their own gaps into the sheet
        float tb = max(0.0, (uBeam.w - wm.y) / uSunDir.y);
        float bz = wm.z + uSunDir.z * tb;
        float db = abs(mod(bz - uBeam.y + uBeam.x * 0.5, uBeam.x) - uBeam.x * 0.5);
        float gap = smoothstep(uBeam.z - 0.2, uBeam.z + 0.35, db);
        // looking along the sheet the path gets huge: saturate softly instead of blowing out
        float dens = 5.0 * (1.0 - exp(-len / 5.0)) * 0.045 * edge * vert * dust * streak * gap * uPower;
        gl_FragColor = vec4(uColor * (1.0 - exp(-dens)) , 1.0);
      }`,
  })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  mesh.onBeforeRender = (renderer: WebGLRenderer) => {
    const p = renderer.clippingPlanes[0] as Plane | undefined
    if (p) mat.uniforms.uClip.value.set(p.normal.x, p.normal.y, p.normal.z, p.constant)
  }
  return mesh
}

/**
 * Floating dust motes. In the lab they sparkle only inside the sunbeam
 * (same analytic slit test as the lighting); in the Other Side they are
 * slow glowing embers.
 */
export function createMotes(opts: {
  count: number
  box: [Vector3, Vector3]
  color: Color
  size: number
  seed: number
  rise: number
  beam?: { slit: Vector4; slitY: number; sunDir: Vector3 }
  ambient: number
}) {
  const r = rng(opts.seed)
  const n = opts.count
  const pos = new Float32Array(n * 3)
  const rnd = new Float32Array(n)
  const [a, b] = opts.box
  for (let i = 0; i < n; i++) {
    pos[i * 3] = a.x + (b.x - a.x) * r()
    pos[i * 3 + 1] = a.y + (b.y - a.y) * r()
    pos[i * 3 + 2] = a.z + (b.z - a.z) * r()
    rnd[i] = r()
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aRnd', new BufferAttribute(rnd, 1))
  const beam = opts.beam
  const mat = new ShaderMaterial({
    clipping: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    defines: beam ? { BEAM: 1 } : {},
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: opts.color.clone() },
      uSize: { value: opts.size },
      uBoxMin: { value: a.clone() },
      uBoxSize: { value: b.clone().sub(a) },
      uRise: { value: opts.rise },
      uAmbient: { value: opts.ambient },
      uSlit: { value: beam?.slit ?? new Vector4() },
      uSlitY: { value: beam?.slitY ?? 0 },
      uSunDir: { value: beam?.sunDir ?? new Vector3(0, 1, 0) },
      uScale: { value: 600 },
      uPower: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aRnd;
      uniform float uTime, uSize, uRise, uScale, uAmbient, uPower;
      uniform vec3 uBoxMin, uBoxSize;
      uniform vec4 uSlit;
      uniform float uSlitY;
      uniform vec3 uSunDir;
      varying float vA;
      ${CLIP_VERT_PARS}
      void main() {
        vec3 p = position;
        float t = uTime * (0.3 + aRnd * 0.7);
        p += vec3(sin(t * 0.7 + aRnd * 40.0), 0.0, cos(t * 0.53 + aRnd * 17.0)) * 0.6;
        p.y += uTime * uRise * (0.4 + aRnd);
        p = uBoxMin + mod(p - uBoxMin, uBoxSize);
        float lit = uAmbient;
        #ifdef BEAM
          float tt = (uSlitY - p.y) / uSunDir.y;
          vec2 q = p.xz + uSunDir.xz * tt;
          float inb = step(uSlit.x, q.x) * step(q.x, uSlit.y) * step(uSlit.z, q.y) * step(q.y, uSlit.w);
          lit += inb * 1.0 * uPower;
        #endif
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float tw = 0.6 + 0.4 * sin(uTime * (2.0 + aRnd * 3.0) + aRnd * 30.0);
        vA = lit * tw;
        gl_PointSize = clamp(uSize * uScale / -mvPosition.z, 1.0, 12.0) * (0.6 + aRnd * 0.8);
        if (vA < 0.01) gl_PointSize = 0.0;
        ${CLIP_VERT}
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      ${CLIP_FRAG_PARS}
      void main() {
        ${CLIP_FRAG}
        vec2 c = gl_PointCoord - 0.5;
        float d = exp(-dot(c, c) * 16.0);
        gl_FragColor = vec4(uColor * d * vA, 1.0);
      }`,
  })
  const pts = new Points(g, mat)
  pts.frustumCulled = false
  return pts
}

export function setTime(materials: Material[], t: number) {
  for (const m of materials) {
    const u = (m as ShaderMaterial).uniforms
    if (u?.uTime) u.uTime.value = t
  }
}
