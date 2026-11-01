import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
} from 'three'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { engine } from '../engine/engine'
import { type QualityTier, isMobile } from '../engine/quality'
import { envUniforms } from './envUniforms'
import { positionSim, shardFragment, shardVertex, velocitySim } from './shaders/shards'

/** A jittered, flat-shaded octahedral crystal — one geometry for every shard. */
function makeShardGeometry() {
  const top = [0, 1, 0]
  const bot = [0, -1, 0]
  const ring = [
    [1, 0.05, 0.18],
    [0.12, -0.08, 1],
    [-0.92, 0.1, 0.25],
    [-0.2, -0.04, -0.95],
  ]
  const pos: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    pos.push(...top, ...a, ...b, ...bot, ...b, ...a)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

export function Shards({ tier }: { tier: QualityTier }) {
  const gl = useThree((s) => s.gl)
  const side = tier.shardSide
  const count = side * side

  const sim = useMemo(() => {
    const gpu = new GPUComputationRenderer(side, side, gl)
    if (isMobile) gpu.setDataType(HalfFloatType)

    const seed = new Float32Array(count * 4)
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
    const seedTex = new DataTexture(seed, side, side, RGBAFormat, FloatType)
    seedTex.minFilter = seedTex.magFilter = NearestFilter
    seedTex.needsUpdate = true

    const pos0 = gpu.createTexture()
    const vel0 = gpu.createTexture()
    const p = pos0.image.data as Float32Array
    const v = vel0.image.data as Float32Array
    for (let i = 0; i < count; i++) {
      const x = seed[i * 4] * 2 - 1
      const y = seed[i * 4 + 1] * 2 - 1
      const z = seed[i * 4 + 2] * 2 - 1
      const l = Math.hypot(x, y, z) || 1
      p[i * 4] = (x / l) * 0.5
      p[i * 4 + 1] = (y / l) * 0.5
      p[i * 4 + 2] = (z / l) * 0.5
      p[i * 4 + 3] = Math.random() * 6.28
      v[i * 4 + 3] = 0
    }
    const posVar = gpu.addVariable('tPos', positionSim, pos0)
    const velVar = gpu.addVariable('tVel', velocitySim, vel0)
    gpu.setVariableDependencies(posVar, [posVar, velVar])
    gpu.setVariableDependencies(velVar, [posVar, velVar])

    const vu = velVar.material.uniforms
    const names = [
      'uDt', 'uTime', 'uFlow', 'uStream', 'uOrbit', 'uModeA', 'uModeB', 'uModeT', 'uExplode', 'uGather',
      'uBurst', 'uShock', 'uCollapse', 'uEnergy', 'uBass', 'uKick', 'uRelease', 'uMouseStr',
    ]
    for (const n of names) vu[n] = { value: 0 }
    vu.tSeed = { value: seedTex }
    vu.uRayO = { value: engine.mouse.rayO }
    vu.uRayD = { value: engine.mouse.rayD }
    vu.uObjRot = { value: engine.rot }
    posVar.material.uniforms.uDt = { value: 0 }

    const err = gpu.init()
    if (err) console.error('[shards] GPGPU init failed:', err)
    const out = { gpu, posVar, velVar, seedTex, ok: !err }
    if (import.meta.env.DEV) (window as unknown as { __shards?: typeof out }).__shards = out
    return out
  }, [gl, side, count])

  const { geometry, material } = useMemo(() => {
    const base = makeShardGeometry()
    const g = new InstancedBufferGeometry()
    g.setAttribute('position', base.getAttribute('position'))
    g.setAttribute('normal', base.getAttribute('normal'))
    const refs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      refs[i * 2] = ((i % side) + 0.5) / side
      refs[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side
    }
    g.setAttribute('aRef', new InstancedBufferAttribute(refs, 2))
    g.instanceCount = count
    const m = new ShaderMaterial({
      vertexShader: shardVertex,
      fragmentShader: shardFragment,
      uniforms: {
        ...envUniforms,
        tPos: { value: null as Texture | null },
        tVel: { value: null as Texture | null },
        tSeed: { value: sim.seedTex },
        uSize: { value: isMobile ? 0.06 : 0.05 },
        uHeat: { value: 0 },
      },
    })
    return { geometry: g, material: m }
  }, [count, side, sim])

  useEffect(
    () => () => {
      sim.gpu.dispose()
      sim.seedTex.dispose()
      geometry.dispose()
      material.dispose()
    },
    [sim, geometry, material],
  )

  useFrame((_, rawDt) => {
    if (!sim.ok) return
    const dt = Math.min(rawDt, 1 / 30)
    const c = engine.climax
    const vu = sim.velVar.material.uniforms
    vu.uDt.value = dt
    vu.uTime.value = engine.time
    vu.uFlow.value = engine.flow
    vu.uStream.value = engine.stream
    vu.uOrbit.value = engine.orbit
    vu.uModeA.value = engine.modeA
    vu.uModeB.value = engine.modeB
    vu.uModeT.value = engine.modeT
    vu.uExplode.value = c.explode
    vu.uGather.value = c.gather
    vu.uBurst.value = engine.burst
    vu.uShock.value = engine.shardShock
    vu.uCollapse.value = c.collapse
    vu.uEnergy.value = engine.energy
    vu.uBass.value = engine.bass
    vu.uKick.value = engine.kick
    vu.uRelease.value = engine.release
    vu.uMouseStr.value = engine.mouse.strength
    sim.posVar.material.uniforms.uDt.value = dt
    sim.gpu.compute()
    material.uniforms.tPos.value = sim.gpu.getCurrentRenderTarget(sim.posVar).texture
    material.uniforms.tVel.value = sim.gpu.getCurrentRenderTarget(sim.velVar).texture
    material.uniforms.uHeat.value = c.heat
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
}
