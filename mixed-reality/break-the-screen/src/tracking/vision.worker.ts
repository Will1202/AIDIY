/// <reference lib="webworker" />
import { VisionRunner, type VisionResult } from './visionRunner'

/**
 * Tracking worker: camera frames arrive as transferred ImageBitmaps, the face
 * and hand landmarkers run here, and only landmark arrays go back. Nothing ever
 * leaves the browser; frames are closed as soon as they are processed.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope
let runner: VisionRunner | null = null

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    try {
      runner = await VisionRunner.create(m.wasmBase, true)
      ctx.postMessage({ type: 'ready', delegate: runner.delegate })
    } catch (err) {
      ctx.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) })
    }
  } else if (m.type === 'frame') {
    const bmp = m.bitmap as ImageBitmap
    if (!runner) {
      bmp.close()
      ctx.postMessage({ type: 'skip' })
      return
    }
    let r: VisionResult
    try {
      r = runner.detect(bmp, m.t, bmp.width, bmp.height)
    } catch (err) {
      bmp.close()
      ctx.postMessage({ type: 'skip', message: String(err) })
      return
    }
    bmp.close()
    const transfer: Transferable[] = [...r.faces.map((f) => f.lm.buffer), ...r.hands.map((h) => h.lm.buffer)]
    ctx.postMessage({ type: 'result', result: r }, transfer)
  } else if (m.type === 'close') {
    runner?.close()
    runner = null
    ctx.close()
  }
}
