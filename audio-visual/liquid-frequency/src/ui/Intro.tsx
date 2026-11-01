import { useRef } from 'react'
import { useStore } from '../state/store'
import { AUDIO_ACCEPT } from './HUD'

export function Intro() {
  const entered = useStore((s) => s.entered)
  const enter = useStore((s) => s.enter)
  const loadFile = useStore((s) => s.loadFile)
  const file = useRef<HTMLInputElement>(null)

  return (
    <section className={`intro ${entered ? 'is-gone' : ''}`} aria-hidden={entered}>
      <div className="intro-top">
        <span>N°01 — AUDIO-REACTIVE SCULPTURE</span>
        <span className="intro-top-r">MAKE SOUND VISIBLE</span>
      </div>

      <div className="intro-main">
        <p className="intro-kicker">A browser-native liquid chrome instrument</p>
        <h1 className="title">
          <span className="title-line">LIQUID</span>
          <span className="title-line title-line--2">FREQUENCY</span>
        </h1>
        <p className="subtitle">SOUND BECOMES MATTER.</p>
        <div className="intro-actions">
          <button className="enter" onClick={enter} autoFocus>
            <span className="enter-label">ENTER EXPERIENCE</span>
            <span className="enter-arrow" aria-hidden>
              →
            </span>
          </button>
          <button className="ghost" onClick={() => file.current?.click()}>
            or load your own track
          </button>
          <input
            ref={file}
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

      <div className="intro-foot">
        <span>RAYMARCHED CHROME · GPU PARTICLES · WEB AUDIO FFT</span>
        <span>AUDIO STAYS ON THIS DEVICE · HEADPHONES RECOMMENDED</span>
      </div>
    </section>
  )
}
