import { create } from 'zustand'
import type { SimPhase } from '../sim/simulation'
import type { Status } from '../sim/component'
import type { CameraMode } from '../camera/rig'
import type { QualityLevel } from '../render/quality'

export type RunState = 'ready' | 'running' | 'paused' | 'rewinding'
export type Format = 'fill' | '16:9' | '9:16'

export interface TraceRow {
  id: string
  label: string
  zone: number
  type: string
  status: Status
  progress: string
  drive: string
}

export interface Issue {
  level: 'error' | 'warn'
  id?: string
  text: string
}

export interface UIState {
  screen: 'landing' | 'experience'
  mode: 'demo' | 'build'
  cinematic: boolean
  run: RunState
  phase: SimPhase
  speed: number
  quality: QualityLevel
  camera: CameraMode
  format: Format
  muted: boolean
  hud: {
    time: number
    fired: number
    total: number
    zone: number
    last: string
    bodies: number
    stepsPerSec: number
    fps: number
    physicsMs: number
    recorded: number
    rewindAt: number
    shot: string
  }
  trace: TraceRow[]
  failReason: string
  title: { big?: string; small?: string; key: number } | null
  // editor
  selected: string | null
  issues: Issue[]
  canUndo: boolean
  canRedo: boolean
  snap: boolean
  placing: string | null
  sceneName: string
  toast: string | null
  set: (p: Partial<UIState>) => void
}

export const useUI = create<UIState>((set) => ({
  screen: 'landing',
  mode: 'demo',
  cinematic: false,
  run: 'ready',
  phase: 'READY',
  speed: 1,
  quality: 'MEDIUM',
  camera: 'director',
  format: 'fill',
  muted: false,
  hud: { time: 0, fired: 0, total: 0, zone: 1, last: '', bodies: 0, stepsPerSec: 0, fps: 0, physicsMs: 0, recorded: 0, rewindAt: 0, shot: '' },
  trace: [],
  failReason: '',
  title: null,
  selected: null,
  issues: [],
  canUndo: false,
  canRedo: false,
  snap: true,
  placing: null,
  sceneName: 'The Grand Contraption',
  toast: null,
  set: (p) => set(p),
}))
