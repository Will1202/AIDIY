export type QualityName = 'high' | 'medium' | 'low'

export interface QualityTier {
  name: QualityName
  /** Upper / lower bound for adaptive device-pixel-ratio */
  dprMax: number
  dprMin: number
  /** Raymarch steps for the liquid sculpture */
  steps: number
  /** Second-bounce self reflections on the chrome */
  bounce: boolean
  /** Shard simulation texture side (count = side²) */
  shardSide: number
  dust: number
  bloom: boolean
}

export const isMobile = (() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
})()

export function detectTier(): QualityTier {
  const url = new URLSearchParams(window.location.search).get('q') as QualityName | null
  const dpr = window.devicePixelRatio || 1
  const cores = navigator.hardwareConcurrency || 4
  const name: QualityName = url ?? (isMobile ? 'low' : cores >= 8 ? 'high' : 'medium')
  switch (name) {
    case 'high':
      return { name, dprMax: Math.min(dpr, 1.5), dprMin: 0.65, steps: 96, bounce: true, shardSide: 64, dust: 9000, bloom: true }
    case 'medium':
      return { name, dprMax: Math.min(dpr, 1.25), dprMin: 0.6, steps: 76, bounce: false, shardSide: 48, dust: 6000, bloom: true }
    default:
      return { name: 'low', dprMax: Math.min(dpr, 1.25), dprMin: 0.5, steps: 56, bounce: false, shardSide: 32, dust: 3500, bloom: true }
  }
}
