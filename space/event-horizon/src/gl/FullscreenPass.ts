import * as THREE from 'three'
import vert from './shaders/fullscreen.vert?raw'
import lensChunk from './shaders/lens.glsl?raw'
import starsChunk from './shaders/stars.glsl?raw'
import debrisLensChunk from './shaders/debrislens.glsl?raw'

const triangle = new THREE.BufferGeometry()
triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))

export const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

/** Resolves our tiny `#include <lens>` convention in raw GLSL sources. */
export function resolveIncludes(src: string): string {
  return src
    .replace('#include <lens>', lensChunk)
    .replace('#include <stars>', starsChunk)
    .replace('#include <debrislens>', debrisLensChunk)
}

export interface PassOptions {
  defines?: Record<string, string | number>
  blending?: THREE.Blending
  blendSrc?: THREE.BlendingSrcFactor
  blendDst?: THREE.BlendingDstFactor
}

/** One full-screen triangle with a raw GLSL3 fragment shader. */
export class FullscreenPass<U extends Record<string, THREE.IUniform> = Record<string, THREE.IUniform>> {
  readonly material: THREE.RawShaderMaterial
  readonly uniforms: U
  private readonly scene = new THREE.Scene()

  constructor(fragment: string, uniforms: U, opts: PassOptions = {}) {
    this.uniforms = uniforms
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: resolveIncludes(fragment),
      uniforms,
      defines: opts.defines ?? {},
      depthTest: false,
      depthWrite: false,
      blending: opts.blending ?? THREE.NoBlending,
    })
    if (opts.blending === THREE.CustomBlending) {
      this.material.blendSrc = opts.blendSrc ?? THREE.OneFactor
      this.material.blendDst = opts.blendDst ?? THREE.OneFactor
      this.material.blendEquation = THREE.AddEquation
      this.material.transparent = true
    }
    const mesh = new THREE.Mesh(triangle, this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  setDefines(defines: Record<string, string | number>) {
    this.material.defines = defines
    this.material.needsUpdate = true
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, clear = false) {
    renderer.setRenderTarget(target)
    if (clear) renderer.clear(true, false, false)
    renderer.render(this.scene, orthoCamera)
  }

  /** draw into whatever target (and cube face) is currently bound */
  draw(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, orthoCamera)
  }

  dispose() {
    this.material.dispose()
  }
}
