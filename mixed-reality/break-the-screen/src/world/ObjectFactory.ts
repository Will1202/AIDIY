import {
  BoxGeometry, BufferGeometry, Color, DodecahedronGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, Quaternion, SphereGeometry, TorusGeometry,
  Vector3, CylinderGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { CORE_HOME, ROOM, rng } from '../core/config'
import { RAPIER, GROUPS, type ObjKind, type PhysObj, type PhysicsEngine } from '../physics/PhysicsEngine'
import { brushedTexture } from './textures'

export interface Spec {
  kind: ObjKind
  object: Object3D
  radius: number
  density: number
  heavy: number
  colliders: (s: number) => RAPIER.ColliderDesc[]
  ccd?: boolean
}

const hullPoints = (g: BufferGeometry, s = 1) => {
  const p = g.attributes.position.array as Float32Array
  const out = new Float32Array(p.length)
  for (let i = 0; i < p.length; i++) out[i] = p[i] * s
  return out
}

/**
 * Creates the experimental objects that live in the lab: metal spheres, cubes,
 * polyhedra and small mechanical assemblies. Geometry and materials are shared;
 * every object is a real Rapier rigid body that can be scaled (its colliders
 * are rebuilt, so its mass follows its size).
 */
export class ObjectFactory {
  readonly mats: Record<string, MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial>
  private readonly geos: Record<string, BufferGeometry>

  constructor(private physics: PhysicsEngine) {
    const brushed = brushedTexture(5)
    brushed.repeat.set(2, 1)
    this.mats = {
      chrome: new MeshStandardMaterial({ color: 0xe8ecf0, metalness: 1, roughness: 0.04 }),
      titanium: new MeshStandardMaterial({ color: 0x9da3aa, metalness: 1, roughness: 0.3, roughnessMap: brushed }),
      anodized: new MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.9, roughness: 0.34 }),
      brass: new MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.22 }),
      ceramic: new MeshPhysicalMaterial({ color: 0xdedbd5, metalness: 0, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
      graphite: new MeshStandardMaterial({ color: 0x23262b, metalness: 0.6, roughness: 0.5 }),
      polished: new MeshStandardMaterial({ color: 0x7c848e, metalness: 1, roughness: 0.12, flatShading: true }),
      glow: new MeshBasicMaterial({ color: new Color(0xa9dcff).multiplyScalar(3) }),
      warmGlow: new MeshBasicMaterial({ color: new Color(0xffc48a).multiplyScalar(2.6) }),
    }
    this.geos = {
      sphere: new SphereGeometry(1, 48, 32),
      box: new RoundedBoxGeometry(1, 1, 1, 3, 0.06),
      ico: new IcosahedronGeometry(1, 0),
      dode: new DodecahedronGeometry(1, 0),
      octa: new OctahedronGeometry(1, 0),
      torus: new TorusGeometry(1, 0.09, 12, 64),
      beam: new BoxGeometry(1, 1, 1),
      node: new SphereGeometry(1, 16, 12),
      strip: new BoxGeometry(1, 1, 1),
      cyl: new CylinderGeometry(1, 1, 1, 24),
    }
  }

  private mesh(geo: string, mat: string, s: number | Vector3) {
    const m = new Mesh(this.geos[geo], this.mats[mat])
    if (typeof s === 'number') m.scale.setScalar(s)
    else m.scale.copy(s)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  sphere(r: number, mat: string): Spec {
    const g = new Group()
    g.add(this.mesh('sphere', mat, r))
    return { kind: 'sphere', object: g, radius: r, density: 2.2, heavy: 1, colliders: (s) => [RAPIER.ColliderDesc.ball(r * s)], ccd: true }
  }

  cube(size: number, mat: string, seam = true): Spec {
    const g = new Group()
    g.add(this.mesh('box', mat, size))
    if (seam) {
      // a lit seam running round the cube
      const strip = this.mesh('strip', mat === 'ceramic' ? 'warmGlow' : 'glow', new Vector3(size * 1.004, size * 0.03, size * 1.004))
      strip.castShadow = false
      g.add(strip)
    }
    const h = size / 2
    return { kind: 'cube', object: g, radius: h * 1.5, density: 1.6, heavy: 1.1, colliders: (s) => [RAPIER.ColliderDesc.cuboid(h * s, h * s, h * s)], ccd: true }
  }

  poly(r: number, geo: 'ico' | 'dode' | 'octa', mat: string): Spec {
    const g = new Group()
    g.add(this.mesh(geo, mat, r))
    const base = this.geos[geo]
    return {
      kind: 'poly',
      object: g,
      radius: r,
      density: 1.9,
      heavy: 1.1,
      colliders: (s) => [RAPIER.ColliderDesc.convexHull(hullPoints(base, r * s)) ?? RAPIER.ColliderDesc.ball(r * s * 0.85)],
      ccd: true,
    }
  }

  /** two crossed rings around a glowing bead */
  gyro(r: number): Spec {
    const g = new Group()
    const a = this.mesh('torus', 'titanium', r)
    const b = this.mesh('torus', 'titanium', r * 0.82)
    b.rotation.x = Math.PI / 2
    const c = this.mesh('torus', 'brass', r * 0.64)
    c.rotation.y = Math.PI / 2
    const bead = this.mesh('node', 'glow', r * 0.28)
    bead.castShadow = false
    g.add(a, b, c, bead)
    return { kind: 'mech', object: g, radius: r * 1.1, density: 1.2, heavy: 1, colliders: (s) => [RAPIER.ColliderDesc.ball(r * 1.05 * s)] }
  }

  /** a three-axis truss: beams with ball joints, compound collider */
  truss(r: number): Spec {
    const g = new Group()
    const t = r * 0.16
    const axes: [number, number, number][] = [[2 * r, t, t], [t, 2 * r, t], [t, t, 2 * r]]
    for (const [x, y, z] of axes) g.add(this.mesh('beam', 'anodized', new Vector3(x, y, z)))
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = this.mesh('node', 'chrome', r * 0.2)
      n.position.set(d[0] * r, d[1] * r, d[2] * r)
      g.add(n)
    }
    const core = this.mesh('node', 'glow', r * 0.22)
    core.castShadow = false
    g.add(core)
    return {
      kind: 'mech',
      object: g,
      radius: r * 1.1,
      density: 1.4,
      heavy: 1.2,
      colliders: (s) =>
        axes.map(([x, y, z]) => RAPIER.ColliderDesc.cuboid(Math.max(x, t * 2) * 0.5 * s, Math.max(y, t * 2) * 0.5 * s, Math.max(z, t * 2) * 0.5 * s)),
    }
  }

  /** a capsule-shaped canister with lit bands */
  canister(r: number): Spec {
    const g = new Group()
    const body = this.mesh('cyl', 'graphite', new Vector3(r, r * 2.6, r))
    g.add(body)
    for (const y of [-0.8, 0.8]) {
      const band = this.mesh('cyl', 'glow', new Vector3(r * 1.02, r * 0.08, r * 1.02))
      band.position.y = y * r
      band.castShadow = false
      g.add(band)
    }
    for (const y of [-1.3, 1.3]) {
      const cap = this.mesh('cyl', 'titanium', new Vector3(r * 1.06, r * 0.18, r * 1.06))
      cap.position.y = y * r
      g.add(cap)
    }
    return { kind: 'mech', object: g, radius: r * 1.5, density: 1.5, heavy: 1.1, colliders: (s) => [RAPIER.ColliderDesc.cylinder(1.4 * r * s, r * 1.06 * s)] }
  }

  spawn(spec: Spec, pos: Vector3, quat = new Quaternion(), groups = GROUPS.obj, gravityScale = 1) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(0.04)
      .setAngularDamping(0.12)
      .setCcdEnabled(!!spec.ccd)
    const body = this.physics.world.createRigidBody(desc)
    const make = (s: number) =>
      spec.colliders(s).map((c) =>
        c
          .setDensity(spec.density)
          .setFriction(0.55)
          .setRestitution(0.32)
          .setCollisionGroups(groups)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(25),
      )
    const descs = make(1)
    let first: RAPIER.Collider | null = null
    for (const d of descs) {
      const c = this.physics.world.createCollider(d, body)
      first ??= c
    }
    spec.object.position.copy(pos)
    spec.object.quaternion.copy(quat)
    const o = this.physics.register({
      kind: spec.kind,
      body,
      collider: first!,
      object: spec.object,
      radius: spec.radius,
      scale: 1,
      grabbable: true,
      heavy: spec.heavy,
      gravityScale,
      home: null,
    })
    o.setScale = (s: number) => {
      this.physics.replaceColliders(o, make(s))
      o.object.scale.setScalar(s)
      o.scale = s
    }
    return o
  }

  /** scatter the lab's experimental objects across the floor (deterministic layout) */
  populate(count: number, seed = 3) {
    const r = rng(seed)
    const out: PhysObj[] = []
    const placed: { x: number; z: number; r: number }[] = []
    const makers: (() => Spec)[] = [
      () => this.sphere(0.45 + r() * 0.35, ['chrome', 'titanium', 'anodized', 'chrome'][Math.floor(r() * 4)]),
      () => this.cube(0.8 + r() * 0.5, ['graphite', 'ceramic', 'anodized'][Math.floor(r() * 3)]),
      () => this.poly(0.55 + r() * 0.35, (['ico', 'dode', 'octa'] as const)[Math.floor(r() * 3)], r() > 0.5 ? 'polished' : 'brass'),
      () => this.gyro(0.55 + r() * 0.25),
      () => this.truss(0.6 + r() * 0.2),
      () => this.canister(0.32 + r() * 0.1),
      () => this.sphere(0.35 + r() * 0.2, 'brass'),
    ]
    const weights = [4, 4, 4, 1.5, 1.5, 1.5, 1]
    const total = weights.reduce((a, b) => a + b, 0)
    const pick = () => {
      let x = r() * total
      for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) <= 0) return makers[i]
      return makers[0]
    }

    // a little stack of cubes near the front left, waiting to be knocked over
    const stack: [number, number, number][] = [[-7.6, 0, -6.5], [-6.6, 0, -6.5], [-5.6, 0, -6.5], [-7.1, 1, -6.5], [-6.1, 1, -6.5], [-6.6, 2, -6.5]]
    for (const [x, layer, z] of stack) {
      if (out.length >= count) break
      const spec = this.cube(0.96, layer === 2 ? 'ceramic' : 'graphite')
      out.push(this.spawn(spec, new Vector3(x, ROOM.floor + 0.49 + layer * 0.98, z)))
      placed.push({ x, z, r: 0.8 })
    }

    let tries = 0
    while (out.length < count && tries++ < 4000) {
      const x = (r() * 2 - 1) * 15
      const z = -3.5 - r() * 27
      const spec = pick()()
      const rad = spec.radius
      const nearCore = Math.hypot(x - CORE_HOME.x, z - CORE_HOME.z) < 5.4 + rad
      const nearConsole = [[-15, -18], [15.5, -14], [-14, -34], [14, -36]].some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 2.4 + rad)
      const nearMonolith = Math.hypot(x + 15, z + 12) < 2.6 + rad
      const overlap = placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + rad + 0.25)
      if (nearCore || nearConsole || nearMonolith || overlap) continue
      const q = new Quaternion().setFromAxisAngle(new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), r() * Math.PI)
      out.push(this.spawn(spec, new Vector3(x, ROOM.floor + rad + 0.2 + r() * 0.8, z), q))
      placed.push({ x, z, r: rad })
    }
    return out
  }
}
