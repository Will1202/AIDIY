import { useCallback, useEffect, useRef, useState } from 'react'
import { Site } from './components/Site'
import { CssBlackHole, Dock, Loader, Toast, UniverseOverlay } from './components/Overlays'
import { Director, directorRef } from './systems/Director'
import { TIER_ORDER, type QualitySetting } from './systems/Quality'
import { useStore, type AspectMode } from './state/store'
import { loadFonts } from './utils/fonts'

const QUALITY_CYCLE: QualitySetting[] = ['auto', ...TIER_ORDER]
const ASPECTS: AspectMode[] = ['full', '16:9', '9:16']

const actions = {
  destroy: () => directorRef.current?.destroy(),
  rebuild: () => directorRef.current?.rebuild(),
  replay: () => directorRef.current?.replay(),
  sound: () => {
    const s = useStore.getState()
    const on = !s.sound
    s.set({ sound: on })
    directorRef.current?.setSound(on)
    s.flash(on ? 'SOUND ON' : 'SOUND OFF')
  },
  quality: () => {
    const s = useStore.getState()
    const next = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(s.quality) + 1) % QUALITY_CYCLE.length]
    directorRef.current?.setQuality(next)
    s.flash(`QUALITY ${next.toUpperCase()}`)
  },
  cinematic: () => {
    const s = useStore.getState()
    const on = !s.cinematic
    s.set({ cinematic: on })
    s.flash(on ? 'CINEMATIC MODE — PRESS C TO EXIT' : 'CINEMATIC MODE OFF')
  },
  aspect: () => {
    const s = useStore.getState()
    const next = ASPECTS[(ASPECTS.indexOf(s.aspect) + 1) % ASPECTS.length]
    s.set({ aspect: next })
    s.flash(next === 'full' ? 'FRAME FULL WINDOW' : `RECORDING FRAME ${next}`)
  },
  fullscreen: () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  },
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const s = useStore.getState()
      const onButton = document.activeElement?.tagName === 'BUTTON'
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      switch (k) {
        case 'Enter':
        case ' ':
          if (onButton) return
          e.preventDefault()
          if (s.phase === 'IDLE') actions.destroy()
          else if (s.phase === 'PARALLEL_UNIVERSE' && s.uniStage >= 3) actions.rebuild()
          break
        case 'r':
          if (s.phase === 'PARALLEL_UNIVERSE') actions.rebuild()
          break
        case 'd':
          actions.replay()
          break
        case 'c':
          actions.cinematic()
          break
        case 'Escape':
          if (s.cinematic) actions.cinematic()
          break
        case 'm':
          actions.sound()
          break
        case 'q':
          actions.quality()
          break
        case 'a':
          actions.aspect()
          break
        case 'f':
          actions.fullscreen()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const siteRef = useRef<HTMLDivElement>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const glOk = useStore((s) => s.glOk)
  const aspect = useStore((s) => s.aspect)
  const cinematic = useStore((s) => s.cinematic)
  const phase = useStore((s) => s.phase)
  useKeyboard()

  useEffect(() => {
    let cancelled = false
    let dir: Director | null = null
    let introTimer = 0
    loadFonts().then(() => {
      if (cancelled) return
      setFontsReady(true)
      // next frame, but never wait on rAF alone (background tabs throttle it)
      let started = false
      const boot = () => {
        if (started || cancelled || !stageRef.current || !canvasRef.current) return
        started = true
        try {
          dir = new Director({ stage: stageRef.current, canvas: canvasRef.current, getSite: () => siteRef.current })
          directorRef.current = dir
          dir.start()
        } catch (err) {
          console.error('[event-horizon] failed to start', err)
          useStore.getState().set({ glOk: false })
        }
        const st = useStore.getState()
        st.set({ ready: true, introKey: st.introKey + 1, introDone: false })
        introTimer = window.setTimeout(() => useStore.getState().set({ introDone: true }), 1900)
      }
      requestAnimationFrame(boot)
      window.setTimeout(boot, 120)
    })
    return () => {
      cancelled = true
      window.clearTimeout(introTimer)
      dir?.dispose()
    }
  }, [])

  const onDestroy = useCallback(() => actions.destroy(), [])
  const onRebuild = useCallback(() => actions.rebuild(), [])
  const stageClass = `stage${aspect === '16:9' ? ' r16x9' : aspect === '9:16' ? ' r9x16' : ''}${cinematic ? ' cine' : ''}${
    glOk === false && (phase === 'PARALLEL_UNIVERSE' || phase === 'CROSSING') ? ' nogl-universe' : ''
  }`

  return (
    <div className="viewport">
      <div ref={stageRef} className={stageClass} style={cinematic ? { cursor: 'none' } : undefined}>
        <canvas ref={canvasRef} className="gl" />
        {glOk === false && phase !== 'PARALLEL_UNIVERSE' ? <CssBlackHole /> : null}
        {fontsReady ? <Site ref={siteRef} onDestroy={onDestroy} /> : null}
        <UniverseOverlay onRebuild={onRebuild} />
        <Dock
          onSound={actions.sound}
          onQuality={actions.quality}
          onCinematic={actions.cinematic}
          onReplay={actions.replay}
          onAspect={actions.aspect}
          onFullscreen={actions.fullscreen}
        />
        <Toast />
        {glOk === false ? <div className="nogl">WEBGL2 UNAVAILABLE — RUNNING THE DOM-ONLY VERSION</div> : null}
        <Loader />
      </div>
      {aspect !== 'full' && !cinematic ? <div className="frame-tag">REC FRAME {aspect}</div> : null}
    </div>
  )
}
