import type { VisionResult } from './visionRunner'

export type CameraStatus =
  | 'OFF'
  | 'REQUESTING'
  | 'LOADING MODELS'
  | 'RUNNING'
  | 'DENIED'
  | 'NO CAMERA'
  | 'UNSUPPORTED'
  | 'ERROR'

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (h: number) => void
}

/**
 * Camera lifecycle + inference scheduling. The camera is only opened after an
 * explicit click; every frame is analysed locally (worker first, main-thread
 * fallback) and never stored or uploaded. Each video frame is analysed at
 * most once, and a new frame is only sent when the previous one came back, so
 * inference can never queue up behind the renderer.
 */
export class TrackingEngine {
  status: CameraStatus = 'OFF'
  message = ''
  mode: 'worker' | 'main' | null = null
  delegate = ''
  readonly video: VideoWithRVFC
  /** tracks of the most recent stream (kept so tests can verify they ended) */
  lastTracks: MediaStreamTrack[] = []
  /** inference results per second */
  fps = 0
  inferMs = 0
  latest: VisionResult | null = null
  onResult: ((r: VisionResult) => void) | null = null
  onStatus: (() => void) | null = null

  private stream: MediaStream | null = null
  private worker: Worker | null = null
  private runner: import('./visionRunner').VisionRunner | null = null
  private busy = false
  private busySince = 0
  private frameReady = false
  private hasRVFC = false
  private lastVideoTime = -1
  private rvfc = 0
  private session = 0
  private count = 0
  private countT = 0

  constructor() {
    const v = document.createElement('video') as VideoWithRVFC
    v.muted = true
    v.playsInline = true
    v.autoplay = true
    v.setAttribute('aria-hidden', 'true')
    // kept in the document (invisible): off-DOM videos may never deliver frame callbacks
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1'
    this.video = v
  }

  get running() {
    return this.status === 'RUNNING'
  }

  private set(status: CameraStatus, message = '') {
    this.status = status
    this.message = message
    this.onStatus?.()
  }

