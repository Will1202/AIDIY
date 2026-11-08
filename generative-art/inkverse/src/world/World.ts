import { Group, Vector3, type Matrix4, type Ray, type Texture } from 'three'
import { BASE_LEVEL, HALF, LIMITS, PAPER_SCALE_Y, type BrushKind } from '../core/constants'
import { U } from '../render/uniforms'
import { clamp, easeInOutCubic, easeOutCubic, phase } from '../util/math'
import type { StrokePoint } from '../util/path'
import { hashNumbers } from '../util/rng'
import { Heightfield, type Patch } from './Heightfield'
import { buildMountain, type MountainSpec } from './TerrainGenerator'
import { TerrainMesh } from './TerrainMesh'
import { Backdrop } from './Backdrop'
import { buildRiver, RiverEntity } from './RiverGenerator'
import { PineEntity } from './VegetationGenerator'
import { BridgeEntity, planBridge } from './BridgeGenerator'
import { Decor } from './Decor'
import type { QualitySettings } from '../engine/Quality'

export interface StrokeResult {
  ok: boolean
  kind: BrushKind
  message?: string
  sub?: string
  /** wash the stroke's ink off the paper (rejected bridge) */
  erase?: boolean
  at?: { x: number; z: number }
}

export interface MountainEntity {
  main: Patch
  echo: Patch | null
  spec: MountainSpec
  t: number
  done: boolean
}

export interface WorldEvents {
  onMountainRise?(m: MountainSpec): void
  onTreeSprout?(t: PineEntity): void
  onBridgeStart?(b: BridgeEntity): void
  onRiverFlow?(r: RiverEntity): void
}

export interface GroundHit {
  /** world-space height of the walkable surface */
  y: number
  bridge: BridgeEntity | null
  t: number
  lat: number
}

/**
 * The generated world. Owns the heightfield and every entity grown from a stroke,
 * advances their staged growth, and answers spatial queries (ground height, water,
 * picking, collisions) for the brush, the camera and the character.
 */
export class World {
  readonly hf = new Heightfield()
  /** everything pressed into the paper; scale.y < 1 before AWAKEN */
  readonly group = new Group()
  /** trees stand upright and scale uniformly (they are not squashed) */
  readonly props = new Group()
  readonly terrain: TerrainMesh
  readonly backdrop = new Backdrop()
  readonly decor = new Decor()
  readonly mountains: MountainEntity[] = []
  readonly rivers: RiverEntity[] = []
  readonly trees: PineEntity[] = []
  readonly bridges: BridgeEntity[] = []
  scaleY = PAPER_SCALE_Y
  events: WorldEvents = {}
  private q: QualitySettings
  private hit = { y: 0, t: 0, lat: 0 }

  constructor(
    ink: { crisp: Texture; wet: Texture; dry: Texture },
    q: QualitySettings,
    private refl: { texture: Texture; matrix: Matrix4 },
  ) {
    this.q = q
    this.terrain = new TerrainMesh(this.hf, ink, q.terrainStride, q.shadowSteps)
    this.group.add(this.terrain.mesh)
    this.group.add(this.backdrop.ground)
    this.group.add(this.decor.rocks, this.decor.reeds)
    this.group.scale.y = this.scaleY
    this.group.name = 'world'
    this.props.name = 'props'
  }

  setScaleY(s: number) {
    this.scaleY = s
    this.group.scale.y = s
  }

  setQuality(q: QualitySettings) {
    this.q = q
    this.terrain.setQuality(q.terrainStride, q.shadowSteps)
  }

  setReflectionOn(on: boolean) {
    for (const r of this.rivers) r.material.uniforms.uReflOn.value = on ? 1 : 0
  }

  get counts(): Record<BrushKind, number> {
    return { mountain: this.mountains.length, river: this.rivers.length, life: this.trees.length, bridge: this.bridges.length }
  }

