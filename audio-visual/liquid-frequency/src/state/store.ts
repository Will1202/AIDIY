import { create } from 'zustand'
import type { TrackInfo } from '../audio/AudioEngine'
import type { SignalSource } from '../audio/features'
import { engine } from '../engine/engine'
import { type QualityTier, detectTier } from '../engine/quality'

export type Aspect = 'full' | '16:9' | '9:16'

export interface Toast {
  id: number
  msg: string
  kind: 'error' | 'info'
}

interface UIState {
  entered: boolean
  mode: number
  source: SignalSource
  playing: boolean
  track: TrackInfo | null
  volume: number
  demoMuted: boolean
  cinematic: boolean
  aspect: Aspect
  help: boolean
  hudHidden: boolean
  toast: Toast | null
  tier: QualityTier
  fps: number
  dpr: number

  enter: () => void
  setMode: (m: number) => void
  setVolume: (v: number) => void
  toggleDemoMute: () => void
  setCinematic: (c: boolean) => void
  setAspect: (a: Aspect) => void
  setHelp: (h: boolean) => void
  toggleHud: () => void
  notify: (msg: string, kind?: Toast['kind']) => void
  loadFile: (f: File) => Promise<void>
  startDemo: () => void
}

let toastId = 0

export const useStore = create<UIState>((set, get) => ({
  entered: false,
  mode: 0,
  source: 'idle',
  playing: false,
  track: null,
  volume: 0.8,
  demoMuted: false,
  cinematic: false,
  aspect: 'full',
  help: false,
  hudHidden: false,
  toast: null,
  tier: detectTier(),
  fps: 0,
  dpr: 1,

  enter: () => {
    if (get().entered) return
    set({ entered: true })
    engine.audio.startDemo()
  },
  setMode: (m) => {
    engine.setMode(m)
    set({ mode: m })
  },
  setVolume: (v) => {
    engine.audio.setVolume(v)
    set({ volume: v })
  },
  toggleDemoMute: () => {
    const m = !get().demoMuted
    engine.audio.setDemoMuted(m)
    set({ demoMuted: m })
  },
  setCinematic: (c) => set({ cinematic: c, help: false }),
  setAspect: (a) => set({ aspect: a }),
  setHelp: (h) => set({ help: h }),
  toggleHud: () => set({ hudHidden: !get().hudHidden }),
  notify: (msg, kind = 'info') => set({ toast: { id: ++toastId, msg, kind } }),
  loadFile: async (f) => {
    if (!get().entered) set({ entered: true })
    const ok = await engine.audio.loadFile(f)
    if (ok) get().notify('LIVE FFT ANALYSIS · 正在实时分析音乐', 'info')
  },
  startDemo: () => {
    engine.audio.startDemo()
  },
}))

engine.audio.events = {
  onTrack: (t) => useStore.setState({ track: t }),
  onPlayState: (p) => useStore.setState({ playing: p }),
  onSource: (s) => useStore.setState({ source: s }),
  onError: (msg) => useStore.getState().notify(msg, 'error'),
  onEnded: () => useStore.getState().notify('TRACK ENDED · 播放结束', 'info'),
}
