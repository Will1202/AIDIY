/**
 * Dev-only test harness for hidden / headless previews (load with `?harness`).
 * Background tabs throttle requestAnimationFrame, so it is shimmed with timers,
 * CSS transitions are disabled, and helpers step the film deterministically:
 *   await __H.destroyTo(9)   → press DESTROY and advance to t = 9 s
 *   __H.shot() / __H.noshot() → overlay / remove a copy of the WebGL canvas
 */
import type { Director } from '../systems/Director'

interface EH {
  director: Director
  manual: (on: boolean) => void
  step: (seconds: number, fps?: number) => unknown
}

const w = window as unknown as { __EH?: EH; __H?: unknown }
window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 4)) as typeof window.requestAnimationFrame

const style = document.createElement('style')
style.textContent = '.loader.done{display:none!important} *{transition-duration:0s!important;transition-delay:0s!important}'
document.head.appendChild(style)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let T = 0

async function eh(): Promise<EH> {
  const t0 = performance.now()
  while (!w.__EH && performance.now() - t0 < 15000) await sleep(100)
  if (!w.__EH) throw new Error('director not ready')
  return w.__EH
}

function flush(e: EH) {
  const g = e.director.gl?.renderer.getContext()
  if (g) g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4))
}

const H = {
  async ready() {
    const e = await eh()
    await sleep(2000)
    e.manual(true)
    e.step(1)
    return true
  },
  async destroyTo(target: number) {
    const e = await eh()
    const d = e.director
    d.resetInstant()
    await sleep(400) // let React re-mount the page before anything measures it
    e.step(2.2)
    await sleep(400)
    d.destroy()
    e.step(0.6)
    const t0 = performance.now()
    while (!d.engine.snapshot && performance.now() - t0 < 8000) await sleep(100)
    T = 0.6
    return H.go(target)
  },
  async go(target: number) {
    const e = await eh()
    while (T < target - 1e-6) {
      const dt = Math.min(0.5, target - T)
      e.step(dt)
      T += dt
      flush(e)
    }
    await sleep(200)
    const en = e.director.engine
    return { T: +T.toFixed(2), phase: e.director.currentPhase, shards: en.shardsAlive, bodies: en.bodiesLeft }
  },
  shot() {
    let img = document.getElementById('__shot') as HTMLImageElement | null
    if (!img) {
      img = document.createElement('img')
      img.id = '__shot'
      img.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;pointer-events:none;'
      document.body.appendChild(img)
    }
    img.src = (document.querySelector('canvas.gl') as HTMLCanvasElement).toDataURL('image/jpeg', 0.92)
    return sleep(250)
  },
  noshot() {
    document.getElementById('__shot')?.remove()
  },
}
w.__H = H
