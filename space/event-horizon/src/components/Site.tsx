import { forwardRef, memo, useEffect, useState } from 'react'
import { Split } from './Split'
import { OrbitalHud } from './OrbitalHud'
import { getPlates } from '../utils/plates'
import { useStore } from '../state/store'

interface Props {
  onDestroy: () => void
}

function Clock() {
  const phase = useStore((s) => s.phase)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (phase !== 'IDLE' && phase !== 'LOADING') return
    const id = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(id)
  }, [phase])
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  return (
    <span className="clock" data-g="block">
      UTC {hh}:{mm}
    </span>
  )
}

const Spark = ({ d }: { d: string }) => (
  <svg className="spark" viewBox="0 0 120 32" preserveAspectRatio="none">
    <path d={d} />
  </svg>
)

const CARDS = [
  {
    k: 'MASS',
    v: '4.297',
    u: '× 10⁶ M☉',
    f: '±0.012 · DFA-7 / 2031.4',
    g: <Spark d="M0 24 L10 22 L20 23 L30 18 L40 19 L50 14 L60 15 L70 11 L80 12 L90 8 L100 9 L110 6 L120 7" />,
  },
  {
    k: 'SCHWARZSCHILD RADIUS',
    v: '1.27',
    u: '× 10⁷ km',
    f: 'R_s = 2GM / c²',
    g: (
      <svg className="bars" viewBox="0 0 120 32" preserveAspectRatio="none">
        {[10, 16, 12, 22, 18, 28, 24, 30, 20, 26, 14, 19].map((h, i) => (
          <rect key={i} x={i * 10 + 1} y={32 - h} width="6" height={h} />
        ))}
      </svg>
    ),
  },
  {
    k: 'SPIN PARAMETER',
    v: '0.94',
    u: 'a* · prograde',
    f: 'frame dragging · ergosphere',
    g: (
      <svg className="gauge" viewBox="0 0 120 32">
        <path d="M8 30 A52 52 0 0 1 112 30" className="track" />
        <path d="M8 30 A52 52 0 0 1 104 17" className="fill" />
      </svg>
    ),
  },
  {
    k: 'TIME DILATION @ 3 Rs',
    v: '0.816',
    u: 'dτ / dt',
    f: '√(1 − R_s / r)',
    g: <Spark d="M0 30 C 20 30, 30 28, 45 22 S 75 8, 120 4" />,
  },
]

const PLATES = ['230 GHZ · VLBI', 'X-RAY FLARE · 2.8 keV', 'Hα SPECTRUM']

