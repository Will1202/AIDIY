import { useState } from 'react'
import { engine } from '../engine/instance'
import { QUALITY_LEVELS } from '../engine/Quality'
import { useStore, type FrameMode } from '../state/store'

export function PauseMenu() {
  const quality = useStore((s) => s.quality)
  const frame = useStore((s) => s.frame)
  const layout = useStore((s) => s.layout)
  const muted = useStore((s) => s.muted)
  const e = engine()
  const [sens, setSens] = useState(() => (e ? e.player.sensitivity * 1000 : 2.2))
  const [invert, setInvert] = useState(() => !!e?.player.invertY)
  const [fov, setFov] = useState(() => e?.baseFov ?? 72)
  return (
    <div className="overlay pause">
      <div className="panel wide">
        <div className="kicker">PAUSED · SETTINGS</div>
        <div className="row">
          <button className="btn primary" onClick={() => engine()?.resume()}>RESUME</button>
          <button className="btn" onClick={() => engine()?.director?.start()}>SHOWCASE · 30 S</button>
          <button className="btn" onClick={() => { engine()?.resetWorld(); engine()?.resume() }}>RESET WORLD</button>
        </div>
        <div className="seg">
          <span className="seg-label">QUALITY</span>
          {QUALITY_LEVELS.map((l) => <button key={l} className={l === quality ? 'on' : ''} onClick={() => engine()?.setQuality(l)}>{l}</button>)}
        </div>
        <div className="seg">
          <span className="seg-label">FRAME</span>
          {(['full', '16:9', '9:16'] as FrameMode[]).map((f) => (
            <button key={f} className={f === frame ? 'on' : ''} onClick={() => { const en = engine(); if (!en) return; while (en.frameMode !== f) en.cycleFrame() }}>{f.toUpperCase()}</button>
          ))}
        </div>
        <div className="seg">
          <span className="seg-label">LAYOUT</span>
          {(['gateway', 'mirror'] as const).map((l) => (
            <button key={l} className={l === layout ? 'on' : ''} onClick={() => { const en = engine(); if (en && en.layout !== l) en.switchLayout(l) }}>{l.toUpperCase()}</button>
          ))}
        </div>
        <label className="slider">
          <span>MOUSE SENSITIVITY</span>
          <input type="range" min={0.6} max={6} step={0.1} value={sens} onChange={(ev) => { const v = +ev.target.value; setSens(v); if (e) e.player.sensitivity = v / 1000 }} />
          <b>{sens.toFixed(1)}</b>
        </label>
        <label className="slider">
          <span>FIELD OF VIEW</span>
          <input type="range" min={55} max={100} step={1} value={fov} onChange={(ev) => { const v = +ev.target.value; setFov(v); if (e) { e.baseFov = v; e.applyCamera() } }} />
          <b>{fov}°</b>
        </label>
        <div className="row">
          <button className={`btn small ${invert ? 'on' : ''}`} onClick={() => { const v = !invert; setInvert(v); if (e) e.player.invertY = v }}>INVERT Y · {invert ? 'ON' : 'OFF'}</button>
          <button className={`btn small ${muted ? 'on' : ''}`} onClick={() => { e?.audio?.setMuted(!muted); useStore.getState().set({ muted: !muted }) }}>SOUND · {muted ? 'OFF' : 'ON'}</button>
        </div>
        <p className="dim small">ESC releases the mouse. Click RESUME (or anywhere in the view) to continue.</p>
      </div>
    </div>
  )
}
