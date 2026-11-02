import { Vector3 } from 'three'
import type { Engine } from '../engine/Engine'
import { HAND_DEFAULTS } from '../tracking/GestureEngine'
import { syntheticHand } from '../fx/HandOverlay'
import type { VisionResult } from '../tracking/visionRunner'
import { useUI } from '../state/store'

/** a synthetic 478-point face with the eye corners where a real face would put them */
export function syntheticFace(u: number, v: number, ipd: number) {
  const lm = new Float32Array(478 * 3)
  const set = (i: number, x: number, y: number, z = 0) => {
    lm[i * 3] = x
    lm[i * 3 + 1] = y
    lm[i * 3 + 2] = z
  }
  for (let i = 0; i < 478; i++) set(i, u, v)
  // subject's right eye appears on the image's left
  for (const i of [33, 133, 159, 145]) set(i, u - ipd / 2 + (i === 33 ? -0.01 : i === 133 ? 0.01 : 0), v)
  for (const i of [362, 263, 386, 374]) set(i, u + ipd / 2 + (i === 263 ? 0.01 : i === 362 ? -0.01 : 0), v)
  set(1, u, v + ipd * 0.6)
  set(10, u, v - ipd * 1.2)
  set(152, u, v + ipd * 2.0)
  return { lm, count: 478 }
}

/** raw-camera landmarks for a hand whose pinch point lands on canvas (x, y) */
export function syntheticHandRaw(x: number, y: number, pinch: number, size: number) {
  const o = HAND_DEFAULTS
  const scr = syntheticHand(x, y, pinch, 4 / 3, size)
  const lm = new Float32Array(63)
  for (let i = 0; i < 21; i++) {
    // invert the gesture engine's mirrored interaction-zone mapping
    lm[i * 3] = 1 - ((scr[i * 2] - 0.5) / o.zoneGx + o.zoneCx)
    lm[i * 3 + 1] = (scr[i * 2 + 1] - 0.5) / o.zoneGy + o.zoneCy
    lm[i * 3 + 2] = 0
  }
  return lm
}

interface SimHand {
  x: number
  y: number
  pinch: number
  size: number
}

/**
 * Dev / ?debug hooks. The browser pane used for automated checks is usually
 * hidden (rAF throttled), so tests drive a manual clock, inject synthetic
 * landmarks through the real tracking → gesture → interaction path, and read
 * the canvas back directly.
 */
export function install(e: Engine) {
  let face: { u: number; v: number; ipd: number } | null = null
  const hands: (SimHand | null)[] = [null, null]
  const W = 640
  const H = 480

  const inject = () => {
    if (!e.simTracking) return
    const r: VisionResult = {
      t: e.time * 1000,
      w: W,
      h: H,
      faces: face ? [syntheticFace(face.u, face.v, face.ipd)] : [],
      hands: hands.filter((h): h is SimHand => !!h).map((h) => ({ lm: syntheticHandRaw(h.x, h.y, h.pinch, h.size), score: 0.95 })),
      ms: 0,
      ranFace: true,
    }
    e.ingest(r)
  }

  const api = {
    e,
    /** stop the rAF loop and step n frames of dt seconds (simulated camera at the same rate) */
    step(n = 1, dt = 1 / 60) {
      e.manualClock = true
      for (let i = 0; i < n; i++) {
        inject()
        e.frame(dt)
      }
      return api.state()
    },
    run() {
      e.manualClock = false
    },
    enter() {
      useUI.setState({ phase: 'experience' })
      e.mouse.autoSway = false
      e.mouse.resetHead()
    },
    /** simulated camera: a face at raw image (u, v) with apparent IPD (normalised width) */
    face(u: number | null, v = 0.45, ipd = 0.1) {
      e.simTracking = true
      face = u === null ? null : { u, v, ipd }
    },
    /** simulated hand i at canvas (x, y); pinch 0..1; size = palm length (bigger = nearer the screen) */
    hand(i: number, h: Partial<SimHand> | null) {
      e.simTracking = true
      hands[i] = h === null ? null : { x: 0.5, y: 0.5, pinch: 0, size: 0.13, ...(hands[i] ?? {}), ...h }
    },
    simOff() {
      e.simTracking = false
      face = null
      hands[0] = hands[1] = null
      e.head.reset()
      e.gestures.reset()
    },
    /** NDC of a world point under the current eye */
    ndc(x: number, y: number, z: number) {
      const p = new Vector3(x, y, z).project(e.view.camera)
      return [+p.x.toFixed(4), +p.y.toFixed(4)]
    },
    obj(i: number) {
      const o = e.labObjects[i]
      const v = o.body.linvel()
      return { kind: o.kind, pos: o.currP.toArray().map((x) => +x.toFixed(3)), vel: [v.x, v.y, v.z].map((x) => +x.toFixed(3)), held: o.held }
    },
    state() {
      const c = e.core.obj
      const v = c.body.linvel()
      return {
        eye: e.view.eye.toArray().map((x) => +x.toFixed(3)),
        eyeCm: e.rig.cm.toArray().map((x) => +x.toFixed(2)),
        source: e.rig.source,
        head: { present: e.head.state.present, conf: +e.head.state.confidence.toFixed(2), calibrated: e.head.state.calibrated },
        core: c.currP.toArray().map((x) => +x.toFixed(3)),
        coreVel: [v.x, v.y, v.z].map((x) => +x.toFixed(2)),
        coreHeld: c.held,
        world: e.world,
        damage: +e.screen.damage.toFixed(3),
        intact: e.screen.intact,
        shards: e.fracture.shards.length,
        grips: [...e.interaction.grips.values()].map((g) => ({ id: g.id, state: g.state, held: g.held?.kind ?? null, hover: g.hover?.kind ?? null, press: +g.press.toFixed(2) })),
        gravity: e.gravity,
        bodies: e.physics.dynamicCount(),
        demo: e.director.active ? +e.director.t.toFixed(2) : null,
        overflow: e.overflow.active,
        heroes: e.overflow.heroes.length,
        creations: e.creationsLive.length,
        fps: Math.round(e.perf.fps),
        camera: e.tracking.status,
      }
    },
    capture(scale = 0.5, type = 'image/jpeg') {
      const c = e.renderer.domElement
      const t = document.createElement('canvas')
      t.width = Math.round(c.width * scale)
      t.height = Math.round(c.height * scale)
      const g = t.getContext('2d')!
      g.drawImage(c, 0, 0, t.width, t.height)
      g.drawImage(e.overlay.canvas, 0, 0, t.width, t.height)
      return t.toDataURL(type, 0.86)
    },
    async save(name: string, scale = 0.75) {
      await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: api.capture(scale) })
      return name
    },
    bench(n = 30) {
      e.manualClock = true
      const gl = e.renderer.getContext()
      const px = new Uint8Array(4)
      e.frame(1 / 60)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const t0 = performance.now()
      for (let i = 0; i < n; i++) {
        e.frame(1 / 60)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      }
      return +((performance.now() - t0) / n).toFixed(2)
    },
    /** a fake camera (animated canvas) to exercise start/stop and the worker pipeline */
    async fakeCamera() {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 480
      const g = c.getContext('2d')!
      let k = 0
      const id = setInterval(() => {
        g.fillStyle = `hsl(${(k++ * 7) % 360},20%,20%)`
        g.fillRect(0, 0, 640, 480)
      }, 33)
      const stream = c.captureStream(30)
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(id))
      await e.startCamera(stream)
      return e.tracking.status
    },
  }
  ;(window as unknown as { __BTS: typeof api }).__BTS = api
  return api
}
