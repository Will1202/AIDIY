import { useEffect } from 'react'
import { useStore } from '../state/store'
import { WORLD_NAMES } from '../portal/Portal'
import { CONTROLS } from './Menu'

export function Hud() {
  const s = useStore()
  useEffect(() => {
    if (!s.toast) return
    const id = setTimeout(() => useStore.getState().set({ toast: null }), 1800)
    return () => clearTimeout(id)
  }, [s.toast])
  if (!s.hud) return s.toast ? <div className="toast">{s.toast}</div> : null
  const toolColor = s.tool === 'portalA' ? 'var(--alpha)' : s.tool === 'portalB' ? 'var(--omega)' : 'var(--ink)'
  return (
    <div className={`hud ${s.rewinding ? 'rewinding' : ''}`}>
      <div className={`crosshair aim-${s.aim} tool-${s.tool} ${s.held ? 'holding' : ''}`} style={{ color: toolColor }}>
        <i className="dot" />
        <i className="ring" />
        <i className="br tl" /><i className="br tr" /><i className="br bl" /><i className="br br2" />
      </div>
      <div className="hud-tl">
        <div className="kicker">{s.world === 0 ? 'LOCATION' : 'LOCATION · UNMAPPED'}</div>
        <div className="hud-world">{WORLD_NAMES[s.world]}</div>
        <div className="kicker dim">LAYOUT · {s.layout === 'gateway' ? 'GATEWAY' : 'MIRROR'} · CROSSINGS {s.crossings}</div>
      </div>
      <div className="hud-tr">
        <div>{s.fps} FPS · {s.quality}</div>
        <div className="dim">{s.renders} RENDERS · DEPTH α{s.levels[0]} Ω{s.levels[1]}</div>
      </div>
      <div className="hud-bottom">
        <div className="slots">
          <div className={`slot ${s.tool === 'hand' ? 'on' : ''}`}><kbd>E</kbd><span>{s.held ? `HOLDING · ${s.held.toUpperCase()}` : 'HAND'}</span></div>
          <div className={`slot alpha ${s.tool === 'portalA' ? 'on' : ''}`}><kbd>1</kbd><span>PORTAL α</span></div>
          <div className={`slot omega ${s.tool === 'portalB' ? 'on' : ''}`}><kbd>2</kbd><span>PORTAL Ω</span></div>
        </div>
      </div>
      <div className="hud-br">
        <div className={`meter grav ${s.gravity < 0 ? 'inv' : ''}`}>
          <span className="kicker">GRAVITY</span>
          <b>{s.gravity < 0 ? '↑ INVERTED' : '↓ NOMINAL'}</b>
          <kbd>G</kbd>
        </div>
        <div className={`meter time ${s.rewinding ? 'on' : ''}`}>
          <span className="kicker">{s.rewinding ? '◀◀ REWINDING' : 'TIME BUFFER'}</span>
          <div className="tbar"><i style={{ transform: `scaleX(${Math.min(1, s.history / 10)})` }} /></div>
          <b>{s.history.toFixed(1)} S</b>
          <kbd>R</kbd>
        </div>
      </div>
      {s.tool !== 'hand' && <div className="hint">AIM AT THE FLOOR · LMB TO ANCHOR · [ ] TO ROTATE · {s.tool === 'portalA' ? '1' : '2'} TO CANCEL</div>}
      {s.toast && <div className="toast">{s.toast}</div>}
      {s.help && (
        <div className="help">
          {CONTROLS.map(([k, v]) => <div key={k} className="ctl"><kbd>{k}</kbd><span>{v}</span></div>)}
        </div>
      )}
    </div>
  )
}
