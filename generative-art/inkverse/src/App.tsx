import { useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine'
import { install } from './dev/harness'
import { useUI } from './state/store'
import { BRUSHES, type BrushKind } from './core/constants'
import { QUALITY_LEVELS } from './engine/Quality'
import { IntroOverlay } from './ui/Intro'
import { Seal } from './ui/Seal'

const BRUSH_INFO: Record<BrushKind, { zh: string; en: string; hint: string; hintEn: string }> = {
  mountain: { zh: '山', en: 'MOUNTAIN', hint: '画一道山脊，墨落之处，山自纸中升起', hintEn: 'Draw a ridge line — mountains rise where your ink falls' },
  river: { zh: '水', en: 'RIVER', hint: '顺着地势画一条河，水会沿笔迹流淌', hintEn: 'Draw a winding line — water flows along your stroke' },
  life: { zh: '松', en: 'LIFE', hint: '点下墨滴，松树从墨中生长；拖动可种一片林', hintEn: 'Tap to drop ink — a pine grows from it. Drag to plant a grove' },
  bridge: { zh: '桥', en: 'BRIDGE', hint: '在两岸或两崖之间画一条线，架起可以行走的桥', hintEn: 'Draw a line between two banks or cliffs to build a walkable bridge' },
}

export default function App() {
  const stage = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const s = useUI()

  useEffect(() => {
    if (!stage.current) return
    const e = new Engine(stage.current)
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) install(e)
    e.start()
    setEngine(e)
    return () => e.dispose()
  }, [])

  const hud = s.mode !== 'intro' && s.mode !== 'loading' && s.mode !== 'cinematic' && !s.uiHidden
  const info = BRUSH_INFO[s.brush]

  return (
    <div className={`app mode-${s.mode}`}>
      <div className="stage" ref={stage} />
      {s.mode === 'intro' && engine && <IntroOverlay onEnter={() => engine.enter()} />}

      {hud && engine && (
        <>
          <header className="logo">
            <div className="logo-en">INKVERSE</div>
            <div className="logo-zh">
              一笔入江湖 <Seal text="墨" size={22} />
            </div>
          </header>

          <nav className="top-right">
            <button onClick={() => engine.playCinematic()}>CINEMATIC</button>
            <button className={s.panel === 'weather' ? 'on' : ''} onClick={() => useUI.setState({ panel: s.panel === 'weather' ? 'none' : 'weather' })}>
              WEATHER
            </button>
            <button className={s.panel === 'quality' ? 'on' : ''} onClick={() => useUI.setState({ panel: s.panel === 'quality' ? 'none' : 'quality' })}>
              QUALITY <span className="dim">{s.quality}</span>
            </button>
            <button onClick={() => engine.setSound(!s.sound)}>
              SOUND <span className="dim">{s.sound ? 'ON' : 'OFF'}</span>
            </button>
          </nav>

          {s.panel === 'weather' && (
            <div className="panel weather">
              <div className="panel-title">WORLD CONTROL · 天时</div>
              <div className="row">
                {(['day', 'sunset', 'night'] as const).map((t) => (
                  <button key={t} className={s.time === t ? 'on' : ''} onClick={() => engine.setTime(t)}>
                    {t === 'day' ? 'DAY 昼' : t === 'sunset' ? 'SUNSET 暮' : 'NIGHT 夜'}
                  </button>
                ))}
              </div>
              <div className="row">
                <button className={s.rain ? 'on' : ''} onClick={() => engine.setRain(!s.rain)}>
                  RAIN 雨
                </button>
                <button className={s.wind ? 'on' : ''} onClick={() => engine.setWind(!s.wind)}>
                  WIND 风
                </button>
              </div>
            </div>
          )}
          {s.panel === 'quality' && (
            <div className="panel quality">
              <div className="panel-title">QUALITY · 画质</div>
              <div className="row">
                {QUALITY_LEVELS.map((q) => (
                  <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => engine.setQuality(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <div className="panel-note">{s.fps} FPS</div>
            </div>
          )}

          {(s.mode === 'draw' || s.mode === 'world') && (
            <aside className="brushes">
              {BRUSHES.map((b) => (
                <button key={b} className={`brush ${s.brush === b && s.mode === 'draw' ? 'on' : ''}`} onClick={() => engine.setBrush(b)} title={BRUSH_INFO[b].hintEn}>
                  <span className="brush-zh">{BRUSH_INFO[b].zh}</span>
                  <span className="brush-en">{BRUSH_INFO[b].en}</span>
                  <span className="brush-count">{s.counts[b] || ''}</span>
                </button>
              ))}
            </aside>
          )}

          <footer className="bottom">
            <button className={s.mode === 'draw' ? 'on' : ''} onClick={() => engine.draw()}>
              <span>DRAW</span>
              <i>绘</i>
            </button>
            <button className={s.mode === 'awakening' ? 'on' : ''} onClick={() => engine.awaken()}>
              <span>AWAKEN</span>
              <i>醒</i>
            </button>
            <button className={s.mode === 'explore' ? 'on' : ''} onClick={() => engine.explore()}>
              <span>EXPLORE</span>
              <i>游</i>
            </button>
            <button onClick={() => engine.reset()}>
              <span>RESET</span>
              <i>洗</i>
            </button>
          </footer>

          {s.mode === 'draw' && !s.counts[s.brush] && (
            <div className="hint" key={s.brush}>
              <div className="hint-zh">{info.hint}</div>
              <div className="hint-en">{info.hintEn}</div>
            </div>
          )}
          {s.mode === 'world' && (
            <div className="hint">
              <div className="hint-zh">拖动环视 · 右键平移 · 滚轮远近</div>
              <div className="hint-en">Drag to look around · right-drag to pan · scroll to zoom · EXPLORE to walk in</div>
            </div>
          )}
          {s.mode === 'explore' && (
            <div className="keys">
              <span>
                <b>WASD</b> 行走
              </span>
              <span>
                <b>SHIFT</b> 疾行
              </span>
              <span>
                <b>SPACE</b> 跃起
              </span>
              <span>
                <b>E</b> 打坐
              </span>
              <span>
                <b>Q</b> 观景
              </span>
              <span>
                <b>DRAG</b> 视角
              </span>
            </div>
          )}
        </>
      )}

      <div className="toasts">
        {s.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Seal text={t.tone === 'warn' ? '止' : '墨'} size={26} />
            <div>
              <div className="toast-zh">{t.text}</div>
              {t.sub && <div className="toast-en">{t.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {s.title && (
        <div className="endcard">
          <div className="end-en">INKVERSE</div>
          <div className="end-zh">一笔入江湖</div>
          <div className="end-tag">EVERY STROKE CREATES A WORLD.</div>
        </div>
      )}
    </div>
  )
}
