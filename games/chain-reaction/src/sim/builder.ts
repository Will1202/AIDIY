import { createComponent } from './components'
import type { Port } from './component'
import { SCHEMA_ID, SCHEMA_VERSION, type ComponentSpec, type ComponentType, type ConnectionSpec, type Params, type SceneSpec } from './schema'
import type { V3 } from './math'

export interface Anchor {
  pos: V3
  yaw: number
}

export const yawOf = (d: V3) => Math.atan2(-d.z, d.x)

/** Small helper for authoring machines in code with the same snap rules the editor uses. */
export class MachineBuilder {
  readonly components: ComponentSpec[] = []
  readonly connections: ConnectionSpec[] = []
  private n = 0

  constructor(readonly name: string) {}

  add(type: ComponentType, id: string, pos: V3, rot: number, params: Params = {}, label?: string, zone?: number): ComponentSpec {
    const spec: ComponentSpec = { id, type, pos: [pos.x, pos.y, pos.z], rot, params, label, zone }
    this.components.push(spec)
    return spec
  }

  /** world ports of a spec, computed without a physics world */
  ports(spec: ComponentSpec): Port[] {
    const c = createComponent(spec)
    return c ? c.ports() : []
  }

  out(spec: ComponentSpec, name = 'out'): Anchor {
    const p = this.ports(spec).find((q) => q.name === name)!
    return { pos: p.pos, yaw: yawOf(p.dir) }
  }

  /** append a track piece whose "in" port sits exactly on the anchor */
  track(id: string, at: Anchor, params: Params, label?: string, zone?: number): ComponentSpec {
    return this.add('track', id, at.pos, at.yaw, params, label, zone)
  }

  /** a run of snapped track pieces; returns the last piece */
  run(prefix: string, at: Anchor, pieces: Params[], zone?: number, label?: string): { last: ComponentSpec; end: Anchor } {
    let a = at
    let last: ComponentSpec | null = null
    pieces.forEach((p, i) => {
      last = this.track(`${prefix}${i + 1}`, a, p, label, zone)
      a = this.out(last)
    })
    return { last: last!, end: a }
  }

  wire(from: string, output: string, to: string, input: string) {
    this.connections.push({ id: `w${++this.n}`, kind: 'signal', from, output, to, input })
  }
  chain(from: string, to: string, ratio: number) {
    this.connections.push({ id: `m${++this.n}`, kind: 'mechanical', from, output: 'shaft', to, input: 'drive', ratio })
  }

  scene(finalId?: string): SceneSpec {
    return { schema: SCHEMA_ID, version: SCHEMA_VERSION, name: this.name, components: this.components, connections: this.connections, finalId }
  }
}
