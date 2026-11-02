import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Group, IcosahedronGeometry,
  InstancedMesh, LineSegments, Mesh, MeshStandardMaterial, Object3D, OctahedronGeometry, Quaternion, ShaderMaterial,
  SphereGeometry, TetrahedronGeometry, TorusGeometry, TubeGeometry, Vector3, BoxGeometry, MeshBasicMaterial, BackSide,
} from 'three'
import { ROOM, rng } from '../core/config'
import { RAPIER, GROUPS, type PhysObj, type PhysicsEngine } from '../physics/PhysicsEngine'

const MAX_STREAKS = 7000
const MAX_DEBRIS = 300

export interface OverflowCounts {
  streaks: number
  debris: number
  heroes: number
}

interface Debris {
  o: Vector3
  c: Vector3
  delay: number
  speed: number
  axis: Vector3
  spin: number
  scale: number
  mesh: number
}

/**
 * REALITY OVERFLOW: after the pane breaks, the lab pours out through the
 * opening. Streaks and small fragments follow straight lines from deep in the
 * hall through a point inside the opening and on past the viewer (so they can
 * never pass through the frame), and a handful of hero objects — mini planets,
 * machined rings, solids — are launched as real rigid bodies.
 */
export class Overflow {
  readonly group = new Group()
  active = false
  t = 0
  heroes: PhysObj[] = []
  private readonly streakMat: ShaderMaterial
  private readonly streakGeo: BufferGeometry
  private readonly debrisMeshes: InstancedMesh[]
  private debris: Debris[] = []
  private readonly streams: Mesh[] = []
  private readonly streamMat: ShaderMaterial
  private counts: OverflowCounts = { streaks: 4000, debris: 200, heroes: 20 }
  private seed = 1
  private readonly tmp = new Object3D()
  private readonly heroMats: MeshStandardMaterial[]
  private readonly heroGeos: { geo: BufferGeometry; collider: (s: number) => RAPIER.ColliderDesc; glow?: boolean }[]
  private readonly planetMat: ShaderMaterial
  private readonly glowMat: ShaderMaterial

  constructor(private physics: PhysicsEngine) {
    // streaks: two vertices each (head, tail), evaluated on the GPU from (origin, crossing, timing)
    const g = new BufferGeometry()
    const n = MAX_STREAKS * 2
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aO', new BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aC', new BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aT', new BufferAttribute(new Float32Array(n * 4), 4))
    this.streakGeo = g
    this.streakMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uStretch: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aO; attribute vec3 aC; attribute vec4 aT; uniform float uTime; uniform float uStretch; varying float vA; varying float vWarm;
        void main(){
          float delay = aT.x; float speed = aT.y; float len = aT.z * uStretch; float tail = position.x;
          vec3 dir = aC - aO; float L = length(dir);
          float s = (uTime - delay) * speed / L;
          float sh = s - tail * len / L;
          vec3 p = aO + dir * max(sh, 0.0);
          vA = step(0.0, s) * step(sh, 3.2) * (1.0 - tail * 0.92) * smoothstep(0.0, 0.25, s);
          vWarm = step(0.88, aT.w);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform float uFade; varying float vA; varying float vWarm;
        void main(){ vec3 c = mix(vec3(0.62,0.85,1.0), vec3(1.0,0.78,0.5), vWarm);
          float a = vA * uFade * 0.8; gl_FragColor = vec4(c * a * 1.3, a); }`,
    })
    const streaks = new LineSegments(g, this.streakMat)
    streaks.frustumCulled = false
    this.group.add(streaks)

    // small fragments (instanced, CPU-animated along the same kind of path)
    const fragMat = new MeshStandardMaterial({ color: 0x8e959e, metalness: 1, roughness: 0.25 })
    const darkMat = new MeshStandardMaterial({ color: 0x1d2025, metalness: 0.9, roughness: 0.35 })
    const glowFrag = new MeshBasicMaterial({ color: new Color(0xbfe6ff).multiplyScalar(2.2) })
    this.debrisMeshes = [
      new InstancedMesh(new TetrahedronGeometry(0.22, 0), fragMat, MAX_DEBRIS),
      new InstancedMesh(new BoxGeometry(0.4, 0.06, 0.25), darkMat, MAX_DEBRIS),
      new InstancedMesh(new OctahedronGeometry(0.12, 0), glowFrag, MAX_DEBRIS),
    ]
    for (const m of this.debrisMeshes) {
      m.count = 0
      m.frustumCulled = false
      this.group.add(m)
    }

    // energy streams pouring from the core through the opening
    this.streamMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform float uFade; varying vec2 vUv;
        void main(){ float flow = fract(vUv.x * 6.0 - uTime * 2.4);
          float band = pow(sin(vUv.y * 3.14159), 3.0);
          float pulse = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.5, flow);
          float a = band * (0.25 + pulse * 0.75) * uFade * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          gl_FragColor = vec4(vec3(0.55, 0.82, 1.0) * a * 1.3, a * 0.8); }`,
    })

