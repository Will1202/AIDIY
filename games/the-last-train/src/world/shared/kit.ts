// 建模工具箱：世界尺度 UV 的盒体、按材质合批的静态几何、常用材质、资源释放。
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, Material, Matrix4, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, ShaderMaterial, Texture, Vector3, type ColorRepresentation, type Side,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** 盒体几何，UV 按真实尺寸缩放（tile = 每多少米重复一次贴图） */
export function boxGeo(sx: number, sy: number, sz: number, tile = 1): BufferGeometry {
  const g = new BoxGeometry(sx, sy, sz)
  const uv = g.getAttribute('uv') as Float32BufferAttribute
  // BoxGeometry 面顺序：+x, -x, +y, -y, +z, -z，每面 4 个顶点
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile)
    }
  }
  return g
}

const tmpQ = new Quaternion()
const tmpE = new Euler()
const tmpV = new Vector3()
const tmpS = new Vector3()

export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  tmpE.set(rx, ry, rz)
  tmpQ.setFromEuler(tmpE)
  return new Matrix4().compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz))
}

/** 静态几何合批：同材质的所有几何合并成一个 Mesh，大幅减少 draw call */
export class Batcher {
  private groups = new Map<Material, BufferGeometry[]>()
  private flags = new Map<Material, { cast: boolean; receive: boolean }>()

  add(geo: BufferGeometry, mat: Material, m?: Matrix4, cast = true, receive = true) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone()
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count
      g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2))
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    if (m) g.applyMatrix4(m)
    let list = this.groups.get(mat)
    if (!list) {
      list = []
      this.groups.set(mat, list)
      this.flags.set(mat, { cast, receive })
    }
    list.push(g)
    if (geo !== g) geo.dispose()
    return this
  }

  box(mat: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, tile = 1, cast = true) {
    return this.add(boxGeo(sx, sy, sz, tile), mat, trs(x, y, z, 0, yaw, 0), cast)
  }

  boxR(mat: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number, tile = 1) {
    return this.add(boxGeo(sx, sy, sz, tile), mat, trs(x, y, z, rx, ry, rz))
  }

  cyl(mat: Material, x: number, y: number, z: number, r: number, h: number, seg = 16, rTop?: number) {
    return this.add(new CylinderGeometry(rTop ?? r, r, h, seg), mat, trs(x, y, z))
  }

  get empty() {
    return this.groups.size === 0
  }

  build(parent: Object3D, name = 'batch'): Mesh[] {
    const out: Mesh[] = []
    for (const [mat, list] of this.groups) {
      const merged = mergeGeometries(list, false)
      for (const g of list) g.dispose()
      if (!merged) continue
      merged.computeBoundingSphere()
      const mesh = new Mesh(merged, mat)
      const f = this.flags.get(mat)!
      mesh.castShadow = f.cast
      mesh.receiveShadow = f.receive
      mesh.name = name
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      parent.add(mesh)
      out.push(mesh)
    }
    this.groups.clear()
    return out
  }
}

export interface StdOpts {
  color?: ColorRepresentation
  rough?: number
  metal?: number
  map?: Texture | null
  roughMap?: Texture | null
  normalMap?: Texture | null
  normalScale?: number
  emissive?: ColorRepresentation
  emissiveIntensity?: number
  emissiveMap?: Texture | null
  env?: number
  side?: Side
  transparent?: boolean
  opacity?: number
}

export function std(o: StdOpts = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.rough ?? 0.7,
    metalness: o.metal ?? 0,
    map: o.map ?? null,
    roughnessMap: o.roughMap ?? null,
    normalMap: o.normalMap ?? null,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    emissiveMap: o.emissiveMap ?? null,
    envMapIntensity: o.env ?? 1,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
  })
  if (o.side !== undefined) m.side = o.side
  if (o.normalMap && o.normalScale) m.normalScale.set(o.normalScale, o.normalScale)
  return m
}

/** 自发光材质（灯管、屏幕、窗户） */
export function glowMat(color: ColorRepresentation, intensity = 2, map: Texture | null = null) {
  return new MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, emissiveMap: map, roughness: 1, metalness: 0 })
}

/** 玻璃（物理材质，透射关闭以保证性能，用菲涅尔 + 低透明度） */
export function glassMat(tint: ColorRepresentation = 0x9fb8c8, opacity = 0.18, rough = 0.05, side: Side = DoubleSide) {
  return new MeshPhysicalMaterial({
    color: tint, roughness: rough, metalness: 0, transparent: true, opacity, depthWrite: false, envMapIntensity: 1.6,
    clearcoat: 1, clearcoatRoughness: 0.05, side,
  })
}

/** 交互高亮：菲涅尔边缘光（叠加在目标物体上，克制、不刺眼） */
export function rimMaterial(color = new Color(1, 0.86, 0.6)) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color }, uStrength: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        float pulse = 0.75 + 0.25 * sin(uTime * 3.0);
        gl_FragColor = vec4(uColor * f * uStrength * pulse * 1.6, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

/** 递归释放一个对象树的几何、材质与非共享纹理 */
export function disposeTree(root: Object3D) {
  const mats = new Set<Material>()
  const geos = new Set<BufferGeometry>()
  root.traverse((o) => {
    const m = o as Mesh
    if (m.geometry) geos.add(m.geometry)
    const mat = m.material as Material | Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x))
    else if (mat) mats.add(mat)
  })
  for (const g of geos) g.dispose()
  for (const m of mats) {
    for (const v of Object.values(m)) {
      if (v instanceof Texture && !v.userData.shared) v.dispose()
    }
    const u = (m as ShaderMaterial).uniforms
    if (u) for (const k of Object.keys(u)) {
      const v = u[k].value
      if (v instanceof Texture && !v.userData.shared) v.dispose()
    }
    m.dispose()
  }
}

/** 等一帧（构建大型世界时让出主线程，避免长时间卡顿） */
export const yieldFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame !== 'undefined' && typeof document !== 'undefined' && !document.hidden ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))
