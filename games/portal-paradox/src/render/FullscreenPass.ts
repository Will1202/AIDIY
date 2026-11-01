import { BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, ShaderMaterial, WebGLRenderer, type WebGLRenderTarget } from 'three'

const tri = new BufferGeometry()
tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
tri.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** One oversized triangle; renders a material over the whole target. */
export class FullscreenPass {
  readonly mesh: Mesh
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  constructor(public material: ShaderMaterial) {
    this.mesh = new Mesh(tri, material)
    this.mesh.frustumCulled = false
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null) {
    renderer.setRenderTarget(target)
    renderer.render(this.mesh, this.cam)
  }

  dispose() {
    this.material.dispose()
  }
}