  /** open the camera and load the models. `override` lets tests inject a synthetic stream. */
  async start(override?: MediaStream) {
    if (this.status === 'RUNNING' || this.status === 'REQUESTING' || this.status === 'LOADING MODELS') return
    const session = ++this.session
    if (!override && !navigator.mediaDevices?.getUserMedia) {
      this.set('UNSUPPORTED', 'Camera needs a secure context (localhost or HTTPS).')
      return
    }
    this.set('REQUESTING')
    try {
      this.stream =
        override ??
        (await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
          audio: false,
        }))
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') this.set('DENIED', 'Camera permission was denied. Mouse mode stays fully available.')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') this.set('NO CAMERA', 'No camera found. Mouse mode stays fully available.')
      else this.set('ERROR', String((e as Error)?.message ?? e))
      return
    }
    if (session !== this.session) return this.releaseStream()
    this.lastTracks = this.stream.getTracks()
    if (!this.video.isConnected) document.body.appendChild(this.video)
    this.video.srcObject = this.stream
    try {
      await this.video.play()
    } catch {
      /* autoplay with muted video normally succeeds; frames still arrive */
    }

    this.set('LOADING MODELS', 'Downloading face + hand models (≈11 MB, first time only)…')
    const wasmBase = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, location.href).href.replace(/\/$/, '')
    const ok = (await this.startWorker(wasmBase, session)) || (await this.startMain(wasmBase, session))
    if (session !== this.session) return
    if (!ok) {
      this.releaseStream()
      this.set('ERROR', 'Could not load the tracking models (offline?). Mouse mode stays fully available.')
      return
    }
    this.busy = false
    this.watchFrames()
    this.set('RUNNING')
  }

  private startWorker(wasmBase: string, session: number) {
    return new Promise<boolean>((resolve) => {
      let w: Worker
      try {
        w = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        resolve(false)
        return
      }
      const timeout = setTimeout(() => {
        w.terminate()
        resolve(false)
      }, 45000)
      w.onmessage = (e) => {
        const m = e.data
        if (m.type === 'ready') {
          clearTimeout(timeout)
          if (session !== this.session) {
            w.terminate()
            resolve(false)
            return
          }
          this.worker = w
          this.mode = 'worker'
          this.delegate = m.delegate
          w.onmessage = (ev) => this.onWorker(ev.data)
          resolve(true)
        } else if (m.type === 'error') {
          clearTimeout(timeout)
          console.warn('[tracking] worker init failed:', m.message)
          w.terminate()
          resolve(false)
        }
      }
      w.onerror = (ev) => {
        clearTimeout(timeout)
        console.warn('[tracking] worker error', ev.message)
        w.terminate()
        resolve(false)
      }
      w.postMessage({ type: 'init', wasmBase })
    })
  }

  private async startMain(wasmBase: string, session: number) {
    try {
      const { VisionRunner } = await import('./visionRunner')
      const r = await VisionRunner.create(wasmBase, false)
      if (session !== this.session) {
        r.close()
        return false
      }
      this.runner = r
      this.mode = 'main'
      this.delegate = r.delegate
      return true
    } catch (e) {
      console.warn('[tracking] main-thread init failed', e)
      return false
    }
  }

  private onWorker(m: { type: string; result?: VisionResult }) {
    this.busy = false
    if (m.type === 'result' && m.result) this.deliver(m.result)
  }

  private deliver(r: VisionResult) {
    this.latest = r
    this.inferMs += (r.ms - this.inferMs) * 0.1
    this.count++
    const now = performance.now()
    if (now - this.countT > 1000) {
      this.fps = (this.count * 1000) / (now - this.countT)
      this.count = 0
      this.countT = now
    }
    this.onResult?.(r)
  }

  private watchFrames() {
    const v = this.video
    this.hasRVFC = typeof v.requestVideoFrameCallback === 'function'
    if (this.hasRVFC) {
      const cb = () => {
        this.frameReady = true
        if (this.stream) this.rvfc = v.requestVideoFrameCallback!(cb)
      }
      this.rvfc = v.requestVideoFrameCallback(cb)
    }
  }

  /** called once per render frame: hands the newest unseen camera frame to inference */
  pump() {
    if (this.status !== 'RUNNING') return
    const v = this.video
    if (v.readyState < 2 || !v.videoWidth) return
    if (this.busy) {
      if (performance.now() - this.busySince > 2000) this.busy = false // a lost message must not stall tracking
      return
    }
    // a frame callback or an advanced playhead both mean a frame we haven't analysed yet
    const fresh = (this.hasRVFC && this.frameReady) || v.currentTime !== this.lastVideoTime
    if (!fresh) return
    this.frameReady = false
    this.lastVideoTime = v.currentTime
    const t = performance.now()
    const w = 640
    const h = Math.round((640 * v.videoHeight) / v.videoWidth)
    if (this.mode === 'worker' && this.worker) {
      this.busy = true
      this.busySince = t
      const worker = this.worker
      createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
        .then((bitmap) => {
          if (this.worker !== worker) {
            bitmap.close()
            return
          }
          worker.postMessage({ type: 'frame', bitmap, t }, [bitmap])
        })
        .catch(() => {
          this.busy = false
        })
    } else if (this.mode === 'main' && this.runner) {
      try {
        this.deliver(this.runner.detect(v, t, v.videoWidth, v.videoHeight))
      } catch (e) {
        console.warn('[tracking] detect failed', e)
      }
    }
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.pause()
    this.video.srcObject = null
  }

  /** stop the camera: end every MediaStreamTrack and free the models */
  stop() {
    this.session++
    if (this.rvfc && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.rvfc)
    this.rvfc = 0
    this.releaseStream()
    if (this.worker) {
      this.worker.postMessage({ type: 'close' })
      const w = this.worker
      setTimeout(() => w.terminate(), 500)
      this.worker = null
    }
    this.runner?.close()
    this.runner = null
    this.mode = null
    this.busy = false
    this.latest = null
    this.fps = 0
    this.set('OFF')
  }
}
