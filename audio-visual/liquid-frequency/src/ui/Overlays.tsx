import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine/engine'
import { useStore } from '../state/store'
import { useRaf } from './useRaf'

export function DropZone() {
  const [over, setOver] = useState(false)
  const loadFile = useStore((s) => s.loadFile)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setOver(true)
    }
    const overH = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) void loadFile(f)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', overH)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [loadFile])
  return (
    <div className={`dropzone ${over ? 'is-over' : ''}`} aria-hidden={!over}>
      <div className="dropzone-frame">
        <span className="dropzone-big">DROP TO ANALYSE</span>
        <span className="dropzone-small">MP3 · WAV · OGG · M4A · FLAC — processed locally, never uploaded</span>
      </div>
    </div>
  )
}

export function ToastView() {
  const toast = useStore((s) => s.toast)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const id = window.setTimeout(() => setVisible(false), toast.kind === 'error' ? 4200 : 2600)
    return () => window.clearTimeout(id)
  }, [toast])
  return (
    <div className={`toast ${visible ? 'is-on' : ''} ${toast?.kind === 'error' ? 'is-error' : ''}`} role="status">
      {toast?.msg}
    </div>
  )
}

const KEYS: [string, string][] = [
  ['1 – 4', 'Switch sculpture'],
  ['SPACE', 'Play / pause'],
  ['X', 'Trigger climax'],
  ['C', 'Cinematic mode'],
  ['A', 'Frame: full · 16:9 · 9:16'],
  ['H', 'Hide interface'],
  ['F', 'Fullscreen'],
  ['M', 'Mute demo synth'],
  ['P / DOUBLE-CLICK', 'Energy pulse'],
  ['DRAG · WHEEL', 'Orbit · zoom'],
  ['ESC', 'Exit cinematic / close'],
]

export function Help() {
  const help = useStore((s) => s.help)
  const setHelp = useStore((s) => s.setHelp)
  return (
    <aside className={`help ${help ? 'is-on' : ''}`} aria-hidden={!help}>
      <div className="help-head">
        <span>CONTROLS</span>
        <button className="text-btn" onClick={() => setHelp(false)}>
          CLOSE
        </button>
      </div>
      <dl>
        {KEYS.map(([k, v]) => (
          <div key={k} className="help-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="help-note">
        DEMO plays an original synthesized score and drives the visuals from that score — a scripted signal. LOAD AUDIO switches
        to live FFT analysis of your own file: bass → impact, mid → flow, treble → fragmentation, detected drops → climax.
      </p>
    </aside>
  )
}

/** Big title card at the end of each demo loop (and in cinematic mode). */
export function TitleCard() {
  const el = useRef<HTMLDivElement>(null)
  const shown = useRef(false)
  useRaf(() => {
    const on = engine.title
    if (on !== shown.current && el.current) {
      shown.current = on
      el.current.classList.toggle('is-on', on)
    }
  })
  return (
    <div className="titlecard" ref={el} aria-hidden>
      <div className="titlecard-main">
        LIQUID <span>FREQUENCY</span>
      </div>
      <div className="titlecard-sub">SOUND BECOMES MATTER.</div>
    </div>
  )
}

export function CinematicOverlay() {
  const cinematic = useStore((s) => s.cinematic)
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!cinematic) return
    setHint(true)
    const id = window.setTimeout(() => setHint(false), 2600)
    let idle = 0
    const move = () => {
      document.body.classList.remove('hide-cursor')
      window.clearTimeout(idle)
      idle = window.setTimeout(() => document.body.classList.add('hide-cursor'), 1800)
    }
    move()
    window.addEventListener('pointermove', move)
    return () => {
      window.clearTimeout(id)
      window.clearTimeout(idle)
      window.removeEventListener('pointermove', move)
      document.body.classList.remove('hide-cursor')
    }
  }, [cinematic])
  return (
    <div className={`cine ${cinematic ? 'is-on' : ''}`} aria-hidden>
      <div className={`cine-hint ${hint ? 'is-on' : ''}`}>CINEMATIC · X CLIMAX · A FRAME · C / ESC EXIT</div>
      <div className="cine-mark">LIQUID FREQUENCY</div>
    </div>
  )
}