    this.planetMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vP; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position;
        vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){ vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
          float bands = sin(vP.y*14.0 + sin(vP.x*5.0)*1.2)*0.5+0.5;
          vec3 c = mix(vec3(0.16,0.3,0.42), vec3(0.78,0.74,0.62), bands);
          float l = max(dot(N, normalize(vec3(-0.5,0.7,0.6))), 0.0);
          float f = pow(1.0 - max(dot(N,V),0.0), 3.0);
          gl_FragColor = vec4(c*(0.15 + l*1.1) + vec3(0.5,0.75,1.0)*f*1.5, 1.0); }`,
    })
    this.glowMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); float f = max(dot(-normalize(vN), V), 0.0);
        float a = pow(f, 3.0) * 0.8; gl_FragColor = vec4(vec3(0.5,0.75,1.0)*a*1.8, a); }`,
    })
    this.heroMats = [
      new MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.08 }),
      new MeshStandardMaterial({ color: 0x23272d, metalness: 0.9, roughness: 0.3, emissive: new Color(0x4aa8ff), emissiveIntensity: 0.15 }),
      new MeshStandardMaterial({ color: 0xa3814f, metalness: 1, roughness: 0.2 }),
    ]
    this.heroGeos = [
      { geo: new SphereGeometry(1, 40, 28), collider: (s) => RAPIER.ColliderDesc.ball(s), glow: true },
      { geo: new TorusGeometry(1, 0.16, 14, 64), collider: (s) => RAPIER.ColliderDesc.cylinder(0.18 * s, 1.1 * s) },
      { geo: new OctahedronGeometry(1, 0), collider: (s) => RAPIER.ColliderDesc.ball(0.75 * s) },
      { geo: new IcosahedronGeometry(1, 0), collider: (s) => RAPIER.ColliderDesc.ball(0.85 * s) },
      { geo: new TetrahedronGeometry(1, 0), collider: (s) => RAPIER.ColliderDesc.ball(0.6 * s) },
    ]
  }

  setCounts(c: OverflowCounts) {
    this.counts = c
  }

  /** a random origin deep in the hall, around the ring */
  private origin(r: () => number) {
    const a = r() * Math.PI * 2
    const rad = Math.sqrt(r()) * 9
    return new Vector3(Math.cos(a) * rad, 4.3 + Math.sin(a) * rad * 0.9, ROOM.back + 3 + r() * 6)
  }

  /** a random crossing point inside the opening (z = 0) */
  private crossing(r: () => number, hw: number, hh: number) {
    return new Vector3((r() * 2 - 1) * hw * 0.9, (r() * 2 - 1) * hh * 0.9, 0)
  }

  start(halfW: number, halfH: number, eye: Vector3, core: Vector3) {
    const r = rng(this.seed++ * 31)
    this.active = true
    this.t = 0
    const n = this.counts.streaks
    const aO = this.streakGeo.attributes.aO as BufferAttribute
    const aC = this.streakGeo.attributes.aC as BufferAttribute
    const aT = this.streakGeo.attributes.aT as BufferAttribute
    const pos = this.streakGeo.attributes.position as BufferAttribute
    for (let i = 0; i < n; i++) {
      const o = this.origin(r)
      const c = this.crossing(r, halfW, halfH)
      const delay = Math.pow(r(), 1.8) * 4.2
      const speed = 45 + r() * 80
      const len = 1.5 + r() * 5
      const warm = r()
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k
        pos.setXYZ(j, k, 0, 0) // x = 0 head, 1 tail
        aO.setXYZ(j, o.x, o.y, o.z)
        aC.setXYZ(j, c.x, c.y, c.z)
        aT.setXYZW(j, delay, speed, len, warm)
      }
    }
    for (const a of [aO, aC, aT, pos]) a.needsUpdate = true
    this.streakGeo.setDrawRange(0, n * 2)

    this.debris = []
    const nd = this.counts.debris
    for (let i = 0; i < nd; i++) {
      this.debris.push({
        o: this.origin(r),
        c: this.crossing(r, halfW, halfH),
        delay: 0.2 + Math.pow(r(), 1.5) * 4,
        speed: 22 + r() * 30,
        axis: new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        spin: 2 + r() * 10,
        scale: 0.5 + r() * 1.6,
        mesh: Math.floor(r() * 3),
      })
    }

    // energy streams from the core out through the opening and past the viewer
    for (const s of this.streams) {
      s.removeFromParent()
      s.geometry.dispose()
    }
    this.streams.length = 0
    for (let k = 0; k < 5; k++) {
      const c = this.crossing(r, halfW * 0.6, halfH * 0.6)
      const end = eye.clone().add(new Vector3((r() - 0.5) * 16, (r() - 0.5) * 10, 6))
      const mid1 = core.clone().lerp(c, 0.5).add(new Vector3((r() - 0.5) * 3, (r() - 0.5) * 3, 0))
      const curve = new CatmullRomCurve3([core.clone(), mid1, c, c.clone().lerp(end, 0.5), end])
      const m = new Mesh(new TubeGeometry(curve, 120, 0.022 + r() * 0.035, 8, false), this.streamMat)
      m.frustumCulled = false
      this.streams.push(m)
      this.group.add(m)
    }

    // hero objects: real bodies launched through the opening
    for (let i = 0; i < this.counts.heroes; i++) {
      const o = this.origin(r)
      const c = this.crossing(r, halfW, halfH)
      const kind = Math.floor(r() * this.heroGeos.length)
      const spec = this.heroGeos[kind]
      const s = kind === 0 ? 0.45 + r() * 0.5 : 0.35 + r() * 0.45
      const group = new Group()
      const mesh = new Mesh(spec.geo, kind === 0 ? this.planetMat : this.heroMats[Math.floor(r() * 3)])
      mesh.scale.setScalar(s)
      mesh.castShadow = true
      group.add(mesh)
      if (spec.glow) {
        const g = new Mesh(spec.geo, this.glowMat)
        g.scale.setScalar(s * 1.35)
        group.add(g)
      }
      group.position.copy(o)
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x, o.y, o.z).setLinearDamping(0.02).setAngularDamping(0.05).setCcdEnabled(true),
      )
      const collider = this.physics.world.createCollider(
        spec.collider(s).setDensity(1.2).setRestitution(0.4).setFriction(0.4).setCollisionGroups(GROUPS.obj),
        body,
      )
      const v = c.clone().sub(o).normalize().multiplyScalar(26 + r() * 18)
      body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
      body.setAngvel({ x: (r() - 0.5) * 4, y: (r() - 0.5) * 4, z: (r() - 0.5) * 4 }, true)
      const obj = this.physics.register({
        kind: 'hero',
        body,
        collider,
        object: group,
        radius: s * 1.2,
        scale: 1,
        grabbable: true,
        heavy: 1,
        gravityScale: 0,
        home: null,
        tag: 'overflow',
      })
      // released in a staggered wave
      body.setEnabled(false)
      group.visible = false
      ;(obj as PhysObj & { launchAt: number }).launchAt = 0.25 + r() * 2.6
      this.group.add(group)
      this.heroes.push(obj)
    }
  }

  update(dt: number, time: number) {
    this.planetMat.uniforms.uTime.value = time
    if (!this.active) return
    this.t += dt
    const t = this.t
    this.streakMat.uniforms.uTime.value = t
    const fade = Math.min(1, t * 3) * (t < 5.5 ? 1 : Math.max(0, 1 - (t - 5.5) / 1.5))
    this.streakMat.uniforms.uFade.value = fade
    this.streamMat.uniforms.uTime.value = t
    this.streamMat.uniforms.uFade.value = Math.min(1, t * 4) * (t < 2.6 ? 1 : Math.max(0, 1 - (t - 2.6) / 1.2))
    for (const s of this.streams) s.visible = this.streamMat.uniforms.uFade.value > 0.01

    // fragments
    const counts = [0, 0, 0]
    const q = new Quaternion()
    for (const d of this.debris) {
      const k = (t - d.delay) * d.speed
      if (k < 0) continue
      const dir = d.c.clone().sub(d.o)
      const L = dir.length()
      const s = k / L
      if (s > 3.2) continue
      const p = d.o.clone().addScaledVector(dir, s)
      const m = this.debrisMeshes[d.mesh]
      const i = counts[d.mesh]++
      q.setFromAxisAngle(d.axis, t * d.spin)
      this.tmp.position.copy(p)
      this.tmp.quaternion.copy(q)
      this.tmp.scale.setScalar(d.scale * Math.min(1, s * 4))
      this.tmp.updateMatrix()
      m.setMatrixAt(i, this.tmp.matrix)
    }
    this.debrisMeshes.forEach((m, i) => {
      m.count = counts[i]
      m.instanceMatrix.needsUpdate = true
    })

    for (const h of this.heroes) {
      const ho = h as PhysObj & { launchAt: number }
      if (ho.launchAt > 0 && t > ho.launchAt) {
        ho.launchAt = 0
        h.body.setEnabled(true)
        h.object.visible = true
      }
      // weightless while they pour out, then they become ordinary debris
      if (ho.launchAt === 0 && h.age > 0 && t > 3.2 && h.gravityScale === 0) {
        h.gravityScale = 1
        h.body.setGravityScale(1, true)
      }
    }
    if (t > 7.5) {
      this.active = false
      for (const m of this.debrisMeshes) m.count = 0
      this.streakMat.uniforms.uFade.value = 0
    }
  }

  /** debris intensity for camera shake / blur (0..1) */
  get intensity() {
    if (!this.active) return 0
    const t = this.t
    return Math.min(1, t * 2.5) * Math.max(0, 1 - Math.max(0, t - 2.2) / 3.5)
  }

  clearHeroes() {
    for (const h of this.heroes) this.physics.remove(h)
    this.heroes = []
  }

  stop() {
    this.active = false
    this.streakMat.uniforms.uFade.value = 0
    this.streamMat.uniforms.uFade.value = 0
    for (const s of this.streams) s.visible = false
    for (const m of this.debrisMeshes) m.count = 0
  }
}
