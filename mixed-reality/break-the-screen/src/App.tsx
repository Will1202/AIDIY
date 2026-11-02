import { useEffect, useRef } from 'react'
import { Engine } from './engine/Engine'
import { setEngine } from './engine/instance'
import { useUI } from './state/store'
import { Landing } from './ui/Landing'
import { Hud } from './ui/Hud'
import { TitleCard } from './ui/TitleCard'

export function App() {
  const host = useRef<HTMLDivElement>(null)
  const phase = useUI((s) => s.phase)
  const frame = useUI((s) => s.frame)
  const loadingMsg = useUI((s) => s.loadingMsg)
  const error = useUI((s) => s.error)

  useEffect(() => {
    let disposed = false
    let eng: Engine | null = null
    Engine.create(host.current!)
      .then((e) => {
        if (disposed) return e.dispose()
        eng = e
        setEngine(e)
        e.mouse.autoSway = true
        useUI.setState({ phase: 'landing' })
        if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
          void import('./dev/harness').then((m) => m.install(e))
        }
      })
      .catch((err) => {
        console.error(err)
        useUI.setState({ error: String(err?.message ?? err) })
      })
    return () => {
      disposed = true
      eng?.dispose()
      setEngine(null)
    }
  }, [])

  return (
    <div className="stage">
      <div className={`frame frame-${frame.replace(':', 'x')}`} ref={host} />
      {phase === 'loading' && (
        <div className="loading">
          <div className="loading-mark" />
          <span>{error ? `ERROR · ${error}` : loadingMsg}</span>
        </div>
      )}
      {phase === 'landing' && <Landing />}
      {phase === 'experience' && <Hud />}
      <TitleCard />
    </div>
  )
}
