import { BoxGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3 } from 'three'
import { HALF, WATER_LEVEL } from '../core/constants'
import { NOISE, WORLD_UNIFORMS } from '../render/glsl'
import { U } from '../render/uniforms'
import { clamp } from '../util/math'
import { pathLength, type StrokePoint } from '../util/path'
import { Rng } from '../util/rng'
import type { Heightfield } from './Heightfield'

/**
 * BRIDGE BRUSH → a bridge between the two ends of the stroke, but only where a bridge
 * makes sense: both ends on land, a river or a valley in between, nothing blocking the
 * span and banks not too different in height. The style follows the site:
 *   rope  – long spans over deep valleys (sagging plank walkway, rope rails, towers)
 *   arch  – short river crossings (humped stone bridge with a vault)
 *   wood  – everything else (planked trestle with posts, rails and legs)
 * The deck is an analytic curve, so the character walks exactly on what is drawn.
 */

export type BridgeStyle = 'wood' | 'arch' | 'rope'

export interface BridgeSpec {
  ax: number
  az: number
  bx: number
  bz: number
  span: number
  dx: number
  dz: number
  halfW: number
  ya: number
  yb: number
  /** hump (+) or sag (−) at mid-span, object units */
  curve: number
  style: BridgeStyle
  crossesWater: boolean
}

export type BridgePlan = { ok: true; spec: BridgeSpec } | { ok: false; message: string; sub: string }

export function deckY(s: BridgeSpec, t: number) {
  return s.ya + (s.yb - s.ya) * t + s.curve * Math.sin(Math.PI * clamp(t))
}

export function planBridge(hf: Heightfield, pts: StrokePoint[]): BridgePlan {
  if (pts.length < 2 || pathLength(pts) < 5) return { ok: false, message: '笔画太短', sub: 'Too short — draw a line from one bank to the other' }
  const lim = HALF - 3
  let ax = clamp(pts[0].x, -lim, lim)
  let az = clamp(pts[0].z, -lim, lim)
  let bx = clamp(pts[pts.length - 1].x, -lim, lim)
  let bz = clamp(pts[pts.length - 1].z, -lim, lim)
  let span = Math.hypot(bx - ax, bz - az)
  if (span < 5) return { ok: false, message: '两端太近', sub: 'The ends are too close — span a river or a valley' }
  let dx = (bx - ax) / span
  let dz = (bz - az) / span
  // slide ends that landed in the water back onto the bank
  const land = (x: number, z: number) => hf.waterDepth(x, z) < 0.05
  for (let k = 0; k < 20 && !land(ax, az); k++) {
    ax -= dx * 0.5
    az -= dz * 0.5
  }
  for (let k = 0; k < 20 && !land(bx, bz); k++) {
    bx += dx * 0.5
    bz += dz * 0.5
  }
  if (!land(ax, az) || !land(bx, bz)) return { ok: false, message: '桥的两端需落在岸上', sub: 'Both ends must rest on land' }
  span = Math.hypot(bx - ax, bz - az)
  dx = (bx - ax) / span
  dz = (bz - az) / span
  if (span > 92) return { ok: false, message: '桥身过长', sub: 'Too long — keep a bridge under ~90 paces' }

  const ya = hf.sample(ax, az)
  const yb = hf.sample(bx, bz)
  if (Math.abs(yb - ya) / span > 0.55) return { ok: false, message: '两岸高低悬殊', sub: 'Too steep — the two ends differ too much in height' }

  const n = Math.max(8, Math.ceil(span / 0.5))
  let crossesWater = false
  let dip = 0
  const hs: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = ax + dx * span * t
    const z = az + dz * span * t
    const h = hf.sample(x, z)
    hs.push(h)
    if (t > 0.04 && t < 0.96 && hf.waterDepth(x, z) > 0.15) crossesWater = true
    dip = Math.max(dip, ya + (yb - ya) * t - h)
  }
  if (!crossesWater && dip < 2.2) return { ok: false, message: '此处平地，无需架桥', sub: 'Nothing to span here — draw across a river or a valley' }

  let style: BridgeStyle = 'wood'
  let curve = Math.min(0.05 * span, 2)
  if (dip > 9 && span > 20) {
    style = 'rope'
    curve = -Math.min(0.045 * span, 3)
  } else if (crossesWater && span <= 34) {
    style = 'arch'
    curve = Math.min(0.13 * span, 4.2)
  }
  const spec: BridgeSpec = { ax, az, bx, bz, span, dx, dz, halfW: 1.3, ya, yb, curve, style, crossesWater }
  const clear = () => {
    for (let i = 0; i <= n; i++) {
      const t = i / n
      if (t < 0.07 || t > 0.93) continue
      if (deckY(spec, t) - hs[i] < 0.45) return false
    }
    return true
  }
  if (!clear() && style === 'rope') {
    spec.style = 'wood'
    spec.curve = Math.min(0.05 * span, 2)
  }
  if (!clear()) {
    // raise the hump if that is all it takes
    spec.curve = Math.max(spec.curve, 0) + 1.5
    if (!clear()) return { ok: false, message: '山石阻挡', sub: 'Blocked — the line runs into the mountainside' }
  }
  return { ok: true, spec }
}

