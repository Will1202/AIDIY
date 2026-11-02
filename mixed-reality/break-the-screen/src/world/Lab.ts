import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, HemisphereLight, PointLight, IcosahedronGeometry, InstancedMesh,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry,
  PlaneGeometry, Points, Quaternion, RingGeometry, Scene, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, SpotLight,
  TorusGeometry, Vector3, type WebGLRenderer, PMREMGenerator, type Texture, CircleGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { CORE_HOME, REVEAL_DEPTH, ROOM, rng } from '../core/config'
import { RAPIER, GROUPS, type PhysicsEngine } from '../physics/PhysicsEngine'
import { concreteTexture, labelTexture, roughnessTexture } from './textures'

export interface LabMaterials {
  concrete: MeshStandardMaterial
  darkMetal: MeshStandardMaterial
  trim: MeshStandardMaterial
  warm: MeshBasicMaterial
  cool: MeshBasicMaterial
}

/** emissive colours are HDR (values > 1) so bloom picks them up after tone mapping */
const hdr = (hex: number, k: number) => new Color(hex).multiplyScalar(k)

/**
 * THE DIMENSION LAB: a brutalist containment hall behind the screen, with a
 * monumental ring aperture in the back wall that opens onto deep space.
 * Layers of depth (frame → core → hall → ring → planet → stars) are what make
 * head-coupled parallax legible.
 */
export class Lab {
  readonly group = new Group()
  readonly mats: LabMaterials
  readonly spot: SpotLight
  readonly rim: DirectionalLight
  readonly hemi: HemisphereLight
  private ring!: Group
  private monoliths: { obj: Object3D; body: RAPIER.RigidBody; base: Vector3; spin: Vector3; phase: number }[] = []
  private beams: ShaderMaterial
  private lattice!: ShaderMaterial
  private planet!: Mesh
  private pedestalGlow!: MeshBasicMaterial
  private holo: Mesh[] = []

  constructor(
    scene: Scene,
    private physics: PhysicsEngine,
  ) {
    const concreteMap = concreteTexture(7)
    concreteMap.repeat.set(4, 2)
    const rough = roughnessTexture(11)
    this.mats = {
      concrete: new MeshStandardMaterial({ color: 0x2a2d31, map: concreteMap, roughness: 0.9, metalness: 0.0, bumpMap: concreteMap, bumpScale: 0.6 }),
      darkMetal: new MeshStandardMaterial({ color: 0x14171b, roughness: 0.42, metalness: 0.85, roughnessMap: rough }),
      trim: new MeshStandardMaterial({ color: 0x3b4048, roughness: 0.26, metalness: 1.0 }),
      warm: new MeshBasicMaterial({ color: hdr(0xffd6ad, 2.4) }),
      cool: new MeshBasicMaterial({ color: hdr(0xa9dcff, 3.2) }),
    }

    this.buildShell()
    this.buildPedestal()
    this.buildBackRing()
    this.buildSpace()
    this.buildMonoliths()
    this.buildLattice()
    this.beams = this.buildBeams()
    this.buildLabels()

    // key light: a single hard-ish top light over the core, the only shadow caster
    const spot = new SpotLight(0xfff0e0, 1500, 40, 0.52, 0.65, 2)
    spot.position.set(0, ROOM.ceil - 0.4, CORE_HOME.z + 2)
    spot.target.position.set(0, ROOM.floor, CORE_HOME.z)
    spot.castShadow = true
    spot.shadow.mapSize.set(2048, 2048)
    spot.shadow.camera.near = 3
    spot.shadow.camera.far = 30
    spot.shadow.bias = -0.0005
    spot.shadow.normalBias = 0.03
    spot.shadow.radius = 5
    this.spot = spot
    this.group.add(spot, spot.target)

    this.rim = new DirectionalLight(0x9cc6ff, 0.45)
    this.rim.position.set(-6, 30, -60)
    this.rim.target.position.set(0, -2, 0)
    this.group.add(this.rim, this.rim.target)

    this.hemi = new HemisphereLight(0x6a7a92, 0x101014, 1.1)
    this.group.add(this.hemi)
    // warm washes grazing the side walls, so the hall reads as architecture, not void
    for (const sx of [-1, 1]) {
      const wash = new PointLight(0xffc28e, 140, 34, 2)
      wash.position.set(sx * 14, 9, -22)
      this.group.add(wash)
    }

    scene.add(this.group)
  }

