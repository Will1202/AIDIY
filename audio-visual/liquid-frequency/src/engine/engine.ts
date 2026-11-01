import { Euler, Matrix3, Matrix4, Vector3 } from 'three'
import { AudioEngine } from '../audio/AudioEngine'
import { DEMO_CLIMAX } from '../audio/demoScore'
import { approach } from '../audio/features'
import { Climax, DROP_TIMINGS, MANUAL_TIMINGS } from './climax'

export const MODES = [
  { key: '1', index: '01', name: 'CHROME HEART', line: 'Interlaced liquid chrome' },
  { key: '2', index: '02', name: 'MERCURY OCEAN', line: 'A floating body of quicksilver' },
  { key: '3', index: '03', name: 'SHATTERED REALITY', line: 'A sculpture of fragments' },
  { key: '4', index: '04', name: 'SINGULARITY', line: 'Collapsing energy core' },
] as const

export interface RingEvent {
  strength: number
  big: boolean
}

export type ClimaxKind = 'manual' | 'drop' | 'demo'

/**
 * Non-React frame state shared by every GL component. Updated once per frame
 * (useFrame priority -10) before anything renders. Nothing here allocates per
 * frame except the rare ring event.
 */
class Engine {
  readonly audio = new AudioEngine()
  readonly climax = new Climax()

  time = 0
  flow = 0
  stream = 0
  orbit = 0
  dustPhase = 0
  envPhase = 0

  mode = 0
  modeA = 0
  modeB = 0
  modeT = 10
  readonly modeW = [1, 0, 0, 0]
  seed = 0

  bass = 0
  mid = 0
  treble = 0
  energy = 0
  kick = 0
  onset = 0
  pulse = 0
  breath = 0
  release = 0
  envFlash = 0
  shake = 0
  reveal = 1
  title = false

  /** 4 × (age seconds, strength) bass shockwaves travelling over the liquid */
  readonly waves = new Float32Array(8)
  /** One-frame impulses consumed by the shard simulation */
  shardShock = 0
  burst = 0
  readonly ringEvents: RingEvent[] = []
  private lastRingAt = -10

  /** Sculpture orientation: object → world, and its inverse */
  readonly rot = new Matrix3()
  readonly rotInv = new Matrix3()
  private euler = new Euler(0, 0, 0, 'YXZ')
  private m4 = new Matrix4()
  private yaw = 0

  readonly mouse = {
    x: 0,
    y: 0,
    inside: false,
    lastMove: -10,
    strength: 0,
    world: new Vector3(),
    rayO: new Vector3(),
    rayD: new Vector3(0, 0, -1),
  }

  private manualCooldownUntil = 0

  setMode(i: number) {
    if (i === this.mode || i < 0 || i > 3) return
    this.modeA = this.modeB
    this.modeB = i
    this.modeT = 0
    this.mode = i
    this.pushWave(0.7)
  }

  pushWave(s: number) {
    const w = this.waves
    for (let i = 3; i > 0; i--) {
      w[i * 2] = w[(i - 1) * 2]
      w[i * 2 + 1] = w[(i - 1) * 2 + 1]
    }
    w[0] = 0
    w[1] = s
  }

  private onBeat(strength: number) {
    this.pushWave(strength)
    this.shardShock = Math.max(this.shardShock, strength)
    if (strength > 0.55 && this.time - this.lastRingAt > 0.32) {
      this.ringEvents.push({ strength, big: false })
      this.lastRingAt = this.time
    }
  }

  /** User interaction pulse (double-click / tap) — not audio. */
  pulseAt(strength = 1) {
    this.pulse = Math.max(this.pulse, strength)
    this.lastRingAt = -10
    this.onBeat(strength)
  }

  triggerClimax(kind: ClimaxKind) {
    if (this.climax.active) return false
    if (kind === 'manual' && this.time < this.manualCooldownUntil) return false
    const timings =
      kind === 'demo'
        ? { pre: DEMO_CLIMAX.pre, scatter: DEMO_CLIMAX.scatter, gather: DEMO_CLIMAX.gather, reform: DEMO_CLIMAX.reform }
        : kind === 'drop'
          ? DROP_TIMINGS
          : MANUAL_TIMINGS
    const ok = this.climax.trigger(timings)
    if (ok && kind === 'manual') this.manualCooldownUntil = this.time + 1.5
    return ok
  }

  update(dtRaw: number) {
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20)
    this.time += dt
    const a = this.audio
    a.update(dt)
    const f = a.features

    if (f.source === 'demo' && a.playing) {
      this.reveal = a.conductor.reveal
      this.title = a.conductor.title
      if (a.conductor.climaxNow) this.triggerClimax('demo')
    } else {
      this.reveal += (1 - this.reveal) * approach(1.2, dt)
      this.title = false
    }
    if (f.drop && f.source === 'music') this.triggerClimax('drop')

    this.pulse *= Math.exp(-dt * 5)
    this.bass = f.bass
    this.mid = f.mid
    this.treble = f.treble
    this.energy = f.energy
    this.onset = f.onset
    this.kick = Math.max(f.kick, this.pulse)
    this.breath = 0.5 + 0.5 * Math.sin(this.time * 0.9)

    this.shardShock = 0
    for (let i = 0; i < 4; i++) this.waves[i * 2] += dt
    if (f.beat) this.onBeat(f.beatStrength)

    const c = this.climax
    c.update(dt)
    this.burst = 0
    if (c.burst) {
      this.burst = 1
      this.ringEvents.push({ strength: 1.7, big: true }, { strength: 1.1, big: false })
      this.pushWave(1.4)
    }
    if (c.reseed) this.seed = (this.seed + 1) % 64

    const kW = approach(2.2, dt)
    let sum = 0
    for (let i = 0; i < 4; i++) {
      this.modeW[i] += ((i === this.mode ? 1 : 0) - this.modeW[i]) * kW
      sum += this.modeW[i]
    }
    for (let i = 0; i < 4; i++) this.modeW[i] /= sum
    this.modeT += dt

    this.flow += dt * (0.22 + this.mid * 0.85 + this.energy * 0.3 + c.twist * 1.6)
    this.stream += dt * (0.5 + this.treble * 3.2 + c.charge * 2)
    this.orbit += dt * (0.5 + this.energy * 1.5)
    this.dustPhase += dt * (0.45 + this.treble * 2.4 + this.energy * 0.6 + c.explode * 0.3)
    this.envPhase += dt * (0.04 + this.treble * 0.5 + this.onset * 0.9)
    this.release = Math.min(0.5, Math.pow(this.treble, 1.6) * 0.38 + c.charge * 0.25)

    this.yaw += dt * (0.1 + this.mid * 0.4 + this.energy * 0.15 + c.twist * 1.4)
    const pitch = 0.22 * Math.sin(this.flow * 0.23) - 0.08
    const roll = 0.16 * Math.sin(this.flow * 0.17 + 1.0) + c.twist * 0.25
    this.euler.set(pitch, this.yaw, roll)
    this.m4.makeRotationFromEuler(this.euler)
    this.rot.setFromMatrix4(this.m4)
    this.rotInv.copy(this.rot).transpose()

    const m = this.mouse
    const active = m.inside && this.time - m.lastMove < 1.5
    m.strength += ((active ? 1 : 0) - m.strength) * approach(active ? 6 : 1.5, dt)

    this.envFlash = Math.min(2.5, this.kick * 0.8 + this.onset * 0.35 + c.flash * 1.6)
    this.shake = this.kick * 0.5 + c.charge * 0.6 + c.flash * 1.2
  }
}

export const engine = new Engine()
