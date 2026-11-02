import { Vector3 } from 'three'
import { clamp, damp, IPD_CM } from '../core/config'
import { OneEuroN } from '../core/OneEuro'
import type { ViewerSettings } from '../camera/Viewer'

/** one detected face: normalised landmarks (x, y in 0..1 of the raw camera image, z ~ x scale), flat xyz */
export interface FaceLandmarks {
  lm: Float32Array
  count: number
}

export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
}

// MediaPipe face mesh indices (subject's right eye appears on the image's left)
const R_EYE = [33, 133, 159, 145]
const L_EYE = [362, 263, 386, 374]
const NOSE = 1
const CHIN = 152
const FOREHEAD = 10
/** assumed horizontal webcam field of view — only used for the absolute depth guess */
const HFOV = (62 * Math.PI) / 180

export interface RawHead {
  /** eye midpoint in the raw camera image, normalised */
  u: number
  v: number
  /** apparent inter-pupillary distance in image px (3-D, so head yaw shrinks it less) */
  ipdPx: number
  /** lateral / vertical offset from the image centre in cm, in screen coordinates (mirrored) */
  x: number
  y: number
  /** absolute distance guess in cm (assumes HFOV); only ratios to the calibration are trusted */
  z: number
  pose: HeadPose
}

/**
 * Measures a face: the eye corners give a stable head anchor, and the known
 * average inter-pupillary distance turns pixels into centimetres at the face's
 * depth. The camera sees the user un-mirrored, so the user moving to their left
 * moves the face to the image's right: x is negated to land in screen space.
 */
export function measureFace(f: FaceLandmarks, w: number, h: number, invertX = false): RawHead | null {
  const L = f.lm
  if (f.count < 400) return null
  const eye = (ids: number[]) => {
    let x = 0, y = 0, z = 0
    for (const i of ids) {
      x += L[i * 3]
      y += L[i * 3 + 1]
      z += L[i * 3 + 2]
    }
    return [x / ids.length, y / ids.length, z / ids.length]
  }
  const r = eye(R_EYE)
  const l = eye(L_EYE)
  const dx = (l[0] - r[0]) * w
  const dy = (l[1] - r[1]) * h
  const dz = (l[2] - r[2]) * w
  const ipdPx = Math.hypot(dx, dy, dz)
  if (!(ipdPx > 4)) return null
  const u = (l[0] + r[0]) / 2
  const v = (l[1] + r[1]) / 2
  const cmPerPx = IPD_CM / ipdPx
  const sx = invertX ? 1 : -1
  const fpx = w / 2 / Math.tan(HFOV / 2)

  // rough pose from the face's own axes (display only)
  const right = [dx, dy, dz]
  const nose = [L[NOSE * 3] * w, L[NOSE * 3 + 1] * h, L[NOSE * 3 + 2] * w]
  const up = [
    (L[FOREHEAD * 3] - L[CHIN * 3]) * w,
    (L[FOREHEAD * 3 + 1] - L[CHIN * 3 + 1]) * h,
    (L[FOREHEAD * 3 + 2] - L[CHIN * 3 + 2]) * w,
  ]
  const mid = [u * w, v * h]
  const yaw = Math.atan2(nose[0] - mid[0], ipdPx * 0.9) * sx
  const roll = Math.atan2(right[1], right[0])
  const pitch = Math.atan2(up[2], -up[1])

  return {
    u,
    v,
    ipdPx,
    x: sx * (u * w - w / 2) * cmPerPx,
    y: -(v * h - h / 2) * cmPerPx,
    z: (fpx * IPD_CM) / ipdPx,
    pose: { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI, roll: (roll * 180) / Math.PI },
  }
}

export interface HeadState {
  /** a face is locked and fresh */
  present: boolean
  /** filtered eye position (cm, screen coords), relative to calibration: x/y offsets, z absolute */
  cm: Vector3
  confidence: number
  faces: number
  calibrated: boolean
  pose: HeadPose
  raw: RawHead | null
}

/**
 * Locks onto one viewer, filters the head with a One Euro filter, and maps it
 * through the user's calibration (rest pose = the screen-centred eye).
 */
