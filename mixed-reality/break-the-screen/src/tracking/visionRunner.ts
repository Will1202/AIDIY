import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

// The .task models ship in public/mediapipe/models, next to the WASM runtime, so tracking
// never depends on Google's model bucket (unreachable in some regions).
export const FACE_MODEL = 'face_landmarker.task'
export const HAND_MODEL = 'hand_landmarker.task'

/** `wasmBase` is the absolute …/mediapipe/wasm URL; the models sit in the sibling folder */
const modelUrl = (wasmBase: string, file: string) => new URL(`../models/${file}`, `${wasmBase}/`).href

export interface VisionResult {
  t: number
  w: number
  h: number
  faces: { lm: Float32Array; count: number }[]
  hands: { lm: Float32Array; score: number }[]
  /** inference time for this frame */
  ms: number
  ranFace: boolean
}

type Source = ImageBitmap | HTMLVideoElement

/**
 * Face + hand landmarkers. Runs inside the tracking worker (useModule = true:
 * the ES-module WASM build can be imported from a module worker) and, as a
 * fallback, on the main thread (classic script build).
 */
export class VisionRunner {
  delegate: 'GPU' | 'CPU' = 'GPU'
  private faceMs = 8
  private handMs = 10
  private frame = 0
  private lastTs = 0

  private constructor(
    private face: FaceLandmarker,
    private hand: HandLandmarker,
  ) {}

  static async create(wasmBase: string, useModule: boolean) {
    const fileset = await FilesetResolver.forVisionTasks(wasmBase, useModule)
    // The ES-module loader only runs once (imports are cached) and MediaPipe clears the
    // global factory after each task is built, so a second task would find no factory.
    // Import it ourselves and hand the factory back before every task.
    const g = globalThis as unknown as { ModuleFactory?: unknown }
    const factory = useModule ? (await import(/* @vite-ignore */ fileset.wasmLoaderPath)).default : null
    const arm = () => {
      if (factory) g.ModuleFactory = factory
    }
    const make = async (delegate: 'GPU' | 'CPU') => {
      arm()
      const face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl(wasmBase, FACE_MODEL), delegate },
        runningMode: 'VIDEO',
        numFaces: 2,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
      arm()
      const hand = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl(wasmBase, HAND_MODEL), delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      const r = new VisionRunner(face, hand)
      r.delegate = delegate
      return r
    }
    try {
      return await make('GPU')
    } catch (e) {
      console.warn('[tracking] GPU delegate failed, using CPU', e)
      return await make('CPU')
    }
  }

  detect(src: Source, t: number, w: number, h: number): VisionResult {
    // MediaPipe needs strictly increasing timestamps per task
    const ts = Math.max(t, this.lastTs + 1)
    this.lastTs = ts
    const t0 = performance.now()
    this.frame++
    // if both models together are too slow, the face (head parallax) runs every other frame;
    // hands keep full rate because grabbing is the latency-critical interaction
    const runFace = this.faceMs + this.handMs < 30 || this.frame % 2 === 0
    const faces: VisionResult['faces'] = []
    if (runFace) {
      const f0 = performance.now()
      const fr = this.face.detectForVideo(src, ts)
      this.faceMs += (performance.now() - f0 - this.faceMs) * 0.1
      for (const lms of fr.faceLandmarks ?? []) {
        const a = new Float32Array(lms.length * 3)
        lms.forEach((p, i) => {
          a[i * 3] = p.x
          a[i * 3 + 1] = p.y
          a[i * 3 + 2] = p.z
        })
        faces.push({ lm: a, count: lms.length })
      }
    }
    const h0 = performance.now()
    const hr = this.hand.detectForVideo(src, ts)
    this.handMs += (performance.now() - h0 - this.handMs) * 0.1
    const hands: VisionResult['hands'] = []
    ;(hr.landmarks ?? []).forEach((lms, k) => {
      const a = new Float32Array(63)
      lms.forEach((p, i) => {
        a[i * 3] = p.x
        a[i * 3 + 1] = p.y
        a[i * 3 + 2] = p.z
      })
      hands.push({ lm: a, score: hr.handedness?.[k]?.[0]?.score ?? 0.5 })
    })
    return { t, w, h, faces, hands, ms: performance.now() - t0, ranFace: runFace }
  }

  close() {
    this.face.close()
    this.hand.close()
  }
}
