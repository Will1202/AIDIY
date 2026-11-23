// 无渲染模拟器：在 Node 里构建真实的世界（几何、碰撞、交互、谜题逻辑），用真实的角色控制器走路，
// 验证每条通关路线确实可走、错误状态下确实走不过去。
import { PerspectiveCamera, Vector3 } from 'three'
import { defaultFx } from '../engine/pipeline'
import { QUALITY } from '../engine/quality'
import { Player } from '../player/Player'
import type { Input } from '../player/Input'
import type { GameApi, Note, Shot } from '../game/api'
import type { World } from '../world/World'
import { Train } from '../world/shared/Train'
import { Conductor } from '../world/shared/Conductor'
import { S, gameStore, newGameData } from '../state/store'
import type { AudioEngine } from '../audio/AudioEngine'
import type { WorldId } from '../game/types'

export interface Log {
  says: string[]
  reads: Note[]
  dialogues: string[]
  moments: string[]
  endings: string[]
  departs: WorldId[]
}

class FakeInput {
  keys = new Set<string>()
  hits = new Set<string>()
  moveX = 0
  moveY = 0
  lookDX = 0
  lookDY = 0
  touchRun = false
  enabled = true
  down(c: string) { return this.keys.has(c) }
  hit(c: string) { return this.hits.has(c) }
}

const audioStub = new Proxy({}, { get: () => () => null }) as unknown as AudioEngine

export function resetState() {
  gameStore.setState(newGameData(), true)
}

export function mockGame() {
  const log: Log = { says: [], reads: [], dialogues: [], moments: [], endings: [], departs: [] }
  const player = new Player()
  const input = new FakeInput()
  const train = new Train(QUALITY.LOW)
  train.build()
  train.door = 1
  train.setDoors(true)
  const conductor = new Conductor()
  const api: GameApi & { input: FakeInput; log: Log; time: number; player: Player } = {
    time: 0,
    camera: new PerspectiveCamera(),
    fx: defaultFx(),
    audio: audioStub,
    player,
    train,
    conductor,
    keys: input,
    input,
    log,
    docked: true,
    inCinematic: false,
    say: (_w, t) => log.says.push(t),
    toast: () => {},
    read: (n) => log.reads.push(n),
    pickup: (i) => { S.give(i) },
    archive: (id) => { S.addArchive(id); S.markRead(id) },
    collect: (id) => { S.collect(id) },
    dialogue: (id) => log.dialogues.push(id),
    keypad: (_id, _t, _l, check) => { (api as unknown as { keypadCheck: typeof check }).keypadCheck = check },
    openSonar: () => {},
    openRadio: () => {},
    manipulate: () => {},
    sfx: () => {},
    cinematic: async (shots: Shot[]) => {
      for (const s of shots) {
        s.start?.()
        s.tick?.(1, 0)
      }
    },
    moment: (m) => log.moments.push(m),
    ending: (e) => log.endings.push(e),
    flash: () => {},
    save: () => {},
    refresh: () => {},
    requestDepart: (w) => log.departs.push(w),
    setEyes: () => {},
    setFade: () => {},
    renderSize: { w: 2, h: 2 },
  }
  return api
}

export type MockGame = ReturnType<typeof mockGame>

export async function buildWorld(W: new () => World, g: MockGame) {
  const w = new W()
  w.init(g, QUALITY.LOW)
  await w.build()
  return w
}

/** 推进世界与角色 dt 秒（固定步长），不移动 */
export function step(g: MockGame, w: World, seconds: number, dt = 1 / 60) {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    g.time += dt
    g.train.update(dt, g.time)
    w.update(dt, g.time)
    g.player.update(dt, g.input as unknown as Input, [g.train.col, w.col], { sensitivity: 1, invertY: false, headBob: false }, true)
    fireTriggers(g, w)
  }
}

function fireTriggers(g: MockGame, w: World) {
  const b = g.player.body
  for (const t of w.triggers) {
    const inside = b.x >= t.min.x && b.x <= t.max.x && b.y >= t.min.y && b.y <= t.max.y && b.z >= t.min.z && b.z <= t.max.z
    if (inside && !t.inside) {
      t.inside = true
      if (!(t.once && t.fired)) {
        t.fired = true
        t.enter?.()
      }
    } else if (!inside && t.inside) {
      t.inside = false
      t.exit?.()
    }
    if (inside) t.stay?.(1 / 60)
  }
}

/**
 * 沿路点行走（真实控制器 + 真实碰撞）。每个路点 2 秒没有靠近就判定失败。
 * 返回 { ok, at } —— 用来断言“能走到 / 走不到”。
 */
export function walk(g: MockGame, w: World, path: [number, number][], opts: { run?: boolean; maxPerPoint?: number } = {}) {
  const p = g.player
  for (const [tx, tz] of path) {
    let t = 0
    const max = opts.maxPerPoint ?? 12
    while (Math.hypot(p.body.x - tx, p.body.z - tz) > 0.35) {
      const dx = tx - p.body.x, dz = tz - p.body.z
      // 在当前参考系里朝目标走：反重力时参考系绕水平轴转了 180°，用 horizontalForward 校正
      const want = new Vector3(dx, 0, dz).normalize()
      p.yaw = 0
      const f0 = p.horizontalForward(new Vector3())
      const a0 = Math.atan2(f0.x, f0.z)
      const a1 = Math.atan2(want.x, want.z)
      p.yaw = (p.g > 0 ? 1 : -1) * (a1 - a0)
      g.input.moveY = 1
      g.input.keys.clear()
      if (opts.run) g.input.touchRun = true
      step(g, w, 1 / 60)
      t += 1 / 60
      if (p.body.y < -40 || p.body.y > 150) return { ok: false, at: [p.body.x, p.body.y, p.body.z], fell: true }
      if (t > max) {
        g.input.moveY = 0
        return { ok: false, at: [p.body.x, p.body.y, p.body.z], fell: false }
      }
    }
  }
  g.input.moveY = 0
  g.input.touchRun = false
  step(g, w, 0.3)
  return { ok: true, at: [p.body.x, p.body.y, p.body.z], fell: false }
}

/** 执行某个交互（检查 enabled / blocked / gravity，像玩家按 E 一样） */
export function use(g: MockGame, w: World, id: string): string {
  const it = w.items.find((i) => i.id === id)
  if (!it) throw new Error(`no item ${id}`)
  if (it.enabled && !it.enabled()) return 'disabled'
  if (it.gravity && it.gravity !== g.player.g) return 'wrong-gravity'
  const b = it.blocked?.()
  if (b) return `blocked:${b}`
  // 距离检查：必须真的走到附近
  const d = it.pos.distanceTo(g.player.eye)
  if (d > (it.range ?? 2.6) + it.radius + 0.5) return `too-far:${d.toFixed(1)}`
  it.use()
  return 'ok'
}
