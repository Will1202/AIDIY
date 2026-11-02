import { create } from 'zustand'
import type { CreationMode, GravityMode } from '../core/config'
import type { QualityLevel } from '../engine/Quality'
import type { CameraStatus } from '../tracking/TrackingEngine'
import { DEFAULT_VIEWER, type HeadSource, type ViewerSettings } from '../camera/Viewer'

export type Phase = 'loading' | 'landing' | 'experience'
export type WorldState = 'INTACT' | 'CRACKING' | 'SHATTERED' | 'REBUILDING'
export type FrameMode = 'FULL' | '16:9' | '9:16'

export interface UIState {
  phase: Phase
  loadingMsg: string
  error: string | null
  uiHidden: boolean
  quality: QualityLevel
  autoRes: boolean
  mode: CreationMode
  gravity: GravityMode
  sideways: number
  camera: CameraStatus
  cameraMsg: string
  trackingMode: string
  headSource: HeadSource
  headConf: number
  calibrated: boolean
  calibrating: boolean
  faces: number
  hands: number
  handConf: number
  gripStates: string[]
  fps: number
  renderScale: number
  physMs: number
  bodies: number
  inferFps: number
  inferMs: number
  glass: number
  world: WorldState
  demo: boolean
  demoT: number
  caption: string | null
  title: boolean
  toast: { id: number; text: string } | null
  calibOpen: boolean
  settings: ViewerSettings
  frame: FrameMode
  muted: boolean
  pose: { yaw: number; pitch: number; roll: number }
  eyeCm: [number, number, number]
}

export const useUI = create<UIState>(() => ({
  phase: 'loading',
  loadingMsg: 'INITIALISING',
  error: null,
  uiHidden: false,
  quality: 'HIGH',
  autoRes: true,
  mode: 'PLANET',
  gravity: 'NORMAL',
  sideways: 1,
  camera: 'OFF',
  cameraMsg: '',
  trackingMode: '',
  headSource: 'REST',
  headConf: 0,
  calibrated: false,
  calibrating: false,
  faces: 0,
  hands: 0,
  handConf: 0,
  gripStates: [],
  fps: 0,
  renderScale: 1,
  physMs: 0,
  bodies: 0,
  inferFps: 0,
  inferMs: 0,
  glass: 1,
  world: 'INTACT',
  demo: false,
  demoT: 0,
  caption: null,
  title: false,
  toast: null,
  calibOpen: false,
  settings: loadSettings(),
  frame: 'FULL',
  muted: false,
  pose: { yaw: 0, pitch: 0, roll: 0 },
  eyeCm: [0, 0, 60],
}))

const KEY = 'bts.viewer.v1'

function loadSettings(): ViewerSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_VIEWER, ...JSON.parse(raw) }
  } catch {
    /* private mode / blocked storage: defaults are fine */
  }
  return { ...DEFAULT_VIEWER }
}

export function saveSettings(s: ViewerSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

let toastId = 0
export function toast(text: string) {
  useUI.setState({ toast: { id: ++toastId, text } })
}
