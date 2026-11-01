import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  DoubleSide,
  type Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Mesh,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { engine } from '../engine/engine'
import { envUniforms } from './envUniforms'
import {
  backdropFragment,
  backdropVertex,
  dustFragment,
  dustVertex,
  orbitFragment,
  orbitVertex,
  ringFragment,
  ringVertex,
} from './shaders/fx'

/** Screen-space position of the sculpture centre, shared by backdrop and post FX. */
export const screenCenter = new Vector2(0.5, 0.5)
const tmpV = new Vector3()

// ---------------------------------------------------------------------------------
export function Backdrop() {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const { geometry, material } = useMemo(() => {
    const g = new PlaneGeometry(2, 2)
    const m = new ShaderMaterial({
      vertexShader: backdropVertex,
      fragmentShader: backdropFragment,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uAspect: { value: 1 },
        uFlash: { value: 0 },
        uEnergy: { value: 0 },
        uReveal: { value: 1 },
        uCenter: { value: screenCenter },
        uAccent: envUniforms.uAccent,
      },
    })
    return { geometry: g, material: m }
  }, [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  useFrame(() => {
    tmpV.set(0, 0, 0).project(camera)
    screenCenter.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5)
    const u = material.uniforms
    u.uAspect.value = size.width / Math.max(1, size.height)
    u.uFlash.value = engine.climax.flash
    u.uEnergy.value = engine.energy
    u.uReveal.value = engine.reveal
  })
  return <mesh geometry={geometry} material={material} renderOrder={-100} frustumCulled={false} />
}

// ---------------------------------------------------------------------------------
export function Dust({ count }: { count: number }) {
  const { geometry, material } = useMemo(() => {
    const base = new PlaneGeometry(1, 1, 1, 1)
    const g = new InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.getAttribute('position'))
    const seeds = new Float32Array(count * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
    g.instanceCount = count
    const m = new ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uPhase: { value: 0 },
        uTrail: { value: 0.05 },
        uExplode: { value: 0 },
        uSing: { value: 0 },
        uWidth: { value: 0.0065 },
        uTime: { value: 0 },
        uCollapse: { value: 0 },
        uIntensity: { value: 1 },
      },
    })
    return { geometry: g, material: m }
  }, [count])
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
    u.uPhase.value = engine.dustPhase
    u.uTrail.value = 0.012 + engine.treble * 0.05 + c.explode * 0.05
    u.uExplode.value = c.explode * (1 - c.gather * 0.85)
    u.uSing.value = engine.modeW[3]
    u.uTime.value = engine.time
    u.uCollapse.value = c.collapse
    const shatter = engine.modeW[2]
    u.uIntensity.value = (0.22 + engine.treble * 1.6 + engine.energy * 0.4 + c.explode * 0.8 + c.flash) * engine.reveal * (1 - shatter * 0.5)
  })
  return <mesh geometry={geometry} material={material} renderOrder={2} frustumCulled={false} />
}

