// UI 根：画布 + 各层界面。游戏逻辑全部在 Game 里，这里只负责显示与转发操作。
import { useEffect, useRef } from 'react'
import { useUI } from '../state/ui'
import { game } from '../game/Game'
import { WORLDS } from '../game/types'
import { Menu } from './Menu'
import { HUD } from './HUD'
import { Pause } from './Pause'
import { DialogueBox, Reading, Keypad, Radio, Sonar, PhotoPanel, Ending, CreditsRoll, Loading } from './Overlays'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const screen = useUI((s) => s.screen)
  const world = useUI((s) => s.world)
  const loadingText = useUI((s) => s.loadingText)
  const locked = useUI((s) => s.pointerLocked)
  const touch = useUI((s) => s.touch)
  const cutscene = useUI((s) => s.cutscene || !!s.showcase)
  const modal = useUI((s) => !!(s.dialogue || s.reading || s.keypad || s.sonar || s.radio || s.photo))
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    game.boot(c).catch((e) => console.error(e))
    if (import.meta.env.DEV || location.search.includes('debug')) void import('../dev/harness').then((m) => m.install(game))
    // 页面被关闭 / 刷新时，组件不会卸载；只在热更新时释放
    return () => {
      if (import.meta.hot) game.dispose()
    }
  }, [])
  const accent = WORLDS[world].accent
  return (
    <div className="stage" style={{ ['--accent' as string]: accent }}>
      <canvas ref={canvasRef} tabIndex={0} onClick={() => { if (screen === 'play' && !modal) game.lock() }} />
      {screen === 'boot' && (
        <div className="boot"><div className="t">{loadingText || 'The Last Train'}</div></div>
      )}
      {screen === 'menu' && <Menu />}
      {(screen === 'play' || screen === 'pause') && <HUD />}
      {screen === 'play' && !locked && !touch && !modal && !cutscene && <div className="clickToPlay" onClick={() => game.lock()}><span>点击画面继续</span></div>}
      {screen === 'pause' && <Pause />}
      <div className="ui">
        <div className="live"><DialogueBox /></div>
      </div>
      <Reading />
      <Keypad />
      <Radio />
      <Sonar />
      <div className="ui"><PhotoPanel /></div>
      {screen === 'ending' && <Ending />}
      <CreditsRoll />
      <Loading />
    </div>
  )
}
