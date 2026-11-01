import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { engine } from '../engine/engine'
import { envUniforms } from './envUniforms'

/** Advances the engine and the shared studio lighting before anything renders. */
export function EngineDriver() {
  const envYaw = useRef(0)
  useFrame((_, dt) => {
    engine.update(dt)
    const c = engine.climax
    envYaw.current += Math.min(dt, 0.05) * (0.035 + engine.energy * 0.05) + engine.kick * 0.004
    const a = envYaw.current
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    envUniforms.uEnvRot.value.set(ca, 0, sa, 0, 1, 0, -sa, 0, ca)
    const rv = engine.reveal
    envUniforms.uEnvI.value = 0.04 + 0.96 * rv * rv
    envUniforms.uEnvFlash.value = engine.envFlash
    envUniforms.uEnvPhase.value = engine.envPhase
    envUniforms.uRimStr.value = (1.1 + engine.energy * 1.4 + engine.treble * 1.4 + c.flash * 3 + c.charge * 1.5) * rv
  }, -10)
  return null
}

/** Adaptive DPR: steps resolution down when frames drop, back up when there's headroom. */
export function AdaptiveQuality() {
  const acc = useRef({ frames: 0, time: 0, good: 0, warm: 0 })
  const tier = useStore((s) => s.tier)
  const dprRef = useRef(tier.dprMax)

  useEffect(() => {
    useStore.setState({ dpr: dprRef.current })
  }, [])

  useFrame((state, dt) => {
    const a = acc.current
    a.frames++
    a.time += dt
    a.warm += dt
    if (a.time < 1) return
    const fps = a.frames / a.time
    a.frames = 0
    a.time = 0
    useStore.setState({ fps: Math.round(fps) })
    if (a.warm < 2.5 || document.hidden) return
    let d = dprRef.current
    if (fps < 47 && d > tier.dprMin) {
      d = Math.max(tier.dprMin, d * 0.85)
      a.good = 0
    } else if (fps > 58) {
      a.good++
      if (a.good >= 3 && d < tier.dprMax) {
        d = Math.min(tier.dprMax, d * 1.1)
        a.good = 0
      }
    } else a.good = 0
    if (Math.abs(d - dprRef.current) > 0.01) {
      dprRef.current = d
      state.setDpr(d)
      useStore.setState({ dpr: Math.round(d * 100) / 100 })
    }
  })
  return null
}
