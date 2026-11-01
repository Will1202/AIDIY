import { useEffect, useRef } from 'react'
import { Engine } from './engine/Engine'
import { Director } from './cinematic/Director'
import { AudioEngine } from './audio/AudioEngine'
import { loadFonts } from './utils/fonts'
import { useStore } from './state/store'
import { engine as getEngine, setEngine } from './engine/instance'
import { Loader } from './ui/Loader'
import { Menu } from './ui/Menu'
import { Hud } from './ui/Hud'
import { PauseMenu } from './ui/PauseMenu'
import { Captions } from './ui/Captions'
import { TouchControls } from './ui/TouchControls'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phase = useStore((s) => s.phase)
  const contextLost = useStore((s) => s.contextLost)
  const touch = useStore((s) => s.touch)

  useEffect(() => {
    const canvas = canvasRef.current!
    let engine: Engine | null = null
    let disposed = false
    const isTouch = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches
    useStore.getState().set({ touch: isTouch })
    ;(async () => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2')
        if (!gl) throw new Error('WebGL2 is not available in this browser.')
        await loadFonts()
        engine = new Engine(canvas)
        engine.audio = new AudioEngine()
        engine.director = new Director(engine)
        setEngine(engine)
        await engine.init((p, label) => useStore.getState().set({ loading: p, loadingLabel: label }))
        if (disposed) return
        engine.input.onLockChange = (locked) => {
          const st = useStore.getState()
          if (!locked && st.phase === 'play' && !st.touch) engine!.pause()
        }
        engine.start()
        useStore.getState().set({ phase: 'menu' })
        if (import.meta.env.DEV || location.search.includes('debug')) void import('./dev/harness').then((m) => m.install(engine!))
        if (location.search.includes('showcase')) setTimeout(() => engine?.director?.start(), 600)
      } catch (err) {
        console.error(err)
        useStore.getState().set({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      disposed = true
      engine?.dispose()
      setEngine(null)
    }
  }, [])

  return (
    <div className={`app phase-${phase}`}>
      <canvas
        ref={canvasRef}
        className="gl"
        onClick={() => {
          const en = getEngine()
          if (!en) return
          const ph = useStore.getState().phase
          if (ph === 'paused') en.resume()
          else if (ph === 'play' && !en.input.locked) en.input.requestLock()
        }}
      />
      {phase === 'loading' && <Loader />}
      {phase === 'error' && <ErrorScreen />}
      {phase === 'menu' && <Menu />}
      {(phase === 'play' || phase === 'paused') && <Hud />}
      {phase === 'paused' && <PauseMenu />}
      <Captions />
      {touch && phase === 'play' && <TouchControls />}
      {contextLost && (
        <div className="overlay center">
          <div className="panel">
            <div className="kicker">GPU CONTEXT LOST</div>
            <p>The graphics context was reset by the browser. Restoring…</p>
            <button className="btn" onClick={() => location.reload()}>RELOAD</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ErrorScreen() {
  const error = useStore((s) => s.error)
  return (
    <div className="overlay center">
      <div className="panel">
        <div className="kicker">REALITY FAILED TO LOAD</div>
        <p>{error}</p>
        <p className="dim">PORTAL PARADOX needs a desktop browser with WebGL2 (Chrome, Edge, Firefox or Safari 16+).</p>
      </div>
    </div>
  )
}