export const Site = memo(
  forwardRef<HTMLDivElement, Props>(function Site({ onDestroy }, ref) {
    const introKey = useStore((s) => s.introKey)
    const introDone = useStore((s) => s.introDone)
    const phase = useStore((s) => s.phase)
    const plates = getPlates()
    const armed = introDone && phase === 'IDLE'

    return (
      <div id="site" ref={ref} key={introKey} className={`site${introDone ? '' : ' intro'}`}>
        <div className="frame-marks" aria-hidden>
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <i key={c} className={`fm ${c}`} data-g="block" />
          ))}
          <div className="ruler" data-g="block">
            {Array.from({ length: 25 }, (_, i) => (
              <i key={i} className={i % 4 === 0 ? 'major' : ''} />
            ))}
          </div>
        </div>

        <header className="topbar rv" style={{ ['--d' as string]: '0.05s' }}>
          <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="brand-mark" data-g="block">
              <svg viewBox="0 0 40 40">
                <ellipse cx="20" cy="21" rx="18" ry="4.2" />
                <circle cx="20" cy="20" r="7.5" />
              </svg>
            </span>
            <span className="brand-text">
              <Split className="brand-name" text="EVENT HORIZON" />
              <Split className="brand-sub" text="DEEP FIELD OBSERVATORY" mode="words" />
            </span>
          </a>
          <nav className="nav">
            {['DISCOVER', 'OBSERVATORY', 'THE UNKNOWN'].map((l, i) => (
              <a key={l} href="#" className={`nav-item${i === 1 ? ' active' : ''}`} onClick={(e) => e.preventDefault()}>
                <span className="nav-idx" data-g="block">
                  0{i + 1}
                </span>
                <Split text={l} />
              </a>
            ))}
          </nav>
          <div className="status">
            <span className="live" data-g="block">
              <i className="dot" /> LIVE FEED · SGR A*
            </span>
            <Clock />
          </div>
        </header>

        <section className="hero">
          <div className="eyebrow rv" style={{ ['--d' as string]: '0.15s' }}>
            <Split text="[ OBS-7F ] — DEEP FIELD ARRAY · 230 GHZ" mode="words" />
          </div>
          <h1 className="title" aria-label="Beyond the Event Horizon">
            <span className="t1 rv" style={{ ['--d' as string]: '0.22s' }}>
              <Split text="BEYOND THE" />
            </span>
            <span className="t2 rv" style={{ ['--d' as string]: '0.3s' }}>
              <Split text="EVENT" />
            </span>
            <span className="t3 rv" style={{ ['--d' as string]: '0.38s' }}>
              <Split text="HORIZON" />
            </span>
          </h1>
          <p className="lede rv" style={{ ['--d' as string]: '0.5s' }}>
            <Split
              mode="words"
              text="Four million suns, folded into a point twenty-six thousand light-years away. Light that crosses the boundary never returns. Tonight our array is close enough to touch it."
            />
          </p>
          <div className="cta rv" style={{ ['--d' as string]: '0.62s' }}>
            <button className="destroy" disabled={!armed} onClick={onDestroy} aria-label="Destroy reality">
              <span className="destroy-frame" data-g="block" />
              <span className="destroy-icon" data-g="block">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="4" />
                  <ellipse cx="12" cy="12" rx="10.5" ry="3.2" />
                </svg>
              </span>
              <Split className="destroy-label" text="DESTROY REALITY" />
            </button>
            <span className="cta-hint">
              <Split text="PRESS ⏎ TO INITIATE COLLAPSE" mode="words" />
            </span>
          </div>
        </section>

        <OrbitalHud />

        <aside className="plates rv" style={{ ['--d' as string]: '0.7s' }}>
          <div className="plates-head" data-g="block">
            <span>OBSERVATION PLATES</span>
            <span>03 / 214</span>
          </div>
          <div className="plates-row">
            {plates.map((src, i) => (
              <figure key={i} className="plate" data-g="block">
                {src ? <img src={src} alt="" draggable={false} /> : <div className="img-ph" />}
                <figcaption>{PLATES[i]}</figcaption>
              </figure>
            ))}
          </div>
        </aside>

        <section className="cards">
          {CARDS.map((c, i) => (
            <article key={c.k} className="card rv" data-g="block" style={{ ['--d' as string]: `${0.55 + i * 0.07}s` }}>
              <header>
                <span className="card-k">{c.k}</span>
                <span className="card-n">0{i + 1}</span>
              </header>
              <div className="card-v">
                {c.v}
                <small>{c.u}</small>
              </div>
              {c.g}
              <footer>{c.f}</footer>
            </article>
          ))}
        </section>

        <footer className="footer rv" style={{ ['--d' as string]: '0.8s' }}>
          <span data-g="block">RA 17ʰ 45ᵐ 40.04ˢ</span>
          <span data-g="block">DEC −29° 00′ 28.1″</span>
          <span data-g="block">DIST 26,673 LY</span>
          <span className="signal" data-g="block">
            SIGNAL <i /><i /><i /><i /><i className="off" /> 98.2%
          </span>
          <span className="legal" data-g="block">
            © 2031 EVENT HORIZON DEEP FIELD OBSERVATORY — A FICTIONAL INSTITUTION
          </span>
        </footer>
      </div>
    )
  }),
)
