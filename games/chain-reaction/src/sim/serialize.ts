import { REGISTRY } from './components'
import { SCHEMA_ID, SCHEMA_VERSION, type ComponentSpec, type ComponentType, type ConnectionSpec, type SceneSpec } from './schema'

export class SceneError extends Error {}

/** canonical JSON (stable key order, rounded floats) for saving / exporting */
export function serializeScene(scene: SceneSpec): string {
  const r = (x: number) => Math.round(x * 1e5) / 1e5
  const out: SceneSpec = {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    name: scene.name,
    finalId: scene.finalId,
    components: scene.components.map((c) => ({
      id: c.id, type: c.type, label: c.label, zone: c.zone,
      pos: [r(c.pos[0]), r(c.pos[1]), r(c.pos[2])], rot: r(c.rot),
      params: Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, typeof v === 'number' ? r(v) : v])),
    })),
    connections: scene.connections.map((k) => ({ ...k })),
  }
  return JSON.stringify(out, null, 2)
}

/**
 * Validate and normalise untrusted JSON (imports, localStorage). Unknown component types, bad
 * numbers, duplicate ids and dangling connections are rejected with a readable message instead
 * of producing a corrupted world. Older schema versions are migrated here.
 */
export function parseScene(json: string | unknown): SceneSpec {
  let data: unknown = json
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json)
    } catch {
      throw new SceneError('Not valid JSON')
    }
  }
  if (!data || typeof data !== 'object') throw new SceneError('Machine file must be a JSON object')
  const d = data as Record<string, unknown>
  if (d.schema !== SCHEMA_ID) throw new SceneError(`Unknown schema "${String(d.schema)}" (expected ${SCHEMA_ID})`)
  const version = Number(d.version)
  if (!Number.isInteger(version) || version < 1) throw new SceneError('Missing schema version')
  if (version > SCHEMA_VERSION) throw new SceneError(`File is from a newer version (${version}); this build reads up to ${SCHEMA_VERSION}`)
  if (!Array.isArray(d.components)) throw new SceneError('"components" must be an array')
  if (d.components.length > 400) throw new SceneError('Too many components (max 400)')
  const ids = new Set<string>()
  const components: ComponentSpec[] = d.components.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new SceneError(`Component #${i} is not an object`)
    const c = raw as Record<string, unknown>
    const id = String(c.id ?? '')
    if (!/^[\w@:.-]{1,64}$/.test(id)) throw new SceneError(`Component #${i} has an invalid id`)
    if (ids.has(id)) throw new SceneError(`Duplicate component id "${id}"`)
    ids.add(id)
    const type = String(c.type) as ComponentType
    const info = REGISTRY[type]
    if (!info) throw new SceneError(`Component "${id}" has unknown type "${String(c.type)}"`)
    const pos = c.pos
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1000)) {
      throw new SceneError(`Component "${id}" has an invalid position`)
    }
    const rot = Number(c.rot ?? 0)
    if (!Number.isFinite(rot)) throw new SceneError(`Component "${id}" has an invalid rotation`)
    const params: Record<string, number | boolean | string> = {}
    const rawP = (c.params && typeof c.params === 'object' ? c.params : {}) as Record<string, unknown>
    for (const def of info.params) {
      const v = rawP[def.key]
      if (v === undefined) continue
      if (def.type === 'number') {
        const n = Number(v)
        if (!Number.isFinite(n)) throw new SceneError(`"${id}.${def.key}" must be a number`)
        params[def.key] = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n))
      } else if (def.type === 'boolean') params[def.key] = v === true || v === 'true'
      else {
        const s = String(v)
        if (def.options && !def.options.includes(s)) throw new SceneError(`"${id}.${def.key}" must be one of ${def.options.join(', ')}`)
        params[def.key] = s
      }
    }
    const zone = c.zone === undefined ? undefined : Number(c.zone)
    return { id, type, pos: [pos[0], pos[1], pos[2]] as [number, number, number], rot, params, label: c.label ? String(c.label).slice(0, 80) : undefined, zone: Number.isFinite(zone) ? zone : undefined }
  })
  const conns = Array.isArray(d.connections) ? d.connections : []
  const connections: ConnectionSpec[] = conns.map((raw, i) => {
    const k = raw as Record<string, unknown>
    const from = String(k.from ?? '')
    const to = String(k.to ?? '')
    const kind = k.kind === 'mechanical' ? 'mechanical' : 'signal'
    if (from !== '@start' && !ids.has(from)) throw new SceneError(`Connection #${i} starts at unknown component "${from}"`)
    if (!ids.has(to)) throw new SceneError(`Connection #${i} ends at unknown component "${to}"`)
    const ratio = k.ratio === undefined ? undefined : Number(k.ratio)
    if (ratio !== undefined && (!Number.isFinite(ratio) || ratio === 0 || Math.abs(ratio) > 100)) throw new SceneError(`Connection #${i} has an invalid ratio`)
    return { id: String(k.id ?? `k${i}`), kind, from, output: String(k.output ?? 'out'), to, input: String(k.input ?? 'in'), ratio }
  })
  // a finish marker pointing at a deleted component is dropped, not fatal
  const finalId = d.finalId && ids.has(String(d.finalId)) ? String(d.finalId) : undefined
  return { schema: SCHEMA_ID, version: SCHEMA_VERSION, name: String(d.name ?? 'Imported Machine').slice(0, 80), components, connections, finalId }
}
