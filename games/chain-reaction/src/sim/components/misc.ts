import { boxBounds, Component, type ParamDef, type Port } from '../component'
import type { ComponentSpec } from '../schema'
import { qAxisAngle, qConj, qRotate, sub } from '../math'
import { RAPIER } from '../physics'
import { MARBLE_R } from './rails'

export const FUNNEL_PARAMS: ParamDef[] = [
  { key: 'top', label: 'Mouth radius', type: 'number', min: 0.4, max: 2, step: 0.02, default: 0.9 },
  { key: 'bottom', label: 'Throat radius', type: 'number', min: 0.18, max: 0.5, step: 0.01, default: 0.21 },
  { key: 'height', label: 'Height', type: 'number', min: 0.3, max: 2, step: 0.02, default: 0.85 },
  { key: 'neck', label: 'Neck tube length', type: 'number', min: 0, max: 0.8, step: 0.02, default: 0 },
]

/** FUNNEL — a cone catcher (triangle-mesh collider) that turns a wild arrival into a clean vertical drop. Origin = throat centre. */
export class Funnel extends Component {
  readonly drive = 'passive' as const
  constructor(spec: ComponentSpec) {
    super(spec, FUNNEL_PARAMS)
  }
  build() {
    const rt = this.num('top')
    const rb = this.num('bottom')
    const h = this.num('height')
    const seg = 40
    const verts: number[] = []
    const idx: number[] = []
    // rings: neck tube (kills the swirl so the marble drops straight), throat, mouth, lip
    const neck = this.num('neck')
    const rings = neck > 0 ? [[rb, -neck], [rb, 0], [rt, h], [rt + 0.02, h + 0.18]] : [[rb, 0], [rt, h], [rt + 0.02, h + 0.18]]
    for (const [r, y] of rings) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2
        verts.push(Math.cos(a) * r, y, -Math.sin(a) * r)
      }
    }
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const a0 = k * seg + i
        const a1 = k * seg + ((i + 1) % seg)
        const b0 = a0 + seg
        const b1 = a1 + seg
        idx.push(a0, b1, b0, a0, a1, b1)
      }
    }
    this.fixedCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)), { x: 0, y: 0, z: 0 }, null, 'cone', 'brass')
  }
  ports(): Port[] { return [{ name: 'out', kind: 'out', pos: this.w(0, -this.num('neck') - 0.3, 0), dir: { x: 0, y: -1, z: 0 } }] }
  bounds() { const r = this.num('top') + 0.1; const n = this.num('neck'); return boxBounds(this, r, (this.num('height') + n) / 2 + 0.15, r, 0, (this.num('height') - n) / 2, 0) }
}

// ---------------------------------------------------------------------------------------------

export const FINAL_PARAMS: ParamDef[] = [
  { key: 'scale', label: 'Machine scale', type: 'number', min: 0.4, max: 2, step: 0.05, default: 1 },
  { key: 'cup', label: 'Trigger cup radius', type: 'number', min: 0.22, max: 0.7, step: 0.01, default: 0.36 },
  { key: 'opening', label: 'Entry opening (deg)', type: 'number', min: 0, max: 120, step: 5, default: 70 },
  { key: 'wall', label: 'Cup wall height', type: 'number', min: 0.1, max: 0.6, step: 0.01, default: 0.36 },
  { key: 'show', label: 'Show length (s)', type: 'number', min: 4, max: 30, step: 0.5, default: 14 },
]

/**
 * FINAL TRIGGER — the end of the chain. It activates only when a marble has physically come to
 * rest in its trigger cup (or a "trigger" signal arrives); then the Final Machine performs.
 * Origin = cup floor centre; the machine itself is drawn above it.
 */
export class Final extends Component {
  readonly drive = 'sensor' as const
  showTime = -1
  private heldFor = 0

  constructor(spec: ComponentSpec) {
    super(spec, FINAL_PARAMS)
    this.signalInputs.push('trigger')
    this.signalOutputs.push('activated')
  }

  build() {
    const r = this.num('cup')
    this.fixedCollider(RAPIER.ColliderDesc.cylinder(0.04, r + 0.05), { x: 0, y: -0.04, z: 0 }, null, 'cup', 'brass')
    const segs = 24
    const open = (this.num('opening') * Math.PI) / 180
    const wh = this.num('wall') / 2
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / segs) * Math.PI * 2
      // the entry opening faces local −x, where the feeding track arrives
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < open / 2) continue
      const L = (2 * Math.PI * (r + 0.03)) / segs
      this.fixedCollider(
        RAPIER.ColliderDesc.cuboid(0.025, wh, L / 2 + 0.01),
        { x: Math.cos(a) * (r + 0.03), y: wh, z: -Math.sin(a) * (r + 0.03) },
        qAxisAngle({ x: 0, y: 1, z: 0 }, a),
        'cup-wall',
        'felt',
      )
    }
    this.waitingFor = 'no marble came to rest in the trigger cup'
  }

  receive(input: string) {
    if (input === 'trigger') this.activate()
  }

  private activate() {
    if (this.status !== 'ARMED') return
    this.showTime = 0
    this.setStatus('ACTIVATED')
    this.emit('activated')
  }

  preStep(dt: number) {
    if (this.status === 'ARMED') {
      const r = this.num('cup')
      const iq = qConj(this.q)
      const inCup = this.sim.marbles().some((m) => {
        const l = qRotate(iq, sub(m.body.translation(), this.origin))
        const v = m.body.linvel()
        return Math.hypot(l.x, l.z) < r && l.y > 0 && l.y < MARBLE_R + 0.12 && Math.hypot(v.x, v.y, v.z) < 0.6
      })
      this.heldFor = inCup ? this.heldFor + dt : 0
      if (this.heldFor > 0.2) this.activate()
    }
    if (this.showTime >= 0) {
      this.showTime += dt
      if (this.status === 'ACTIVATED' && this.showTime > 0.5) this.setStatus('RUNNING')
      if (this.status === 'RUNNING' && this.showTime > this.num('show')) this.setStatus('COMPLETED')
    }
  }

  busy() { return this.status === 'ACTIVATED' || this.status === 'RUNNING' }
  progress() { return this.showTime >= 0 ? `show ${this.showTime.toFixed(1)} s` : 'armed' }
  saveExtra() { return [this.showTime, this.heldFor] }
  loadExtra(s: number[]) { this.showTime = s[0]; this.heldFor = s[1] }
  ports(): Port[] { return [{ name: 'in', kind: 'in', pos: this.w(0, 0.5, 0), dir: { x: 0, y: -1, z: 0 } }] }
  bounds() {
    const s = this.num('scale')
    return boxBounds(this, 3.6 * s, 3.8 * s, 3.6 * s, 0, 4 * s, 0)
  }
}