  /** a dim studio of strip lights, prefiltered into the environment map for metal reflections */
  static environment(renderer: WebGLRenderer): Texture {
    const env = new Scene()
    const room = new Mesh(new BoxGeometry(60, 30, 60), new MeshBasicMaterial({ color: 0x030405, side: BackSide }))
    env.add(room)
    const strip = (w: number, h: number, d: number, x: number, y: number, z: number, c: Color) => {
      const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color: c }))
      m.position.set(x, y, z)
      env.add(m)
    }
    for (const x of [-12, -4, 4, 12]) strip(1.2, 0.2, 50, x, 14.5, 0, hdr(0xffffff, 3.2))
    strip(0.3, 18, 30, -29, 0, 0, hdr(0xffd2a0, 1.4))
    strip(0.3, 18, 30, 29, 0, 0, hdr(0xffd2a0, 1.1))
    const disc = new Mesh(new CircleGeometry(9, 48), new MeshBasicMaterial({ color: hdr(0x9fd0ff, 2.2) }))
    disc.position.set(0, 4, -29.5)
    env.add(disc)
    strip(60, 0.4, 0.4, 0, -6, -29.5, hdr(0x6fa8ff, 0.8))
    const pmrem = new PMREMGenerator(renderer)
    const rt = pmrem.fromScene(env, 0.035)
    pmrem.dispose()
    env.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        ;(o.material as MeshBasicMaterial).dispose()
      }
    })
    return rt.texture
  }

  private fixed(desc: RAPIER.ColliderDesc) {
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.physics.world.createCollider(desc.setCollisionGroups(GROUPS.room), body)
    return body
  }

  private buildShell() {
    const R = ROOM
    const depth = -R.back
    const H = R.ceil - R.floor
    const g = this.group
    const m = this.mats

    // floor: dark polished slab with a machined grid that glows faintly near the core
    const floorMat = new MeshStandardMaterial({ color: 0x090a0c, roughness: 0.62, metalness: 0.35, roughnessMap: roughnessTexture(23), envMapIntensity: 0.3 })
    floorMat.roughnessMap!.repeat.set(10, 10)
    floorMat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec2 q = vWp.xz / 2.0;
            vec2 gw = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-4);
            float minor = 1.0 - min(min(gw.x, gw.y), 1.0);
            vec2 q2 = vWp.xz / 8.0;
            vec2 gw2 = abs(fract(q2 - 0.5) - 0.5) / max(fwidth(q2), 1e-4);
            float major = 1.0 - min(min(gw2.x, gw2.y), 1.0);
            float d = length(vWp.xz - vec2(${CORE_HOME.x.toFixed(2)}, ${CORE_HOME.z.toFixed(2)}));
            float fade = exp(-d * 0.06) + 0.12;
            totalEmissiveRadiance += vec3(0.42, 0.66, 1.0) * (minor * 0.05 + major * 0.16) * fade;
            diffuseColor.rgb *= 1.0 - major * 0.35;
          }`,
        )
    }
    const floorDepth = depth - REVEAL_DEPTH
    const floor = new Mesh(new PlaneGeometry(R.halfX * 2, floorDepth), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, R.floor, -REVEAL_DEPTH - floorDepth / 2)
    floor.receiveShadow = true
    g.add(floor)

    const sill = new Mesh(new BoxGeometry(R.halfX * 2, 3, 0.4), m.darkMetal)
    sill.position.set(0, R.floor - 1.5, -1.45)
    g.add(sill)
    const sillEdge = new Mesh(new BoxGeometry(R.halfX * 2, 0.025, 0.025), m.cool)
    sillEdge.position.set(0, R.floor + 0.01, -1.25)
    g.add(sillEdge)

    const ceil = new Mesh(new PlaneGeometry(R.halfX * 2, depth), m.concrete)
    ceil.rotation.x = Math.PI / 2
    ceil.position.set(0, R.ceil, R.back / 2)
    g.add(ceil)

    for (const sx of [-1, 1]) {
      const wall = new Mesh(new PlaneGeometry(depth, H), m.concrete)
      wall.rotation.y = -sx * Math.PI / 2
      wall.position.set(sx * R.halfX, (R.floor + R.ceil) / 2, R.back / 2)
      wall.receiveShadow = true
      g.add(wall)
    }

    // structural fins on the side walls, every 4 m; light slots between alternate pairs
    const finGeo = new BoxGeometry(1.1, H, 0.9)
    const fins = new InstancedMesh(finGeo, m.concrete, 24)
    const slotGeo = new BoxGeometry(0.08, H * 0.82, 0.22)
    const slots = new InstancedMesh(slotGeo, m.warm, 24)
    const M = new Matrix4()
    let fi = 0
    let si = 0
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 11; k++) {
        const z = -3 - k * 4
        M.makeTranslation(sx * (R.halfX - 0.55), (R.floor + R.ceil) / 2, z)
        fins.setMatrixAt(fi++, M)
        if (k % 2 === 1) {
          M.makeTranslation(sx * (R.halfX - 0.05), (R.floor + R.ceil) / 2, z - 2)
          slots.setMatrixAt(si++, M)
        }
      }
    }
    fins.count = fi
    slots.count = si
    fins.castShadow = fins.receiveShadow = true
    g.add(fins, slots)

    // ceiling: beams across, long linear lights along the hall
    const beamGeo = new BoxGeometry(R.halfX * 2, 0.9, 0.7)
    const beams = new InstancedMesh(beamGeo, m.concrete, 12)
    for (let k = 0; k < 12; k++) {
      M.makeTranslation(0, R.ceil - 0.45, -2 - k * 4)
      beams.setMatrixAt(k, M)
    }
    g.add(beams)
    const stripGeo = new BoxGeometry(0.22, 0.06, -R.back - 4)
    for (const x of [-12, -6, 6, 12]) {
      const s = new Mesh(stripGeo, m.cool)
      s.position.set(x, R.ceil - 0.93, R.back / 2)
      g.add(s)
    }

    // side gantries at mid height with railings
    const deckGeo = new BoxGeometry(2.4, 0.22, depth - 3)
    const railGeo = new BoxGeometry(0.06, 0.06, depth - 3)
    const postGeo = new BoxGeometry(0.06, 1.1, 0.06)
    for (const sx of [-1, 1]) {
      const deck = new Mesh(deckGeo, m.darkMetal)
      deck.position.set(sx * (R.halfX - 2.3), 5.4, R.back / 2 - 1.5)
      deck.castShadow = deck.receiveShadow = true
      g.add(deck)
      for (const y of [6.0, 6.5]) {
        const rail = new Mesh(railGeo, m.trim)
        rail.position.set(sx * (R.halfX - 3.45), y, R.back / 2 - 1.5)
        g.add(rail)
      }
      const posts = new InstancedMesh(postGeo, m.trim, 22)
      for (let k = 0; k < 22; k++) {
        M.makeTranslation(sx * (R.halfX - 3.45), 6.0, -3.5 - k * 1.95)
        posts.setMatrixAt(k, M)
      }
      g.add(posts)
      const edge = new Mesh(new BoxGeometry(0.04, 0.04, depth - 3), m.cool)
      edge.position.set(sx * (R.halfX - 3.5), 5.29, R.back / 2 - 1.5)
      g.add(edge)
      this.fixed(RAPIER.ColliderDesc.cuboid(1.2, 0.11, (depth - 3) / 2).setTranslation(sx * (R.halfX - 2.3), 5.4, R.back / 2 - 1.5))
    }

    // service pipes along the ceiling corners
    const pipeGeo = new CylinderGeometry(0.22, 0.22, depth, 12)
    pipeGeo.rotateX(Math.PI / 2)
    for (const [x, y] of [[-17.6, 11.6], [-16.9, 12.3], [17.6, 11.6], [16.9, 12.3]]) {
      const p = new Mesh(pipeGeo, m.trim)
      p.position.set(x, y, R.back / 2)
      g.add(p)
    }

    // floor stations: low consoles near the walls
    const consoleGeo = new RoundedBoxGeometry(2.2, 1.1, 1.2, 2, 0.08)
    for (const [x, z, ry] of [[-15, -18, 0.5], [15.5, -14, -0.4], [-14, -34, 0.2], [14, -36, -0.3]]) {
      const c = new Mesh(consoleGeo, m.darkMetal)
      c.position.set(x, R.floor + 0.55, z)
      c.rotation.y = ry
      c.castShadow = c.receiveShadow = true
      g.add(c)
      const screen = new Mesh(new PlaneGeometry(1.8, 0.5), m.cool)
      screen.position.set(0, 0.2, 0.61)
      c.add(screen)
      this.fixed(
        RAPIER.ColliderDesc.cuboid(1.1, 0.55, 0.6)
          .setTranslation(x, R.floor + 0.55, z)
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry)),
      )
    }
  }

  private buildPedestal() {
    const g = new Group()
    g.position.set(CORE_HOME.x, ROOM.floor, CORE_HOME.z)
    const m = this.mats
    const base = new Mesh(new CylinderGeometry(4.4, 4.7, 0.3, 64), m.darkMetal)
    base.position.y = 0.15
    const plinth = new Mesh(new CylinderGeometry(2.7, 3.0, 0.55, 64), m.trim)
    plinth.position.y = 0.3 + 0.275
    base.receiveShadow = plinth.receiveShadow = true
    base.castShadow = plinth.castShadow = true
    this.pedestalGlow = new MeshBasicMaterial({ color: hdr(0x9fd6ff, 3) })
    const ring = new Mesh(new TorusGeometry(3.55, 0.035, 8, 128), this.pedestalGlow)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.31
    const ring2 = new Mesh(new TorusGeometry(2.62, 0.02, 8, 128), this.pedestalGlow)
    ring2.rotation.x = Math.PI / 2
    ring2.position.y = 0.86
    g.add(base, plinth, ring, ring2)
    // containment clamps
    const clampGeo = new RoundedBoxGeometry(0.5, 1.6, 1.2, 2, 0.06)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4
      const c = new Mesh(clampGeo, m.darkMetal)
      c.position.set(Math.cos(a) * 4.0, 1.1, Math.sin(a) * 4.0)
      c.rotation.y = -a
      c.castShadow = true
      g.add(c)
      const led = new Mesh(new BoxGeometry(0.04, 1.0, 0.06), this.pedestalGlow)
      led.position.set(-0.26, 0, 0)
      c.add(led)
      this.fixed(
        RAPIER.ColliderDesc.cuboid(0.25, 0.8, 0.6)
          .setTranslation(CORE_HOME.x + Math.cos(a) * 4, ROOM.floor + 1.1, CORE_HOME.z + Math.sin(a) * 4)
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -a)),
      )
    }
    this.fixed(RAPIER.ColliderDesc.cylinder(0.15, 4.5).setTranslation(CORE_HOME.x, ROOM.floor + 0.15, CORE_HOME.z))
    this.fixed(RAPIER.ColliderDesc.cylinder(0.28, 2.85).setTranslation(CORE_HOME.x, ROOM.floor + 0.575, CORE_HOME.z))
    this.group.add(g)
  }

  private buildBackRing() {
    const R = ROOM
    const cy = 4.3
    const holeR = 9.6
    const W = R.halfX * 2
    const H = R.ceil - R.floor
    // back wall with a circular opening
    const shape = new Shape()
    shape.moveTo(-W / 2, R.floor)
    shape.lineTo(W / 2, R.floor)
    shape.lineTo(W / 2, R.ceil)
    shape.lineTo(-W / 2, R.ceil)
    shape.lineTo(-W / 2, R.floor)
    const hole = new Shape()
    hole.absarc(0, cy, holeR, 0, Math.PI * 2, true)
    shape.holes.push(hole)
    const wallGeo = new ShapeGeometry(shape, 64)
    // planar UVs for the concrete map
    const pos = wallGeo.attributes.position
    const uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 10
      uv[i * 2 + 1] = pos.getY(i) / 10
    }
    wallGeo.setAttribute('uv', new BufferAttribute(uv, 2))
    const wall = new Mesh(wallGeo, this.mats.concrete)
    wall.position.z = R.back
    wall.receiveShadow = true
    this.group.add(wall)
    void H

    // the ring: a heavy torus, segmented collar blocks with light slits, a thin icy inner line
    const ring = new Group()
    ring.position.set(0, cy, R.back + 0.6)
    const torus = new Mesh(new TorusGeometry(holeR + 0.55, 0.75, 24, 160), this.mats.trim)
    ring.add(torus)
    const inner = new Mesh(new TorusGeometry(holeR - 0.05, 0.05, 8, 200), this.mats.cool)
    ring.add(inner)
    const blockGeo = new RoundedBoxGeometry(1.4, 2.2, 2.4, 2, 0.08)
    const blocks = new InstancedMesh(blockGeo, this.mats.darkMetal, 40)
    const slitGeo = new BoxGeometry(0.12, 1.5, 0.06)
    const slits = new InstancedMesh(slitGeo, this.mats.cool, 40)
    const o = new Object3D()
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2
      o.position.set(Math.cos(a) * (holeR + 1.7), Math.sin(a) * (holeR + 1.7), 0.2)
      o.rotation.set(0, 0, a)
      o.updateMatrix()
      blocks.setMatrixAt(k, o.matrix)
      o.position.set(Math.cos(a) * (holeR + 1.7), Math.sin(a) * (holeR + 1.7), 1.42)
      o.updateMatrix()
      slits.setMatrixAt(k, o.matrix)
    }
    ring.add(blocks, slits)
    this.ring = ring
    this.group.add(ring)
  }

  private buildSpace() {
    // a cold banded giant beyond the ring, lit from the upper left, with a thin ring system
    const planetMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSun: { value: new Vector3(-0.7, 0.45, 0.55).normalize() } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSun; varying vec3 vN; varying vec3 vP; varying vec3 vW;
        float h(float n){ return fract(sin(n)*43758.5453); }
        float n3(vec3 x){ vec3 p=floor(x), f=fract(x); f=f*f*(3.-2.*f); float n=p.x+p.y*57.+113.*p.z;
          return mix(mix(mix(h(n),h(n+1.),f.x),mix(h(n+57.),h(n+58.),f.x),f.y),mix(mix(h(n+113.),h(n+114.),f.x),mix(h(n+170.),h(n+171.),f.x),f.y),f.z); }
        void main(){
          vec3 p = normalize(vP);
          float lat = p.y;
          float rot = uTime * 0.004;
          vec3 q = vec3(p.x*cos(rot)-p.z*sin(rot), p.y, p.x*sin(rot)+p.z*cos(rot));
          float turb = n3(q*6.0)*0.6 + n3(q*14.0)*0.3;
          float bands = sin(lat*22.0 + turb*2.2)*0.5+0.5;
          vec3 c1 = vec3(0.50,0.58,0.64), c2 = vec3(0.80,0.78,0.70), c3 = vec3(0.28,0.36,0.44);
          vec3 col = mix(c3, mix(c1, c2, bands), smoothstep(-0.9, 0.9, lat*0.4 + bands*0.6));
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          float ndl = dot(normalize((viewMatrix*vec4(uSun,0.)).xyz), N);
          float day = smoothstep(-0.08, 0.35, ndl);
          float fres = pow(1.0 - max(dot(N, normalize((viewMatrix*vec4(V,0.)).xyz)), 0.0), 3.0);
          vec3 lit = col * day * 0.2 + vec3(0.45,0.65,1.0) * fres * (0.1 + day) * 0.3;
          gl_FragColor = vec4(lit, 1.0);
        }`,
    })
    const planet = new Mesh(new SphereGeometry(26, 96, 64), planetMat)
    planet.position.set(30, 6, -430)
    planet.rotation.z = 0.32
    this.planet = planet
    this.group.add(planet)

    const ringMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {},
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `varying vec3 vP;
        void main(){ float r = length(vP.xy);
          float t = (r - 35.0) / 21.0;
          float b = 0.5 + 0.5*sin(t*90.0) * sin(t*23.0+1.3);
          float a = smoothstep(0.0,0.08,t)*smoothstep(1.0,0.86,t) * (0.25 + 0.5*b);
          gl_FragColor = vec4(vec3(0.82,0.80,0.74)*a*0.35, a*0.6); }`,
    })
    const rings = new Mesh(new RingGeometry(35, 56, 160, 1), ringMat)
    rings.rotation.x = -Math.PI / 2 + 0.22
    rings.rotation.y = 0.12
    planet.add(rings)

    const moon = new Mesh(new SphereGeometry(5, 32, 24), new MeshStandardMaterial({ color: 0x777b80, roughness: 1 }))
    moon.position.set(-30, 26, -330)
    this.group.add(moon)

    // stars: fixed-pixel points on a far shell, mostly behind the lab
    const N = 3200
    const r = rng(99)
    const pos = new Float32Array(N * 3)
    const mag = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1
      const th = r() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const v = new Vector3(s * Math.cos(th), u, -Math.abs(s * Math.sin(th)) - 0.25).normalize().multiplyScalar(900)
      pos.set([v.x, v.y, v.z], i * 3)
      mag[i] = Math.pow(r(), 6)
    }
    const sg = new BufferGeometry()
    sg.setAttribute('position', new BufferAttribute(pos, 3))
    sg.setAttribute('aMag', new BufferAttribute(mag, 1))
    const stars = new Points(
      sg,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uPx: { value: 1 } },
        vertexShader: /* glsl */ `attribute float aMag; uniform float uPx; varying float vM;
          void main(){ vM = aMag; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = (1.0 + aMag*2.6) * uPx; }`,
        fragmentShader: /* glsl */ `varying float vM; void main(){ vec2 p = gl_PointCoord*2.-1.; float d = dot(p,p);
          float a = exp(-d*3.5); gl_FragColor = vec4(vec3(0.85,0.92,1.0)*(0.35+vM*3.0)*a, a); }`,
      }),
    )
    stars.frustumCulled = false
    stars.userData.isStars = true
    this.group.add(stars)
  }

  private buildMonoliths() {
    const add = (obj: Object3D, collider: RAPIER.ColliderDesc, spin: Vector3) => {
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(obj.position.x, obj.position.y, obj.position.z),
      )
      this.physics.world.createCollider(collider.setCollisionGroups(GROUPS.room).setRestitution(0.4), body)
      obj.castShadow = true
      this.group.add(obj)
      this.monoliths.push({ obj, body, base: obj.position.clone(), spin, phase: Math.random() * 6 })
    }
    const edgeMat = new LineBasicMaterial({ color: hdr(0xa9dcff, 1.6), transparent: true, opacity: 0.8 })

    const octGeo = new OctahedronGeometry(2.6, 0)
    const oct = new Mesh(octGeo, this.mats.darkMetal)
    oct.add(new LineSegments(new EdgesGeometry(octGeo), edgeMat))
    oct.position.set(-12.5, 5.2, -33)
    add(oct, RAPIER.ColliderDesc.ball(1.9), new Vector3(0.05, 0.12, 0.03))

    const ringGeo = new TorusGeometry(2.6, 0.24, 20, 96)
    const ring = new Mesh(ringGeo, this.mats.trim)
    ring.position.set(12.5, 6.8, -25)
    add(ring, RAPIER.ColliderDesc.cylinder(0.25, 2.8), new Vector3(0.18, 0.07, 0.0))

    const slabs = new Group()
    for (let k = 0; k < 3; k++) {
      const s = new Mesh(new RoundedBoxGeometry(2.2, 0.32, 3.6, 2, 0.06), this.mats.darkMetal)
      s.position.y = k * 1.15
      s.rotation.y = k * 0.35
      s.castShadow = true
      const led = new Mesh(new BoxGeometry(2.0, 0.03, 0.05), this.mats.cool)
      led.position.set(0, 0, 1.81)
      s.add(led)
      slabs.add(s)
    }
    slabs.position.set(13.5, -0.2, -38)
    add(slabs, RAPIER.ColliderDesc.cuboid(1.5, 1.6, 1.9).setTranslation(0, 1.15, 0), new Vector3(0, 0.05, 0))

    const icoGeo = new IcosahedronGeometry(1.5, 0)
    const ico = new Mesh(icoGeo, this.mats.trim)
    ico.add(new LineSegments(new EdgesGeometry(icoGeo), edgeMat))
    ico.position.set(-15, 1.5, -12)
    add(ico, RAPIER.ColliderDesc.ball(1.25), new Vector3(0.1, 0.2, 0.06))
  }

  private buildLattice() {
    // a measurement lattice of tiny crosses filling the hall: the strongest single parallax cue
    const pts: number[] = []
    for (let x = -18; x <= 18; x += 3)
      for (let y = -3.5; y <= 12.5; y += 3)
        for (let z = -3; z >= -44; z -= 4) pts.push(x, y, z)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3))
    this.lattice = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uPx: { value: 1 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `uniform float uPx; varying float vF;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
          float d = -mv.z; vF = smoothstep(80.0, 20.0, d); gl_PointSize = clamp(170.0 / d, 2.0, 9.0) * uPx; }`,
      fragmentShader: /* glsl */ `uniform float uAlpha; varying float vF;
        void main(){ vec2 p = abs(gl_PointCoord*2.-1.);
          float w = 0.09; float c = max(step(p.x,w)*step(p.y,0.95), step(p.y,w)*step(p.x,0.95));
          gl_FragColor = vec4(vec3(0.62,0.82,1.0)*c*0.55*vF*uAlpha, 1.0); }`,
    })
    const lattice = new Points(geo, this.lattice)
    lattice.frustumCulled = false
    this.group.add(lattice)
  }

  private buildBeams() {
    // soft volumetric shafts from the ceiling (additive, fresnel-faded edges)
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uTime: { value: 0 }, uBoost: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz);
          vY = uv.y; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform float uBoost; varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
          float edge = pow(f, 2.2);
          float fall = smoothstep(0.0, 0.25, vY) * (0.35 + 0.65*vY);
          float flick = 0.92 + 0.08*sin(uTime*1.7 + vY*9.0);
          float a = edge * fall * flick * (0.055 + uBoost*0.08);
          gl_FragColor = vec4(vec3(1.0,0.93,0.84)*a, a); }`,
    })
    const h = ROOM.ceil - ROOM.floor
    const geo = new CylinderGeometry(0.9, 4.8, h, 48, 1, true)
    const main = new Mesh(geo, mat)
    main.position.set(CORE_HOME.x, ROOM.floor + h / 2, CORE_HOME.z)
    main.renderOrder = 2
    this.group.add(main)
    const sideGeo = new CylinderGeometry(0.5, 2.6, h, 32, 1, true)
    for (const [x, z] of [[-9, -20], [9, -31], [-5, -40]]) {
      const s = new Mesh(sideGeo, mat)
      s.position.set(x, ROOM.floor + h / 2, z)
      s.renderOrder = 2
      this.group.add(s)
    }
    return mat
  }

  private buildLabels() {
    const mk = (lines: string[], w: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
      const t = labelTexture(lines)
      const m = new Mesh(
        new PlaneGeometry(w, w / 4),
        new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: AdditiveBlending, color: hdr(0xffffff, 1.2) }),
      )
      m.position.set(x, y, z)
      m.rotation.set(rx, ry, 0)
      this.group.add(m)
      this.holo.push(m)
    }
    mk(['DIMENSIONAL APERTURE  Ψ-07', 'RING STABLE · FIELD 0.998 · SECTOR 7'], 9, -4.5, 15.6 - 3.4, ROOM.back + 0.3)
    mk(['CORE CONTAINMENT', 'CLASS-IV ENERGY SINGULARITY · DO NOT TOUCH'], 5.2, 4.6, ROOM.floor + 0.02, CORE_HOME.z + 4.6, 0, -Math.PI / 2)
    mk(['SECTOR 07', 'GRAVIMETRIC LAB · DECK B'], 6, -ROOM.halfX + 1.2, 9.6, -16, Math.PI / 2)
    mk(['OBSERVATION WINDOW', 'FIELD-LOCKED GLASS · 4.2 GPa'], 6, ROOM.halfX - 1.2, 9.6, -12, -Math.PI / 2)
  }

  update(t: number, dt: number, coreEnergy: number) {
    this.ring.rotation.z = t * 0.02
    this.beams.uniforms.uTime.value = t
    this.beams.uniforms.uBoost.value = coreEnergy
    ;(this.planet.material as ShaderMaterial).uniforms.uTime.value = t
    this.planet.rotation.y = t * 0.003
    this.pedestalGlow.color.copy(hdr(0x9fd6ff, 2.2 + Math.sin(t * 2.1) * 0.6 + coreEnergy * 3))
    const q = new Quaternion()
    for (const m of this.monoliths) {
      const y = m.base.y + Math.sin(t * 0.45 + m.phase) * 0.35
      m.obj.position.set(m.base.x, y, m.base.z)
      m.obj.rotation.x += m.spin.x * dt
      m.obj.rotation.y += m.spin.y * dt
      m.obj.rotation.z += m.spin.z * dt
      q.setFromEuler(m.obj.rotation)
      m.body.setNextKinematicTranslation({ x: m.base.x, y, z: m.base.z })
      m.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    }
    for (const h of this.holo) {
      const mat = h.material as MeshBasicMaterial
      mat.opacity = 0.75 + Math.sin(t * 3 + h.position.x) * 0.08
    }
  }

  setPixelRatio(px: number) {
    this.lattice.uniforms.uPx.value = px
    this.group.traverse((o) => {
      if (o.userData.isStars) ((o as Points).material as ShaderMaterial).uniforms.uPx.value = px
    })
  }
}
