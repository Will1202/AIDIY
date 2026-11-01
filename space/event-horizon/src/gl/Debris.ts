import * as THREE from 'three'
import shardVert from './shaders/shard.vert?raw'
import shardFrag from './shaders/shard.frag?raw'
import particleVert from './shaders/particle.vert?raw'
import particleFrag from './shaders/particle.frag?raw'
import { orthoCamera, resolveIncludes } from './FullscreenPass'

const GRID = 6 // vertices per side of a shard (5x5 quads) — enough to bend and to wrap into arcs

function gridGeometry(n: number) {
  const pos: number[] = []
  const idx: number[] = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) pos.push(x / (n - 1), y / (n - 1), 0)
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const a = y * n + x
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n)
    }
  return { pos: new Float32Array(pos), idx }
}

function dyn(array: Float32Array, size: number) {
  const a = new THREE.InstancedBufferAttribute(array, size)
  a.setUsage(THREE.DynamicDrawUsage)
  return a
}

function upload(attr: THREE.InstancedBufferAttribute, count: number) {
  attr.clearUpdateRanges()
  if (count > 0) attr.addUpdateRange(0, count * attr.itemSize)
  attr.needsUpdate = true
}

export interface DebrisTargets {
  backColor: THREE.WebGLRenderTarget
  frontColor: THREE.WebGLRenderTarget
  backGlow: THREE.WebGLRenderTarget
  frontGlow: THREE.WebGLRenderTarget
}

/** pass modes understood by debrislens.glsl */
const FRONT = 0
const BACK = 1
const BACK_SECONDARY = 2

/**
 * GPU side of the destruction system: instanced page shards (LDR colour + HDR glow)
 * and glowing particles. Every frame they are drawn in three passes — matter in
 * front of the hole, the primary lensed image of matter behind it, and the
 * secondary image on the far side of the shadow. Buffers are allocated once.
 */
export class DebrisGPU {
  readonly shardCap: number
  readonly partCap: number

  readonly cornA: Float32Array
  readonly cornB: Float32Array
  readonly home: Float32Array
  readonly pos: Float32Array
  readonly mat: Float32Array
  readonly fx: Float32Array
  /** θE px, side/mask (>0 behind the hole), unused, gravitational redshift g */
  readonly lens: Float32Array
  shardCount = 0

  readonly pv: Float32Array
  readonly col: Float32Array
  /** fade, redshift g, θE px, side/mask */
  readonly pfx: Float32Array
  partCount = 0

  private readonly shardAttrs: THREE.InstancedBufferAttribute[]
  private readonly partAttrs: THREE.InstancedBufferAttribute[]
  private readonly shardGeo = new THREE.InstancedBufferGeometry()
  private readonly partGeo = new THREE.InstancedBufferGeometry()
  readonly shardColor: THREE.RawShaderMaterial
  readonly shardGlow: THREE.RawShaderMaterial
  readonly particle: THREE.RawShaderMaterial
  private readonly colorScene = new THREE.Scene()
  private readonly glowScene = new THREE.Scene()
  private readonly placeholder: THREE.DataTexture
  private readonly mode = { value: FRONT }
  readonly shared = {
    uStage: { value: new THREE.Vector2(1, 1) },
    uBh: { value: new THREE.Vector2() },
    uShadowPx: { value: 100 },
  }

