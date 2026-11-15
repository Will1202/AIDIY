import { useEffect, useRef, useState } from 'react'
import { engine } from './app/engine'
import { useUI } from './app/store'
import { ZONE_NAMES } from './sim/schema'
import { CAMERA_LABEL, CAMERA_MODES } from './camera/rig'
import { QUALITY_LEVELS } from './render/quality'
import { BuildUI } from './ui/BuildUI'
import { editor } from './editor/editor'

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const screen = useUI((s) => s.screen)
  const format = useUI((s) => s.format)
  const mode = useUI((s) => s.mode)
  const cinematic = useUI((s) => s.cinematic)

  useEffect(() => {
    let alive = true
    engine.init(canvas.current!).then(() => {
      if (!alive) return
      editor.attach(engine)
      setReady(true)
      const q = new URLSearchParams(location.search)
      if (q.has('cinematic')) void engine.cinematic()
      else if (q.has('build')) { useUI.getState().set({ screen: 'experience' }); editor.enter() }
      else if (q.has('play')) useUI.getState().set({ screen: 'experience' })
    })
    if (import.meta.env.DEV) import('./dev/harness').then((h) => h.install(engine))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      const s = useUI.getState()
      if (s.mode === 'build') return
      if (e.code === 'Space') { e.preventDefault(); s.run === 'running' ? engine.pause() : engine.resume() }
      if (e.key === 'r' || e.key === 'R') engine.reset()
      if (e.key === 'b' || e.key === 'B') engine.toggleRewind()
      if (e.key === 'c' || e.key === 'C') { const i = CAMERA_MODES.indexOf(s.camera); engine.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  return (
    <div className="stage">
      <div className={`frame ${format === '16:9' ? 'f169' : format === '9:16' ? 'f916' : ''}`}>
        <canvas ref={canvas} />
        <div className="ui">
          {!ready && <div className="caption" style={{ left: 22, bottom: 22 }}>ASSEMBLING THE MACHINE…</div>}
          {ready && screen === 'landing' && <Landing />}
          {ready && screen === 'experience' && mode === 'demo' && !cinematic && <Hud />}
          {ready && screen === 'experience' && mode === 'build' && <BuildUI />}
          {ready && cinematic && <Cinema />}
          <Titles />
        </div>
      </div>
    </div>
  )
}

function Landing() {
  const go = async (what: 'start' | 'build' | 'cinema') => {
    const s = useUI.getState()
    if (what === 'cinema') return engine.cinematic()
    s.set({ screen: 'experience' })
    if (what === 'build') { await engine.audio.start(); editor.enter(); return }
    engine.setCamera('director')
    await engine.start()
  }
  return (
    <div className="landing">
      <div className="kicker">A real-physics kinetic sculpture · 14 mechanisms · 8 zones</div>
      <h1><span>CHAIN</span><span>REACTION</span></h1>
      <div className="sub">The Butterfly Machine</div>
      <div className="tag"><b>One marble.</b> A thousand consequences. · 一颗小球，撬动整个世界</div>
      <div className="actions">
        <button className="cta primary" onClick={() => go('start')}>Start the machine <i>▶</i></button>
        <button className="cta" onClick={() => go('build')}>Build your own <i>EDITOR</i></button>
        <button className="cta" onClick={() => go('cinema')}>Watch cinematic <i>FILM</i></button>
      </div>
      <div className="zones">
        {Object.entries(ZONE_NAMES).map(([k, v]) => <div key={k}><b>{k.padStart(2, '0')}</b>{v}</div>)}
      </div>
      <div className="foot">Rapier rigid-body physics · fixed 120 Hz step · every trigger is a real contact, joint or sensor</div>
    </div>
  )
}

function Hud() {
  const hud = useUI((s) => s.hud)
  const phase = useUI((s) => s.phase)
  const run = useUI((s) => s.run)
  const trace = useUI((s) => s.trace)
  const fail = useUI((s) => s.failReason)
  const camera = useUI((s) => s.camera)
  return (
    <>
      <div className="brand">
        <span className="logo" onClick={() => useUI.getState().set({ screen: 'landing' })}>CHAIN <em>REACTION</em></span>
        <span className="zone"><b>ZONE {String(hud.zone).padStart(2, '0')}</b> · {ZONE_NAMES[hud.zone] ?? ''}</span>
      </div>
      <div className="telemetry">
        <div className="t">T+ {fmt(hud.time)}</div>
        <div className="bar"><div style={{ width: `${(100 * hud.fired) / Math.max(1, hud.total)}%` }} /></div>
        <div className="row"><span>TRIGGERED</span><span>{hud.fired} / {hud.total}</span></div>
        <div className="row"><span>STATE</span><span className={`state st-${phase}`}>{run === 'rewinding' ? 'REWINDING' : run === 'paused' ? 'PAUSED' : phase}</span></div>
        <div className="row"><span>LAST EVENT</span><span title={hud.last}>{hud.last}</span></div>
        <div className="row"><span>PHYSICS</span><span>{Math.round(hud.stepsPerSec)} steps/s · {hud.bodies} bodies</span></div>
        <div className="row"><span>SOLVER</span><span>{hud.physicsMs.toFixed(1)} ms · {Math.round(hud.fps)} fps</span></div>
        <div className="row"><span>HISTORY</span><span>{hud.recorded.toFixed(1)} s recorded</span></div>
      </div>
      <div className="trace">
        <h4>Causal chain</h4>
        {trace.map((r) => (
          <div key={r.id} className={`r ${r.status}`} title={`${r.type} · ${r.drive} · ${r.status}`} onClick={() => { engine.macroId = r.id; engine.setCamera('macro') }}>
            <span className="d" />
            <span className="n"><span className="z">{String(r.zone).padStart(2, '0')}</span>{r.label}</span>
            <span className="p">{r.progress}</span>
          </div>
        ))}
      </div>
      {phase === 'FAILED' && fail && <div className="fail"><b>CHAIN BROKEN</b>{fail}</div>}
      {phase === 'COMPLETED' && <div className="done">✦ THE FINAL MACHINE HAS BEEN ACTIVATED ✦</div>}
      {run === 'rewinding' && <div className="rewind-badge">◀◀ REWINDING TIME</div>}
      <div className="caption">{CAMERA_LABEL[camera]} {camera === 'director' && <>· <b>{hud.shot}</b></>}</div>
      <Controls />
    </>
  )
}

function Controls() {
  const run = useUI((s) => s.run)
  const phase = useUI((s) => s.phase)
  const speed = useUI((s) => s.speed)
  const camera = useUI((s) => s.camera)
  const quality = useUI((s) => s.quality)
  const format = useUI((s) => s.format)
  const muted = useUI((s) => s.muted)
  const playLabel = run === 'running' ? '❚❚ Pause' : phase === 'READY' && run === 'ready' ? '▶ Play' : '▶ Resume'
  return (
    <div className="controls">
      <button className="play" onClick={() => (run === 'running' ? engine.pause() : engine.resume())}>{playLabel}</button>
      <button onClick={() => engine.reset()}>Reset</button>
      <button className={run === 'rewinding' ? 'on' : ''} onClick={() => engine.toggleRewind()}>◀◀ Rewind</button>
      <div className="seg"><small>CAM</small>
        <button onClick={() => { const i = CAMERA_MODES.indexOf(camera); engine.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]) }} style={{ color: 'var(--brass-hi)' }}>{CAMERA_LABEL[camera]}</button>
      </div>
      <div className="seg"><small>SPEED</small>
        {[0.25, 0.5, 1, 2].map((v) => <button key={v} style={speed === v ? { color: 'var(--brass-hi)' } : undefined} onClick={() => engine.setSpeed(v)}>{v}×</button>)}
      </div>
      <div className="seg"><small>QUALITY</small>
        <button style={{ color: 'var(--brass-hi)' }} onClick={() => engine.setQuality(QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(quality) + 1) % 4])}>{quality}</button>
      </div>
      <div className="seg"><small>FRAME</small>
        {(['fill', '16:9', '9:16'] as const).map((f) => <button key={f} style={format === f ? { color: 'var(--brass-hi)' } : undefined} onClick={() => engine.setFormat(f)}>{f === 'fill' ? 'FULL' : f}</button>)}
      </div>
      <button onClick={() => engine.setMuted(!muted)}>{muted ? 'Sound off' : 'Sound on'}</button>
      <button className="hot" onClick={() => editor.enter()}>Build</button>
      <button className="hot" onClick={() => engine.cinematic()}>Cinematic</button>
    </div>
  )
}

