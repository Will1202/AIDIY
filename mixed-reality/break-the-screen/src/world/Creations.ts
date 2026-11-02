import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Points, Quaternion, ShaderMaterial, SphereGeometry,
  Vector3, Vector4,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { clamp, damp, rng, type CreationMode } from '../core/config'
import { RAPIER, GROUPS, type PhysObj, type PhysicsEngine } from '../physics/PhysicsEngine'
import { SIMPLEX_GLSL } from './EnergyCore'

const PALETTES = [
  { deep: [0.03, 0.12, 0.2], shallow: [0.1, 0.36, 0.42], land: [0.55, 0.46, 0.3], high: [0.86, 0.84, 0.8], atmo: [0.45, 0.72, 1.0] },
  { deep: [0.18, 0.2, 0.24], shallow: [0.45, 0.5, 0.56], land: [0.78, 0.82, 0.86], high: [1.0, 1.0, 1.0], atmo: [0.7, 0.85, 1.0] },
  { deep: [0.12, 0.05, 0.03], shallow: [0.38, 0.16, 0.08], land: [0.72, 0.42, 0.22], high: [0.95, 0.8, 0.6], atmo: [1.0, 0.7, 0.45] },
  { deep: [0.02, 0.02, 0.025], shallow: [0.08, 0.07, 0.07], land: [0.2, 0.18, 0.17], high: [1.6, 0.55, 0.12], atmo: [1.0, 0.5, 0.2] },
]

/**
 * HOLOGRAPHIC CREATION: the four things a user can conjure between their hands.
 * Each is a physics object with its own look and its own response to the hands:
 *  - PLANET: procedural surface, drifting clouds, atmosphere, orbiting ring; squeeze it to make it burst
 *  - LIQUID METAL: a flowing chrome blob whose surface the hand disturbs
 *  - PARTICLE GALAXY: a spiral of stars, spun by the hands, scattered by a fast release
 *  - PHYSICS CUBE: a heavy machined cube with a spinning core, built to be thrown
 */
export class Creations {
  private seed = 1
  private readonly cubeMats = {
    frame: new MeshStandardMaterial({ color: 0x8b929b, metalness: 1, roughness: 0.22 }),
    dark: new MeshStandardMaterial({ color: 0x15181c, metalness: 0.85, roughness: 0.35 }),
    glow: new MeshBasicMaterial({ color: new Color(0xa9dcff).multiplyScalar(3.2) }),
    warm: new MeshBasicMaterial({ color: new Color(0xffc48a).multiplyScalar(2.8) }),
  }

  constructor(
    private physics: PhysicsEngine,
    private counts: { galaxy: number; liquidDetail: number },
  ) {}

  setCounts(c: { galaxy: number; liquidDetail: number }) {
    this.counts = c
  }

  create(mode: CreationMode, at: Vector3, scale: number): PhysObj {
    switch (mode) {
      case 'PLANET':
        return this.planet(at, scale)
      case 'LIQUID':
        return this.liquid(at, scale)
      case 'GALAXY':
        return this.galaxy(at, scale)
      default:
        return this.cube(at, scale)
    }
  }