  constructor(shardCap: number, partCap: number, noise: THREE.Texture) {
    this.shardCap = shardCap
    this.partCap = partCap
    this.cornA = new Float32Array(shardCap * 4)
    this.cornB = new Float32Array(shardCap * 4)
    this.home = new Float32Array(shardCap * 4)
    this.pos = new Float32Array(shardCap * 2)
    this.mat = new Float32Array(shardCap * 4)
    this.fx = new Float32Array(shardCap * 4)
    this.lens = new Float32Array(shardCap * 4)
    this.pv = new Float32Array(partCap * 4)
    this.col = new Float32Array(partCap * 4)
    this.pfx = new Float32Array(partCap * 4)

    const g = gridGeometry(GRID)
    this.shardGeo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3))
    this.shardGeo.setIndex(g.idx)
    this.shardAttrs = [
      dyn(this.cornA, 4), dyn(this.cornB, 4), dyn(this.home, 4), dyn(this.pos, 2), dyn(this.mat, 4), dyn(this.fx, 4), dyn(this.lens, 4),
    ]
    ;['iCornA', 'iCornB', 'iHome', 'iPos', 'iMat', 'iFx', 'iLens'].forEach((n, i) => this.shardGeo.setAttribute(n, this.shardAttrs[i]))
    this.shardGeo.instanceCount = 0

    this.partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
    this.partGeo.setIndex([0, 1, 2, 0, 2, 3])
    this.partAttrs = [dyn(this.pv, 4), dyn(this.col, 4), dyn(this.pfx, 4)]
    ;['iPV', 'iCol', 'iFx'].forEach((n, i) => this.partGeo.setAttribute(n, this.partAttrs[i]))
    this.partGeo.instanceCount = 0

    this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
    this.placeholder.needsUpdate = true

    const shardUniforms = {
      ...this.shared,
      uMode: this.mode,
      uSnapSize: { value: new THREE.Vector2(1, 1) },
      uWarpK: { value: 90 },
      uWarpL: { value: 320 },
      uSnap: { value: this.placeholder as THREE.Texture },
      uNoise: { value: noise },
    }
    const base = {
      glslVersion: THREE.GLSL3,
      vertexShader: resolveIncludes(shardVert),
      fragmentShader: shardFrag,
      uniforms: shardUniforms,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // shards are mirrored freely by their matrices, the lens and the y-flip — never cull
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
    } as const
    this.shardColor = new THREE.RawShaderMaterial({
      ...base,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    this.shardGlow = new THREE.RawShaderMaterial({
      ...base,
      defines: { GLOW_PASS: 1 },
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    })
    this.particle = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: resolveIncludes(particleVert),
      fragmentShader: particleFrag,
      uniforms: {
        ...this.shared,
        uMode: this.mode,
        uStreak: { value: 0.035 },
        uGain: { value: 1.5 },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    })

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, scene: THREE.Scene) => {
      const m = new THREE.Mesh(geo, mat)
      m.frustumCulled = false
      scene.add(m)
    }
    mk(this.shardGeo, this.shardColor, this.colorScene)
    mk(this.shardGeo, this.shardGlow, this.glowScene)
    mk(this.partGeo, this.particle, this.glowScene)
  }

  get uniforms() {
    return this.shardColor.uniforms as {
      uSnapSize: { value: THREE.Vector2 }
      uWarpK: { value: number }
      uWarpL: { value: number }
      uSnap: { value: THREE.Texture }
    }
  }

  setSnapshot(tex: THREE.Texture | null, w: number, h: number) {
    this.uniforms.uSnap.value = tex ?? this.placeholder
    this.uniforms.uSnapSize.value.set(Math.max(1, w), Math.max(1, h))
  }

  get active() {
    return this.shardCount > 0 || this.partCount > 0
  }

  commit() {
    for (const a of this.shardAttrs) upload(a, this.shardCount)
    for (const a of this.partAttrs) upload(a, this.partCount)
    this.shardGeo.instanceCount = this.shardCount
    this.partGeo.instanceCount = this.partCount
  }

  private pass(renderer: THREE.WebGLRenderer, scene: THREE.Scene, target: THREE.WebGLRenderTarget, mode: number, clear: boolean, clearAlpha: number) {
    renderer.setRenderTarget(target)
    if (clear) {
      renderer.setClearColor(0x000000, clearAlpha)
      renderer.clear(true, false, false)
    }
    this.mode.value = mode
    renderer.render(scene, orthoCamera)
  }

  /** front matter, primary lensed image and secondary image, colour and glow */
  render(renderer: THREE.WebGLRenderer, t: DebrisTargets) {
    if (this.shardCount > 0) {
      this.pass(renderer, this.colorScene, t.frontColor, FRONT, true, 0)
      this.pass(renderer, this.colorScene, t.backColor, BACK, true, 0)
      this.pass(renderer, this.colorScene, t.backColor, BACK_SECONDARY, false, 0)
    } else {
      for (const rt of [t.frontColor, t.backColor]) {
        renderer.setRenderTarget(rt)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, false, false)
      }
    }
    this.pass(renderer, this.glowScene, t.frontGlow, FRONT, true, 1)
    this.pass(renderer, this.glowScene, t.backGlow, BACK, true, 1)
    this.pass(renderer, this.glowScene, t.backGlow, BACK_SECONDARY, false, 1)
  }

  /** compile programs up front */
  warm(renderer: THREE.WebGLRenderer) {
    renderer.compile(this.colorScene, orthoCamera)
    renderer.compile(this.glowScene, orthoCamera)
  }

  dispose() {
    this.shardGeo.dispose()
    this.partGeo.dispose()
    this.shardColor.dispose()
    this.shardGlow.dispose()
    this.particle.dispose()
    this.placeholder.dispose()
  }
}