// ───────────────────────────── geometry

const VERT = /* glsl */ `
${WORLD_UNIFORMS}
uniform float uBuild;
attribute float aBirth;
attribute float aKind;
varying vec3 vN;
varying vec3 vL;
varying float vKind;
varying float vInkT;
varying vec3 vW;
void main() {
  float k1 = smoothstep(aBirth, aBirth + 0.1, uBuild);
  float k2 = smoothstep(aBirth + 0.1, aBirth + 0.26, uBuild);
  vec3 p = position;
  float sy = length(instanceMatrix[1].xyz);
  float sz = length(instanceMatrix[2].xyz);
  // first an ink line drawn along the member, then it thickens into timber or stone
  p.x *= k1;
  p.y *= mix(max(0.05, 0.06 / sy), 1.0, k2);
  p.z *= mix(max(0.05, 0.06 / sz), 1.0, k2);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vL = position * vec3(length(instanceMatrix[0].xyz), sy, sz);
  vKind = aKind;
  vInkT = 1.0 - k2;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  // not yet drawn: collapse outside the clip volume
  if (k1 <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`
const FRAG = /* glsl */ `
${WORLD_UNIFORMS}
${NOISE}
varying vec3 vN;
varying vec3 vL;
varying float vKind;
varying float vInkT;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  float ndl = dot(n, normalize(uSunDir));
  float shade = 1.0 - clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  float kind = vKind;
  float grain = vnoise(vec2(vL.x * 1.2, (vL.y + vL.z) * 14.0));
  float tone;
  vec3 tint = vec3(1.0);
  if (kind < 0.5) { // wood
    tone = 0.5 + 0.32 * smoothstep(0.3, 0.75, shade) + (grain - 0.5) * 0.22;
    tint = vec3(1.0, 0.94, 0.86);
  } else if (kind < 1.5) { // stone
    float blocks = smoothstep(0.42, 0.5, abs(fract(vL.x * 0.9) - 0.5)) + smoothstep(0.43, 0.5, abs(fract(vL.y * 1.6 + 0.5) - 0.5));
    tone = 0.2 + 0.35 * smoothstep(0.35, 0.8, shade) + blocks * 0.25 + (grain - 0.5) * 0.08;
  } else if (kind < 2.5) { // rope
    tone = 0.78;
  } else { // lantern
    vec3 red = vec3(0.72, 0.17, 0.11);
    vec3 c = mix(red, red * 0.55, shade);
    c += vec3(1.0, 0.55, 0.3) * uNight * 0.9;
    gl_FragColor = vec4(mix(c, uInk, vInkT), 1.0);
    return;
  }
  vec3 col = mix(uPaper, uInk, clamp(tone, 0.0, 1.0)) * tint;
  col = mix(col, uInk, vInkT * 0.9);
  // lantern light pools on the deck at night
  gl_FragColor = vec4(col, 1.0);
}
`

