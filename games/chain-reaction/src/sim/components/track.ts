import { aabb, Component, type ParamDef, type Port } from '../component'
import type { ComponentSpec } from '../schema'
import { add, qRotate, scale, type V3 } from '../math'
import { arcPoints, bankRamp, buildTrough, framePath, troughGeometry, type PathSample, type TroughGeometry } from './rails'

export const TRACK_KINDS = ['straight', 'curve', 'spiral', 'jump'] as const

export const TRACK_PARAMS: ParamDef[] = [
  { key: 'kind', label: 'Shape', type: 'select', options: [...TRACK_KINDS], default: 'straight' },
  { key: 'length', label: 'Length', type: 'number', min: 0.4, max: 14, step: 0.1, default: 3, when: (p) => p.kind === 'straight' || p.kind === 'jump' },
  { key: 'drop', label: 'Drop', type: 'number', min: -0.5, max: 8, step: 0.02, default: 0.24 },
  { key: 'radius', label: 'Radius', type: 'number', min: 0.5, max: 4, step: 0.05, default: 1.2, when: (p) => p.kind === 'curve' || p.kind === 'spiral' },
  { key: 'angle', label: 'Turn (deg)', type: 'number', min: -360, max: 360, step: 5, default: 90, when: (p) => p.kind === 'curve' },
  { key: 'turns', label: 'Turns', type: 'number', min: 0.5, max: 5, step: 0.25, default: 2, when: (p) => p.kind === 'spiral' },
  { key: 'dir', label: 'Direction', type: 'select', options: ['left', 'right'], default: 'left', when: (p) => p.kind === 'spiral' },
  { key: 'bank', label: 'Bank (deg)', type: 'number', min: 0, max: 35, step: 1, default: 15, when: (p) => p.kind === 'curve' || p.kind === 'spiral' },
  { key: 'lip', label: 'Jump lip (deg)', type: 'number', min: 0, max: 40, step: 1, default: 18, when: (p) => p.kind === 'jump' },
  { key: 'profile', label: 'Drop profile', type: 'select', options: ['linear', 's-curve', 'steepen', 'flatten'], default: 'linear', when: (p) => p.kind === 'straight' },
  { key: 'support', label: 'Support depth', type: 'number', min: 0, max: 12, step: 0.1, default: 0 },
]

/**
 * Modular marble track: a polished half-pipe trough (triangle-mesh collider with internal-edge
 * fixing). The ball rolls in the channel and rides up the outer wall in curves. Pieces start at their origin heading local +x
 * and expose an "out" port at their end for the snap system.
 */
export class Track extends Component {
  readonly drive = 'passive' as const
  path: PathSample[] = []
  trough!: TroughGeometry

  constructor(spec: ComponentSpec) {
    super(spec, TRACK_PARAMS)
  }

  /** ball-centre polyline in local coordinates */
  localPoints(): { pts: V3[]; banks: number[] } {
    const kind = this.str('kind')
    const drop = this.num('drop')
    if (kind === 'curve' || kind === 'spiral') {
      const sign = kind === 'spiral' ? (this.str('dir') === 'right' ? -1 : 1) : Math.sign(this.num('angle')) || 1
      const ang = kind === 'spiral' ? sign * this.num('turns') * Math.PI * 2 : (this.num('angle') * Math.PI) / 180
      const pts = arcPoints(this.num('radius'), ang, drop)
      const bank = (sign * this.num('bank') * Math.PI) / 180
      // spirals hold their bank all the way round (except the very ends)
      const banks = kind === 'spiral' ? pts.map((_, i) => bank * Math.min(1, i / 6, (pts.length - 1 - i) / 6)) : bankRamp(pts.length, bank)
      return { pts, banks }
    }
    const L = this.num('length')
    if (kind === 'jump') {
      // straight run-up, then an upturned lip
      const lip = (this.num('lip') * Math.PI) / 180
      const run = Math.max(0.3, L - 0.6)
      const pts: V3[] = []
      const n = Math.max(2, Math.ceil(run / 0.5))
      for (let i = 0; i <= n; i++) pts.push({ x: (run * i) / n, y: (-drop * i) / n, z: 0 })
      const slope = Math.atan2(drop, run)
      const rLip = 0.6 / Math.max(0.05, lip + slope)
      const cx = run
      const cy = -drop
      for (let i = 1; i <= 6; i++) {
        const a = -slope + ((lip + slope) * i) / 6
        pts.push({ x: cx + rLip * (Math.sin(a) + Math.sin(slope)), y: cy + rLip * (Math.cos(slope) - Math.cos(a)), z: 0 })
      }
      return { pts, banks: pts.map(() => 0) }
    }
    const prof = this.str('profile')
    const f = (u: number) => (prof === 's-curve' ? u * u * (3 - 2 * u) : prof === 'steepen' ? u * u : prof === 'flatten' ? 1 - (1 - u) * (1 - u) : u)
    const n = prof === 'linear' ? Math.max(2, Math.ceil(L / 0.5)) : Math.max(4, Math.ceil(L / 0.18))
    const pts: V3[] = []
    for (let i = 0; i <= n; i++) pts.push({ x: (L * i) / n, y: -drop * f(i / n), z: 0 })
    return { pts, banks: pts.map(() => 0) }
  }

  build() {
    const { pts, banks } = this.localPoints()
    this.path = framePath(pts, banks)
    this.trough = troughGeometry(this.path)
    buildTrough(this, this.trough)
  }

  /** world-space ball line */
  worldPath(): PathSample[] {
    return this.path.map((f) => ({
      ...f,
      p: this.w(f.p.x, f.p.y, f.p.z),
      t: qRotate(this.q, f.t),
      l: qRotate(this.q, f.l),
      u: qRotate(this.q, f.u),
    }))
  }

  ports(): Port[] {
    if (!this.path.length) this.path = framePath(this.localPoints().pts)
    const a = this.path[0]
    const b = this.path[this.path.length - 1]
    return [
      { name: 'in', kind: 'in', pos: this.w(a.p.x, a.p.y, a.p.z), dir: qRotate(this.q, a.t) },
      { name: 'out', kind: 'out', pos: this.w(b.p.x, b.p.y, b.p.z), dir: qRotate(this.q, b.t) },
    ]
  }

  bounds() {
    if (!this.path.length) this.path = framePath(this.localPoints().pts)
    const pts = this.path.flatMap((f) => [add(f.p, scale(f.u, 0.25)), add(f.p, scale(f.u, -0.25)), add(f.p, scale(f.l, 0.25)), add(f.p, scale(f.l, -0.25))])
    return aabb(pts.map((p) => this.w(p.x, p.y, p.z)))
  }
}
