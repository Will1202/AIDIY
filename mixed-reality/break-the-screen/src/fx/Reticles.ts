import { AdditiveBlending, Color, DoubleSide, Group, Mesh, PlaneGeometry, RingGeometry, ShaderMaterial, Vector3 } from 'three'
import type { Grip } from '../interaction/SpatialInteraction'

interface R {
  ring: Mesh
  mat: ShaderMaterial
  tether: Mesh
  tmat: ShaderMaterial
  seen: boolean
}

const RING_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`
const RING_FS = /* glsl */ `uniform float uState; uniform float uCharge; uniform float uTime; uniform vec3 uColor; varying vec2 vP;
  void main(){
    float r = length(vP); float a = atan(vP.y, vP.x);
    float ring = smoothstep(0.82, 0.86, r) * smoothstep(1.0, 0.96, r);
    float ticks = step(0.5, fract(a / 6.28318 * 4.0 + uTime * 0.15)) * 0.6 + 0.4;
    float inner = smoothstep(0.12, 0.08, r) * (0.6 + uState * 0.4);
    float charge = smoothstep(0.58, 0.62, r) * smoothstep(0.74, 0.7, r) * step(fract(-a / 6.28318 + 0.25), uCharge);
    float alpha = ring * ticks * (0.55 + uState * 0.45) + inner + charge * 1.2;
    gl_FragColor = vec4(uColor * alpha * 2.2, alpha);
  }`

/**
 * In-world pointer reticles: a ring that sits at the depth of whatever the
 * pointer aims at (so it parallaxes with the scene), an open-palm charge arc,
 * and a tether from the point the hand "touches" on the screen to the object it holds.
 */
export class Reticles {
  readonly group = new Group()
  private map = new Map<string, R>()
  private readonly geo = new RingGeometry(0, 1, 64, 1)
  private readonly plane = new PlaneGeometry(1, 1)

  private make(): R {
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { uState: { value: 0 }, uCharge: { value: 0 }, uTime: { value: 0 }, uColor: { value: new Color(0.7, 0.88, 1) } },
      vertexShader: RING_VS,
      fragmentShader: RING_FS,
    })
    const ring = new Mesh(this.geo, mat)
    ring.renderOrder = 50
    const tmat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uTime: { value: 0 }, uA: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform float uA; varying vec2 vUv;
        void main(){ float core = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 3.0);
          float flow = 0.55 + 0.45 * sin(vUv.y * 40.0 - uTime * 14.0);
          float a = core * flow * uA; gl_FragColor = vec4(vec3(0.6,0.86,1.0)*a*2.5, a); }`,
    })
    const tether = new Mesh(this.plane, tmat)
    tether.renderOrder = 49
    this.group.add(ring, tether)
    return { ring, mat, tether, tmat, seen: true }
  }

  update(grips: Iterable<Grip>, eye: Vector3, time: number, visible: boolean) {
    for (const r of this.map.values()) r.seen = false
    for (const g of grips) {
      let r = this.map.get(g.id)
      if (!r) {
        r = this.make()
        this.map.set(g.id, r)
      }
      r.seen = true
      const show = visible && g.pointer.present
      r.ring.visible = show
      r.tether.visible = show && !!g.held
      if (!show) continue
      const st = g.held ? 1 : g.hover ? 0.6 : 0.15
      r.mat.uniforms.uState.value += (st - r.mat.uniforms.uState.value) * 0.2
      r.mat.uniforms.uCharge.value = g.pointer.charge
      r.mat.uniforms.uTime.value = time
      const warm = g.pointer.kind === 'demo'
      r.mat.uniforms.uColor.value.setRGB(warm ? 1.0 : 0.7, warm ? 0.86 : 0.88, warm ? 0.7 : 1.0)
      const p = g.aim
      r.ring.position.copy(p)
      const d = eye.distanceTo(p)
      const size = d * (g.held ? 0.022 : g.hover ? 0.03 : 0.02) * (g.held && g.held.radius ? 1 + g.held.radius * g.held.scale * 0.08 : 1)
      r.ring.scale.setScalar(size)
      if (g.held) {
        // tether: from the touch point on the screen plane to the held object, billboarded
        const o = g.ray.origin
        const dir = g.ray.direction
        const t = -o.z / Math.min(-1e-3, dir.z)
        const a = o.clone().addScaledVector(dir, t)
        const b = g.held.object.position
        const mid = a.clone().add(b).multiplyScalar(0.5)
        const len = a.distanceTo(b)
        r.tether.position.copy(mid)
        const up = b.clone().sub(a).normalize()
        const view = eye.clone().sub(mid).normalize()
        const side = new Vector3().crossVectors(up, view).normalize()
        const fwd = new Vector3().crossVectors(side, up)
        r.tether.matrixAutoUpdate = false
        r.tether.matrix.makeBasis(side.multiplyScalar(0.07 + d * 0.0015), up.multiplyScalar(len), fwd)
        r.tether.matrix.setPosition(mid)
        r.tmat.uniforms.uTime.value = time
        r.tmat.uniforms.uA.value = 0.6
      }
    }
    for (const [id, r] of this.map) {
      if (!r.seen) {
        r.ring.removeFromParent()
        r.tether.removeFromParent()
        r.mat.dispose()
        r.tmat.dispose()
        this.map.delete(id)
      }
    }
  }
}
