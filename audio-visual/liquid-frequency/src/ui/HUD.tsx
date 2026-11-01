import { useEffect, useRef } from 'react'
import { MODES, engine } from '../engine/engine'
import { type Aspect, useStore } from '../state/store'
import { fmtTime, useRaf } from './useRaf'

const ASPECTS: Aspect[] = ['full', '16:9', '9:16']
export const cycleAspect = () => {
  const a = useStore.getState().aspect
  useStore.getState().setAspect(ASPECTS[(ASPECTS.indexOf(a) + 1) % ASPECTS.length])
}

function SourceBadge() {
  const source = useStore((s) => s.source)
  const dot = useRef<HTMLSpanElement>(null)
  useRaf(() => {
    if (dot.current) dot.current.style.opacity = String(0.35 + Math.min(1, engine.kick) * 0.65)
  })
  const label =
    source === 'music' ? 'LIVE FFT ANALYSIS' : source === 'demo' ? 'DEMO · SCRIPTED SIGNAL' : 'IDLE · NO SIGNAL'
  return (
    <div className={`badge badge-${source}`} title={source === 'demo' ? 'Visuals follow the scripted demo score, not FFT analysis' : undefined}>
      <span className="badge-dot" ref={dot} />
      {label}
    </div>
  )
}

function Brand() {
  return (
    <div className="hud-brand">
      <div className="brand-mark">
        LIQUID <em>FREQUENCY</em>
      </div>
      <SourceBadge />
    </div>
  )
}

function ModeRail() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  return (
    <nav className="modes" aria-label="Sculpture modes">
      {MODES.map((m, i) => (
        <button key={m.index} className={`mode ${mode === i ? 'is-active' : ''}`} onClick={() => setMode(i)}>
          <span className="mode-idx">{m.index}</span>
          <span className="mode-text">
            <span className="mode-name">{m.name}</span>
            <span className="mode-line">{m.line}</span>
          </span>
        </button>
      ))}
    </nav>
  )
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </svg>
)
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
    <path d="M6.5 4.5h3.6v15H6.5zM13.9 4.5h3.6v15h-3.6z" fill="currentColor" />
  </svg>
)

export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm'

