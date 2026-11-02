import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, EdgesGeometry, Group,
  IcosahedronGeometry, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, PointLight, Points, ShaderMaterial,
  SphereGeometry, TorusGeometry, Vector3, DoubleSide,
} from 'three'
import { CORE_HOME, CORE_RADIUS, clamp, damp, rng } from '../core/config'
import { RAPIER, GROUPS, type PhysObj, type PhysicsEngine } from '../physics/PhysicsEngine'

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`
export { NOISE as SIMPLEX_GLSL }

/**
 * The blue-white energy core: a plasma sphere that ripples and stretches when
 * held, gyroscope rings, a geodesic cage, an orbiting particle halo that is
 * pulled in by the hand, a real point light, and a motion ribbon.
 */
export class EnergyCore {
  readonly group = new Group()
  readonly light: PointLight
  obj!: PhysObj
  /** 0 calm … 1 held / excited */
  energy = 0
  /** set while a hand holds it */
  grabbed = false
  /** once disturbed it floats free until the world is rebuilt */
  free = false
  private readonly mat: ShaderMaterial
  private readonly shellMat: ShaderMaterial
  private readonly haloMat: ShaderMaterial
  private readonly rings: Mesh[] = []
  private readonly cage: LineSegments
  private readonly trail: Mesh
  private readonly trailPts: Vector3[] = []
  private readonly trailMat: ShaderMaterial
  private readonly vel = new Vector3()
  private readonly lastPos = new Vector3()
  private ripple = 0
  private flare = 0

  constructor(
    private physics: PhysicsEngine,
    haloCount: number,
  ) {
    this.mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uRipple: { value: 0 },
        uStretch: { value: new Vector3() },
        uFlare: { value: 0 },
      },
      vertexShader: /* glsl */ `
        ${NOISE}
        uniform float uTime; uniform float uEnergy; uniform float uRipple; uniform vec3 uStretch;
        varying vec3 vN; varying vec3 vObj; varying vec3 vW; varying float vDisp;
        void main(){
          vec3 p = position;
          float n = snoise(p*1.6 + vec3(0.0, uTime*0.5, uTime*0.3));
          float n2 = snoise(p*4.0 - vec3(uTime*1.2));
          float wave = sin(dot(p, vec3(0.0,1.0,0.3))*9.0 - uTime*7.0) * uRipple;
          float d = n*(0.04 + uEnergy*0.09) + n2*0.02*uEnergy + wave*0.06;
          p += normal * d;
          // stretch along the motion direction (in object space), volume-ish preserving
          float s = length(uStretch);
          if (s > 1e-4) { vec3 dir = uStretch / s; float k = dot(p, dir); p += dir * k * s - (p - dir*k) * s * 0.35; }
          vDisp = d;
          vObj = position;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform float uTime; uniform float uEnergy; uniform float uFlare;
        varying vec3 vN; varying vec3 vObj; varying vec3 vW; varying float vDisp;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float f = 1.0 - max(dot(normalize(vN), V), 0.0);
          float plasma = snoise(vObj*2.2 + vec3(uTime*0.6, -uTime*0.4, uTime*0.5)) * 0.5 + 0.5;
          float vein = 1.0 - abs(snoise(vObj*3.5 + vec3(0.0, uTime*0.9, 0.0)));
          vein = pow(vein, 6.0);
          vec3 deep = vec3(0.02, 0.12, 0.62);
          vec3 ice = vec3(0.75, 0.92, 1.0);
          vec3 col = mix(deep, ice, plasma*0.6 + vein*0.8);
          float core = pow(1.0 - f, 2.0);
          vec3 e = col * (0.38 + core*0.75 + uEnergy*0.45) + vec3(0.3,0.6,1.0) * pow(f, 2.0) * (1.3 + uEnergy*1.0);
          e += vec3(0.7,0.85,1.0) * uFlare * 2.5;
          gl_FragColor = vec4(e, 1.0);
        }`,
    })
    const sphere = new Mesh(new SphereGeometry(1, 96, 64), this.mat)
    this.group.add(sphere)

    // outer glow shell (back faces, additive fresnel)
    this.shellMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      uniforms: { uEnergy: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW;
        void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `uniform float uEnergy; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 V = normalize(cameraPosition - vW); float f = max(dot(-normalize(vN), V), 0.0);
          float a = pow(f, 3.2) * (0.45 + uEnergy*0.45);
          gl_FragColor = vec4(vec3(0.45,0.72,1.0)*a*1.2, a); }`,
    })
    const shell = new Mesh(new SphereGeometry(1.9, 64, 48), this.shellMat)
    this.group.add(shell)

    // gyroscope rings
    const ringMat = new MeshStandardMaterial({ color: 0x9aa4b0, metalness: 1, roughness: 0.18, emissive: new Color(0x6fb6ff), emissiveIntensity: 0.25 })
    for (const [r, tube] of [[1.62, 0.028], [1.86, 0.02], [2.12, 0.016]]) {
      const m = new Mesh(new TorusGeometry(r, tube, 10, 160), ringMat)
      m.castShadow = true
      this.rings.push(m)
      this.group.add(m)
    }

    // geodesic cage
    const cageGeo = new EdgesGeometry(new IcosahedronGeometry(1.42, 1))
    this.cage = new LineSegments(cageGeo, new LineBasicMaterial({ color: new Color(0.55, 0.85, 1.4), transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }))
    this.group.add(this.cage)

    // orbiting halo particles (orbits evaluated in the vertex shader)
    const r = rng(17)
    const N = haloCount
    const seed = new Float32Array(N * 4)
    for (let i = 0; i < N; i++) {
      seed[i * 4] = 2.0 + Math.pow(r(), 1.6) * 3.2 // radius
      seed[i * 4 + 1] = r() * Math.PI * 2 // phase
      seed[i * 4 + 2] = (r() - 0.5) * 2.2 // inclination
      seed[i * 4 + 3] = r() // size / speed seed
    }
    const hg = new BufferGeometry()
    hg.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3))
    hg.setAttribute('aSeed', new BufferAttribute(seed, 4))
    this.haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPull: { value: 0 }, uPx: { value: 1 }, uEnergy: { value: 0 } },
      vertexShader: /* glsl */ `attribute vec4 aSeed; uniform float uTime; uniform float uPull; uniform float uPx; uniform float uEnergy; varying float vA;
        void main(){
          float rad = mix(aSeed.x, 1.25 + aSeed.x*0.18, uPull);
          float sp = (0.25 + aSeed.w*0.6) * (1.0 + uPull*3.5) / sqrt(rad);
          float a = aSeed.y + uTime*sp;
          float inc = aSeed.z * (1.0 - uPull*0.4);
          vec3 p = vec3(cos(a)*rad, sin(a)*rad*sin(inc), sin(a)*rad*cos(inc));
          p.y += sin(uTime*0.7 + aSeed.y*3.0)*0.15;
          vec4 mv = modelViewMatrix*vec4(p,1.);
          gl_Position = projectionMatrix*mv;
          vA = 0.35 + aSeed.w*0.65;
          gl_PointSize = (1.4 + aSeed.w*2.4) * (1.0 + uEnergy*0.8) * uPx * 26.0 / -mv.z;
        }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ vec2 p = gl_PointCoord*2.-1.; float d = dot(p,p); if(d>1.) discard;
        float a = exp(-d*4.0)*vA; gl_FragColor = vec4(vec3(0.6,0.85,1.0)*a*2.2, a); }`,
    })
    const halo = new Points(hg, this.haloMat)
    halo.frustumCulled = false
    this.group.add(halo)

    this.light = new PointLight(0xa8d6ff, 70, 46, 2)
    this.group.add(this.light)

    // motion ribbon
    const TR = 48
    const tg = new BufferGeometry()
    tg.setAttribute('position', new BufferAttribute(new Float32Array(TR * 2 * 3), 3).setUsage(DynamicDrawUsage))
    const tu = new Float32Array(TR * 2)
    const idx: number[] = []
    for (let i = 0; i < TR; i++) {
      tu[i * 2] = tu[i * 2 + 1] = i / (TR - 1)
      if (i < TR - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    tg.setAttribute('aT', new BufferAttribute(tu, 1))
    tg.setIndex(idx)
    this.trailMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `uniform float uAlpha; varying float vT; void main(){ float a = pow(1.0 - vT, 2.0) * uAlpha; gl_FragColor = vec4(vec3(0.55,0.82,1.0)*a*2.0, a); }`,
    })
    this.trail = new Mesh(tg, this.trailMat)
    this.trail.frustumCulled = false
    for (let i = 0; i < TR; i++) this.trailPts.push(CORE_HOME.clone())

    this.group.position.copy(CORE_HOME)
    this.lastPos.copy(CORE_HOME)
    this.spawn()
  }

  /** the trail lives in world space, so it is added to the scene separately */
  get trailMesh() {
    return this.trail
  }

  private spawn() {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(CORE_HOME.x, CORE_HOME.y, CORE_HOME.z)
        .setLinearDamping(0.9)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    )
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(CORE_RADIUS).setDensity(9).setRestitution(0.3).setFriction(0.2).setCollisionGroups(GROUPS.core),
      body,
    )
    this.obj = this.physics.register({
      kind: 'core',
      body,
      collider,
      object: this.group,
      radius: 1.9,
      scale: 1,
      grabbable: true,
      heavy: 1.6,
      gravityScale: 0,
      home: { p: CORE_HOME.clone(), q: this.group.quaternion.clone() },
      noForces: true,
    })
    // calm hover: a soft spring to its cradle until someone takes it
    this.physics.preStep.push((h) => {
      const o = this.obj
      if (o.held || this.free || o.homing || !o.body.isDynamic()) return
      const p = o.body.translation()
      const v = o.body.linvel()
      const t = this.physics.time
      const ty = CORE_HOME.y + Math.sin(t * 1.1) * 0.12
      const k = 18
      const c = 7
      const m = o.body.mass()
      o.body.applyImpulse(
        { x: ((CORE_HOME.x - p.x) * k - v.x * c) * m * h, y: ((ty - p.y) * k - v.y * c) * m * h, z: ((CORE_HOME.z - p.z) * k - v.z * c) * m * h },
        true,
      )
    })
  }

  flash() {
    this.flare = 1
  }

  update(dt: number, t: number) {
    const held = this.obj.held
    this.grabbed = held
    if (held) this.free = true
    this.energy += ((held ? 1 : 0.15 + (this.free ? 0.15 : 0)) - this.energy) * damp(held ? 4 : 1.5, dt)
    this.ripple += ((held ? 1 : 0) - this.ripple) * damp(3, dt)
    this.flare *= Math.exp(-dt * 3)

    // velocity (world) → stretch in object space
    const p = this.group.position
    this.vel.copy(p).sub(this.lastPos).divideScalar(Math.max(dt, 1e-3))
    this.lastPos.copy(p)
    const speed = this.vel.length()
    const s = clamp(speed / 40, 0, 0.28)
    const local = this.vel.clone().normalize().applyQuaternion(this.group.quaternion.clone().invert()).multiplyScalar(s)
    const u = this.mat.uniforms
    u.uStretch.value.lerp(local, damp(8, dt))
    u.uTime.value = t
    u.uEnergy.value = this.energy
    u.uRipple.value = this.ripple
    u.uFlare.value = this.flare
    this.shellMat.uniforms.uEnergy.value = this.energy
    this.haloMat.uniforms.uTime.value = t
    this.haloMat.uniforms.uPull.value += ((held ? 1 : 0) - this.haloMat.uniforms.uPull.value) * damp(2.5, dt)
    this.haloMat.uniforms.uEnergy.value = this.energy

    const spin = 1 + this.energy * 3
    this.rings[0].rotation.x += dt * 0.6 * spin
    this.rings[0].rotation.y += dt * 0.2 * spin
    this.rings[1].rotation.y += dt * 0.8 * spin
    this.rings[1].rotation.z += dt * 0.3 * spin
    this.rings[2].rotation.z += dt * 0.5 * spin
    this.rings[2].rotation.x -= dt * 0.35 * spin
    this.cage.rotation.y += dt * 0.15 * spin
    this.cage.rotation.x += dt * 0.07 * spin
    ;(this.cage.material as LineBasicMaterial).opacity = 0.3 + this.energy * 0.5

    this.light.intensity = 55 + this.energy * 130 + this.flare * 400

    // ribbon: newest point at the head, billboarded against the view direction
    this.trailPts.pop()
    this.trailPts.unshift(p.clone())
    this.trailMat.uniforms.uAlpha.value += (clamp(speed / 10, 0, 1) * 0.8 - this.trailMat.uniforms.uAlpha.value) * damp(6, dt)
  }

  /** rebuild the ribbon vertices (needs the eye for billboarding) */
  updateTrail(eye: Vector3) {
    const pos = this.trail.geometry.attributes.position as BufferAttribute
    const side = new Vector3()
    const dir = new Vector3()
    const view = new Vector3()
    const n = this.trailPts.length
    for (let i = 0; i < n; i++) {
      const a = this.trailPts[i]
      const b = this.trailPts[Math.min(n - 1, i + 1)]
      dir.copy(a).sub(b)
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0)
      view.copy(eye).sub(a)
      side.crossVectors(dir, view).normalize().multiplyScalar(0.9 * (1 - i / n))
      pos.setXYZ(i * 2, a.x + side.x, a.y + side.y, a.z + side.z)
      pos.setXYZ(i * 2 + 1, a.x - side.x, a.y - side.y, a.z - side.z)
    }
    pos.needsUpdate = true
  }

  setPixelRatio(px: number) {
    this.haloMat.uniforms.uPx.value = px
  }
}
