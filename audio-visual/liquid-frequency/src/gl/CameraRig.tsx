import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type PerspectiveCamera, Vector3 } from 'three'
import { approach } from '../audio/features'
import { engine } from '../engine/engine'
import { useStore } from '../state/store'
import { envUniforms } from './envUniforms'

/**
 * Cinematic orbit camera: slow auto-orbit, drag-to-rotate with inertia, wheel /
 * pinch zoom, kick shake, climax dolly. Distance is fitted to the aspect ratio
 * so 9:16 framing keeps the whole sculpture in shot.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const st = useRef({
    az: 0.7,
    el: 0.14,
    vAz: 0,
    vEl: 0,
    zoom: 1,
    zoomT: 1,
    drag: false,
    lx: 0,
    ly: 0,
    downX: 0,
    downY: 0,
    lastTap: 0,
    lastInput: -10,
    pull: 0,
    lookY: 0,
  })
  const tmp = useMemo(() => ({ o: new Vector3(), d: new Vector3(), f: new Vector3() }), [])

  useEffect(() => {
    const el = gl.domElement
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch0 = 0
    let zoom0 = 1
    const s = st.current
    const updateMouse = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      engine.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
      engine.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1
      engine.mouse.inside = true
      engine.mouse.lastMove = engine.time
    }
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      el.setPointerCapture(e.pointerId)
      s.drag = true
      s.lx = s.downX = e.clientX
      s.ly = s.downY = e.clientY
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
        zoom0 = s.zoomT
      }
      updateMouse(e)
    }
    const move = (e: PointerEvent) => {
      updateMouse(e)
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch0 > 0) s.zoomT = Math.min(2.2, Math.max(0.55, zoom0 * (pinch0 / d)))
        return
      }
      if (!s.drag) return
      const dx = e.clientX - s.lx
      const dy = e.clientY - s.ly
      s.lx = e.clientX
      s.ly = e.clientY
      s.vAz -= dx * 0.0009
      s.vEl += dy * 0.0007
      s.lastInput = engine.time
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch0 = 0
      if (pointers.size === 0) s.drag = false
      if (e.pointerType !== 'mouse') {
        const moved = Math.hypot(e.clientX - s.downX, e.clientY - s.downY)
        const now = performance.now()
        if (moved < 12 && now - s.lastTap < 320) {
          engine.pulseAt(1)
          s.lastTap = 0
        } else if (moved < 12) s.lastTap = now
        engine.mouse.inside = false
      }
    }
    const leave = () => {
      engine.mouse.inside = false
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      s.zoomT = Math.min(2.2, Math.max(0.55, s.zoomT * Math.exp(e.deltaY * 0.0011)))
      s.lastInput = engine.time
    }
    const dbl = () => engine.pulseAt(1)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('dblclick', dbl)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('dblclick', dbl)
    }
  }, [gl])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const s = st.current
    const { cinematic, entered } = useStore.getState()
    const c = engine.climax
    const t = engine.time

    // auto orbit + drag inertia
    s.az += dt * (cinematic ? 0.12 + engine.energy * 0.08 : 0.045 + engine.energy * 0.04) + s.vAz
    s.el += s.vEl
    const inertia = Math.exp(-dt * 5)
    s.vAz *= inertia
    s.vEl *= inertia
    const idle = t - s.lastInput > 2.5
    const elBase = cinematic ? 0.12 + 0.14 * Math.sin(t * 0.13) : 0.13
    if (idle && !s.drag) s.el += (elBase - s.el) * approach(0.6, dt)
    s.el = Math.max(-0.7, Math.min(1.05, s.el))
    if (cinematic && idle) s.zoomT += (1 - s.zoomT) * approach(0.4, dt)
    s.zoom += (s.zoomT - s.zoom) * approach(4, dt)

    const aspect = size.width / Math.max(1, size.height)
    const tanH = Math.tan((camera.fov * Math.PI) / 360)
    const fitR = 2.55
    let dist = Math.max(fitR / tanH, fitR / (tanH * aspect)) * s.zoom
    s.pull += (c.explode * (1 - c.gather * 0.7) - s.pull) * approach(1.2, dt)
    dist *= 1 - 0.12 * c.charge + 0.12 * c.flash + 0.32 * s.pull
    if (cinematic) dist *= 1 + 0.05 * Math.sin(t * 0.21)
    const portraitIntro = !entered && aspect < 0.85
    if (!entered && size.width > 860) dist *= 0.94
    if (portraitIntro) dist *= 0.82
    s.lookY += ((portraitIntro ? -0.32 * dist * tanH : 0) - s.lookY) * approach(2.2, dt)

    const ce = Math.cos(s.el)
    camera.position.set(Math.sin(s.az) * ce * dist, Math.sin(s.el) * dist, Math.cos(s.az) * ce * dist)
    const sh = engine.shake * 0.022
    if (sh > 0.0005) {
      camera.position.x += Math.sin(t * 47.3) * sh
      camera.position.y += Math.sin(t * 53.1 + 1.3) * sh
      camera.position.z += Math.sin(t * 41.7 + 2.1) * sh
    }
    camera.position.y += s.lookY
    camera.lookAt(0, s.lookY, 0)

    // intro composition: push the sculpture right of the title on wide screens
    const filmT = !entered && size.width > 860 ? -8.5 : 0
    camera.filmOffset += (filmT - camera.filmOffset) * approach(2.2, dt)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()

    // cursor ray (for magnetic disturbance)
    const m = engine.mouse
    tmp.o.copy(camera.position)
    tmp.d.set(m.x, m.y, 0.5).unproject(camera).sub(camera.position).normalize()
    m.rayO.copy(tmp.o)
    m.rayD.copy(tmp.d)
    // hit a proxy sphere around the sculpture; if missed, use the closest point to the centre
    const R = 1.1
    const b = tmp.o.dot(tmp.d)
    const cc = tmp.o.lengthSq() - R * R
    const h = b * b - cc
    const tt = h > 0 ? -b - Math.sqrt(h) : -b
    m.world.copy(tmp.o).addScaledVector(tmp.d, tt)

    camera.getWorldDirection(tmp.f)
    envUniforms.uRimDir.value.copy(tmp.f)
  }, -5)

  return null
}
