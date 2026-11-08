import { BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, type Material, type WebGLRenderer, type WebGLRenderTarget } from 'three'

/** one big triangle covering the viewport; `vUv` is provided to the fragment shader */
const tri = new BufferGeometry()
tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
tri.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export class FullscreenPass {
  readonly mesh: Mesh
  constructor(public material: Material) {
    this.mesh = new Mesh(tri, material)
    this.mesh.frustumCulled = false
  }
  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null) {
    renderer.setRenderTarget(target)
    renderer.render(this.mesh, cam)
  }
  dispose() {
    this.material.dispose()
  }
}

export const fullscreenCamera = cam