function Player() {
  const source = useStore((s) => s.source)
  const playing = useStore((s) => s.playing)
  const track = useStore((s) => s.track)
  const volume = useStore((s) => s.volume)
  const demoMuted = useStore((s) => s.demoMuted)
  const setVolume = useStore((s) => s.setVolume)
  const loadFile = useStore((s) => s.loadFile)
  const toggleDemoMute = useStore((s) => s.toggleDemoMute)
  const fileRef = useRef<HTMLInputElement>(null)
  const seekRef = useRef<HTMLInputElement>(null)
  const curRef = useRef<HTMLSpanElement>(null)
  const durRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useRaf(() => {
    const a = engine.audio
    const cur = a.currentTime()
    const dur = a.duration()
    if (curRef.current) curRef.current.textContent = fmtTime(cur)
    if (durRef.current) durRef.current.textContent = fmtTime(dur)
    if (seekRef.current && !dragging.current) {
      seekRef.current.max = String(dur || 1)
      seekRef.current.value = String(cur)
    }
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${dur ? Math.min(1, cur / dur) : 0})`
  })

  const isMusic = source === 'music'
  return (
    <div className="player">
      <div className="player-head">
        <button className="play-btn" onClick={() => engine.audio.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="track">
          <div className="kicker">{isMusic ? (playing ? 'NOW ANALYSING' : 'PAUSED') : 'DEMO SEQUENCE'}</div>
          <div className="track-name" title={track?.name}>
            {isMusic && track ? track.name : 'Original synth score · 128 BPM · 30 s loop'}
          </div>
        </div>
      </div>
      <div className="seek">
        <span className="time" ref={curRef}>
          0:00
        </span>
        <div className={`seek-track ${isMusic ? '' : 'is-locked'}`}>
          <div className="seek-fill" ref={fillRef} />
          <input
            ref={seekRef}
            type="range"
            min={0}
            step={0.01}
            disabled={!isMusic}
            aria-label="Seek"
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={() => (dragging.current = false)}
            onChange={(e) => engine.audio.seek(parseFloat(e.target.value))}
          />
        </div>
        <span className="time" ref={durRef}>
          0:00
        </span>
      </div>
      <div className="player-foot">
        <button className="text-btn strong" onClick={() => fileRef.current?.click()}>
          LOAD AUDIO
        </button>
        {isMusic ? (
          <button className="text-btn" onClick={() => engine.audio.startDemo()}>
            DEMO
          </button>
        ) : track ? (
          <button className="text-btn" onClick={() => engine.audio.resumeMusic()}>
            BACK TO TRACK
          </button>
        ) : null}
        {source === 'demo' && (
          <button className="text-btn" onClick={toggleDemoMute}>
            {demoMuted ? 'UNMUTE' : 'MUTE'}
          </button>
        )}
        <label className="vol">
          <span>VOL</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-label="Volume"
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            style={{ ['--v' as string]: volume }}
          />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void loadFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

function Meters() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const bars = useRef<(HTMLDivElement | null)[]>([])
  const bpm = useRef<HTMLSpanElement>(null)
  const beat = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const d = Math.min(2, window.devicePixelRatio || 1)
    c.width = 240 * d
    c.height = 44 * d
    c.getContext('2d')?.scale(d, d)
  }, [])

  useRaf(() => {
    const f = engine.audio.features
    const vals = [engine.bass, engine.mid, engine.treble]
    vals.forEach((v, i) => {
      const b = bars.current[i]
      if (b) b.style.transform = `scaleX(${v.toFixed(3)})`
    })
    if (bpm.current) bpm.current.textContent = f.bpm ? `${Math.round(f.bpm)}` : '—'
    if (beat.current) beat.current.style.opacity = String(0.15 + Math.min(1, engine.kick) * 0.85)
    const c = canvas.current
    const g = c?.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, 240, 44)
    const s = f.spectrum
    const n = s.length
    const w = 240 / n
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(0, 43, 240, 1)
    g.fillStyle = 'rgba(228,234,245,0.62)'
    for (let i = 0; i < n; i++) {
      const h = Math.max(1, s[i] * 40)
      g.fillRect(i * w + w * 0.35, 43 - h, Math.max(1, w * 0.3), h)
    }
  })

  return (
    <div className="meters">
      <canvas ref={canvas} className="spectrum" style={{ width: 240, height: 44 }} />
      <div className="bands">
        {['BASS', 'MID', 'TREB'].map((l, i) => (
          <div className="band" key={l}>
            <span className="band-label">{l}</span>
            <span className="band-track">
              <div
                className="band-fill"
                ref={(el) => {
                  bars.current[i] = el
                }}
              />
            </span>
          </div>
        ))}
        <div className="band bpm">
          <span className="beat-dot" ref={beat} />
          <span ref={bpm}>—</span>
          <span className="band-label">BPM</span>
        </div>
      </div>
    </div>
  )
}

function Actions() {
  const aspect = useStore((s) => s.aspect)
  const help = useStore((s) => s.help)
  const fps = useStore((s) => s.fps)
  const dpr = useStore((s) => s.dpr)
  const tier = useStore((s) => s.tier)
  const setCinematic = useStore((s) => s.setCinematic)
  const setHelp = useStore((s) => s.setHelp)
  const climaxLine = useRef<HTMLSpanElement>(null)
  const climaxBtn = useRef<HTMLButtonElement>(null)
  useRaf(() => {
    const c = engine.climax
    if (climaxLine.current) climaxLine.current.style.transform = `scaleX(${c.progress.toFixed(3)})`
    if (climaxBtn.current) climaxBtn.current.classList.toggle('is-live', c.active)
  })
  return (
    <div className="actions">
      <button ref={climaxBtn} className="act act-climax" onClick={() => engine.triggerClimax('manual')}>
        <span className="act-label">TRIGGER CLIMAX</span>
        <kbd>X</kbd>
        <span className="act-progress" ref={climaxLine} />
      </button>
      <button className="act" onClick={() => setCinematic(true)}>
        <span className="act-label">CINEMATIC</span>
        <kbd>C</kbd>
      </button>
      <button className="act" onClick={cycleAspect}>
        <span className="act-label">FRAME {aspect === 'full' ? 'FULL' : aspect}</span>
        <kbd>A</kbd>
      </button>
      <button className={`act ${help ? 'is-on' : ''}`} onClick={() => setHelp(!help)}>
        <span className="act-label">CONTROLS</span>
        <kbd>?</kbd>
      </button>
      <div className="stats">
        {fps} FPS · {dpr.toFixed(2)}× · {tier.name.toUpperCase()}
      </div>
    </div>
  )
}

export function HUD() {
  const hidden = useStore((s) => s.cinematic || s.hudHidden)
  return (
    <div className={`hud ${hidden ? 'is-hidden' : ''}`}>
      <Brand />
      <ModeRail />
      <Player />
      <Meters />
      <Actions />
    </div>
  )
}
