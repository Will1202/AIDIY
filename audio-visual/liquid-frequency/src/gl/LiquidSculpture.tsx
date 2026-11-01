import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BackSide, Matrix4, type Mesh, type PerspectiveCamera, ShaderMaterial, SphereGeometry, Vector2, Vector3, Vector4 } from 'three'
import { engine } from '../engine/engine'
import type { QualityTier } from '../engine/quality'
import { envUniforms } from './envUniforms'
import { liquidFragment, liquidVertex } from './shaders/liquid'

export function LiquidSculpture({ tier }: { tier: QualityTier }) {
  const mesh = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const geometry = useMemo(() => new SphereGeometry(1, 48, 32), [])
  const material = useMemo(() => {
    const defines: Record<string, string | number> = { STEPS: tier.steps }
    if (tier.bounce) defines.BOUNCE = ''
    return new ShaderMaterial({
      vertexShader: liquidVertex,
      fragmentShader: liquidFragment,
      defines,
      side: BackSide,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      uniforms: {
        ...envUniforms,
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uSeed: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
        uKick: { value: 0 },
        uBreath: { value: 0 },
        uWaves: { value: [new Vector2(), new Vector2(), new Vector2(), new Vector2()] },
        uModeW: { value: new Vector4(1, 0, 0, 0) },
        uTwist: { value: 0 },
        uCharge: { value: 0 },
        uScale: { value: 1 },
        uCollapse: { value: 0 },
        uHeat: { value: 0 },
        uRot: { value: engine.rotInv },
        uMouseObj: { value: new Vector3(9, 9, 9) },
        uMouseStr: { value: 0 },
        uBound: { value: 2.5 },
        uPixel: { value: 0.001 },
        uViewProj: { value: new Matrix4() },
      },
    })
  }, [tier.steps, tier.bounce])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    const u = material.uniforms
    const c = engine.climax
    const w = engine.modeW
    const scale = c.liquid * (0.82 + 0.18 * engine.reveal)
    const m = mesh.current
    if (!m) return
    m.visible = scale > 0.015 && w[2] < 0.995
    if (!m.visible) return

    u.uTime.value = engine.time
    u.uFlow.value = engine.flow
    u.uSeed.value = engine.seed
    u.uBass.value = engine.bass
    u.uMid.value = engine.mid
    u.uTreble.value = engine.treble
    u.uEnergy.value = engine.energy
    u.uKick.value = engine.kick
    u.uBreath.value = engine.breath
    const waves = u.uWaves.value as Vector2[]
    for (let i = 0; i < 4; i++) waves[i].set(engine.waves[i * 2], engine.waves[i * 2 + 1])
    ;(u.uModeW.value as Vector4).set(w[0], w[1], w[2], w[3])
    u.uTwist.value = c.twist
    u.uCharge.value = Math.max(c.charge, Math.max(0, engine.audio.features.tension - 0.3) * 0.5)
    u.uScale.value = scale
    u.uCollapse.value = c.collapse * w[3]
    u.uHeat.value = c.heat
    const bound = 2.5 * scale * (1 + engine.kick * 0.12)
    u.uBound.value = bound
    m.scale.setScalar(bound)

    const mo = u.uMouseObj.value as Vector3
    mo.copy(engine.mouse.world).applyMatrix3(engine.rotInv).divideScalar(scale)
    u.uMouseStr.value = engine.mouse.strength * (1 - c.explode)

    u.uPixel.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height * dpr)
    ;(u.uViewProj.value as Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  })

  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />
}