  /** a finished stroke from the brush → world generation command */
  addStroke(kind: BrushKind, pts: StrokePoint[]): StrokeResult {
    const first = pts[0]
    const at = first ? { x: first.x, z: first.z } : undefined
    const flat: number[] = []
    for (const p of pts) flat.push(p.x, p.z)
    const seed = hashNumbers(flat, kind.length)

    if (kind === 'mountain') {
      if (this.mountains.length >= LIMITS.mountains) return { ok: false, kind, at, message: '纸上群山已满', sub: 'The paper holds no more mountains — RESET to begin anew' }
      const { main, echo, spec } = buildMountain(this.hf, pts, seed)
      this.hf.add(main)
      if (echo) this.hf.add(echo)
      this.mountains.push({ main, echo, spec, t: 0, done: false })
      return { ok: true, kind, at }
    }

    if (kind === 'river') {
      if (this.rivers.length >= LIMITS.rivers) return { ok: false, kind, at, message: '江河已足', sub: 'Enough rivers on this sheet — RESET to begin anew' }
      const r = buildRiver(pts)
      if (!r) return { ok: false, kind, at, message: '河流太短', sub: 'Too short for a river — draw a longer, winding line' }
      this.hf.add(r.patch)
      const ent = new RiverEntity(r.patch, r.spec, this.hf.texture, this.refl.texture, this.refl.matrix)
      this.group.add(ent.mesh)
      this.rivers.push(ent)
      ent.seed = seed
      this.events.onRiverFlow?.(ent)
      return { ok: true, kind, at }
    }

    if (kind === 'life') {
      let planted = 0
      let wet = 0
      pts.forEach((p, i) => {
        if (this.trees.length >= LIMITS.trees) return
        if (Math.abs(p.x) > HALF - 3 || Math.abs(p.z) > HALF - 3) return
        if (this.hf.waterDepth(p.x, p.z) > 0.08 || this.hf.waterMask(p.x, p.z) > 0.5) {
          wet++
          return
        }
        const tree = new PineEntity(p.x, p.z, hashNumbers([p.x, p.z], 77 + i), this.q.trunkSides, this.q.padDetail, 0.6 + i * 0.22)
        this.trees.push(tree)
        this.props.add(tree.group)
        this.placeTree(tree)
        this.events.onTreeSprout?.(tree)
        planted++
      })
      if (!planted && wet) return { ok: false, kind, at, message: '水中不宜种松', sub: 'Pines cannot grow in the water — drop the ink on land' }
      if (!planted && this.trees.length >= LIMITS.trees) return { ok: false, kind, at, message: '林已满山', sub: 'The forest is full — RESET to begin anew' }
      return { ok: planted > 0, kind, at }
    }

    // bridge
    if (this.bridges.length >= LIMITS.bridges) return { ok: false, kind, at, erase: true, message: '桥已足够', sub: 'Enough bridges — RESET to begin anew' }
    const plan = planBridge(this.hf, pts)
    if (!plan.ok) return { ok: false, kind, at, erase: true, message: plan.message, sub: plan.sub }
    const b = new BridgeEntity(plan.spec, this.hf, seed)
    this.group.add(b.mesh)
    this.bridges.push(b)
    this.events.onBridgeStart?.(b)
    return { ok: true, kind, at }
  }

  private placeTree(t: PineEntity) {
    const k = clamp((this.scaleY - PAPER_SCALE_Y) / (1 - PAPER_SCALE_Y))
    const s = 0.72 + 0.28 * k
    t.group.position.set(t.x, this.heightAt(t.x, t.z) - 0.15 * s, t.z)
    t.group.scale.setScalar(s)
  }