function Cinema() {
  const phase = useUI((s) => s.phase)
  const [end, setEnd] = useState(false)
  useEffect(() => {
    if (phase !== 'COMPLETED') { setEnd(false); return }
    const t = setTimeout(() => setEnd(true), 11000)
    return () => clearTimeout(t)
  }, [phase])
  return (
    <>
      <button className="cine-exit" onClick={() => engine.exitCinematic()}>Exit film ✕</button>
      {phase === 'FAILED' && <div className="fail"><b>CHAIN BROKEN</b>{useUI.getState().failReason}</div>}
      {(end || phase === 'FAILED') && (
        <div className="replay">
          <button className="cta primary" onClick={() => engine.cinematic()}>Replay ↺</button>
          <button className="cta" onClick={() => { engine.exitCinematic() }}>Explore the machine</button>
        </div>
      )}
    </>
  )
}

function Titles() {
  const title = useUI((s) => s.title)
  if (!title) return null
  const hold = !!title.big && title.big === 'CHAIN REACTION'
  const lower = !title.big
  return (
    <div key={title.key} className={`titles ${hold ? 'hold' : ''} ${lower ? 'lower' : ''}`}>
      {title.big && <div className="big">{title.big}</div>}
      {title.small && <div className="small">{title.small}</div>}
    </div>
  )
}
