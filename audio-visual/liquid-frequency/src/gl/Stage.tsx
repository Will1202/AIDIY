import { Canvas, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { engine } from '../engine/engine'
import { useStore } from '../state/store'
import { CameraRig } from './CameraRig'
import { Backdrop, Dust, OrbitRings, ShockRings } from './Effects'
import { AdaptiveQuality, EngineDriver } from './EngineDriver'
import { LiquidSculpture } from './LiquidSculpture'
import { PostFX } from './PostFX'
import { Shards } from './Shards'

/** Dev-only console handle: step frames manually and time the GPU (`__lf.bench(60)`). */
function DevHook() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__lf = {
      engine,
      store: useStore,
      three: get,
      step(n = 1) {
        for (let i = 0; i < n; i++) get().advance(performance.now() / 1000)
      },
      /** Deterministic demo scrubbing: fixed 60 Hz steps on a virtual demo clock (muted). */
      scrub(to: number) {
        const s = get()
        const st = useStore.getState()
        const w2 = window as unknown as { __T?: number }
        if (w2.__T === undefined) {
          s.clock.getDelta = () => 1 / 60
          st.enter()
          if (!useStore.getState().demoMuted) st.toggleDemoMute()
          w2.__T = 0
          engine.audio.demoTime = () => w2.__T ?? 0
        }
        while ((w2.__T ?? 0) < to) {
          w2.__T = Math.min(to, (w2.__T ?? 0) + 1 / 60)
          s.advance(performance.now() / 1000)
        }
        return { T: w2.__T, phase: engine.climax.phase, bass: +engine.bass.toFixed(2), treble: +engine.treble.toFixed(2) }
      },
      bench(n = 30) {
        const s = get()
        const ctx = s.gl.getContext()
        const px = new Uint8Array(4)
        // a 1-pixel readback forces a real GPU sync (finish() doesn't block in Chrome)
        const sync = () => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
        s.advance(performance.now() / 1000)
        sync()
        const t0 = performance.now()
        for (let i = 0; i < n; i++) {
          s.advance(performance.now() / 1000)
          sync()
        }
        const ms = (performance.now() - t0) / n
        return { msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), size: [s.gl.domElement.width, s.gl.domElement.height] }
      },
    }
  }, [get])
  return null
}

export function Stage() {
  const tier = useStore((s) => s.tier)
  return (
    <Canvas
      dpr={tier.dprMax}
      flat
      gl={{ antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' }}
      camera={{ fov: 30, near: 0.1, far: 100, position: [0, 0.6, 8.5] }}
      onCreated={({ gl }) => gl.setClearColor('#040405', 1)}
    >
      <EngineDriver />
      <CameraRig />
      <Backdrop />
      <Shards tier={tier} />
      <LiquidSculpture tier={tier} />
      <Dust count={tier.dust} />
      <OrbitRings />
      <ShockRings />
      <PostFX tier={tier} />
      <AdaptiveQuality />
      <DevHook />
    </Canvas>
  )
}
