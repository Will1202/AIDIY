import * as THREE from 'three'
import { FullscreenPass } from './FullscreenPass'
import noiseFrag from './shaders/noise.frag?raw'
import skyFrag from './shaders/sky.frag?raw'

export const NOISE_RES = 512

/** Tileable RGBA noise atlas, baked once on the GPU, mip-mapped and anisotropic. */
export function bakeNoise(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(NOISE_RES, NOISE_RES, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  })
  const pass = new FullscreenPass(noiseFrag, {})
  pass.render(renderer, rt)
  pass.dispose()
  return rt
}

/** Procedural sky baked into a cubemap. Faces are written with GL cube conventions. */
export function bakeSky(renderer: THREE.WebGLRenderer, variant: 0 | 1, size: number, hdrType: THREE.TextureDataType) {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: hdrType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  })
  const uniforms = { uFace: { value: 0 }, uFaceRes: { value: size } }
  const pass = new FullscreenPass(skyFrag, uniforms, { defines: { VARIANT: variant } })
  for (let face = 0; face < 6; face++) {
    uniforms.uFace.value = face
    rt.texture.generateMipmaps = face === 5
    renderer.setRenderTarget(rt, face)
    pass.draw(renderer)
  }
  rt.texture.generateMipmaps = true
  pass.dispose()
  return rt
}
