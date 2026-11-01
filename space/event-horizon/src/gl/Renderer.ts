import * as THREE from 'three'
import { FullscreenPass } from './FullscreenPass'
import { bakeNoise, bakeSky } from './Bake'
import { DebrisGPU } from './Debris'
import type { CameraRig } from './CameraRig'
import type { Params } from '../systems/params'
import type { TierSpec } from '../systems/Quality'
import { TIERS } from '../systems/Quality'
import blackholeFrag from './shaders/blackhole.frag?raw'
import universeFrag from './shaders/universe.frag?raw'
import worldFrag from './shaders/world.frag?raw'
import prefilterFrag from './shaders/prefilter.frag?raw'
import downFrag from './shaders/down.frag?raw'
import upFrag from './shaders/up.frag?raw'
import trailFrag from './shaders/trail.frag?raw'
import finalFrag from './shaders/final.frag?raw'
import dustVert from './shaders/dust.vert?raw'
import dustFrag from './shaders/dust.frag?raw'

export interface FrameState {
  time: number
  dt: number
  P: Params
  rig: CameraRig
  uniRig: CameraRig
  bhPx: { x: number; y: number }
  shadowPx: number
  diskTime: number
  tunnelTravel: number
  hotPos: THREE.Vector3
  shakePx: { x: number; y: number }
  skyAngle: number
}

const v2 = () => ({ value: new THREE.Vector2() })
const v3 = () => ({ value: new THREE.Vector3() })
const f = (x = 0) => ({ value: x })
const tex = () => ({ value: null as THREE.Texture | null })

const VORTEX_AXIS = new THREE.Vector3(0, 0.035, -1).normalize()

