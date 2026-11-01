import { memo } from 'react'
import { isSequence, useStore } from '../state/store'
import { Split } from './Split'
import type { QualitySetting } from '../systems/Quality'

interface UniverseProps {
  onRebuild: () => void
}

export const UniverseOverlay = memo(function UniverseOverlay({ onRebuild }: UniverseProps) {
  const stage = useStore((s) => s.uniStage)
  const phase = useStore((s) => s.phase)
  const live = phase === 'PARALLEL_UNIVERSE'
  return (
    <div className={`universe s${stage}`} aria-hidden={stage === 0}>
      <div className="u-kicker">UNIVERSE Δ-02 · SIGNAL REACQUIRED</div>
      <h2 className="u-title">
        <Split text="REALITY IS ONLY" />
        <br />
        <Split text="ONE POSSIBILITY." />
      </h2>
      <p className="u-sub">EXPLORE THE OTHER SIDE</p>
      <button className="rebuild" onClick={onRebuild} disabled={!live || stage < 3} tabIndex={stage < 3 ? -1 : 0}>
        <span>REBUILD REALITY</span>
      </button>
    </div>
  )
})

export const Loader = memo(function Loader() {
  const ready = useStore((s) => s.ready)
  return (
    <div className={`loader${ready ? ' done' : ''}`} aria-hidden={ready}>
      <div className="loader-ring" />
      <span>ACQUIRING SIGNAL</span>
    </div>
  )
})

export const Toast = memo(function Toast() {
  const toast = useStore((s) => s.toast)
  return <div className={`toast${toast ? ' on' : ''}`}>{toast}</div>
})

export const CssBlackHole = memo(function CssBlackHole() {
  return (
    <div className="css-bh" aria-hidden>
      <div className="css-disk" />
      <div className="css-shadow" />
    </div>
  )
})

interface DockProps {
  onSound: () => void
  onQuality: () => void
  onCinematic: () => void
  onReplay: () => void
  onAspect: () => void
  onFullscreen: () => void
}

const Q_LABEL: Record<QualitySetting, string> = { auto: 'AUTO', low: 'LOW', medium: 'MED', high: 'HIGH', ultra: 'ULTRA' }

export const Dock = memo(function Dock(p: DockProps) {
  const sound = useStore((s) => s.sound)
  const quality = useStore((s) => s.quality)
  const tier = useStore((s) => s.tier)
  const cinematic = useStore((s) => s.cinematic)
  const aspect = useStore((s) => s.aspect)
  const phase = useStore((s) => s.phase)
  const ready = useStore((s) => s.ready)
  const hidden = cinematic || isSequence(phase) || !ready
  return (
    <div className={`dock${hidden ? ' hidden' : ''}`} role="toolbar" aria-label="Controls">
      <button onClick={p.onSound} title="Sound (M)">
        <i className={`ico-sound${sound ? ' on' : ''}`} />
        SOUND <b>{sound ? 'ON' : 'OFF'}</b>
      </button>
      <button onClick={p.onQuality} className="opt" title="Quality (Q)">
        QUALITY <b>{Q_LABEL[quality]}</b>
        {quality === 'auto' ? <em>{Q_LABEL[tier]}</em> : null}
      </button>
      <button onClick={p.onAspect} className="opt" title="Recording frame (A)">
        FRAME <b>{aspect === 'full' ? 'FULL' : aspect}</b>
      </button>
      <button onClick={p.onCinematic} title="Cinematic mode (C)">
        CINEMATIC
      </button>
      <button onClick={p.onReplay} className="replay" title="Demo replay (D)">
        ▶ REPLAY
      </button>
      <button onClick={p.onFullscreen} className="opt" title="Fullscreen (F)" aria-label="Fullscreen">
        ⤢
      </button>
    </div>
  )
})