const BOX = new BoxGeometry(1, 1, 1)

interface Inst {
  m: Matrix4
  birth: number
  kind: number
}

const KIND = { wood: 0, stone: 1, rope: 2, lantern: 3 }

export class BridgeEntity {
  readonly mesh: InstancedMesh
  readonly material: ShaderMaterial
  t = 0
  build = 0
  done = false
  /** lantern positions (object space) for night glow */
  readonly lanterns: Vector3[] = []

  constructor(
    readonly spec: BridgeSpec,
    hf: Heightfield,
    seed: number,
  ) {
    const parts = this.layout(hf, new Rng(seed))
    this.material = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...U, uBuild: { value: 0 } } })
    const geo = BOX.clone()
    const birth = new InstancedBufferAttribute(new Float32Array(parts.length), 1).setUsage(DynamicDrawUsage)
    const kind = new InstancedBufferAttribute(new Float32Array(parts.length), 1)
    geo.setAttribute('aBirth', birth)
    geo.setAttribute('aKind', kind)
    this.mesh = new InstancedMesh(geo, this.material, parts.length)
    parts.forEach((p, i) => {
      this.mesh.setMatrixAt(i, p.m)
      birth.setX(i, p.birth)
      kind.setX(i, p.kind)
    })
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.frustumCulled = false
    this.mesh.name = 'bridge'
  }

  /** world xz → point along the deck */
  private P(t: number, lat: number, yOff: number, out = new Vector3()) {
    const s = this.spec
    return out.set(s.ax + s.dx * s.span * t - s.dz * lat, deckY(s, t) + yOff, s.az + s.dz * s.span * t + s.dx * lat)
  }

  private layout(hf: Heightfield, rng: Rng): Inst[] {
    const s = this.spec
    const out: Inst[] = []
    const q = new Quaternion()
    const add = (a: Vector3, b: Vector3, thick: number, depth: number, birth: number, kind: number, upHint = new Vector3(0, 1, 0)) => {
      // a box whose local x runs from a to b
      const axis = b.clone().sub(a)
      const len = axis.length()
      if (len < 1e-3) return
      axis.divideScalar(len)
      let side = new Vector3().crossVectors(axis, upHint)
      if (side.lengthSq() < 1e-6) side = new Vector3(0, 0, 1).cross(axis)
      side.normalize()
      const up = new Vector3().crossVectors(side, axis).normalize()
      const basis = new Matrix4().makeBasis(axis, up, side)
      q.setFromRotationMatrix(basis)
      const m = new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(len, thick, depth))
      out.push({ m, birth, kind })
    }
    const hw = s.halfW
    const across = new Vector3(-s.dz, 0, s.dx)
    const plankKind = s.style === 'arch' ? KIND.stone : KIND.wood
    const bt = (t: number) => 0.06 + t * 0.62

    // deck: planks / slabs laid across, following the deck curve
    const step = s.style === 'arch' ? 0.62 : s.style === 'rope' ? 0.5 : 0.42
    const nP = Math.max(2, Math.round(s.span / step))
    for (let i = 0; i <= nP; i++) {
      const t = i / nP
      const c = this.P(t, 0, -0.07)
      const w = s.style === 'arch' ? hw + 0.2 : s.style === 'rope' ? hw * 0.9 : hw
      const a = c.clone().addScaledVector(across, -w)
      const b = c.clone().addScaledVector(across, w)
      const t2 = Math.min(1, t + 0.01)
      const tang = this.P(t2, 0, 0).sub(this.P(Math.max(0, t2 - 0.02), 0, 0)).normalize()
      add(a, b, s.style === 'arch' ? 0.3 : 0.12, step * (s.style === 'rope' ? 0.62 : 0.9), bt(t) + 0.04, plankKind, new Vector3().crossVectors(across, tang).normalize())
    }

    if (s.style === 'wood') {
      // stringers
      const seg = Math.max(2, Math.round(s.span / 2))
      for (const side of [-1, 1]) {
        for (let i = 0; i < seg; i++) {
          const t0 = i / seg
          const t1 = (i + 1) / seg
          add(this.P(t0, side * (hw - 0.2), -0.24), this.P(t1, side * (hw - 0.2), -0.24), 0.22, 0.2, bt(t0), KIND.wood)
        }
      }
      // legs where the ground falls away
      const nL = Math.max(1, Math.round(s.span / 6))
      for (let i = 1; i < nL; i++) {
        const t = i / nL
        const top = this.P(t, 0, -0.3)
        const g = hf.sample(top.x, top.z)
        if (top.y - g < 1.2) continue
        for (const side of [-1, 1]) {
          const a = this.P(t, side * (hw - 0.2), -0.3)
          const b = a.clone()
          b.y = Math.min(g, WATER_LEVEL + 0.2) - 0.6
          if (g > WATER_LEVEL) b.y = g - 0.4
          add(b, a, 0.3, 0.3, bt(t) - 0.04, KIND.wood, across)
        }
        // cross brace
        const l = this.P(t, -(hw - 0.2), -0.6)
        const r = this.P(t, hw - 0.2, -0.6)
        add(l, r, 0.16, 0.16, bt(t), KIND.wood)
      }
    }

    if (s.style === 'arch') {
      // the vault: blocks around a half ellipse from bank to bank under the deck
      let tA = 0.12
      let tB = 0.88
      for (let i = 0; i <= 40; i++) {
        const t = i / 40
        const p = this.P(t, 0, 0)
        if (hf.waterDepth(p.x, p.z) > 0.05) {
          tA = Math.min(tA, t)
          tB = Math.max(tB, t)
        }
      }
      tA = Math.max(0.05, tA - 0.06)
      tB = Math.min(0.95, tB + 0.06)
      const crown = deckY(s, (tA + tB) / 2) - 0.75
      const springY = WATER_LEVEL - 0.6
      const nV = 18
      let prev: Vector3 | null = null
      for (let i = 0; i <= nV; i++) {
        const th = (i / nV) * Math.PI
        const t = tA + (tB - tA) * (1 - Math.cos(th)) / 2
        const y = springY + (crown - springY) * Math.sin(th)
        const p = this.P(t, 0, 0)
        p.y = y
        if (prev) {
          for (const side of [-1, 1]) {
            const a = prev.clone().addScaledVector(across, side * (hw - 0.05))
            const b = p.clone().addScaledVector(across, side * (hw - 0.05))
            add(a, b, 0.55, 0.5, 0.02 + (i / nV) * 0.5, KIND.stone, across)
          }
          // spandrel: fill between vault and deck
          const tm = tA + (tB - tA) * (1 - Math.cos(th - Math.PI / nV / 2)) / 2
          for (const side of [-1, 1]) {
            const top = this.P(tm, side * (hw + 0.05), -0.3)
            const bot = top.clone()
            bot.y = (prev.y + p.y) / 2 + 0.2
            // vertical member: local y runs across the bridge, local z along it
            bot.y -= 0.25
            if (top.y - bot.y > 0.15) add(bot, top, 0.34, (((tB - tA) * s.span) / nV) * 1.5 + 0.25, 0.3 + (i / nV) * 0.3, KIND.stone, across)
          }
        }
        prev = p
      }
      // parapets
      const nW = Math.max(3, Math.round(s.span / 1.6))
      for (const side of [-1, 1]) {
        for (let i = 0; i < nW; i++) {
          const t0 = i / nW
          const t1 = (i + 1) / nW
          add(this.P(t0, side * (hw + 0.1), 0.3), this.P(t1, side * (hw + 0.1), 0.3), 0.62, 0.24, bt(t0) + 0.18, KIND.stone)
        }
      }
    } else {
      // posts + rails (wood) or towers + ropes (rope)
      const postStep = s.style === 'rope' ? 1.5 : 1.8
      const nPo = Math.max(2, Math.round(s.span / postStep))
      for (const side of [-1, 1]) {
        let prevTop: Vector3 | null = null
        let prevMid: Vector3 | null = null
        for (let i = 0; i <= nPo; i++) {
          const t = i / nPo
          const end = i === 0 || i === nPo
          const base = this.P(t, side * hw, s.style === 'rope' ? -0.05 : -0.1)
          const hPost = s.style === 'rope' ? (end ? 2.7 : 1.05) : end ? 1.5 : 1.08
          const top = base.clone()
          top.y += hPost
          const thick = s.style === 'rope' ? (end ? 0.28 : 0.035) : end ? 0.22 : 0.13
          add(base, top, thick, thick, bt(t) + 0.12, s.style === 'rope' && !end ? KIND.rope : KIND.wood, across)
          const railTop = this.P(t, side * hw, 1.02)
          const railMid = this.P(t, side * hw, 0.55)
          if (prevTop && prevMid) {
            const k = s.style === 'rope' ? KIND.rope : KIND.wood
            const th = s.style === 'rope' ? 0.06 : 0.09
            add(prevTop, railTop, th, th, bt(t) + 0.16, k)
            if (s.style === 'wood') add(prevMid, railMid, 0.07, 0.07, bt(t) + 0.2, k)
          }
          prevTop = railTop
          prevMid = railMid
          if (s.style === 'rope' && end) {
            // tower cross beam
            if (side === 1) add(this.P(t, -hw, 2.5), this.P(t, hw, 2.5), 0.22, 0.22, bt(t) + 0.2, KIND.wood)
          }
        }
        if (s.style === 'rope') {
          // floor ropes under the planks
          const nR = Math.max(3, Math.round(s.span / 1.2))
          for (let i = 0; i < nR; i++) add(this.P(i / nR, side * hw * 0.85, -0.16), this.P((i + 1) / nR, side * hw * 0.85, -0.16), 0.06, 0.06, bt(i / nR), KIND.rope)
        }
      }
    }

    // red lanterns at both ends (朱砂红)
    for (const t of [0, 1]) {
      const side = t === 0 ? -1 : 1
      const p = this.P(t, side * (hw + (s.style === 'arch' ? 0.25 : 0.05)), s.style === 'arch' ? 1.15 : 1.25)
      const a = p.clone()
      a.y -= 0.17
      const b = p.clone()
      b.y += 0.17
      add(a, b, 0.22, 0.22, 0.86 + t * 0.04, KIND.lantern, across)
      // dark caps above and below the paper lantern
      const c0 = p.clone()
      c0.y += 0.17
      const c1 = c0.clone()
      c1.y += 0.05
      add(c0, c1, 0.15, 0.15, 0.9, KIND.wood, across)
      const d0 = p.clone()
      d0.y -= 0.22
      const d1 = d0.clone()
      d1.y += 0.05
      add(d0, d1, 0.15, 0.15, 0.9, KIND.wood, across)
      this.lanterns.push(p)
    }
    void rng
    return out
  }

  update(dt: number) {
    if (this.done) return
    this.t += dt
    this.build = clamp((this.t - 0.25) / 3.6) * 1.18
    this.material.uniforms.uBuild.value = this.build
    if (this.build >= 1.18) this.done = true
  }

  /**
   * walkable deck surface (object space) under a point, or null.
   * `lat` is the signed lateral offset, `t` the position along the span.
   */
  surface(x: number, z: number, out: { y: number; t: number; lat: number }) {
    if (!this.done) return null
    const s = this.spec
    const px = x - s.ax
    const pz = z - s.az
    const t = (px * s.dx + pz * s.dz) / s.span
    const lat = -px * s.dz + pz * s.dx
    if (t < -0.01 || t > 1.01 || Math.abs(lat) > s.halfW + 0.05) return null
    out.y = deckY(s, clamp(t))
    out.t = t
    out.lat = lat
    return out
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