export class GLRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly debris: DebrisGPU
  spec: TierSpec
  worldScale: number
  cssW = 1
  cssH = 1
  dpr = 1

  private readonly hdrType: THREE.TextureDataType
  private readonly noiseRT: THREE.WebGLRenderTarget
  private skyA: THREE.WebGLCubeRenderTarget
  private skyB: THREE.WebGLCubeRenderTarget
  private skyRes: number
  private readonly rt: Record<'bh' | 'uni' | 'world' | 'glowBack' | 'glowFront' | 'trailA' | 'trailB' | 'debrisBack' | 'debrisFront', THREE.WebGLRenderTarget>
  private bloom: THREE.WebGLRenderTarget[] = []
  private readonly black: THREE.DataTexture
  private trailEnergy = 0

  private readonly lensU = { uBhUv: v2(), uAspect: f(1), uLens: f(0), uEinstein: f(0.1), uShadowR: f(0.1), uMaskOn: f(0) }
  private readonly bh: FullscreenPass
  private readonly uni: FullscreenPass
  private readonly world: FullscreenPass
  private readonly prefilter: FullscreenPass
  private readonly down: FullscreenPass
  private readonly up: FullscreenPass
  private readonly trail: FullscreenPass
  private readonly final: FullscreenPass
  private readonly dustScene = new THREE.Scene()
  private readonly dustMat: THREE.RawShaderMaterial
  private readonly dustGeo: THREE.BufferGeometry
  private readonly tmpM4 = new THREE.Matrix4()
  private readonly tmpM4b = new THREE.Matrix4()
  private readonly skyRot = new THREE.Matrix3()

  static create(canvas: HTMLCanvasElement, spec: TierSpec): GLRenderer | null {
    try {
      const probe = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        // dev only: lets automated screenshots read the canvas back
        preserveDrawingBuffer: import.meta.env.DEV,
      })
      if (!probe) return null
      return new GLRenderer(canvas, probe, spec)
    } catch (err) {
      console.warn('[event-horizon] WebGL unavailable', err)
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext, spec: TierSpec) {
    this.spec = spec
    this.worldScale = spec.worldScale
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' })
    this.renderer.autoClear = false
    this.renderer.setClearColor(0x000000, 1)
    const ext = this.renderer.extensions
    this.hdrType = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType

    this.noiseRT = bakeNoise(this.renderer)
    this.skyRes = spec.skyRes
    this.skyA = bakeSky(this.renderer, 0, this.skyRes, this.hdrType)
    this.skyB = bakeSky(this.renderer, 1, this.skyRes, this.hdrType)

    const mk = (type: THREE.TextureDataType) =>
      new THREE.WebGLRenderTarget(2, 2, { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false })
    this.rt = {
      bh: mk(this.hdrType),
      uni: mk(this.hdrType),
      world: mk(this.hdrType),
      glowBack: mk(this.hdrType),
      glowFront: mk(this.hdrType),
      trailA: mk(this.hdrType),
      trailB: mk(this.hdrType),
      debrisBack: mk(THREE.UnsignedByteType),
      debrisFront: mk(THREE.UnsignedByteType),
    }
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    this.black.needsUpdate = true

    const noise = this.noiseRT.texture
    this.bh = new FullscreenPass(
      blackholeFrag,
      {
        uRes: v2(), uCamPos: v3(), uFwd: v3(), uRight: v3(), uUp: v3(), uTanHalf: v2(), uShift: v2(), uAspect: f(1), uBhUv: v2(),
        uSky: { value: this.skyA.texture }, uNoise: { value: noise },
        uTime: f(), uDiskTime: f(), uDiskBright: f(1), uBeaming: f(0.8), uHaze: f(1), uRingBoost: f(1), uSkyGain: f(1), uEscape: f(32), uHoleDepth: f(29),
        uRipple: f(), uRippleR: f(), uWaves: f(), uHotPos: v3(), uHot: f(),
      },
      { defines: this.bhDefines() },
    )
    this.uni = new FullscreenPass(universeFrag, {
      uRes: v2(), uCamPos: v3(), uFwd: v3(), uRight: v3(), uUp: v3(), uTanHalf: v2(),
      uSky: { value: this.skyB.texture }, uNoise: { value: noise }, uSkyRot: { value: this.skyRot }, uTime: f(), uGain: f(1),
    })
    this.world = new FullscreenPass(worldFrag, {
      uBH: tex(), uUni: tex(), uNoise: { value: noise },
      uBhMix: f(1), uUniMix: f(), uStreak: f(), uTunnel: f(), uTravel: f(), uHue: f(), uAperture: f(), uImplode: f(), uTime: f(), uAspect: f(1), uBhUv: v2(), uResY: f(1),
    })
    this.prefilter = new FullscreenPass(prefilterFrag, { ...this.lensU, uWorld: tex(), uTrail: tex(), uGlowFront: tex(), uTexel: v2(), uTrailGain: f(1), uThreshold: f(0.9) })
    this.down = new FullscreenPass(downFrag, { uSrc: tex(), uTexel: v2() })
    this.up = new FullscreenPass(upFrag, { uSrc: tex(), uTexel: v2(), uWeight: f(1) }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor })
    this.trail = new FullscreenPass(trailFrag, { uPrev: tex(), uGlow: tex(), uCenter: v2(), uAspect: f(1), uDecay: f(0.9), uSpin: f(0), uInflow: f(0) })
    this.final = new FullscreenPass(finalFrag, {
      ...this.lensU,
      uWorld: tex(), uBloom: tex(), uTrail: tex(), uDebrisBack: tex(), uDebrisFront: tex(), uGlowFront: tex(), uRes: v2(), uShake: v2(),
      uExposure: f(1), uBloomStr: f(0.07), uTrailGain: f(1), uCA: f(), uVignette: f(1), uFlash: f(), uFlashCol: { value: new THREE.Color(1, 0.96, 0.9) },
      uFade: f(), uGrain: f(1), uTime: f(), uDebrisOn: f(),
    })

    this.debris = new DebrisGPU(3200, TIERS.ultra.particles, noise)

    const dust = this.buildDust(spec.dust)
    this.dustGeo = dust
    this.dustMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      uniforms: { uView: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uPxScale: f(500), uTime: f() },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    })
    const pts = new THREE.Points(this.dustGeo, this.dustMat)
    pts.frustumCulled = false
    this.dustScene.add(pts)
  }

  private bhDefines() {
    return { STEPS: this.spec.steps, DISK_LAYERS: this.spec.diskLayers }
  }

  private buildDust(n: number) {
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 4)
    const palette = [
      [0.75, 0.82, 1.0],
      [0.55, 0.65, 1.0],
      [0.85, 0.55, 1.0],
      [1.0, 0.6, 0.85],
      [0.6, 0.95, 1.0],
    ]
    let seed = 1337
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) {
      // a long cloud along the camera's flight path, denser near the axis
      // a long cloud along the flight path, kept in front of the worlds
      const z = 300 - Math.pow(rnd(), 0.9) * 700
      const spread = 30 + (300 - z) * 0.32
      const a = rnd() * Math.PI * 2
      const r = Math.pow(rnd(), 0.6) * spread
      pos[i * 3] = Math.cos(a) * r * 1.4
      pos[i * 3 + 1] = Math.sin(a) * r * 0.8 + (rnd() - 0.5) * 30
      pos[i * 3 + 2] = z
      const c = palette[Math.floor(rnd() * palette.length)]
      const b = 0.08 + Math.pow(rnd(), 4) * 1.1
      col[i * 4] = c[0] * b
      col[i * 4 + 1] = c[1] * b
      col[i * 4 + 2] = c[2] * b
      col[i * 4 + 3] = 0.3 + Math.pow(rnd(), 6) * 2.2
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 4))
    return g
  }

  get canvasW() {
    return Math.max(2, Math.round(this.cssW * this.dpr))
  }
  get canvasH() {
    return Math.max(2, Math.round(this.cssH * this.dpr))
  }

  resize(cssW: number, cssH: number) {
    this.cssW = Math.max(1, cssW)
    this.cssH = Math.max(1, cssH)
    this.dpr = Math.min(window.devicePixelRatio || 1, this.spec.maxDpr)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.cssW, this.cssH, false)
    this.allocate()
  }

  setWorldScale(s: number) {
    this.worldScale = s
    this.allocate()
  }

  setTier(spec: TierSpec) {
    this.spec = spec
    this.worldScale = spec.worldScale
    this.bh.setDefines(this.bhDefines())
    if (spec.skyRes !== this.skyRes) {
      this.skyRes = spec.skyRes
      this.skyA.dispose()
      this.skyB.dispose()
      this.skyA = bakeSky(this.renderer, 0, this.skyRes, this.hdrType)
      this.skyB = bakeSky(this.renderer, 1, this.skyRes, this.hdrType)
      this.bh.uniforms.uSky.value = this.skyA.texture
      this.uni.uniforms.uSky.value = this.skyB.texture
    }
    this.resize(this.cssW, this.cssH)
  }

  private allocate() {
    const cw = this.canvasW
    const ch = this.canvasH
    const ww = Math.max(2, Math.round(cw * this.worldScale))
    const wh = Math.max(2, Math.round(ch * this.worldScale))
    for (const k of ['bh', 'uni', 'world', 'glowBack', 'glowFront', 'trailA', 'trailB'] as const) this.rt[k].setSize(ww, wh)
    this.rt.debrisBack.setSize(cw, ch)
    this.rt.debrisFront.setSize(cw, ch)
    for (const b of this.bloom) b.dispose()
    this.bloom = []
    let bw = Math.max(2, ww >> 1)
    let bh = Math.max(2, wh >> 1)
    for (let i = 0; i < this.spec.bloomLevels; i++) {
      this.bloom.push(
        new THREE.WebGLRenderTarget(bw, bh, { type: this.hdrType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }),
      )
      bw = Math.max(2, bw >> 1)
      bh = Math.max(2, bh >> 1)
    }
    this.clearTrails()
  }

  private clearTrails() {
    const r = this.renderer
    r.setClearColor(0x000000, 1)
    for (const t of [this.rt.trailA, this.rt.trailB, this.rt.glowBack, this.rt.glowFront]) {
      r.setRenderTarget(t)
      r.clear(true, false, false)
    }
    r.setRenderTarget(null)
    this.trailEnergy = 0
  }

  /** compile every program up-front so nothing stalls mid-film */
  warmUp(state: FrameState) {
    this.debris.shardCount = 0
    this.debris.partCount = 0
    this.debris.warm(this.renderer)
    this.renderer.compile(this.dustScene, new THREE.PerspectiveCamera())
    const P = state.P
    const saved = { ...P }
    Object.assign(P, { uni: 1, tunnel: 1, streak: 0.5, aperture: 0.5, implode: 0.2, ca: 0.5, lens: 1 })
    this.render(state)
    Object.assign(P, saved)
    this.trailEnergy = 2
    this.render(state)
    this.clearTrails()
  }

  render(s: FrameState) {
    const r = this.renderer
    const P = s.P
    const W = this.cssW
    const H = this.cssH
    const aspect = W / H
    const bhU = this.lensU.uBhUv.value.set(s.bhPx.x / W, 1 - s.bhPx.y / H)
    const shadowR = s.shadowPx / H
    this.lensU.uAspect.value = aspect
    this.lensU.uLens.value = P.lens
    this.lensU.uEinstein.value = shadowR * P.einstein
    this.lensU.uShadowR.value = shadowR
    this.lensU.uMaskOn.value = P.lensMask

    const needBH = P.bh > 0.002
    const needUni = P.uni > 0.002
    const rtW = this.rt.bh.width
    const rtH = this.rt.bh.height

    if (needBH) {
      const u = this.bh.uniforms
      const rig = s.rig
      u.uRes.value.set(rtW, rtH)
      u.uCamPos.value.copy(rig.pos)
      u.uFwd.value.copy(rig.fwd)
      u.uRight.value.copy(rig.right)
      u.uUp.value.copy(rig.up)
      u.uTanHalf.value.set(rig.tanX, rig.tanY)
      u.uShift.value.set(rig.shiftX, rig.shiftY)
      u.uAspect.value = aspect
      u.uBhUv.value.copy(bhU)
      u.uTime.value = s.time
      u.uDiskTime.value = s.diskTime
      u.uDiskBright.value = P.diskBright
      u.uBeaming.value = P.beaming
      u.uHaze.value = P.haze
      u.uRingBoost.value = P.ringBoost
      u.uSkyGain.value = P.skyGain
      u.uEscape.value = Math.max(rig.dist * 1.02, 32)
      u.uHoleDepth.value = rig.dist
      u.uRipple.value = P.ripple
      u.uRippleR.value = P.rippleR
      u.uWaves.value = P.waves
      u.uHotPos.value.copy(s.hotPos)
      u.uHot.value = P.hot
      this.bh.render(r, this.rt.bh)
    }

    if (needUni) {
      const u = this.uni.uniforms
      const rig = s.uniRig
      u.uRes.value.set(rtW, rtH)
      u.uCamPos.value.copy(rig.pos)
      u.uFwd.value.copy(rig.fwd)
      u.uRight.value.copy(rig.right)
      u.uUp.value.copy(rig.up)
      u.uTanHalf.value.set(rig.tanX, rig.tanY)
      this.skyRot.setFromMatrix4(this.tmpM4.makeRotationAxis(VORTEX_AXIS, s.skyAngle))
      u.uTime.value = s.time
      u.uGain.value = P.uniGain
      this.uni.render(r, this.rt.uni)
      const du = this.dustMat.uniforms
      rig.viewMatrix(du.uView.value)
      rig.projMatrix(this.tmpM4b)
      du.uProj.value.copy(this.tmpM4b)
      du.uPxScale.value = rtH / (2 * rig.tanY)
      du.uTime.value = s.time
      r.setRenderTarget(this.rt.uni)
      r.render(this.dustScene, new THREE.Camera())
    }

    let worldTex: THREE.Texture = this.rt.bh.texture
    const composite = needUni || P.tunnel > 0.001 || P.streak > 0.002 || P.bh < 0.998
    if (composite) {
      const u = this.world.uniforms
      u.uBH.value = this.rt.bh.texture
      u.uUni.value = this.rt.uni.texture
      u.uBhMix.value = needBH ? P.bh : 0
      u.uUniMix.value = needUni ? P.uni : 0
      u.uStreak.value = P.streak
      u.uTunnel.value = P.tunnel
      u.uTravel.value = s.tunnelTravel
      u.uHue.value = P.hue
      u.uAperture.value = P.aperture
      u.uImplode.value = P.implode
      u.uTime.value = s.time
      u.uAspect.value = aspect
      u.uBhUv.value.copy(bhU)
      u.uResY.value = rtH
      this.world.render(r, this.rt.world)
      worldTex = this.rt.world.texture
    }

    // ---- debris: page shards (LDR colour + HDR glow) and particles
    const d = this.debris
    const du = d.uniforms
    d.shared.uStage.value.set(W, H)
    d.shared.uBh.value.set(s.bhPx.x, s.bhPx.y)
    d.shared.uShadowPx.value = s.shadowPx
    du.uWarpK.value = 70 * (s.shadowPx / 120)
    du.uWarpL.value = s.shadowPx * 2.6
    d.commit()
    const dActive = d.active
    const targets = { backColor: this.rt.debrisBack, frontColor: this.rt.debrisFront, backGlow: this.rt.glowBack, frontGlow: this.rt.glowFront }
    if (dActive) {
      d.render(r, targets)
      this.trailEnergy = 150
    }
    const glowFront: THREE.Texture = dActive ? this.rt.glowFront.texture : this.black

    let trailTex: THREE.Texture = this.black
    if (this.trailEnergy > 0) {
      if (!dActive) d.render(r, targets)
      const t = this.trail.uniforms
      t.uPrev.value = this.rt.trailA.texture
      t.uGlow.value = this.rt.glowBack.texture
      t.uCenter.value.copy(bhU)
      t.uAspect.value = aspect
      t.uDecay.value = Math.exp(-s.dt / 0.11)
      t.uSpin.value = s.dt * 0.55 * (0.4 + P.swirl)
      t.uInflow.value = s.dt * 0.22 * (0.3 + P.gravity)
      this.trail.render(r, this.rt.trailB)
      const tmp = this.rt.trailA
      this.rt.trailA = this.rt.trailB
      this.rt.trailB = tmp
      trailTex = this.rt.trailA.texture
      this.trailEnergy--
      if (this.trailEnergy === 0) this.clearTrails()
    }

    // ---- bloom
    const pf = this.prefilter.uniforms
    pf.uWorld.value = worldTex
    pf.uTrail.value = trailTex
    pf.uGlowFront.value = glowFront
    pf.uTexel.value.set(1 / rtW, 1 / rtH)
    pf.uThreshold.value = 0.85
    this.prefilter.render(r, this.bloom[0])
    for (let i = 1; i < this.bloom.length; i++) {
      const src = this.bloom[i - 1]
      this.down.uniforms.uSrc.value = src.texture
      this.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height)
      this.down.render(r, this.bloom[i])
    }
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const src = this.bloom[i]
      this.up.uniforms.uSrc.value = src.texture
      this.up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height)
      this.up.uniforms.uWeight.value = 0.9
      this.up.render(r, this.bloom[i - 1])
    }

    // ---- final
    const fu = this.final.uniforms
    fu.uWorld.value = worldTex
    fu.uBloom.value = this.bloom[0].texture
    fu.uTrail.value = trailTex
    fu.uDebrisBack.value = this.rt.debrisBack.texture
    fu.uDebrisFront.value = this.rt.debrisFront.texture
    fu.uGlowFront.value = glowFront
    fu.uDebrisOn.value = dActive ? 1 : 0
    fu.uRes.value.set(this.canvasW, this.canvasH)
    fu.uShake.value.set(-s.shakePx.x / W, s.shakePx.y / H)
    fu.uExposure.value = P.exposure
    fu.uBloomStr.value = 0.045 * P.bloom
    fu.uCA.value = P.ca
    fu.uVignette.value = P.vignette
    fu.uFlash.value = P.flash
    fu.uFlashCol.value.setRGB(1 - P.flashCool * 0.18, 0.96 - P.flashCool * 0.04, 0.9 + P.flashCool * 0.1)
    fu.uFade.value = P.fade
    fu.uGrain.value = P.grain
    fu.uTime.value = s.time
    this.final.render(r, null)
  }

  dispose() {
    for (const k of Object.keys(this.rt) as (keyof typeof this.rt)[]) this.rt[k].dispose()
    for (const b of this.bloom) b.dispose()
    this.noiseRT.dispose()
    this.skyA.dispose()
    this.skyB.dispose()
    this.black.dispose()
    for (const p of [this.bh, this.uni, this.world, this.prefilter, this.down, this.up, this.trail, this.final]) p.dispose()
    this.debris.dispose()
    this.dustGeo.dispose()
    this.dustMat.dispose()
    this.renderer.dispose()
  }
}
