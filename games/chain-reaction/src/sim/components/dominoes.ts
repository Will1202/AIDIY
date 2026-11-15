import { aabb, Component, type ParamDef } from '../component'
import type { ComponentSpec } from '../schema'
import { qMul, qYaw, twistAngle, type Q4, type V3 } from '../math'
import { RAPIER, type RigidBody } from '../physics'

export const DOMINO_PARAMS: ParamDef[] = [
  { key: 'count', label: 'Count', type: 'number', min: 2, max: 80, step: 1, default: 24 },
  { key: 'height', label: 'Height', type: 'number', min: 0.2, max: 1.4, step: 0.02, default: 0.56 },
  { key: 'width', label: 'Width', type: 'number', min: 0.1, max: 0.8, step: 0.01, default: 0.3 },
  { key: 'thickness', label: 'Thickness', type: 'number', min: 0.03, max: 0.2, step: 0.005, default: 0.075 },
  { key: 'spacing', label: 'Spacing (× height)', type: 'number', min: 0.25, max: 0.9, step: 0.01, default: 0.5 },
  { key: 'growth', label: 'Final size ×', type: 'number', min: 0.5, max: 4, step: 0.05, default: 1 },
  { key: 'shape', label: 'Path', type: 'select', options: ['line', 'arc', 's-curve'], default: 'line' },
  { key: 'curve', label: 'Bend (deg)', type: 'number', min: -270, max: 270, step: 5, default: 90 },
]

export interface DominoPiece {
  body: RigidBody
  /** half extents */
  hx: number
  hy: number
  hz: number
  rest: Q4
  fallen: boolean
}

const UP: V3 = { x: 0, y: 1, z: 0 }

/**
 * DOMINO ARRAY — every piece is its own rigid body; nothing is animated. The chain only
 * propagates through contacts, and each piece reports "fallen" from its measured tilt.
 * Origin = foot of the first domino; the row runs along local +x.
 */
export class Dominoes extends Component {
  readonly drive = 'physical' as const
  pieces: DominoPiece[] = []
  fallenCount = 0
  /** index of the furthest fallen domino (the cascade front, for the camera) */
  front = -1

  constructor(spec: ComponentSpec) {
    super(spec, DOMINO_PARAMS)
    this.signalOutputs.push('complete')
  }

  /** local placement: position of each foot and heading */
  layout(): { x: number; z: number; yaw: number; k: number }[] {
    const n = Math.round(this.num('count'))
    const H = this.num('height')
    const g = this.num('growth')
    const sp = this.num('spacing')
    const ks: number[] = []
    for (let i = 0; i < n; i++) ks.push(1 + (g - 1) * Math.pow(n === 1 ? 0 : i / (n - 1), 1.6))
    const s: number[] = [0]
    for (let i = 1; i < n; i++) s.push(s[i - 1] + sp * H * (ks[i - 1] + ks[i]) * 0.5)
    const S = s[n - 1] || 1
    const shape = this.str('shape')
    const bend = (this.num('curve') * Math.PI) / 180
    const heading = (u: number) => (shape === 'arc' ? bend * u : shape === 's-curve' ? bend * Math.sin(u * Math.PI * 2) * 0.5 : 0)
    // integrate the path finely so curved rows keep exact spacing
    const out: { x: number; z: number; yaw: number; k: number }[] = []
    let x = 0, z = 0, acc = 0, idx = 0
    const steps = 2000
    for (let j = 0; j <= steps && idx < n; j++) {
      const u = j / steps
      const at = u * S
      while (idx < n && s[idx] <= at + 1e-9) {
        out.push({ x, z, yaw: heading(s[idx] / S), k: ks[idx] })
        idx++
      }
      const h = heading(u)
      const ds = S / steps
      x += Math.cos(h) * ds
      z -= Math.sin(h) * ds
      acc += ds
    }
    while (out.length < n) out.push({ x, z, yaw: heading(1), k: ks[out.length] })
    return out
  }

  build() {
    const H = this.num('height')
    const W = this.num('width')
    const T = this.num('thickness')
    for (const [i, d] of this.layout().entries()) {
      const hx = (T * d.k) / 2
      const hy = (H * d.k) / 2
      const hz = (W * d.k) / 2
      const pos = this.w(d.x, hy + 0.0015, d.z)
      const rest = qMul(this.q, qYaw(d.yaw))
      const body = this.sim.physics.body(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rest).setSleeping(true).setCanSleep(true).setAngularDamping(0.05),
      )
      // light wood: 0.3 kg for the base size, scaling with volume
      this.sim.physics.collider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMass(0.3 * d.k * d.k * d.k).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
        this.owner(`domino:${i}`, 'wood'),
      )
      this.pieces.push({ body, hx, hy, hz, rest, fallen: false })
      this.bodies.push(body)
    }
    this.waitingFor = 'nothing struck the first domino'
  }

  postStep() {
    if (this.status === 'IDLE') return
    let count = 0
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i]
      if (!p.fallen) {
        const r = p.body.rotation()
        // tilt = angle between the piece's up axis and world up
        const tilt = tiltOf(r)
        if (tilt > 0.75) {
          p.fallen = true
          this.front = Math.max(this.front, i)
        }
      }
      if (p.fallen) count++
    }
    this.fallenCount = count
    if (this.status === 'ARMED') {
      const first = this.pieces[0]
      if (first && tiltOf(first.body.rotation()) > 0.12) this.setStatus('ACTIVATED')
    }
    if (this.status === 'ACTIVATED' && count > 0) this.setStatus('RUNNING')
    if (this.status === 'RUNNING') {
      this.waitingFor = `the cascade stopped at domino ${this.front + 1} / ${this.pieces.length}`
      if (this.pieces[this.pieces.length - 1].fallen) {
        this.setStatus('COMPLETED')
        this.emit('complete')
      }
    }
  }

  /** twist of a piece about its own forward axis is irrelevant; only the fall matters */
  pieceAngle(i: number) {
    const p = this.pieces[i]
    return twistAngle(p.rest, p.body.rotation(), UP)
  }

  progress() { return `${this.fallenCount} / ${this.pieces.length} fallen` }

  saveExtra() {
    return [this.fallenCount, this.front, ...this.pieces.map((p) => (p.fallen ? 1 : 0))]
  }
  loadExtra(s: number[]) {
    this.fallenCount = s[0]
    this.front = s[1]
    this.pieces.forEach((p, i) => (p.fallen = s[2 + i] === 1))
  }

  bounds() {
    const pts: V3[] = []
    const H = this.num('height')
    for (const d of this.layout()) {
      pts.push(this.w(d.x, 0, d.z), this.w(d.x, H * d.k, d.z))
    }
    const b = aabb(pts)
    b.min.x -= 0.3; b.min.z -= 0.3; b.max.x += 0.3; b.max.z += 0.3
    return b
  }
}

/** angle between a rotated body's +Y and world +Y */
export function tiltOf(r: { x: number; y: number; z: number; w: number }) {
  // y component of rotated up vector = 1 - 2(x² + z²)
  const uy = 1 - 2 * (r.x * r.x + r.z * r.z)
  return Math.acos(Math.max(-1, Math.min(1, uy)))
}
