import {
  BoxGeometry, BufferGeometry, Color, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion,
  RectAreaLight, ShaderMaterial, Vector2, Vector3, Vector4, type Texture,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { framePose, linkMatrix, linkQuaternion, linkYaw, type PortalFrame } from './PortalMath'
import { CLIP_FRAG, CLIP_FRAG_PARS, CLIP_VERT, CLIP_VERT_PARS, NOISE } from '../render/shaderUtil'
import { patchStandard } from '../world/materials'

export type WorldId = 0 | 1
export const WORLD_NAMES = ['SECTOR 07 — THE LABORATORY', 'THE OTHER SIDE'] as const

export const OPENING_W = 2.6
export const OPENING_H = 4.2
const POST = 0.95
const LINTEL = 1.15
export const GATE_DEPTH = 0.9
export const GATE_OUTER_W = OPENING_W + POST * 2
export const GATE_OUTER_H = OPENING_H + LINTEL

const SURFACE_VERT = /* glsl */ `
uniform mat4 uPortalInv;
varying vec3 vLocal;
${CLIP_VERT_PARS}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vLocal = (uPortalInv * wp).xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  ${CLIP_VERT}
}
`

const SURFACE_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec2 uTarget;
uniform vec4 uRect;
uniform float uOpen;
uniform float uEnergy;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform vec2 uSize;
varying vec3 vLocal;
${CLIP_FRAG_PARS}
${NOISE}
void main() {
  ${CLIP_FRAG}
  vec2 suv = gl_FragCoord.xy / uTarget;
  vec2 p = vLocal.xy;
  float dEdge = max(0.0, min(uSize.x * 0.5 - abs(p.x), min(p.y, uSize.y - p.y)));
  vec2 c = vec2(p.x / (uSize.x * 0.5), (p.y - uSize.y * 0.5) / (uSize.y * 0.5));
  float r = length(c);
  float ang = atan(c.y, c.x);
  float n = fbm(vec2(ang * 2.0 + uTime * 0.15, r * 3.0 - uTime * 0.7));
  float aperture = uOpen * 1.62;
  float rr = r + (n - 0.5) * 0.3 * (1.0 - uOpen * 0.6);
  float inside = 1.0 - smoothstep(aperture - 0.06, aperture, rr);

  // closed membrane: slow ionised swirl
  float swirl = fbm(vec2(ang * 3.0 - uTime * 0.25 + r * 2.0, r * 5.0 - uTime * 0.9));
  vec3 mem = uColor * (0.05 + 1.4 * pow(swirl, 3.0)) + uColor * 0.5 * exp(-dEdge * 2.5);

  // view through the portal, with a faint heat-shimmer only at the very rim
  float rim = exp(-dEdge * 10.0);
  vec2 wob = vec2(vnoise(p * 6.0 + vec2(uTime * 1.3, 0.0)), vnoise(p * 6.0 - vec2(0.0, uTime * 1.1))) - 0.5;
  vec2 uv = clamp(suv + wob * rim * 0.008, uRect.xy, uRect.zw);
  vec3 view = uHasTex > 0.5 ? texture2D(uTex, uv).rgb : uDeep * (0.6 + 0.4 * swirl) + uColor * 0.25 * swirl;

  vec3 col = mix(mem * uEnergy, view, inside);
  float ring = exp(-abs(rr - aperture) * 22.0) * step(0.0005, uOpen) * (1.0 - smoothstep(0.85, 1.0, uOpen));
  col += uColor * ring * 4.0 * uEnergy;
  col += uColor * rim * 1.2 * uEnergy;
  gl_FragColor = vec4(col, 1.0);
}
`

export class Portal implements PortalFrame {
  readonly matrix = new Matrix4()
  readonly inverse = new Matrix4()
  readonly quaternion = new Quaternion()
  readonly width = OPENING_W
  readonly height = OPENING_H
  readonly position = new Vector3()
  readonly forward = new Vector3(0, 0, 1)
  yaw = 0
  world: WorldId = 0
  partner!: Portal
  /** this → partner */
  readonly link = new Matrix4()
  readonly linkQuat = new Quaternion()
  linkYaw = 0

  /** iris aperture 0..1 (visual) */
  open = 0
  /** frame / rim energy 0..1 */
  energy = 0
  readonly color: Color
  readonly group = new Group()
  readonly frame: Mesh
  readonly surface: Mesh
  readonly surfaceMat: ShaderMaterial
  readonly frameMat: MeshStandardMaterial
  readonly glowMat: MeshStandardMaterial
  readonly lights: RectAreaLight[] = []
  /** world-space glow colour cast by the area lights (set from the partner world's mood) */
  readonly lightColor = new Color()
  lightIntensity = 0
  /** Rapier body carrying the frame colliders */
  bodyHandle = -1

  constructor(readonly id: number, readonly label: string, color: Color, metalTex: Texture) {
    this.color = color.clone()
    this.group.name = `portal-${label}`
    this.group.matrixAutoUpdate = false

    this.frameMat = patchStandard(new MeshStandardMaterial({ color: 0x5d636c, metalness: 0.65, roughness: 0.6 }), {
      tri: { map: metalTex, scale: 1 / 2, space: 'object' },
    })
    this.glowMat = new MeshStandardMaterial({ color: 0x000000, emissive: this.color, emissiveIntensity: 0, roughness: 0.4 })
    this.frame = new Mesh(gateGeometry(), this.frameMat)
    this.frame.castShadow = true
    this.frame.receiveShadow = true
    const glow = new Mesh(glowGeometry(), this.glowMat)
    this.frame.add(glow)
    this.group.add(this.frame)

    this.surfaceMat = new ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      side: DoubleSide,
      clipping: true,
      uniforms: {
        uTex: { value: null },
        uHasTex: { value: 0 },
        uTarget: { value: new Vector2(1, 1) },
        uRect: { value: new Vector4(0, 0, 1, 1) },
        uOpen: { value: 0 },
        uEnergy: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: this.color.clone().multiplyScalar(1.6) },
        uDeep: { value: new Color(0.02, 0.025, 0.03) },
        uSize: { value: new Vector2(OPENING_W, OPENING_H) },
        uPortalInv: { value: this.inverse },
      },
    })
    const sg = new BoxGeometry(OPENING_W + 0.002, OPENING_H + 0.002, 1)
    sg.translate(0, OPENING_H / 2, -0.5)
    this.surface = new Mesh(sg, this.surfaceMat)
    this.surface.frustumCulled = false
    this.surface.matrixAutoUpdate = false
    this.surface.renderOrder = -1
    this.group.add(this.surface)

    // two-sided glow: one area light on each face of the opening
    for (const side of [1, -1]) {
      const l = new RectAreaLight(0xffffff, 0, OPENING_W, OPENING_H)
      l.position.set(0, OPENING_H / 2, side * 0.05)
      l.lookAt(0, OPENING_H / 2, side * 10)
      this.group.add(l)
      this.lights.push(l)
    }
  }

  setPose(world: WorldId, position: Vector3, yaw: number) {
    this.world = world
    this.position.copy(position)
    this.yaw = yaw
    framePose(this, position, yaw)
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion)
    this.group.matrix.copy(this.matrix)
    this.group.matrixWorldNeedsUpdate = true
    this.group.updateMatrixWorld(true)
  }

  /** call after either portal of the pair moved */
  updateLink() {
    linkMatrix(this, this.partner, this.link)
    linkQuaternion(this, this.partner, this.linkQuat)
    this.linkYaw = linkYaw(this.yaw, this.partner.yaw)
  }

  /**
   * Thicken the surface into a slab that extends *away* from the given camera
   * when it is close, so the near plane can never slice through the window.
   */
  fitSurfaceTo(camPos: Vector3) {
    const l = _v.copy(camPos).applyMatrix4(this.inverse)
    const near = Math.abs(l.z) < 0.7 && Math.abs(l.x) < OPENING_W * 0.5 + 0.4 && l.y > -0.4 && l.y < OPENING_H + 0.4
    const t = near ? 0.42 : 0.0015
    const side = l.z >= 0 ? 1 : -1
    // geometry spans z ∈ [-1, 0] before scaling → [−side·t, 0] after
    this.surface.matrix.makeScale(1, 1, t * side)
    this.surface.matrixWorldNeedsUpdate = true
    this.surface.updateMatrixWorld(true)
  }

  syncVisuals(time: number) {
    const u = this.surfaceMat.uniforms
    u.uOpen.value = this.open
    u.uEnergy.value = this.energy
    u.uTime.value = time
    this.glowMat.emissiveIntensity = 0.3 + this.energy * 3.2
    const li = this.lightIntensity * Math.min(1, this.open * 1.4) + this.energy * 0.6
    for (const l of this.lights) {
      l.color.copy(this.lightColor)
      // never toggle visibility: a changing light count recompiles every lit material
      l.intensity = li
    }
  }
}

const _v = new Vector3()

let _gate: BufferGeometry | null = null
let _glow: BufferGeometry | null = null

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/** monolithic slab with a rectangular opening, chamfer rails and engraved grooves */
function gateGeometry() {
  if (_gate) return _gate
  const hw = OPENING_W / 2
  const parts: BufferGeometry[] = [
    box(POST, GATE_OUTER_H, GATE_DEPTH, -hw - POST / 2, GATE_OUTER_H / 2, 0),
    box(POST, GATE_OUTER_H, GATE_DEPTH, hw + POST / 2, GATE_OUTER_H / 2, 0),
    box(OPENING_W, LINTEL, GATE_DEPTH, 0, OPENING_H + LINTEL / 2, 0),
    // crown block, slightly proud — gives the monolith a heavier silhouette
    box(GATE_OUTER_W + 0.3, 0.32, GATE_DEPTH + 0.24, 0, GATE_OUTER_H + 0.16, 0),
    // feet
    box(POST + 0.36, 0.22, GATE_DEPTH + 0.36, -hw - POST / 2, 0.11, 0),
    box(POST + 0.36, 0.22, GATE_DEPTH + 0.36, hw + POST / 2, 0.11, 0),
  ]
  // vertical ribs on both faces of each post
  for (const s of [-1, 1]) {
    for (const f of [-1, 1]) {
      for (const k of [0.22, 0.5, 0.78]) {
        parts.push(box(0.05, GATE_OUTER_H - 1.6, 0.05, s * (hw + POST * k), (GATE_OUTER_H - 1.6) / 2 + 0.5, f * (GATE_DEPTH / 2 + 0.02)))
      }
    }
  }
  _gate = mergeGeometries(parts.map((g) => g.toNonIndexed()))
  return _gate
}

/** thin emissive strips lining the opening on both faces + a status bar on the lintel */
function glowGeometry() {
  if (_glow) return _glow
  const hw = OPENING_W / 2
  const t = 0.045
  const parts: BufferGeometry[] = []
  for (const f of [-1, 1]) {
    const z = f * (GATE_DEPTH / 2 + 0.006)
    parts.push(box(t, OPENING_H, 0.012, -hw - t / 2 - 0.02, OPENING_H / 2, z))
    parts.push(box(t, OPENING_H, 0.012, hw + t / 2 + 0.02, OPENING_H / 2, z))
    parts.push(box(OPENING_W + t * 2 + 0.04, t, 0.012, 0, OPENING_H + t / 2 + 0.02, z))
    parts.push(box(1.4, 0.06, 0.012, 0, OPENING_H + LINTEL * 0.55, z))
    for (let i = 0; i < 5; i++) parts.push(box(0.06, 0.06, 0.012, -0.36 + i * 0.18, OPENING_H + LINTEL * 0.3, z))
  }
  // inner jamb strips (visible when looking through at an angle)
  parts.push(box(0.012, OPENING_H, GATE_DEPTH * 0.6, -hw - 0.004, OPENING_H / 2, 0))
  parts.push(box(0.012, OPENING_H, GATE_DEPTH * 0.6, hw + 0.004, OPENING_H / 2, 0))
  _glow = mergeGeometries(parts.map((g) => g.toNonIndexed()))
  return _glow
}
