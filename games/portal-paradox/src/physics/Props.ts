import {
  BufferGeometry, CanvasTexture, Color, CylinderGeometry, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh,
  Material, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry, Plane, Quaternion,
  ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3, type Scene,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { RAPIER, G, GROUPS, groups, type PhysicsWorld } from './PhysicsWorld'
import { mapVector, nearOpening, segmentCrossing } from '../portal/PortalMath'
import type { Portal, WorldId } from '../portal/Portal'
import { patchStandard } from '../world/materials'
import { rng } from '../world/textures'
import { CLIP_FRAG, CLIP_FRAG_PARS, CLIP_VERT, CLIP_VERT_PARS } from '../render/shaderUtil'

export type PropKind = 'cube' | 'sphere' | 'ceramic' | 'glass' | 'shard' | 'canister'

export interface Prop {
  id: number
  kind: PropKind
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  mesh: Mesh
  clone: Mesh
  plane: Plane
  clonePlane: Plane
  radius: number
  world: WorldId
  readonly prevP: Vector3
  readonly prevQ: Quaternion
  readonly currP: Vector3
  readonly currQ: Quaternion
  readonly renderP: Vector3
  readonly renderQ: Quaternion
  readonly spawnP: Vector3
  readonly spawnQ: Quaternion
  spawnWorld: WorldId
  teleports: number
  held: boolean
  /** seconds since last portal crossing (for effects) */
  sinceCross: number
}

const KEEP_ALL = () => new Plane(new Vector3(0, 0, 0), 1)

function cubeTexture() {
  const s = 512
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = '#6d747d'
  g.fillRect(0, 0, s, s)
  const r = rng(4)
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`
    g.fillRect(0, r() * s, s, 1)
  }
  g.strokeStyle = 'rgba(10,12,14,0.85)'
  g.lineWidth = 6
  g.strokeRect(46, 46, s - 92, s - 92)
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(s / 2, 46); g.lineTo(s / 2, 150)
  g.moveTo(s / 2, s - 46); g.lineTo(s / 2, s - 150)
  g.moveTo(46, s / 2); g.lineTo(150, s / 2)
  g.moveTo(s - 46, s / 2); g.lineTo(s - 150, s / 2)
  g.stroke()
  g.fillStyle = 'rgba(12,14,16,0.9)'
  g.font = '700 34px "PP Mono", ui-monospace, monospace'
  g.fillText('MS-07', 72, 104)
  g.font = '500 20px "PP Mono", ui-monospace, monospace'
  g.fillText('MASS SAMPLE / 18 KG', 72, s - 72)
  // indicator slot (also used as emissive map: everything else is black there)
  g.fillStyle = '#0d0f12'
  g.fillRect(s / 2 - 70, s / 2 - 12, 140, 24)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const e = document.createElement('canvas')
  e.width = e.height = s
  const eg = e.getContext('2d')!
  eg.fillStyle = '#000'
  eg.fillRect(0, 0, s, s)
  eg.fillStyle = '#9fe9ff'
  eg.fillRect(s / 2 - 64, s / 2 - 7, 128, 14)
  const em = new CanvasTexture(e)
  em.colorSpace = SRGBColorSpace
  return { map: tex, emissive: em }
}

/**
 * Every dynamic object in both worlds. Physics runs at a fixed 60 Hz; the
 * rendered pose is interpolated between the last two steps, so motion is
 * smooth at 120/144 Hz and identical at any refresh rate.
 */
export class PropSystem {
  readonly props: Prop[] = []
  private readonly byCollider = new Map<number, Prop>()
  private cubeTex = cubeTexture()
  private readonly blobs: InstancedMesh[]
  private readonly blobAlpha: InstancedBufferAttribute[]
  /** gravity direction of the lab's field (+1 normal, -1 inverted); the Other Side keeps its own */
  labGravity = 1
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  constructor(private readonly phys: PhysicsWorld, private readonly scenes: Scene[]) {
    this.blobs = []
    this.blobAlpha = []
    for (const s of scenes) {
      const max = 128
      const alpha = new InstancedBufferAttribute(new Float32Array(max), 1)
      const g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
      g.setAttribute('aAlpha', alpha)
      const m = new InstancedMesh(g, new ShaderMaterial({
        transparent: true, depthWrite: false, clipping: true, polygonOffset: true, polygonOffsetFactor: -4,
        vertexShader: /* glsl */ `
          attribute float aAlpha; varying float vA; varying vec2 vUv;
          ${CLIP_VERT_PARS}
          void main() { vA = aAlpha; vUv = uv; vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; ${CLIP_VERT} }`,
        fragmentShader: /* glsl */ `
          varying float vA; varying vec2 vUv;
          ${CLIP_FRAG_PARS}
          void main() { ${CLIP_FRAG} float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, vA * pow(max(0.0, 1.0 - d), 1.6)); }`,
      }), max)
      m.count = 0
      m.frustumCulled = false
      m.renderOrder = 1
      s.add(m)
      this.blobs.push(m)
      this.blobAlpha.push(alpha)
    }
  }

  private material(kind: PropKind, seed: number): Material {
    switch (kind) {
      case 'cube': {
        const m = new MeshStandardMaterial({ map: this.cubeTex.map, metalness: 0.85, roughness: 0.38, emissive: new Color(0.6, 0.9, 1.0), emissiveMap: this.cubeTex.emissive, emissiveIntensity: 3 })
        return patchStandard(m, { sunMask: true })
      }
      case 'sphere':
        return patchStandard(new MeshStandardMaterial({ color: 0xf2f4f7, metalness: 1, roughness: 0.06 }), { sunMask: true })
      case 'ceramic':
        return patchStandard(new MeshPhysicalMaterial({ color: 0xe9e6e1, metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }), { sunMask: true })
      case 'glass':
      case 'shard': {
        const hue = (seed * 0.137) % 1
        return patchStandard(new MeshPhysicalMaterial({
          color: new Color().setHSL(0.52 + hue * 0.12, 0.35, 0.72), metalness: 0, roughness: 0.04, transparent: true, opacity: kind === 'glass' ? 0.36 : 0.5,
          clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.9, iridescenceIOR: 1.6, envMapIntensity: 2.2, side: 0,
          emissive: new Color().setHSL(0.55 + hue * 0.1, 0.8, 0.5), emissiveIntensity: 0.08, specularIntensity: 1,
        }), { sunMask: true })
      }
      case 'canister':
        return patchStandard(new MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.9, roughness: 0.3, emissive: new Color(0.9, 0.95, 1.0), emissiveIntensity: 0 }), { sunMask: true })
    }
  }

  spawn(kind: PropKind, world: WorldId, pos: Vector3, quat = new Quaternion(), opts: { size?: number; seed?: number } = {}) {
    const id = this.props.length
    const seed = opts.seed ?? id
    let geo: BufferGeometry
    let desc: RAPIER.ColliderDesc
    let radius: number
    let density = 1
    let restitution = 0.25
    let friction = 0.6
    switch (kind) {
      case 'cube': {
        const s = opts.size ?? 0.7
        geo = new RoundedBoxGeometry(s, s, s, 3, s * 0.06)
        desc = RAPIER.ColliderDesc.roundCuboid(s / 2 - 0.03, s / 2 - 0.03, s / 2 - 0.03, 0.03)
        radius = s * 0.87
        density = 2.6
        restitution = 0.18
        break
      }
      case 'sphere':
      case 'ceramic': {
        const r = opts.size ?? 0.34
        geo = new SphereGeometry(r, 40, 24)
        desc = RAPIER.ColliderDesc.ball(r)
        radius = r
        density = kind === 'sphere' ? 3 : 1.5
        restitution = kind === 'sphere' ? 0.42 : 0.35
        friction = 0.4
        break
      }
      case 'glass': {
        const r = opts.size ?? 0.45
        geo = seed % 2 ? new IcosahedronGeometry(r, 0) : new OctahedronGeometry(r, 0)
        const pts = geo.attributes.position.array as Float32Array
        desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!
        radius = r
        density = 1.2
        restitution = 0.3
        break
      }
      case 'shard': {
        const r = rng(seed * 31 + 7)
        const s = opts.size ?? 0.26
        const pts: Vector3[] = []
        for (let i = 0; i < 9; i++) pts.push(new Vector3((r() - 0.5) * s, (r() - 0.5) * s * 2.2, (r() - 0.5) * s * 0.6))
        geo = new ConvexGeometry(pts)
        geo.computeVertexNormals()
        desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])))!
        radius = s * 1.2
        density = 1.4
        restitution = 0.2
        break
      }
      case 'canister': {
        const r = 0.28, h = 0.95
        geo = new CylinderGeometry(r, r, h, 28)
        desc = RAPIER.ColliderDesc.cylinder(h / 2, r)
        radius = Math.hypot(r, h / 2)
        density = 1.6
        restitution = 0.2
        break
      }
    }
    desc.setDensity(density).setRestitution(restitution).setFriction(friction).setCollisionGroups(GROUPS.prop)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(40)
    const body = this.phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.12).setCanSleep(true),
    )
    const collider = this.phys.world.createCollider(desc, body)
    const plane = KEEP_ALL()
    const clonePlane = KEEP_ALL()
    const mat = this.material(kind, seed)
    mat.clippingPlanes = [plane]
    mat.clipShadows = true
    const cmat = this.material(kind, seed)
    cmat.clippingPlanes = [clonePlane]
    cmat.clipShadows = true
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    const clone = new Mesh(geo, cmat)
    clone.castShadow = clone.receiveShadow = true
    clone.matrixAutoUpdate = false
    clone.visible = false
    this.scenes[world].add(mesh)
    this.scenes[world].add(clone)
    const p: Prop = {
      id, kind, body, collider, mesh, clone, plane, clonePlane, radius, world,
      prevP: pos.clone(), prevQ: quat.clone(), currP: pos.clone(), currQ: quat.clone(), renderP: pos.clone(), renderQ: quat.clone(),
      spawnP: pos.clone(), spawnQ: quat.clone(), spawnWorld: world, teleports: 0, held: false, sinceCross: 99,
    }
    this.props.push(p)
    this.byCollider.set(collider.handle, p)
    this.writeMesh(p)
    return p
  }

  byHandle(h: number) {
    return this.byCollider.get(h)
  }

  setWorld(p: Prop, w: WorldId) {
    if (p.world === w) return
    p.world = w
    this.scenes[w].add(p.mesh)
  }

  /** after each physics step: capture poses and teleport anything whose centre passed through an open portal */
  afterStep(portals: Portal[], dt: number, onCross?: (p: Prop, from: Portal) => void) {
    for (const p of this.props) {
      p.prevP.copy(p.currP)
      p.prevQ.copy(p.currQ)
      const t = p.body.translation()
      const r = p.body.rotation()
      p.currP.set(t.x, t.y, t.z)
      p.currQ.set(r.x, r.y, r.z, r.w)
      p.sinceCross += dt
      if (p.body.isSleeping()) continue
      for (const P of portals) {
        if (P.world !== p.world || P.open < 0.98) continue
        if (!segmentCrossing(P, p.prevP, p.currP, 0)) continue
        this.teleport(p, P)
        onCross?.(p, P)
        break
      }
    }
  }

  /** apply the link transform to the full rigid-body state (pose, momentum, spin) */
  teleport(p: Prop, P: Portal) {
    p.currP.applyMatrix4(P.link)
    p.currQ.premultiply(P.linkQuat).normalize()
    p.prevP.applyMatrix4(P.link)
    p.prevQ.premultiply(P.linkQuat).normalize()
    const lv = p.body.linvel(), av = p.body.angvel()
    const v = mapVector(P.link, _v.set(lv.x, lv.y, lv.z))
    const w = mapVector(P.link, _w.set(av.x, av.y, av.z))
    p.body.setTranslation({ x: p.currP.x, y: p.currP.y, z: p.currP.z }, true)
    p.body.setRotation({ x: p.currQ.x, y: p.currQ.y, z: p.currQ.z, w: p.currQ.w }, true)
    p.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
    p.body.setAngvel({ x: w.x, y: w.y, z: w.z }, true)
    this.setWorld(p, P.partner.world)
    // crossing into the other world means entering its gravity field
    p.body.setGravityScale(this.scaleFor(p), true)
    p.teleports++
    p.sinceCross = 0
  }

  /** interpolate render poses, slice objects straddling a portal and show their exit-side twin */
  updateVisuals(alpha: number, portals: Portal[], interpolate = true) {
    for (const p of this.props) {
      if (interpolate) {
        p.renderP.lerpVectors(p.prevP, p.currP, alpha)
        p.renderQ.slerpQuaternions(p.prevQ, p.currQ, alpha)
      }
      this.writeMesh(p)
      let straddle: Portal | null = null
      for (const P of portals) {
        if (P.world !== p.world || P.open < 0.02) continue
        if (nearOpening(P, p.renderP, p.radius, p.radius * 0.5)) { straddle = P; break }
      }
      if (!straddle) {
        p.plane.normal.set(0, 0, 0)
        p.plane.constant = 1
        p.clone.visible = false
        continue
      }
      const P = straddle, Q = P.partner
      const side = P.forward.dot(p.renderP) - P.forward.dot(P.position) >= 0 ? 1 : -1
      // keep the part still on this side of P …
      p.plane.normal.copy(P.forward).multiplyScalar(side)
      p.plane.constant = -p.plane.normal.dot(P.position)
      // … and show the part that has already come out of Q
      p.clonePlane.normal.copy(Q.forward).multiplyScalar(side)
      p.clonePlane.constant = -p.clonePlane.normal.dot(Q.position)
      if (p.clone.parent !== this.scenes[Q.world]) this.scenes[Q.world].add(p.clone)
      _m.compose(p.renderP, p.renderQ, _one).premultiply(P.link)
      p.clone.matrix.copy(_m)
      p.clone.matrixWorldNeedsUpdate = true
      p.clone.visible = true
    }
    this.updateBlobs()
  }

  private writeMesh(p: Prop) {
    p.mesh.matrix.compose(p.renderP, p.renderQ, _one)
    p.mesh.matrixWorldNeedsUpdate = true
  }

  /** soft contact shadows: cheap, but they are what makes objects sit on the floor */
  private updateBlobs() {
    const counts = [0, 0]
    const rp = this.phys.world
    const ray = this.ray
    for (const p of this.props) {
      const w = p.world
      ray.origin.x = p.renderP.x
      ray.origin.y = p.renderP.y
      ray.origin.z = p.renderP.z
      const hit = rp.castRay(ray, 6, true, undefined, STATIC_ONLY)
      if (!hit) continue
      const d = hit.timeOfImpact
      const h = Math.max(0, d - p.radius * 0.6)
      const a = 0.62 * Math.max(0, 1 - h / 3.5)
      if (a < 0.02) continue
      const i = counts[w]++
      if (i >= 128) continue
      const s = p.radius * (1.9 + h * 0.6)
      _o.position.set(p.renderP.x, p.renderP.y - d + 0.012, p.renderP.z)
      _o.scale.set(s, 1, s)
      _o.rotation.set(0, 0, 0)
      _o.updateMatrix()
      this.blobs[w].setMatrixAt(i, _o.matrix)
      this.blobAlpha[w].setX(i, a)
    }
    for (let w = 0; w < 2; w++) {
      this.blobs[w].count = Math.min(128, counts[w])
      this.blobs[w].instanceMatrix.needsUpdate = true
      this.blobAlpha[w].needsUpdate = true
    }
  }

  /** gravity scale a prop should have right now */
  scaleFor(p: Prop) {
    return p.held ? 0 : p.world === 0 ? this.labGravity : 1
  }

  applyGravity(labDir: number) {
    this.labGravity = labDir
    for (const p of this.props) {
      p.body.setGravityScale(this.scaleFor(p), true)
      if (p.world === 0) p.body.wakeUp()
    }
  }

  /** hard reset to the authored layout (used by X and before the showcase) */
  resetAll() {
    for (const p of this.props) {
      this.setWorld(p, p.spawnWorld)
      p.body.setTranslation({ x: p.spawnP.x, y: p.spawnP.y, z: p.spawnP.z }, false)
      p.body.setRotation({ x: p.spawnQ.x, y: p.spawnQ.y, z: p.spawnQ.z, w: p.spawnQ.w }, false)
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
      p.currP.copy(p.spawnP); p.prevP.copy(p.spawnP); p.renderP.copy(p.spawnP)
      p.currQ.copy(p.spawnQ); p.prevQ.copy(p.spawnQ); p.renderQ.copy(p.spawnQ)
      p.held = false
      p.collider.setCollisionGroups(GROUPS.prop)
      p.body.setGravityScale(this.scaleFor(p), false)
      p.body.sleep()
    }
    this.phys.world.propagateModifiedBodyPositionsToColliders()
  }

  /** recycle objects that fell into the void back to where they were authored */
  recycleFallen(voidY: number) {
    for (const p of this.props) {
      if ((p.currP.y > voidY && p.currP.y < 600) || p.held) continue
      this.setWorld(p, p.spawnWorld)
      p.body.setGravityScale(this.scaleFor(p), true)
      p.body.setTranslation({ x: p.spawnP.x, y: p.spawnP.y + 1.5, z: p.spawnP.z }, true)
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      p.currP.set(p.spawnP.x, p.spawnP.y + 1.5, p.spawnP.z)
      p.prevP.copy(p.currP)
    }
  }
}

const _v = new Vector3()
const _w = new Vector3()
const _one = new Vector3(1, 1, 1)
const _o = new Object3D()
const _m = new Matrix4()
const STATIC_ONLY = groups(0xffff, G.STATIC)
