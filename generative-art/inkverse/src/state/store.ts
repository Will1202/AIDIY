import { create } from 'zustand'
import type { BrushKind } from '../core/constants'
import type { QualityLevel } from '../engine/Quality'

export type Mode = 'loading' | 'intro' | 'draw' | 'awakening' | 'world' | 'explore' | 'cinematic'
export type TimeOfDay = 'day' | 'sunset' | 'night'

export interface Toast {
  id: number
  text: string
  sub?: string
  tone: 'info' | 'warn'
}

export interface UIState {
  mode: Mode
  brush: BrushKind
  quality: QualityLevel
  sound: boolean
  panel: 'none' | 'weather' | 'quality'
  time: TimeOfDay
  rain: boolean
  wind: boolean
  awakened: boolean
  counts: Record<BrushKind, number>
  toasts: Toast[]
  fps: number
  uiHidden: boolean
  /** end-card of the cinematic demo */
  title: boolean
  /** explore sub-state shown in the HUD */
  pose: 'walk' | 'meditate' | 'observe'
}

export const useUI = create<UIState>(() => ({
  mode: 'loading',
  brush: 'mountain',
  quality: 'HIGH',
  sound: true,
  panel: 'none',
  time: 'day',
  rain: false,
  wind: false,
  awakened: false,
  counts: { mountain: 0, river: 0, life: 0, bridge: 0 },
  toasts: [],
  fps: 60,
  uiHidden: false,
  title: false,
  pose: 'walk',
}))

let toastId = 1
export function toast(text: string, sub?: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const id = toastId++
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, sub, tone }] }))
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}
