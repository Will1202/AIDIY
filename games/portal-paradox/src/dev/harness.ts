import { Vector3 } from 'three'
import type { Engine } from '../engine/Engine'
import type { WorldId } from '../portal/Portal'
import { SUN_SLIT } from '../world/materials'

/**
 * Dev / ?debug test hooks. The browser pane used for automated checks is often
 * hidden (rAF throttled), so tests drive a manual clock and read the canvas
 * back directly.
 */
export function install(e: Engine) {
  const api = {
    e,
    SUN_SLIT,
    /** stop the rAF loop and step n frames of dt seconds */
    step(n = 1, dt = 1 / 60) {
      e.manualClock = true
      for (let i = 0; i < n; i++) e.frame(dt)
      return api.state()
    },
    run() {
      e.manualClock = false
    },
    play() {
      e.playing = true
      e.paused = false
      e.lab.setPower(1)
      e.setPortalTargets(1)
      for (const p of e.portals) { p.open = 1; p.energy = 1 }
    },
    /** put the player's feet at x,y,z in a world */
    tp(world: WorldId, x: number, y: number, z: number, yaw = 0, pitch = 0) {
      e.player.teleport(world, new Vector3(x, y, z), yaw, pitch)
      e.viewWorld = world
    },
    key(code: string, down: boolean) {
      if (down) e.input.keys.add(code)
      else e.input.keys.delete(code)
    },
    act(a: Parameters<Engine['input']['push']>[0]) {
      e.input.push(a)
    },
    state() {
      const p = e.player
      return {
        world: p.world,
        pos: p.position.toArray().map((v) => +v.toFixed(3)),
        yaw: +p.yaw.toFixed(4),
        vel: p.velocity.toArray().map((v) => +v.toFixed(3)),
        viewWorld: e.viewWorld,
        fps: e.stats.fps,
        renders: e.stats.renders,
        draws: e.stats.drawCalls,
        levels: [...e.pipeline.portalRenderer.stats.levels],
        gravity: e.gravityDir,
        rewinding: e.recorder.rewinding,
        history: +e.recorder.seconds.toFixed(2),
        cine: e.director?.active ? +e.director.t.toFixed(2) : null,
      }
    },
    prop(i: number) {
      const p = e.props.props[i]
      const v = p.body.linvel(), w = p.body.angvel()
      return { kind: p.kind, world: p.world, pos: p.currP.toArray().map((x) => +x.toFixed(3)), vel: [v.x, v.y, v.z].map((x) => +x.toFixed(3)), ang: [w.x, w.y, w.z].map((x) => +x.toFixed(3)), teleports: p.teleports }
    },
    /** canvas as data URL (preserveDrawingBuffer is on in dev) */
    capture(scale = 0.5, type = 'image/jpeg') {
      const c = e.canvas
      const t = document.createElement('canvas')
      t.width = Math.round(c.width * scale)
      t.height = Math.round(c.height * scale)
      t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height)
      return t.toDataURL(type, 0.85)
    },
    /** overlay the GL canvas as an <img> so a page screenshot shows it */
    show(scale = 1) {
      let img = document.getElementById('__pp_shot') as HTMLImageElement | null
      if (!img) {
        img = document.createElement('img')
        img.id = '__pp_shot'
        img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;z-index:99999;pointer-events:none;background:#000'
        document.body.appendChild(img)
      }
      img.src = api.capture(scale, 'image/png')
      return true
    },
    /** POST a capture to the dev server, which writes .shots/<name> */
    async save(name: string, scale = 0.75) {
      const data = api.capture(scale, 'image/jpeg')
      await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: data })
      return name
    },
    hide() {
      document.getElementById('__pp_shot')?.remove()
    },
    /** time n frames with a GPU sync, ms per frame */
    bench(n = 30) {
      e.manualClock = true
      const gl = e.renderer.getContext()
      const px = new Uint8Array(4)
      e.frame(1 / 60)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const t0 = performance.now()
      for (let i = 0; i < n; i++) {
        e.frame(1 / 60)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      }
      return +((performance.now() - t0) / n).toFixed(2)
    },
  }
  ;(window as unknown as { __PP: typeof api }).__PP = api
  return api
}