// ---------------------------------------------------------------------------------
const RING_POOL = 8
export function ShockRings() {
  const camera = useThree((s) => s.camera)
  const refs = useRef<(Mesh | null)[]>([])
  const state = useMemo(
    () => Array.from({ length: RING_POOL }, () => ({ age: 99, dur: 1, str: 0, big: false, base: 3 })),
    [],
  )
  const geometry = useMemo(() => new PlaneGeometry(2, 2), [])
  const materials = useMemo(
    () =>
      Array.from(
        { length: RING_POOL },
        () =>
          new ShaderMaterial({
            vertexShader: ringVertex,
            fragmentShader: ringFragment,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
            uniforms: { uProg: { value: 1 }, uStr: { value: 0 }, uColor: { value: new Vector3(0.82, 0.9, 1.0) } },
          }),
      ),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      materials.forEach((m) => m.dispose())
    },
    [geometry, materials],
  )
  const next = useRef(0)

  useFrame((_, dt) => {
    const ev = engine.ringEvents
    for (let e = 0; e < ev.length; e++) {
      const i = next.current
      next.current = (i + 1) % RING_POOL
      const s = state[i]
      const m = refs.current[i]
      if (!m) continue
      s.age = 0
      s.big = ev[e].big
      s.str = Math.min(1.8, ev[e].strength) * engine.reveal
      s.dur = s.big ? 1.7 : 0.95 + ev[e].strength * 0.25
      s.base = s.big ? 7.5 : 2.4 + ev[e].strength * 1.6
      if (s.big) m.quaternion.copy(camera.quaternion)
      else m.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6)
    }
    ev.length = 0
    for (let i = 0; i < RING_POOL; i++) {
      const s = state[i]
      const m = refs.current[i]
      if (!m) continue
      s.age += Math.min(dt, 0.05)
      const prog = s.age / s.dur
      m.visible = prog < 1
      if (!m.visible) continue
      m.scale.setScalar(s.base)
      materials[i].uniforms.uProg.value = prog
      materials[i].uniforms.uStr.value = s.str
    }
  })

  return (
    <group>
      {materials.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          geometry={geometry}
          material={m}
          visible={false}
          renderOrder={3}
          frustumCulled={false}
        />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------------
const ORBITS = [
  { r: 1.32, tube: 0.026, tilt: [1.2, 0.2], speed: [0.35, 0.12], run: 0.35 },
  { r: 1.72, tube: 0.016, tilt: [0.4, 1.1], speed: [-0.22, 0.27], run: -0.25 },
  { r: 2.18, tube: 0.034, tilt: [1.45, -0.5], speed: [0.16, -0.1], run: 0.2 },
  { r: 2.8, tube: 0.011, tilt: [1.6, 0.05], speed: [0.06, 0.05], run: 0.12 },
]
export function OrbitRings() {
  const group = useRef<Group>(null)
  const rings = useRef<(Mesh | null)[]>([])
  const geos = useMemo(() => ORBITS.map((o) => new TorusGeometry(o.r, o.tube, 14, 240)), [])
  const mats = useMemo(
    () =>
      ORBITS.map(
        (o) =>
          new ShaderMaterial({
            vertexShader: orbitVertex,
            fragmentShader: orbitFragment,
            uniforms: { ...envUniforms, uGlow: { value: 0 }, uTime: { value: 0 }, uSpeed: { value: o.run } },
          }),
      ),
    [],
  )
  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
    },
    [geos, mats],
  )
  const spin = useRef(ORBITS.map(() => [0, 0]))

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = group.current
    if (!g) return
    const w = engine.modeW[3]
    const c = engine.climax
    g.visible = w > 0.01
    if (!g.visible) return
    const blast = c.explode * (1 - c.gather)
    const s = Math.pow(w, 0.6) * (1 - 0.78 * c.collapse) * (1 + blast * 1.3 + engine.kick * 0.04)
    g.scale.setScalar(Math.max(0.001, s))
    const sp = 0.6 + engine.energy * 1.8 + c.charge * 3 + blast * 2
    ORBITS.forEach((o, i) => {
      const r = rings.current[i]
      if (!r) return
      spin.current[i][0] += dt * o.speed[0] * sp
      spin.current[i][1] += dt * o.speed[1] * sp
      r.rotation.set(o.tilt[0] + spin.current[i][0], spin.current[i][1] * 2, o.tilt[1] + spin.current[i][1])
      mats[i].uniforms.uGlow.value = 0.3 + engine.energy * 1.2 + engine.kick * 1.5 + c.charge * 2
      mats[i].uniforms.uTime.value = engine.time
    })
  })

  return (
    <group ref={group} visible={false}>
      {ORBITS.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            rings.current[i] = el
          }}
          geometry={geos[i]}
          material={mats[i]}
        />
      ))}
    </group>
  )
}
