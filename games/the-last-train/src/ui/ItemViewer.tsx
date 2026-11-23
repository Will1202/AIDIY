// 物品 3D 预览：独立的小渲染器，拖动旋转。关闭时释放全部 GPU 资源。
import { useEffect, useRef } from 'react'
import { ACESFilmicToneMapping, AmbientLight, DirectionalLight, Group, Mesh, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, WebGLRenderer, type Material } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ITEMS } from '../content/items'
import { itemModel } from '../world/shared/itemModels'

let shared: { r: WebGLRenderer; env: ReturnType<PMREMGenerator['fromScene']> } | null = null

function getRenderer() {
  if (shared) return shared
  const r = new WebGLRenderer({ antialias: true, alpha: true })
  r.outputColorSpace = SRGBColorSpace
  r.toneMapping = ACESFilmicToneMapping
  r.toneMappingExposure = 1.1
  const pm = new PMREMGenerator(r)
  const env = pm.fromScene(new RoomEnvironment(), 0.04)
  pm.dispose()
  shared = { r, env }
  return shared
}

export function ItemViewer({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    const def = ITEMS[id]
    if (!el || !def) return
    const { r, env } = getRenderer()
    el.appendChild(r.domElement)
    const scene = new Scene()
    scene.environment = env.texture
    scene.add(new AmbientLight(0xffffff, 0.3))
    const key = new DirectionalLight(0xffe8cc, 2.2)
    key.position.set(2, 3, 2)
    scene.add(key)
    const rim = new DirectionalLight(0x8fb8ff, 1.6)
    rim.position.set(-3, 1, -2)
    scene.add(rim)
    const pivot = new Group()
    const model = itemModel(def.model, def.color)
    pivot.add(model)
    scene.add(pivot)
    const cam = new PerspectiveCamera(32, 1, 0.1, 50)
    cam.position.set(0, 0.6, 3.6)
    cam.lookAt(0, 0, 0)
    let rx = 0.4, ry = 0.6, vy = 0.4, drag = false, lx = 0, ly = 0
    const down = (e: PointerEvent) => { drag = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId) }
    const move = (e: PointerEvent) => {
      if (!drag) return
      ry += (e.clientX - lx) * 0.01
      rx += (e.clientY - ly) * 0.01
      vy = (e.clientX - lx) * 0.01
      lx = e.clientX
      ly = e.clientY
    }
    const up = () => { drag = false }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    let raf = 0
    let last = performance.now()
    const frame = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const w = el.clientWidth, h = el.clientHeight
      if (r.domElement.width !== w * Math.min(2, devicePixelRatio)) {
        r.setPixelRatio(Math.min(2, devicePixelRatio))
        r.setSize(w, h, false)
        cam.aspect = w / Math.max(1, h)
        cam.updateProjectionMatrix()
      }
      if (!drag) {
        vy += (0.35 - vy) * dt * 1.5
        ry += vy * dt
      }
      pivot.rotation.set(rx, ry, 0)
      model.position.y = Math.sin(now / 900) * 0.04
      r.render(scene, cam)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      r.domElement.remove()
      model.traverse((o) => {
        const m = o as Mesh
        m.geometry?.dispose()
        const mat = m.material as Material | Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
    }
  }, [id])
  return <div className="c3" ref={host} />
}