export class HeadTracker {
  readonly state: HeadState = {
    present: false,
    cm: new Vector3(),
    confidence: 0,
    faces: 0,
    calibrated: false,
    pose: { yaw: 0, pitch: 0, roll: 0 },
    raw: null,
  }
  private ref: { x: number; y: number; z: number } | null = null
  private readonly filter = new OneEuroN(3, 0.85, 0.045, 1.2)
  private lock: { u: number; v: number } | null = null
  private lastSeen = -Infinity
  private firstSeen = -Infinity
  private presence = 0
  private stability = 1
  private readonly prev = new Vector3()
  private calibSamples: RawHead[] = []
  private calibrating = false
  /** seconds to keep the last pose before the head counts as lost */
  holdTime = 0.3

  constructor(private settings: ViewerSettings) {}

  /** start capturing the rest pose from the next few frames */
  recalibrate() {
    this.calibrating = true
    this.calibSamples = []
  }

  get isCalibrating() {
    return this.calibrating
  }

  /** feed one camera frame's faces (possibly none). t in seconds. */
  update(faces: FaceLandmarks[], w: number, h: number, t: number) {
    const st = this.state
    st.faces = faces.length
    const dt = Math.min(0.2, Math.max(1e-3, t - (this.lastFrameT ?? t - 1 / 30)))
    this.lastFrameT = t

    // pick the primary viewer: stick to the locked face, else take the closest (largest) one
    let best: RawHead | null = null
    let bestScore = Infinity
    for (const f of faces) {
      const m = measureFace(f, w, h, this.settings.invertX)
      if (!m) continue
      let score: number
      if (this.lock && t - this.lastSeen < 1.0) {
        const d = Math.hypot(m.u - this.lock.u, m.v - this.lock.v)
        if (d > 0.22) continue // someone else walking through the frame
        score = d
      } else {
        score = -m.ipdPx
      }
      if (score < bestScore) {
        bestScore = score
        best = m
      }
    }

    if (best) {
      if (t - this.lastSeen > 1.0) {
        this.filter.reset()
        this.firstSeen = t
      }
      this.lastSeen = t
      this.lock = { u: best.u, v: best.v }
      st.raw = best
      st.pose = best.pose

      if (this.calibrating) {
        this.calibSamples.push(best)
        if (this.calibSamples.length >= 12) this.finishCalibration()
      } else if (!this.ref && t - this.firstSeen > 0.6) {
        // first stable second of tracking: assume the user is sitting at rest
        this.recalibrate()
      }

      const ref = this.ref ?? { x: best.x, y: best.y, z: best.z }
      const vd = this.settings.viewDistanceCm
      const ratio = clamp(best.z / ref.z, 0.45, 2.2)
      const f = this.filter.filter([best.x - ref.x, best.y - ref.y, vd * ratio], t)
      st.cm.set(f[0], f[1], f[2])

      // plausibility: implausible per-frame jumps lower the confidence
      const jump = st.cm.distanceTo(this.prev)
      this.prev.copy(st.cm)
      const jumpPenalty = clamp((jump - 4) / 10, 0, 1)
      this.stability += (1 - jumpPenalty - this.stability) * damp(6, dt)
      this.presence += (1 - this.presence) * damp(6, dt)
    } else {
      this.presence += (0 - this.presence) * damp(3, dt)
    }

    st.present = t - this.lastSeen < this.holdTime
    st.confidence = clamp(this.presence * this.stability, 0, 1)
    st.calibrated = !!this.ref
    return st
  }

  /** call when the camera stops */
  reset() {
    this.filter.reset()
    this.lock = null
    this.lastSeen = -Infinity
    this.presence = 0
    this.state.present = false
    this.state.confidence = 0
    this.state.faces = 0
    this.state.raw = null
    this.lastFrameT = undefined
  }

  private lastFrameT: number | undefined

  private finishCalibration() {
    const n = this.calibSamples.length
    const avg = { x: 0, y: 0, z: 0 }
    for (const s of this.calibSamples) {
      avg.x += s.x / n
      avg.y += s.y / n
      avg.z += s.z / n
    }
    this.ref = avg
    this.calibrating = false
    this.calibSamples = []
    this.filter.reset()
  }
}
