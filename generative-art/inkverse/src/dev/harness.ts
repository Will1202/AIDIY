import type { BrushKind } from '../core/constants'
import type { Engine } from '../engine/Engine'
import type { P2 } from '../util/path'

/**
 * Dev / ?debug hooks. The browser pane used for automated checks is often hidden
 * (rAF throttled), so tests drive a manual clock and read the canvas back directly.
 */
export function install(e: Engine) {
  const api = {
    e,
    /** stop the rAF loop and step n frames of dt seconds */
    step(n = 1, dt = 1 / 60) {
      e.manualClock = true
      for (let i = 0; i < n; i++) e.frame(dt)
      return api.state()
    },
    run() {
      e.manualClock = false
    },
    /** fast-forward n seconds at a coarser step (keeps calls under the tool timeout) */
    ff(seconds: number, dt = 1 / 30) {
      e.manualClock = true
      const n = Math.round(seconds / dt)
      for (let i = 0; i < n; i++) e.frame(dt)
      return api.state()
    },
    /** scripted stroke through the real brush pipeline; steps the clock until it is done */
    stroke(kind: BrushKind, path: P2[], duration = 1.2, settle = 0) {
      if (e.mode === 'intro') e.enter()
      e.brush.play(kind, path, duration)
      e.manualClock = true
      let guard = 0
      while (e.brush.busy && guard++ < 2000) e.frame(1 / 60)
      for (let i = 0; i < Math.round(settle * 60); i++) e.frame(1 / 60)
      return api.state()
    },
    state() {
      const c = e.rig.camera
      return {
        mode: e.mode,
        cam: c.position.toArray().map((v) => +v.toFixed(2)),
        scaleY: +e.world.scaleY.toFixed(3),
        mountains: e.world.mountains.length,
        patches: e.world.hf.patches.length,
        fps: e.stats.fps,
        ms: +e.stats.ms.toFixed(2),
        stamps: e.ink.stats.stamps,
        sim: e.ink.stats.simSteps,
        calls: e.renderer.info.render.calls,
        tris: e.renderer.info.render.triangles,
        geos: e.renderer.info.memory.geometries,
        texs: e.renderer.info.memory.textures,
      }
    },
    h(x: number, z: number) {
      return +e.world.heightAt(x, z).toFixed(3)
    },
    capture(scale = 0.5, type = 'image/jpeg') {
      const c = e.canvas
      const t = document.createElement('canvas')
      t.width = Math.round(c.width * scale)
      t.height = Math.round(c.height * scale)
      t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height)
      return t.toDataURL(type, 0.88)
    },
    /** POST a capture to the dev server, which writes .shots/<name> */
    async save(name: string, scale = 0.75) {
      const data = api.capture(scale, 'image/jpeg')
      await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: data })
      return name
    },
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
    glError() {
      const gl = e.renderer.getContext()
      return gl.getError()
    },
  }
  ;(window as unknown as { __INK: typeof api }).__INK = api
  return api
}
