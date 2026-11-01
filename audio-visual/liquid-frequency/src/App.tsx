import { useEffect } from 'react'
import { engine } from './engine/engine'
import { Stage } from './gl/Stage'
import { useStore } from './state/store'
import { HUD, cycleAspect } from './ui/HUD'
import { Intro } from './ui/Intro'
import { CinematicOverlay, DropZone, Help, TitleCard, ToastView } from './ui/Overlays'

const hasWebGL2 = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
})()

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const s = useStore.getState()
      if (!s.entered) {
        if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') s.enter()
        return
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      switch (k) {
        case '1':
        case '2':
        case '3':
        case '4':
          s.setMode(parseInt(k, 10) - 1)
          break
        case ' ':
          e.preventDefault()
          ;(document.activeElement as HTMLElement | null)?.blur?.()
          engine.audio.toggle()
          break
        case 'x':
          engine.triggerClimax('manual')
          break
        case 'c':
          s.setCinematic(!s.cinematic)
          break
        case 'a':
          cycleAspect()
          break
        case 'h':
          s.toggleHud()
          break
        case 'm':
          s.toggleDemoMute()
          break
        case 'p':
          engine.pulseAt(1)
          break
        case 'f':
          if (document.fullscreenElement) void document.exitFullscreen()
          else void document.documentElement.requestFullscreen?.().catch(() => undefined)
          break
        case '?':
        case '/':
          s.setHelp(!s.help)
          break
        case 'Escape':
          if (s.cinematic) s.setCinematic(false)
          else if (s.help) s.setHelp(false)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const aspect = useStore((s) => s.aspect)
  const entered = useStore((s) => s.entered)
  const cinematic = useStore((s) => s.cinematic)
  useKeyboard()

  useEffect(() => () => engine.audio.dispose(), [])

  if (!hasWebGL2) {
    return (
      <div className="fallback">
        <h1>LIQUID FREQUENCY</h1>
        <p>This experience needs WebGL 2. Please open it in a recent Chrome, Edge, Firefox or Safari.</p>
        <p>需要支持 WebGL 2 的浏览器（新版 Chrome / Edge / Firefox / Safari）。</p>
      </div>
    )
  }

  return (
    <div className={`app ${entered ? 'is-entered' : ''} ${cinematic ? 'is-cinematic' : ''}`}>
      <div className="stage-wrap">
        <div className="stage" data-aspect={aspect}>
          <Stage />
          <TitleCard />
          <CinematicOverlay />
        </div>
      </div>
      <Intro />
      <HUD />
      <Help />
      <DropZone />
      <ToastView />
    </div>
  )
}
