import type { Engine } from '../app/engine'
import { useUI } from '../app/store'
import { DT } from '../sim/physics'
import { editor } from '../editor/editor'

/** dev-only hooks for driving the app from the test browser (the pane is often hidden / rAF-throttled) */
export function install(engine: Engine) {
  const api = {
    engine,
    editor,
    ui: () => useUI.getState(),
    /** render n frames of dt seconds each (runs physics like a real frame) */
    frames(n: number, dt = 1 / 60) {
      for (let i = 0; i < n; i++) engine.step(dt)
      return engine.sim.time
    },
    /** fast-forward simulated seconds without rendering each step, then render one frame */
    ff(seconds: number) {
      const w = engine.world
      const steps = Math.round(seconds / DT)
      for (let i = 0; i < steps; i++) {
        w.interp.beforeStep()
        engine.sim.step()
        w.interp.afterStep()
        engine.recorder.afterStep()
        // keep the director's clock moving so its holds / pending cuts behave like real playback
        if (i % 12 === 0) engine.director.shot(useUI.getState().camera, DT * 12, w.interp)
      }
      engine.step(1 / 60)
      return engine.sim.time
    },
    async shot(name: string, w = 1280) {
      const c = engine.world.renderer.domElement
      const out = document.createElement('canvas')
      out.width = w
      out.height = Math.round((w * c.height) / c.width)
      out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height)
      const data = out.toDataURL('image/jpeg', 0.88)
      await fetch(`/__shot?name=${encodeURIComponent(name)}.jpg`, { method: 'POST', body: data })
      return name
    },
    status() {
      const s = engine.sim
      return { t: s.time.toFixed(2), phase: s.phase, fail: s.failReason, fired: s.components.filter((c) => c.status !== 'ARMED' && c.status !== 'IDLE').map((c) => c.id) }
    },
  }
  ;(window as unknown as { __CR: typeof api }).__CR = api
}
