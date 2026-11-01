import { create } from 'zustand'
import type { QualityLevel } from '../engine/Quality'
import type { Tool } from '../player/Interaction'

export type Phase = 'loading' | 'menu' | 'play' | 'paused' | 'cinematic' | 'error'
export type FrameMode = 'full' | '16:9' | '9:16'

/**
 * Low-frequency UI state only. The engine publishes here at ~10 Hz (or on
 * events); nothing in the render loop reads React state.
 */
export interface UiState {
  phase: Phase
  loading: number
  loadingLabel: string
  error: string | null
  quality: QualityLevel
  tool: Tool
  gravity: number
  rewinding: boolean
  history: number
  world: 0 | 1
  held: string | null
  aim: 'none' | 'grab' | 'pulse'
  fps: number
  renders: number
  levels: number[]
  layout: 'gateway' | 'mirror'
  hud: boolean
  help: boolean
  muted: boolean
  frame: FrameMode
  toast: string | null
  crossings: number
  contextLost: boolean
  /** cinematic caption id + text */
  caption: { id: number; title: string; sub?: string; kind: 'chapter' | 'title' } | null
  cineT: number
  touch: boolean
  set: (s: Partial<UiState>) => void
}

export const useStore = create<UiState>((set) => ({
  phase: 'loading',
  loading: 0,
  loadingLabel: 'BOOT',
  error: null,
  quality: 'MEDIUM',
  tool: 'hand',
  gravity: 1,
  rewinding: false,
  history: 0,
  world: 0,
  held: null,
  aim: 'none',
  fps: 0,
  renders: 1,
  levels: [0, 0],
  layout: 'gateway',
  hud: true,
  help: false,
  muted: false,
  frame: 'full',
  toast: null,
  crossings: 0,
  contextLost: false,
  caption: null,
  cineT: 0,
  touch: false,
  set: (s) => set(s),
}))
