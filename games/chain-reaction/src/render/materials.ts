import {
  BackSide, CanvasTexture, Color, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, PMREMGenerator,
  RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, type Texture, type WebGLRenderer,
} from 'three'

/** seeded value noise for canvas textures */
function noiseCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  let s = 1234567
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  draw(ctx, rnd)
  return c
}

function brushed(): Texture {
  const c = noiseCanvas(512, 512, (ctx, r) => {
    ctx.fillStyle = '#8a8a8a'
    ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 2600; i++) {
      const y = r() * 512
      const v = 110 + r() * 60
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.08 + r() * 0.18})`
      ctx.lineWidth = 0.5 + r() * 1.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(512, y + (r() - 0.5) * 3)
      ctx.stroke()
    }
    // a few scuffs
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(200,200,200,${r() * 0.12})`
      ctx.beginPath()
      ctx.ellipse(r() * 512, r() * 512, 4 + r() * 22, 2 + r() * 8, r() * 3, 0, 7)
      ctx.fill()
    }
  })
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  return t
}

function walnut(): { map: Texture; rough: Texture } {
  const draw = (ctx: CanvasRenderingContext2D, r: () => number, rough: boolean) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, rough ? '#9a9a9a' : '#4a2c1a')
    g.addColorStop(1, rough ? '#8c8c8c' : '#3a2214')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1024, 512)
    for (let i = 0; i < 220; i++) {
      const y0 = r() * 512
      const amp = 4 + r() * 18
      const f = 0.004 + r() * 0.01
      const ph = r() * 6
      const light = r() < 0.5
      ctx.strokeStyle = rough
        ? `rgba(${light ? 170 : 110},${light ? 170 : 110},${light ? 170 : 110},${0.15 + r() * 0.25})`
        : light ? `rgba(120,78,46,${0.15 + r() * 0.3})` : `rgba(28,14,8,${0.2 + r() * 0.35})`
      ctx.lineWidth = 0.6 + r() * 2.4
      ctx.beginPath()
      for (let x = 0; x <= 1024; x += 8) {
        const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  const map = new CanvasTexture(noiseCanvas(1024, 512, (c, r) => draw(c, r, false)))
  map.colorSpace = SRGBColorSpace
  const rough = new CanvasTexture(noiseCanvas(1024, 512, (c, r) => draw(c, r, true)))
  for (const t of [map, rough]) t.wrapS = t.wrapT = RepeatWrapping
  return { map, rough }
}

export interface Materials {
  brass: MeshPhysicalMaterial
  brassDark: MeshPhysicalMaterial
  gold: MeshPhysicalMaterial
  copper: MeshPhysicalMaterial
  patina: MeshStandardMaterial
  steel: MeshPhysicalMaterial
  steelDark: MeshStandardMaterial
  iron: MeshStandardMaterial
  chrome: MeshPhysicalMaterial
  walnut: MeshPhysicalMaterial
  walnutDark: MeshPhysicalMaterial
  felt: MeshStandardMaterial
  rubber: MeshStandardMaterial
  enamel: MeshPhysicalMaterial
  lampOff: MeshStandardMaterial
  /** shared emissive for lit indicator lamps (intensity animated per lamp via clones) */
  lampOn: MeshStandardMaterial
  glass: MeshPhysicalMaterial
  ghost: MeshStandardMaterial
  invalid: MeshStandardMaterial
}

export function createMaterials(): Materials {
  const br = brushed()
  const wood = walnut()
  const metal = (color: string, rough: number, extra: Partial<MeshPhysicalMaterial> = {}) => {
    const m = new MeshPhysicalMaterial({ color: new Color(color), metalness: 1, roughness: rough, roughnessMap: br, envMapIntensity: 1 })
    Object.assign(m, extra)
    return m
  }
  return {
    brass: metal('#d7a24a', 0.3, { clearcoat: 0.25, clearcoatRoughness: 0.2 }),
    brassDark: metal('#9a6c2c', 0.42),
    gold: metal('#f3c35a', 0.18, { clearcoat: 0.5, clearcoatRoughness: 0.1 }),
    copper: metal('#c27148', 0.34),
    patina: new MeshStandardMaterial({ color: '#2c3a38', metalness: 0.55, roughness: 0.62, roughnessMap: br }),
    steel: metal('#c9ced3', 0.32),
    steelDark: new MeshStandardMaterial({ color: '#31373c', metalness: 0.85, roughness: 0.48, roughnessMap: br }),
    iron: new MeshStandardMaterial({ color: '#23282c', metalness: 0.75, roughness: 0.62 }),
    chrome: metal('#eef1f4', 0.05, { roughnessMap: null }),
    walnut: new MeshPhysicalMaterial({ map: wood.map, roughnessMap: wood.rough, roughness: 0.62, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.28, color: '#ffffff' }),
    walnutDark: new MeshPhysicalMaterial({ map: wood.map, roughnessMap: wood.rough, roughness: 0.7, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.4, color: '#7a6a60' }),
    felt: new MeshStandardMaterial({ color: '#2e1412', roughness: 1, metalness: 0 }),
    rubber: new MeshStandardMaterial({ color: '#16181a', roughness: 0.85, metalness: 0 }),
    enamel: new MeshPhysicalMaterial({ color: '#1b2a2e', roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15 }),
    lampOff: new MeshStandardMaterial({ color: '#2a1410', roughness: 0.4, metalness: 0.1, emissive: '#ff4a14', emissiveIntensity: 0.05 }),
    lampOn: new MeshStandardMaterial({ color: '#ff7a3a', roughness: 0.3, metalness: 0, emissive: '#ff5a1c', emissiveIntensity: 6 }),
    glass: new MeshPhysicalMaterial({ color: '#c8e4ff', roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    ghost: new MeshStandardMaterial({ color: '#7fe0ff', roughness: 0.4, metalness: 0, transparent: true, opacity: 0.35, emissive: '#2aa8d8', emissiveIntensity: 0.6, depthWrite: false }),
    invalid: new MeshStandardMaterial({ color: '#ff5040', roughness: 0.4, transparent: true, opacity: 0.4, emissive: '#ff2010', emissiveIntensity: 0.8, depthWrite: false }),
  }
}

/**
 * Studio environment for reflections: deep teal-grey dome, a big warm key softbox, a cool rim
 * strip and a floor bounce — rendered once to a PMREM cube. Gives the metals their product-shot look.
 */
export function studioEnvironment(renderer: WebGLRenderer, size: number): Texture {
  const scene = new Scene()
  const dome = new Mesh(new SphereGeometry(50, 48, 24), new MeshBasicMaterial({ side: BackSide, vertexColors: false, color: '#0d1416' }))
  scene.add(dome)
  const panel = (w: number, h: number, color: string, intensity: number, pos: [number, number, number], look: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: 2 }))
    m.position.set(...pos)
    m.lookAt(...look)
    scene.add(m)
  }
  panel(26, 16, '#ffd9a8', 4.2, [-22, 26, 24], [0, 0, 0]) // warm key
  panel(8, 40, '#9fd6ff', 2.2, [30, 10, -16], [0, 0, 0]) // cool rim strip
  panel(40, 6, '#f2e6d0', 1.1, [0, 40, -5], [0, 0, 0]) // top
  panel(60, 30, '#20302f', 1.0, [0, -24, 0], [0, 0, 0]) // floor bounce
  panel(12, 12, '#ff9a5a', 1.6, [24, 4, 26], [0, 0, 0]) // warm accent
  const pm = new PMREMGenerator(renderer)
  const rt = pm.fromScene(scene, 0.02, 0.1, 100, { size })
  pm.dispose()
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose()
      ;(o.material as MeshBasicMaterial).dispose()
    }
  })
  return rt.texture
}