  private body(at: Vector3, desc: RAPIER.ColliderDesc, opts: { damping: number; group?: number; sensor?: boolean }) {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setLinearDamping(opts.damping).setAngularDamping(0.6).setCcdEnabled(true),
    )
    const c = this.physics.world.createCollider(desc.setCollisionGroups(opts.group ?? GROUPS.obj).setSensor(!!opts.sensor), body)
    return { body, c }
  }

  /** shared materialise effect: grows in from nothing with an easeOutBack */
  private appear(o: PhysObj, target: number) {
    const base = o.onFrame
    o.onFrame = (dt, t) => {
      const k = clamp(o.age / 0.55, 0, 1)
      const e = k >= 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)
      if (k < 1) o.object.scale.setScalar(Math.max(0.01, o.scale * e))
      else if (o.object.scale.x !== o.scale) o.object.scale.setScalar(o.scale)
      base?.(dt, t)
    }
    void target
  }

  private planet(at: Vector3, scale: number) {
    const r = rng(this.seed++ * 101)
    const pal = PALETTES[Math.floor(r() * PALETTES.length)]
    const v3 = (a: number[]) => new Vector3(a[0], a[1], a[2])
    const group = new Group()
    const surf = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: r() * 100 },
        uDeep: { value: v3(pal.deep) },
        uShallow: { value: v3(pal.shallow) },
        uLand: { value: v3(pal.land) },
        uHigh: { value: v3(pal.high) },
        uAtmo: { value: v3(pal.atmo) },
        uSqueeze: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `${SIMPLEX_GLSL}
        uniform float uTime; uniform float uSeed; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uLand; uniform vec3 uHigh; uniform vec3 uAtmo; uniform float uSqueeze;
        varying vec3 vN; varying vec3 vP; varying vec3 vW;
        float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*snoise(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          vec3 p = normalize(vP);
          float h = fbm(p*1.6 + uSeed);
          vec3 col = mix(uDeep, uShallow, smoothstep(-0.4, 0.0, h));
          col = mix(col, uLand, smoothstep(0.02, 0.08, h));
          col = mix(col, uHigh, smoothstep(0.32, 0.45, h));
          col = mix(col, vec3(0.95), smoothstep(0.82, 0.92, abs(p.y)));
          vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
          vec3 L = normalize(vec3(-0.45, 0.6, 0.65));
          float day = smoothstep(-0.15, 0.4, dot(N, L));
          float spec = pow(max(dot(reflect(-L, N), V), 0.0), 40.0) * (1.0 - smoothstep(-0.05, 0.05, h)) * 0.6;
          float f = pow(1.0 - max(dot(N, V), 0.0), 2.5);
          vec3 c = col * (0.04 + day * 1.2) + spec + uAtmo * f * (0.3 + day) * 1.2;
          c += uAtmo * uSqueeze * 2.5 * (0.5 + 0.5*sin(uTime*30.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    const surface = new Mesh(new SphereGeometry(1, 64, 48), surf)
    surface.castShadow = true
    const cloudMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSeed: { value: r() * 50 } },
      vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `${SIMPLEX_GLSL} uniform float uTime; uniform float uSeed; varying vec3 vP; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 p = normalize(vP); float a = uTime*0.05; p.xz = mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
          float c = snoise(p*3.0 + uSeed)*0.6 + snoise(p*7.0 + uSeed)*0.3;
          float m = smoothstep(0.15, 0.55, c);
          float day = smoothstep(-0.1, 0.4, dot(normalize(vN), normalize(vec3(-0.45,0.6,0.65))));
          gl_FragColor = vec4(vec3(1.0)*(0.08 + day*0.95), m*0.75); }`,
    })
    const clouds = new Mesh(new SphereGeometry(1.025, 48, 32), cloudMat)
    const atmoMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      uniforms: { uAtmo: { value: v3(pal.atmo) } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `uniform vec3 uAtmo; varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW);
        float f = max(dot(-normalize(vN), V), 0.0); float a = pow(f, 4.0) * 1.1; gl_FragColor = vec4(uAtmo*a*1.6, a); }`,
    })
    const atmo = new Mesh(new SphereGeometry(1.22, 48, 32), atmoMat)
    // orbit ring of particles
    const N = 900
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2
      const rr = 1.55 + r() * 0.55
      pos.set([Math.cos(a) * rr, (r() - 0.5) * 0.04, Math.sin(a) * rr], i * 3)
    }
    const rg = new BufferGeometry()
    rg.setAttribute('position', new BufferAttribute(pos, 3))
    const ringMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uPx: { value: 1 } },
      vertexShader: /* glsl */ `uniform float uPx; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = 2.2*uPx*14.0 / -mv.z; }`,
      fragmentShader: /* glsl */ `void main(){ vec2 p = gl_PointCoord*2.-1.; float d = dot(p,p); if (d>1.) discard; float a = exp(-d*3.0)*0.6; gl_FragColor = vec4(vec3(0.9,0.92,1.0)*a, a); }`,
    })
    const ring = new Points(rg, ringMat)
    ring.rotation.x = 0.45
    ring.frustumCulled = false
    group.add(surface, clouds, atmo, ring)
    group.position.copy(at)
    const { body, c } = this.body(at, RAPIER.ColliderDesc.ball(scale).setDensity(1.4).setRestitution(0.45), { damping: 0.5 })
    const o = this.physics.register({
      kind: 'planet', body, collider: c, object: group, radius: 1.3, scale, grabbable: true, heavy: 1.3, gravityScale: 0, home: null, tag: 'creation',
    })
    o.creation = { mode: 'PLANET', baseScale: scale }
    o.setScale = (s) => {
      this.physics.replaceColliders(o, [RAPIER.ColliderDesc.ball(s).setDensity(1.4).setRestitution(0.45).setCollisionGroups(GROUPS.obj)])
      o.scale = s
      o.object.scale.setScalar(s)
    }
    o.onFrame = (dt, t) => {
      surf.uniforms.uTime.value = t
      cloudMat.uniforms.uTime.value = t
      surface.rotation.y += dt * 0.12
      ring.rotation.y += dt * 0.25
      const squeeze = clamp(1 - o.scale / (o.creation!.baseScale * 0.7), 0, 1)
      surf.uniforms.uSqueeze.value += (squeeze - surf.uniforms.uSqueeze.value) * damp(8, dt)
    }
    this.appear(o, scale)
    o.object.scale.setScalar(0.01)
    return o
  }

  private liquid(at: Vector3, scale: number) {
    const mat = new MeshPhysicalMaterial({ color: 0xeef2f6, metalness: 1, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 3.4 })
    const uniforms = { uTime: { value: 0 }, uDisturb: { value: new Vector4(0, 0, 0, 0) }, uPulse: { value: 0 } }
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uniforms)
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          ${SIMPLEX_GLSL}
          uniform float uTime; uniform vec4 uDisturb; uniform float uPulse;
          float field(vec3 p){
            float n = snoise(p*1.15 + vec3(0.0, uTime*0.45, uTime*0.3))*0.15 + snoise(p*2.1 - vec3(uTime*0.6))*0.035;
            float d = length(p - uDisturb.xyz);
            n += sin(d*7.0 - uTime*9.0) * exp(-d*1.6) * uDisturb.w * 0.12;
            n += sin(p.y*5.0 + uTime*3.0) * uPulse * 0.08;
            return n;
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = normal;
          {
            vec3 t = normalize(cross(normal, abs(normal.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
            vec3 b = normalize(cross(normal, t));
            float e = 0.02;
            vec3 p0 = position + normal * field(position);
            vec3 p1 = (position + t*e); p1 = normalize(p1) * length(position); p1 += normalize(p1) * field(p1);
            vec3 p2 = (position + b*e); p2 = normalize(p2) * length(position); p2 += normalize(p2) * field(p2);
            objectNormal = normalize(cross(p1 - p0, p2 - p0));
            if (dot(objectNormal, normal) < 0.0) objectNormal = -objectNormal;
          }
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace('#include <begin_vertex>', `vec3 transformed = position + normal * field(position);`)
    }
    const mesh = new Mesh(new IcosahedronGeometry(1, this.counts.liquidDetail), mat)
    mesh.castShadow = true
    const group = new Group()
    group.add(mesh)
    group.position.copy(at)
    const { body, c } = this.body(at, RAPIER.ColliderDesc.ball(scale * 0.95).setDensity(3.2).setRestitution(0.15), { damping: 0.7 })
    const o = this.physics.register({
      kind: 'liquid', body, collider: c, object: group, radius: 1.15, scale, grabbable: true, heavy: 1.8, gravityScale: 0, home: null, tag: 'creation',
    })
    const inv = new Vector3()
    o.creation = {
      mode: 'LIQUID',
      baseScale: scale,
      disturb: (p, strength) => {
        inv.copy(p).sub(o.object.position).applyQuaternion(o.object.quaternion.clone().invert()).divideScalar(o.scale)
        uniforms.uDisturb.value.set(inv.x, inv.y, inv.z, Math.max(uniforms.uDisturb.value.w, clamp(strength, 0, 1.5)))
      },
    }
    o.setScale = (s) => {
      this.physics.replaceColliders(o, [RAPIER.ColliderDesc.ball(s * 0.95).setDensity(3.2).setRestitution(0.15).setCollisionGroups(GROUPS.obj)])
      o.scale = s
      o.object.scale.setScalar(s)
    }
    o.onFrame = (dt, t) => {
      uniforms.uTime.value = t
      uniforms.uDisturb.value.w *= Math.exp(-dt * 1.8)
      uniforms.uPulse.value = o.held ? Math.min(1, uniforms.uPulse.value + dt * 2) : uniforms.uPulse.value * Math.exp(-dt * 2)
    }
    this.appear(o, scale)
    o.object.scale.setScalar(0.01)
    return o
  }

  private galaxy(at: Vector3, scale: number) {
    const r = rng(this.seed++ * 53)
    const N = this.counts.galaxy
    const seed = new Float32Array(N * 4)
    const col = new Float32Array(N * 3)
    const arms = 2 + Math.floor(r() * 3)
    for (let i = 0; i < N; i++) {
      const bulge = r() < 0.18
      const rad = bulge ? Math.pow(r(), 2) * 0.35 : 0.12 + Math.pow(r(), 0.8) * 1.0
      const arm = Math.floor(r() * arms)
      const twist = rad * 5.2
      const spread = (r() - 0.5) * (bulge ? 6.28 : 0.55 + rad * 0.4)
      const theta = (arm / arms) * Math.PI * 2 + twist + spread
      const h = (r() - 0.5) * (bulge ? 0.22 : 0.05) * (1.2 - rad)
      seed.set([rad, theta, h, r()], i * 4)
      const c = new Color().setHSL(bulge ? 0.09 : 0.54 + r() * 0.025, bulge ? 0.45 : 0.32, bulge ? 0.72 : 0.6 + r() * 0.22)
      if (!bulge && r() < 0.05) c.setRGB(1.0, 0.78, 0.62)
      col.set([c.r, c.g, c.b], i * 3)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3))
    g.setAttribute('aSeed', new BufferAttribute(seed, 4))
    g.setAttribute('aCol', new BufferAttribute(col, 3))
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSpin: { value: 0 }, uPx: { value: 1 }, uBurst: { value: -1 }, uScale: { value: scale } },
      vertexShader: /* glsl */ `attribute vec4 aSeed; attribute vec3 aCol; uniform float uTime; uniform float uSpin; uniform float uPx; uniform float uBurst; uniform float uScale;
        varying vec3 vC; varying float vA;
        void main(){
          float rad = aSeed.x * 2.4;
          float ang = aSeed.y + uSpin / (0.35 + aSeed.x * 1.6);
          vec3 p = vec3(cos(ang)*rad, aSeed.z*2.4, sin(ang)*rad);
          vA = 1.0;
          if (uBurst >= 0.0) {
            vec3 dir = normalize(p + vec3(0.0, (aSeed.w-0.5)*0.8, 0.0) + 1e-3);
            p += dir * uBurst * (3.0 + aSeed.w * 9.0);
            vA = max(0.0, 1.0 - uBurst / 2.2);
          }
          vec4 mv = modelViewMatrix*vec4(p,1.);
          gl_Position = projectionMatrix*mv;
          vC = aCol;
          gl_PointSize = (0.8 + aSeed.w*1.8) * uPx * uScale * 16.0 / -mv.z * (aSeed.x < 0.3 ? 1.5 : 1.0);
        }`,
      fragmentShader: /* glsl */ `varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord*2.-1.; float d = dot(p,p); if (d>1.) discard;
        float a = exp(-d*3.5) * vA; gl_FragColor = vec4(vC * a * 1.05, a); }`,
    })
    const pts = new Points(g, mat)
    pts.frustumCulled = false
    const coreGlow = new Mesh(
      new SphereGeometry(0.22, 24, 16),
      new MeshBasicMaterial({ color: new Color(1.0, 0.85, 0.65).multiplyScalar(3), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    )
    const group = new Group()
    group.add(pts, coreGlow)
    group.rotation.x = 0.5
    group.position.copy(at)
    // the galaxy is made of light: a sensor body, so it can be held and moved but never collides
    const { body, c } = this.body(at, RAPIER.ColliderDesc.ball(2.0 * scale), { damping: 1.4, group: GROUPS.ghost, sensor: true })
    body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5), true)
    const o = this.physics.register({
      kind: 'galaxy', body, collider: c, object: group, radius: 2.4, scale, grabbable: true, heavy: 0.8, gravityScale: 0, home: null, tag: 'creation', noForces: true,
    })
    let spinRate = 0.35
    let burst = -1
    o.creation = {
      mode: 'GALAXY',
      baseScale: scale,
      disperse: () => {
        if (burst < 0) burst = 0
      },
    }
    o.setScale = (s) => {
      o.scale = s
      o.object.scale.setScalar(s)
      mat.uniforms.uScale.value = s
    }
    o.onFrame = (dt, t) => {
      mat.uniforms.uTime.value = t
      // a held galaxy spins faster; its angular velocity also feeds the spin
      const w = o.body.angvel()
      const target = o.held ? 1.2 + Math.abs(w.y) * 0.5 : 0.35
      spinRate += (target - spinRate) * damp(2, dt)
      mat.uniforms.uSpin.value += dt * spinRate
      if (burst >= 0) {
        burst += dt
        mat.uniforms.uBurst.value = burst
        if (burst > 2.3 && o.creation) o.creation.dead = true
      }
    }
    this.appear(o, scale)
    o.object.scale.setScalar(0.01)
    return o
  }

  private cube(at: Vector3, scale: number) {
    const m = this.cubeMats
    const group = new Group()
    const S = 1
    const e = 0.09
    const beam = new BoxGeometry(1, 1, 1)
    // outer frame: 12 edges
    for (const ax of [0, 1, 2]) {
      for (const a of [-1, 1]) {
        for (const b of [-1, 1]) {
          const mesh = new Mesh(beam, m.frame)
          const p = [0, 0, 0]
          const sc = [e, e, e]
          sc[ax] = S
          const o1 = (ax + 1) % 3
          const o2 = (ax + 2) % 3
          p[o1] = (a * S) / 2
          p[o2] = (b * S) / 2
          mesh.position.set(p[0], p[1], p[2])
          mesh.scale.set(sc[0], sc[1], sc[2])
          mesh.castShadow = true
          group.add(mesh)
        }
      }
    }
    // corner caps
    const capGeo = new RoundedBoxGeometry(0.2, 0.2, 0.2, 2, 0.04)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const c = new Mesh(capGeo, m.dark)
      c.position.set((x * S) / 2, (y * S) / 2, (z * S) / 2)
      c.castShadow = true
      group.add(c)
    }
    // smoked panels with lit seams
    const panelGeo = new BoxGeometry(0.78, 0.78, 0.03)
    const seamGeo = new BoxGeometry(0.6, 0.02, 0.035)
    const dirs: [Vector3, Vector3][] = [
      [new Vector3(0, 0, 1), new Vector3(0, 0, 0)], [new Vector3(0, 0, -1), new Vector3(0, Math.PI, 0)],
      [new Vector3(1, 0, 0), new Vector3(0, Math.PI / 2, 0)], [new Vector3(-1, 0, 0), new Vector3(0, -Math.PI / 2, 0)],
      [new Vector3(0, 1, 0), new Vector3(-Math.PI / 2, 0, 0)], [new Vector3(0, -1, 0), new Vector3(Math.PI / 2, 0, 0)],
    ]
    for (const [n, rot] of dirs) {
      const p = new Mesh(panelGeo, m.dark)
      p.position.copy(n).multiplyScalar(0.44)
      p.rotation.set(rot.x, rot.y, rot.z)
      const s1 = new Mesh(seamGeo, m.glow)
      s1.position.z = 0.002
      p.add(s1)
      group.add(p)
    }
    // spinning inner core
    const inner = new Group()
    const innerCube = new Mesh(new RoundedBoxGeometry(0.34, 0.34, 0.34, 2, 0.04), m.frame)
    const innerGlow = new Mesh(new BoxGeometry(0.4, 0.04, 0.4), m.warm)
    inner.add(innerCube, innerGlow)
    group.add(inner)
    group.position.copy(at)
    const { body, c } = this.body(at, RAPIER.ColliderDesc.cuboid(0.55 * scale, 0.55 * scale, 0.55 * scale).setDensity(4).setRestitution(0.3).setFriction(0.6), { damping: 0.05 })
    c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    c.setContactForceEventThreshold(40)
    const o = this.physics.register({
      kind: 'mechcube', body, collider: c, object: group, radius: 0.9, scale, grabbable: true, heavy: 2, gravityScale: 1, home: null, tag: 'creation',
    })
    o.creation = { mode: 'CUBE', baseScale: scale }
    o.setScale = (s) => {
      this.physics.replaceColliders(o, [
        RAPIER.ColliderDesc.cuboid(0.55 * s, 0.55 * s, 0.55 * s).setDensity(4).setRestitution(0.3).setFriction(0.6).setCollisionGroups(GROUPS.obj)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(40),
      ])
      o.scale = s
      o.object.scale.setScalar(s)
    }
    o.onFrame = (dt) => {
      const sp = o.held ? 6 : 1.2
      inner.rotation.x += dt * sp
      inner.rotation.y += dt * sp * 1.3
    }
    this.appear(o, scale)
    o.object.scale.setScalar(0.01)
    return o
  }
}
