// 探索时尽量隐藏 UI：只在需要时出现交互提示、字幕、目标更新。
import { useEffect, useState } from 'react'
import { useUI } from '../state/ui'
import { useSettings } from '../state/store'
import { game } from '../game/Game'

export function HUD() {
  const prompt = useUI((s) => s.prompt)
  const cinema = useUI((s) => s.cinema)
  const photo = useUI((s) => s.photo)
  const dialogue = useUI((s) => s.dialogue)
  const manip = useUI((s) => s.manipulate)
  const hint = useUI((s) => s.hint)
  const card = useUI((s) => s.chapterCard)
  const timeHud = useUI((s) => s.timeHud)
  const showFps = useSettings((s) => s.showFps)
  const subSize = useSettings((s) => s.subtitleSize)
  const fps = useUI((s) => s.fps)
  const touch = useUI((s) => s.touch)
  const hidden = cinema || photo
  const [skipVisible, setSkip] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setSkip(game.director.active && game.director.skippable), 300)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="ui" style={{ ['--subs' as string]: subSize }}>
      {!hidden && !dialogue && <div className={'reticle' + (prompt ? ' on' : '') + (skipVisible ? ' off' : '')} />}
      {!hidden && prompt && !dialogue && !skipVisible && (
        <div className={'prompt' + (prompt.disabled ? ' dis' : '')}>
          <span className="k">{touch ? '点按' : prompt.key}</span>
          <span>{prompt.verb}</span>
          <span className="lab">{prompt.label}</span>
          {prompt.note && <span className="note">{prompt.note}</span>}
        </div>
      )}
      {!photo && <Subtitles />}
      {!hidden && <Toasts />}
      {!hidden && hint && <div className="hint"><b>提示</b>{hint}</div>}
      {!photo && card && (
        <div className="chapterCard" key={card.name}>
          <div className="no">CHAPTER {String(card.index).padStart(2, '0')}</div>
          <div className="nm">{card.name}</div>
          <div className="en">{card.en}</div>
        </div>
      )}
      {!hidden && manip && <div className="manip">{manip} · 移动鼠标操作 · <span className="k">E</span> 退出</div>}
      {!hidden && timeHud && (
        <div className="timeHud">
          <span><span className="k">R</span> 按住倒转</span>
          <span className="tg">{timeHud.target ?? '—'}</span>
          <span><span className="k">F</span> 暂停 / 恢复</span>
          {timeHud.state && <span className="st">{timeHud.state === 'pause' ? 'PAUSED' : timeHud.state === 'rewind' ? 'REWIND' : 'RUNNING'}</span>}
        </div>
      )}
      {skipVisible && !photo && <div className="skip">ESC / ENTER 跳过</div>}
      {showFps && <div className="fps">{fps} FPS · {game.qLevel}</div>}
      {touch && !photo && <TouchControls />}
    </div>
  )
}

function Subtitles() {
  const subs = useUI((s) => s.subtitles)
  return (
    <div className="subs">
      {subs.map((s) => (
        <div className="sub" key={s.id}>{s.who && <b>{s.who}</b>}{s.text}</div>
      ))}
    </div>
  )
}

function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const label: Record<string, string> = { item: '获得物品', objective: '新目标', archive: '异常档案', info: '', collect: '收藏品', save: '' }
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {label[t.kind] && <div className="k1">{label[t.kind]}</div>}
          <div className="t1">{t.title}</div>
          {t.text && <div className="t2">{t.text}</div>}
        </div>
      ))}
    </div>
  )
}

function TouchControls() {
  const [joy, setJoy] = useState<typeof game.input.joy>(null)
  const timeHud = useUI((s) => s.timeHud)
  useEffect(() => {
    let raf = 0
    const f = () => {
      setJoy(game.input.joy ? { ...game.input.joy } : null)
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  const btn = (cls: string, code: string, label: string) => (
    <button
      className={'tb ' + cls}
      onTouchStart={(e) => { e.stopPropagation(); game.input.press(code) }}
      onTouchEnd={(e) => { e.stopPropagation(); game.input.release(code) }}
    >{label}</button>
  )
  return (
    <div className="touchUI">
      {joy && (
        <div className="joy" style={{ left: joy.x, top: joy.y }}>
          <i style={{ transform: `translate(${joy.dx}px, ${joy.dy}px)` }} />
        </div>
      )}
      {btn('e', 'KeyE', '交互')}
      {btn('j', 'Space', '跳')}
      {timeHud && btn('r', 'KeyR', '倒转')}
      {timeHud && btn('f', 'KeyF', '暂停')}
      <button className="tb m" onTouchStart={(e) => { e.stopPropagation(); game.pause(true) }}>II</button>
    </div>
  )
}
