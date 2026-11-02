import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Mesh, Points, ShaderMaterial, SphereGeometry, Vector3,
  PointLight, RingGeometry, DoubleSide,
} from 'three'
import { rng } from '../core/config'

interface Wave {
  mesh: Mesh
  ring: Mesh
  pts: Points
  t: number
  life: number
  radius: number
  active: boolean
}

/**
 * Energy pulses: an expanding fresnel shell, a flat shock ring, a burst of
 * sparks (all GPU-evaluated from the start time) and a flash of real light that
 * lights the room and the frame.
 */
export class Shockwave {
  readonly group = new Group()
  readonly light = new PointLight(0xbfe4ff, 0, 60, 2)
  private waves: Wave[] = []
  private flash = 0
  private readonly color = new Color()

  constructor(sparks = 420) {
    const r = rng(5)
    const N = sparks
    const dir = new Float32Array(N * 3)
    const sp = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1
      const th = r() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      dir.set([s * Math.cos(th), u, s * Math.sin(th)], i * 3)
      sp[i] = 0.3 + r() * 0.7
    }
    for (let k = 0; k < 4; k++) {
      const shell = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uK: { value: 0 }, uColor: { value: new Color(0.6, 0.85, 1.0) } },
        vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW;
          void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: /* glsl */ `uniform float uK; uniform vec3 uColor; varying vec3 vN; varying vec3 vW;
          void main(){ vec3 V = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(normalize(vN), V));
            float a = pow(f, 3.5) * (1.0 - uK) * (1.0 - uK) * 0.55; gl_FragColor = vec4(uColor*a*1.6, a); }`,
      })
      const mesh = new Mesh(new SphereGeometry(1, 48, 32), shell)
      const ringMat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uK: { value: 0 }, uColor: { value: new Color(0.6, 0.85, 1.0) } },
        vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: /* glsl */ `uniform float uK; uniform vec3 uColor; varying vec2 vP;
          void main(){ float r = length(vP); float a = smoothstep(0.7, 0.95, r) * smoothstep(1.0, 0.95, r) * (1.0-uK);
            gl_FragColor = vec4(uColor*a*3.0, a); }`,
      })
      const ring = new Mesh(new RingGeometry(0.7, 1, 96), ringMat)
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3))
      g.setAttribute('aDir', new BufferAttribute(dir, 3))
      g.setAttribute('aSp', new BufferAttribute(sp, 1))
      const pm = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uT: { value: 0 }, uR: { value: 10 }, uPx: { value: 1 }, uColor: { value: new Color(0.7, 0.9, 1.0) } },
        vertexShader: /* glsl */ `attribute vec3 aDir; attribute float aSp; uniform float uT; uniform float uR; uniform float uPx; varying float vA;
          void main(){ float k = 1.0 - exp(-uT * 3.0 * aSp); vec3 p = aDir * uR * k * aSp; p.y -= uT*uT*1.5;
            vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv; vA = exp(-uT*1.6) * aSp;
            gl_PointSize = (2.0 + aSp*3.0) * uPx * 26.0 / -mv.z; }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main(){ vec2 p = gl_PointCoord*2.-1.; float d = dot(p,p); if (d>1.) discard;
          float a = exp(-d*4.0)*vA; gl_FragColor = vec4(uColor*a*3.0, a); }`,
      })
      const pts = new Points(g, pm)
      pts.frustumCulled = false
      mesh.visible = ring.visible = pts.visible = false
      this.group.add(mesh, ring, pts)
      this.waves.push({ mesh, ring, pts, t: 0, life: 1, radius: 10, active: false })
    }
    this.group.add(this.light)
  }

  /** fire a pulse at a world point; `facing` orients the flat ring (e.g. the screen normal) */
  fire(at: Vector3, radius = 10, opts: { color?: number; light?: number; facing?: Vector3 } = {}) {
    const w = this.waves.find((x) => !x.active) ?? this.waves[0]
    w.active = true
    w.t = 0
    w.life = 0.9 + radius * 0.02
    w.radius = radius
    this.color.set(opts.color ?? 0x9fd6ff)
    for (const m of [w.mesh, w.ring, w.pts]) {
      m.position.copy(at)
      m.visible = true
      ;((m as Mesh).material as ShaderMaterial).uniforms.uColor.value.copy(this.color)
    }
    const f = opts.facing ?? new Vector3(0, 0, 1)
    w.ring.lookAt(at.clone().add(f))
    this.light.position.copy(at)
    this.light.color.copy(this.color)
    this.flash = opts.light ?? 1
  }

  update(dt: number, px: number) {
    for (const w of this.waves) {
      if (!w.active) continue
      w.t += dt
      const k = Math.min(1, w.t / w.life)
      const r = w.radius * (1 - Math.pow(1 - k, 3))
      w.mesh.scale.setScalar(Math.max(0.01, r))
      w.ring.scale.setScalar(Math.max(0.01, r * 1.15))
      ;(w.mesh.material as ShaderMaterial).uniforms.uK.value = k
      ;(w.ring.material as ShaderMaterial).uniforms.uK.value = k
      const pm = w.pts.material as ShaderMaterial
      pm.uniforms.uT.value = w.t
      pm.uniforms.uR.value = w.radius * 0.9
      pm.uniforms.uPx.value = px
      if (k >= 1) {
        w.mesh.visible = w.ring.visible = false
        if (w.t > 2.5) {
          w.pts.visible = false
          w.active = false
        }
      }
    }
    this.flash *= Math.exp(-dt * 5)
    this.light.intensity = this.flash * 900
  }
}
