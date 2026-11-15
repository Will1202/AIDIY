import { createComponent } from './components'
import type { Component, Port } from './component'
import type { SceneSpec } from './schema'
import { dist, type V3 } from './math'

export interface ValidationIssue {
  level: 'error' | 'warn'
  id?: string
  text: string
}

const SUPPORTED_BELOW = ['platform', 'track', 'conveyor', 'turntable', 'lift', 'funnel', 'pulley', 'final', 'hopper', 'wall']

/**
 * Structural checks (not a proof that the chain will succeed): broken track joints, track ends
 * that lead nowhere, unsupported dominoes, inputs nobody drives, an unreachable final trigger.
 */
export function validateScene(scene: SceneSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const comps = scene.components.map((s) => createComponent(s)).filter((c): c is Component => !!c)
  const byId = new Map(comps.map((c) => [c.id, c]))
  const name = (c: Component) => c.spec.label ?? `${c.type} ${c.id}`
  const ports = comps.flatMap((c) => c.ports().map((p) => ({ c, p })))
  const outs = ports.filter((x) => x.p.kind === 'out')
  const ins = ports.filter((x) => x.p.kind === 'in')
  const bounds = new Map(comps.map((c) => [c.id, c.bounds()]))

  const inside = (p: V3, id: string, pad = 0.15) => {
    const b = bounds.get(id)!
    return p.x > b.min.x - pad && p.x < b.max.x + pad && p.z > b.min.z - pad && p.z < b.max.z + pad && p.y > b.min.y - 2.5 && p.y < b.max.y + 0.6
  }

  // 1 · track joints: an out port close to an in port must line up in height and direction
  for (const o of outs) {
    if (o.c.type !== 'track' && o.c.type !== 'hopper' && o.c.type !== 'lift') continue
    // drop-in ports (cups, buckets) are entered from above, not through a track joint
    const near = ins.filter((i) => i.c !== o.c && i.p.dir.y > -0.5 && dist(i.p.pos, o.p.pos) < 0.7)
    for (const i of near) {
      const dy = i.p.pos.y - o.p.pos.y
      if (dy > 0.04) issues.push({ level: 'error', id: i.c.id, text: `${name(i.c)} starts ${(dy * 100).toFixed(0)} cm above the end of ${name(o.c)} — the marble cannot climb into it` })
      else if (dy < -0.45) issues.push({ level: 'warn', id: i.c.id, text: `${name(i.c)} starts ${(-dy * 100).toFixed(0)} cm below ${name(o.c)} — the marble will drop hard` })
      const align = o.p.dir.x * i.p.dir.x + o.p.dir.z * i.p.dir.z
      if (align < 0.85 && i.c.type === 'track') issues.push({ level: 'warn', id: i.c.id, text: `${name(i.c)} is turned ${Math.round((Math.acos(Math.max(-1, Math.min(1, align))) * 180) / Math.PI)}° away from the track feeding it` })
      const lateral = Math.hypot(i.p.pos.x - o.p.pos.x, i.p.pos.z - o.p.pos.z)
      if (lateral > 0.2 && i.c.type === 'track') issues.push({ level: 'warn', id: i.c.id, text: `${name(i.c)} is ${(lateral * 100).toFixed(0)} cm off the joint with ${name(o.c)} (use snapping)` })
    }
    // 2 · a track end must lead somewhere: another track, a catcher, a deck, dominoes…
    if (o.c.type === 'track' || o.c.type === 'hopper') {
      const p = o.p.pos
      const ahead = { x: p.x + o.p.dir.x * 0.5, y: p.y, z: p.z + o.p.dir.z * 0.5 }
      const lands = comps.some((c) => c !== o.c && (inside(ahead, c.id) || inside(p, c.id, 0.05)) && SUPPORTED_BELOW.concat(['dominoes', 'lever', 'launcher', 'marble']).includes(c.type))
      if (!lands) issues.push({ level: 'warn', id: o.c.id, text: `The end of ${name(o.c)} leads nowhere — the marble will fall off` })
    }
  }

  // 3 · dominoes need a floor under every piece
  for (const c of comps) {
    if (c.type !== 'dominoes') continue
    const d = c as unknown as { layout(): { x: number; z: number }[] }
    const unsupported = d.layout().filter((l) => {
      const p = c.w(l.x, 0, l.z)
      return !comps.some((o) => o.type === 'platform' && (() => {
        const b = bounds.get(o.id)!
        return p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && Math.abs(p.y - o.origin.y) < 0.06
      })())
    }).length
    if (unsupported) issues.push({ level: 'error', id: c.id, text: `${unsupported} domino${unsupported > 1 ? 'es are' : ' is'} not standing on a platform` })
  }
  // levers / launchers / marbles hanging in the air
  for (const c of comps) {
    if (c.type !== 'lever' && c.type !== 'marble') continue
    const p = c.origin
    const floor = comps.some((o) => o !== c && SUPPORTED_BELOW.includes(o.type) && inside({ x: p.x, y: p.y - 0.05, z: p.z }, o.id, 0.05))
    if (!floor && p.y > 0.2) issues.push({ level: 'warn', id: c.id, text: `${name(c)} has no visible support underneath` })
  }

  // 4 · signal inputs nobody drives / outputs going nowhere
  for (const c of comps) {
    const wired = scene.connections.some((k) => k.to === c.id)
    if (c.type === 'motor' && !wired && !c.bool('runOnStart')) issues.push({ level: 'error', id: c.id, text: `${name(c)} has no start signal — connect a switch or enable "Run on START"` })
    if (c.type === 'pendulum' && c.bool('latched') && !wired) issues.push({ level: 'error', id: c.id, text: `${name(c)} is latched but nothing is wired to its release` })
    if (c.type === 'launcher' && c.str('trigger') === 'signal' && !wired) issues.push({ level: 'error', id: c.id, text: `${name(c)} waits for a fire signal that is never sent` })
    if (c.type === 'lift' && !c.bool('auto') && !wired) issues.push({ level: 'error', id: c.id, text: `${name(c)} never receives a start signal` })
    if (c.type === 'hopper' && !c.bool('openOnStart') && !wired) issues.push({ level: 'error', id: c.id, text: `${name(c)} is never opened (no wire, no cam drive, not open on START)` })
    if ((c.type === 'conveyor' || c.type === 'turntable') && !wired && c.num('selfRpm') === 0) issues.push({ level: 'warn', id: c.id, text: `${name(c)} has no drive chain and no own motor — it will not move` })
    if (c.type === 'button' && !scene.connections.some((k) => k.from === c.id)) issues.push({ level: 'warn', id: c.id, text: `${name(c)} is not wired to anything` })
  }
  for (const k of scene.connections) {
    if (k.kind === 'mechanical') {
      const a = byId.get(k.from)
      if (a && !a.rotors().length) issues.push({ level: 'error', id: a.id, text: `${name(a)} has no shaft to drive a chain from` })
    }
  }

  // 5 · the final trigger must be reachable
  const fin = comps.find((c) => c.id === scene.finalId) ?? comps.find((c) => c.type === 'final')
  if (!fin) issues.push({ level: 'warn', text: 'No FINAL TRIGGER in this machine — it can run, but it can never be completed' })
  else {
    const wired = scene.connections.some((k) => k.to === fin.id)
    const cup = fin.origin
    const fed = outs.some((o) => o.c !== fin && dist(o.p.pos, cup) < 1.6 && o.p.pos.y >= cup.y - 0.05)
    if (!wired && !fed) issues.push({ level: 'error', id: fin.id, text: `${name(fin)} can never be activated: no track, lift or chute delivers a marble to its cup, and no signal is wired to it` })
  }
  // 6 · something must start the machine
  const starts = comps.some((c) => (c.type === 'hopper' && (c.bool('openOnStart') || scene.connections.some((k) => k.from === '@start' && k.to === c.id))) || (c.type === 'motor' && c.bool('runOnStart')))
  if (!starts && comps.length) issues.push({ level: 'error', text: 'Nothing reacts to START — add a Gravity Drop with "Open on START"' })
  void ({} as Port)
  return issues
}