  update(dt: number) {
    for (const m of this.mountains) {
      if (m.done) continue
      const prev = m.t
      m.t += dt
      // stage 3: the ink lifts into a ridge · stage 4: cliffs & gullies · stage 5: pale echo range
      m.main.grow = easeInOutCubic(phase(m.t, 0.45, 2.3))
      m.main.detailGrow = easeOutCubic(phase(m.t, 1.6, 1.7))
      if (m.echo) {
        m.echo.grow = easeInOutCubic(phase(m.t, 2.6, 2.6))
        m.echo.detailGrow = m.echo.grow
      }
      if (prev < 0.45 && m.t >= 0.45) this.events.onMountainRise?.(m.spec)
      if (m.t > 5.4) {
        m.main.grow = m.main.detailGrow = 1
        if (m.echo) m.echo.grow = m.echo.detailGrow = 1
        m.done = true
      }
      this.hf.markDirty()
    }
    for (const r of this.rivers) {
      if (r.update(dt)) this.hf.markDirty()
      else if (!r.decorated) {
        r.decorated = true
        this.hf.markDirty()
        this.hf.rebuild()
        this.decor.decorateRiver(r.spec, this.hf, r.seed, U.uTime.value)
      }
    }
    this.hf.rebuild()
    for (const t of this.trees) {
      t.update(dt)
      this.placeTree(t)
    }
    for (const b of this.bridges) b.update(dt)
  }

  /** world-space terrain height */
  heightAt(x: number, z: number) {
    return this.hf.sample(x, z) * this.scaleY
  }

  /** world-space water depth at a point (0 on land) */
  waterDepth(x: number, z: number) {
    return this.hf.waterDepth(x, z) * this.scaleY
  }

  /**
   * highest walkable surface under (x,z) that the feet at `feetY` can step onto:
   * the terrain or a finished bridge deck.
   */
  groundAt(x: number, z: number, feetY: number, stepUp = 0.8, out: GroundHit = { y: 0, bridge: null, t: 0, lat: 0 }): GroundHit {
    out.y = this.heightAt(x, z)
    out.bridge = null
    for (const b of this.bridges) {
      const s = b.surface(x, z, this.hit)
      if (!s) continue
      const y = s.y * this.scaleY
      if (y <= feetY + stepUp && y > out.y - 0.05) {
        out.y = Math.max(out.y, y)
        out.bridge = b
        out.t = s.t
        out.lat = s.lat
      }
    }
    return out
  }

  /** ray → point on the land (march + bisection); null if it leaves the paper */
  pick(ray: Ray, out = new Vector3()): Vector3 | null {
    const o = ray.origin
    const d = ray.direction
    if (d.y > -1e-4 && o.y > 200) return null
    let t = 0
    let prevT = 0
    const maxT = 3000
    for (let i = 0; i < 600 && t < maxT; i++) {
      const x = o.x + d.x * t
      const y = o.y + d.y * t
      const z = o.z + d.z * t
      const h = Math.abs(x) <= HALF && Math.abs(z) <= HALF ? this.heightAt(x, z) : BASE_LEVEL * this.scaleY
      if (y <= h) {
        let a = prevT
        let b = t
        for (let k = 0; k < 18; k++) {
          const m = (a + b) / 2
          const mx = o.x + d.x * m
          const mz = o.z + d.z * m
          if (o.y + d.y * m <= this.heightAt(mx, mz)) b = m
          else a = m
        }
        out.set(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b)
        if (Math.abs(out.x) > HALF - 1 || Math.abs(out.z) > HALF - 1) return null
        return out
      }
      prevT = t
      t += Math.max(0.25, (y - h) * 0.45)
    }
    return null
  }

  get growing() {
    return this.mountains.some((m) => !m.done) || this.rivers.some((r) => !r.done) || this.trees.some((t) => !t.done) || this.bridges.some((b) => !b.done)
  }

  reset() {
    this.mountains.length = 0
    for (const r of this.rivers) {
      this.group.remove(r.mesh)
      r.dispose()
    }
    this.rivers.length = 0
    for (const t of this.trees) {
      this.props.remove(t.group)
      t.dispose()
    }
    this.trees.length = 0
    for (const b of this.bridges) {
      this.group.remove(b.mesh)
      b.dispose()
    }
    this.bridges.length = 0
    this.decor.reset()
    this.hf.reset()
  }

  dispose() {
    this.reset()
    this.terrain.dispose()
    this.backdrop.dispose()
    this.decor.dispose()
    this.hf.dispose()
  }
}
