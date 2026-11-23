// 开发 / 测试钩子：window.__LT。浏览器测试面板通常是隐藏的（rAF 被节流），
// 所以这里提供手动步进、截图、瞬移、直接触发交互等工具。只在 DEV 或 ?debug 时加载。
import type { Game } from '../game/Game'
import { gameStore, metaStore, S } from '../state/store'
import { uiStore } from '../state/ui'
import { Vector3 } from 'three'

export function install(game: Game) {
  if (location.search.includes('test')) game.autoPause = false
  const api = {
    game,
    S,
    state: () => gameStore.getState(),
    meta: () => metaStore.getState(),
    ui: () => uiStore.getState(),
    /** 手动推进 n 帧（每帧 dt 秒），期间暂停自动时钟 */
    frames(n: number, dt = 1 / 60) {
      game.manualClock = true
      for (let i = 0; i < n; i++) game.frame(dt)
      return { t: game.time.toFixed(2), phase: game.phase, world: game.worldId }
    },
    /** 快进若干秒（不逐帧渲染，只推进逻辑），最后渲染一帧 */
    ff(seconds: number, dt = 1 / 30) {
      game.manualClock = true
      const n = Math.round(seconds / dt)
      for (let i = 0; i < n; i++) game.frame(dt)
      return { t: game.time.toFixed(2), phase: game.phase, world: game.worldId }
    },
    resume() {
      game.manualClock = false
    },
    /** 隐藏的测试面板会触发“切到后台自动暂停”，测试时强制恢复 */
    play() {
      game.paused = false
      uiStore.setState({ screen: 'play' })
    },
    async shot(name: string, w = 1280) {
      const c = game.renderer.domElement
      const out = document.createElement('canvas')
      out.width = w
      out.height = Math.round((w * c.height) / c.width)
      out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height)
      const data = out.toDataURL('image/jpeg', 0.88)
      await fetch(`/__shot?name=${encodeURIComponent(name)}.jpg`, { method: 'POST', body: data })
      return name
    },
    tp(x: number, y: number, z: number, yaw = 0, pitch = 0) {
      game.player.teleport(x, y, z, yaw, pitch)
      game.player.applyCamera(game.camera)
    },
    look(x: number, y: number, z: number) {
      const e = game.player.eye
      const d = new Vector3(x - e.x, y - e.y, z - e.z).normalize()
      game.player.yaw = Math.atan2(-d.x, -d.z)
      game.player.pitch = Math.asin(d.y)
      game.player.applyCamera(game.camera)
    },
    /** 直接执行某个交互物体（绕过准星检测，测试谜题逻辑） */
    use(id: string) {
      const it = game.world?.items.find((i) => i.id === id) ?? (game as unknown as { trainItems: { id: string; use: () => void; blocked?: () => string | null }[] }).trainItems.find((i) => i.id === id)
      if (!it) return `no item ${id}`
      const b = it.blocked?.()
      if (b) return `blocked: ${b}`
      it.use()
      return 'ok'
    },
    items() {
      return game.world?.items.map((i) => ({ id: i.id, en: i.enabled ? i.enabled() : true, pos: i.pos.toArray().map((v) => +v.toFixed(2)) }))
    },
    skip() {
      game.director.skip(game.camera)
    },
    press(code: string) {
      game.input.press(code)
      game.frame(1 / 60)
      game.input.release(code)
    },
    info() {
      const r = game.renderer.info
      return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, programs: r.programs?.length, fps: uiStore.getState().fps }
    },
  }
  ;(window as unknown as { __LT: typeof api }).__LT = api
}
