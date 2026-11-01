import { create } from 'zustand'
import type { QualitySetting, Tier } from '../systems/Quality'

export type Phase =
  | 'LOADING'
  | 'IDLE'
  | 'ACTIVATING'
  | 'DISTORTING'
  | 'FRAGMENTING'
  | 'ACCRETING'
  | 'CROSSING'
  | 'PARALLEL_UNIVERSE'
  | 'REBUILDING'

export type AspectMode = 'full' | '16:9' | '9:16'

interface State {
  phase: Phase
  ready: boolean
  introKey: number
  introDone: boolean
  glOk: boolean | null
  sound: boolean
  quality: QualitySetting
  tier: Tier
  cinematic: boolean
  aspect: AspectMode
  uniStage: number
  toast: string | null
  setPhase: (p: Phase) => void
  set: (patch: Partial<State>) => void
  flash: (msg: string) => void
}

let toastTimer = 0

export const useStore = create<State>((set) => ({
  phase: 'LOADING',
  ready: false,
  introKey: 0,
  introDone: false,
  glOk: null,
  sound: true,
  quality: 'auto',
  tier: 'high',
  cinematic: false,
  aspect: 'full',
  uniStage: 0,
  toast: null,
  setPhase: (phase) => set({ phase }),
  set: (patch) => set(patch),
  flash: (msg) => {
    window.clearTimeout(toastTimer)
    set({ toast: msg })
    toastTimer = window.setTimeout(() => set({ toast: null }), 1800)
  },
}))

export const isSequence = (p: Phase) => p !== 'IDLE' && p !== 'PARALLEL_UNIVERSE' && p !== 'LOADING'
