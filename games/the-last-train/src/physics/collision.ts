// 轻量碰撞世界：第一人称角色（竖直圆柱 / 胶囊近似）对 盒体(绕 Y 旋转的 OBB) / 圆柱 / 斜坡 / 高度场。
// 支持重力方向翻转：所有竖直计算都在“重力坐标” u = g·y 里完成，g = ±1。
// 纯 TypeScript，不依赖 WebGL，可以在 Node 测试里直接跑通关路线。

export type Surface = 'concrete' | 'metal' | 'wood' | 'wet' | 'glass' | 'sand' | 'marble' | 'carpet' | 'stone' | 'grate'

export type ColliderKind = 'box' | 'cyl' | 'ramp' | 'height'

export interface Collider {
  kind: ColliderKind
  cx: number
  cz: number
  /** 盒体 / 斜坡半宽（局部 x / z） */
  hx: number
  hz: number
  /** 绕 Y 轴旋转的 cos / sin */
  c: number
  s: number
  minY: number
  maxY: number
  /** 斜坡：局部 -hx 处与 +hx 处的顶面高度 */
  y0: number
  y1: number
  /** 圆柱半径 */
  r: number
  /** 高度场函数（世界坐标） */
  fn: ((x: number, z: number) => number) | null
  enabled: boolean
  /** false：只能站，不挡水平移动（例如低矮的地毯） */
  solid: boolean
  /** false：顶面不能站（例如空气墙） */
  walkable: boolean
  /** false：掉落后不记为“安全复活点” */
  safe: boolean
  surface: Surface
  tag: string
}

export interface ColliderOpts {
  yaw?: number
  surface?: Surface
  tag?: string
  solid?: boolean
  walkable?: boolean
  safe?: boolean
  enabled?: boolean
}

export interface Body {
  x: number
  y: number
  z: number
  /** 沿重力“向上”的速度（u 空间） */
  vu: number
  radius: number
  height: number
  stepHeight: number
  grounded: boolean
  ground: Collider | null
}

const base = (kind: ColliderKind, o: ColliderOpts = {}): Collider => {
  const yaw = o.yaw ?? 0
  return {
    kind, cx: 0, cz: 0, hx: 0, hz: 0, c: Math.cos(yaw), s: Math.sin(yaw), minY: 0, maxY: 0, y0: 0, y1: 0, r: 0, fn: null,
    enabled: o.enabled ?? true, solid: o.solid ?? true, walkable: o.walkable ?? true, safe: o.safe ?? true,
    surface: o.surface ?? 'concrete', tag: o.tag ?? '',
  }
}

export function setYaw(c: Collider, yaw: number) {
  c.c = Math.cos(yaw)
  c.s = Math.sin(yaw)
}

export class CollisionWorld {
  readonly list: Collider[] = []
  /** 是否整体参与计算（列车行驶时世界碰撞整体关闭） */
  enabled = true

  /** 盒体：中心 (x,y,z) 与尺寸 (sx,sy,sz)，可绕 Y 旋转 */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: ColliderOpts = {}) {
    const c = base('box', o)
    c.cx = x; c.cz = z; c.hx = sx / 2; c.hz = sz / 2; c.minY = y - sy / 2; c.maxY = y + sy / 2
    this.list.push(c)
    return c
  }

  /** 以底面高度和顶面高度定义的盒体（建造关卡时更直观） */
  slab(x: number, z: number, sx: number, sz: number, minY: number, maxY: number, o: ColliderOpts = {}) {
    return this.box(x, (minY + maxY) / 2, z, sx, maxY - minY, sz, o)
  }

  cyl(x: number, z: number, r: number, minY: number, maxY: number, o: ColliderOpts = {}) {
    const c = base('cyl', o)
    c.cx = x; c.cz = z; c.r = r; c.minY = minY; c.maxY = maxY
    this.list.push(c)
    return c
  }

  /** 斜坡：局部 x 从 -sx/2 到 +sx/2，顶面高度从 y0 线性变到 y1 */
  ramp(x: number, z: number, sx: number, sz: number, minY: number, y0: number, y1: number, o: ColliderOpts = {}) {
    const c = base('ramp', o)
    c.cx = x; c.cz = z; c.hx = sx / 2; c.hz = sz / 2; c.minY = minY; c.y0 = y0; c.y1 = y1; c.maxY = Math.max(y0, y1)
    this.list.push(c)
    return c
  }

  /** 高度场地面（沙丘），只作为地面，不阻挡水平移动 */
  height(x0: number, z0: number, x1: number, z1: number, fn: (x: number, z: number) => number, o: ColliderOpts = {}) {
    const c = base('height', { ...o, solid: false })
    c.cx = (x0 + x1) / 2; c.cz = (z0 + z1) / 2; c.hx = (x1 - x0) / 2; c.hz = (z1 - z0) / 2; c.fn = fn; c.minY = -1e4; c.maxY = 1e4
    this.list.push(c)
    return c
  }

  remove(c: Collider) {
    const i = this.list.indexOf(c)
    if (i >= 0) this.list.splice(i, 1)
  }
}

// ---------- 几何辅助 ----------

/** 点到局部坐标 */
function local(c: Collider, x: number, z: number) {
  const dx = x - c.cx, dz = z - c.cz
  // 旋转 -yaw
  return { lx: dx * c.c - dz * c.s, lz: dx * c.s + dz * c.c }
}

export function containsXZ(c: Collider, x: number, z: number, pad = 0): boolean {
  if (c.kind === 'cyl') {
    const dx = x - c.cx, dz = z - c.cz
    const r = c.r + pad
    return dx * dx + dz * dz <= r * r
  }
  const { lx, lz } = local(c, x, z)
  return Math.abs(lx) <= c.hx + pad && Math.abs(lz) <= c.hz + pad
}

/** 顶面高度（世界 y） */
export function topY(c: Collider, x: number, z: number): number {
  if (c.kind === 'height') return c.fn!(x, z)
  if (c.kind === 'ramp') {
    const { lx } = local(c, x, z)
    const t = Math.min(1, Math.max(0, (lx + c.hx) / (2 * c.hx)))
    return c.y0 + (c.y1 - c.y0) * t
  }
  return c.maxY
}

/** u 空间的“地板”高度：正重力时是顶面，反重力时是底面取负 */
function floorU(c: Collider, x: number, z: number, g: number) {
  return g > 0 ? topY(c, x, z) : -c.minY
}
/** u 空间的“天花板”高度 */
function ceilU(c: Collider, x: number, z: number, g: number) {
  return g > 0 ? c.minY : -topY(c, x, z)
}

/** 圆（x,z,r）与碰撞体在水平面上的穿透，返回推出向量或 null */
function pushOut(c: Collider, x: number, z: number, r: number): { px: number; pz: number } | null {
  if (c.kind === 'cyl') {
    const dx = x - c.cx, dz = z - c.cz
    const d2 = dx * dx + dz * dz
    const rr = c.r + r
    if (d2 >= rr * rr) return null
    const d = Math.sqrt(d2)
    if (d < 1e-6) return { px: rr, pz: 0 }
    const k = (rr - d) / d
    return { px: dx * k, pz: dz * k }
  }
  const { lx, lz } = local(c, x, z)
  const qx = Math.max(-c.hx, Math.min(c.hx, lx))
  const qz = Math.max(-c.hz, Math.min(c.hz, lz))
  let ox = lx - qx, oz = lz - qz
  const d2 = ox * ox + oz * oz
  let plx: number, plz: number
  if (d2 > 1e-12) {
    if (d2 >= r * r) return null
    const d = Math.sqrt(d2)
    const k = (r - d) / d
    plx = ox * k
    plz = oz * k
  } else {
    // 圆心在盒内：沿最近的面推出
    const ex = c.hx - Math.abs(lx), ez = c.hz - Math.abs(lz)
    if (ex < ez) { plx = (ex + r) * Math.sign(lx || 1); plz = 0 } else { plx = 0; plz = (ez + r) * Math.sign(lz || 1) }
    ox = 0; oz = 0
  }
  // 局部 → 世界（旋转 +yaw）
  return { px: plx * c.c + plz * c.s, pz: -plx * c.s + plz * c.c }
}

/** 从碰撞体表面取离点最近的点（用于斜坡判断墙） */
function clampToFootprint(c: Collider, x: number, z: number) {
  if (c.kind === 'cyl') return { x, z }
  const { lx, lz } = local(c, x, z)
  const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz))
  return { x: c.cx + qx * c.c + qz * c.s, z: c.cz - qx * c.s + qz * c.c }
}

function* active(worlds: CollisionWorld[]) {
  for (const w of worlds) {
    if (!w.enabled) continue
    for (const c of w.list) if (c.enabled) yield c
  }
}

/**
 * 移动角色：先水平（分段 + 多次迭代推出），再竖直（重力、落地、上台阶、贴地、顶头）。
 * dx/dz 为本帧期望水平位移，g 为重力方向，grav 为重力加速度。
 */
export function moveBody(worlds: CollisionWorld[], b: Body, dx: number, dz: number, dt: number, g: number, grav = 18, maxFall = 40) {
  const len = Math.hypot(dx, dz)
  const n = Math.max(1, Math.ceil(len / 0.12))
  let u = g * b.y
  for (let i = 0; i < n; i++) {
    b.x += dx / n
    b.z += dz / n
    for (let it = 0; it < 3; it++) {
      let moved = false
      for (const c of active(worlds)) {
        if (!c.solid) continue
        let lo: number, hi: number
        if (c.kind === 'ramp') {
          const p = clampToFootprint(c, b.x, b.z)
          lo = g > 0 ? c.minY : -topY(c, p.x, p.z)
          hi = g > 0 ? topY(c, p.x, p.z) : -c.minY
        } else {
          lo = g > 0 ? c.minY : -c.maxY
          hi = g > 0 ? c.maxY : -c.minY
        }
        // 低于台阶高度的是“台阶”，交给竖直阶段处理；高于头顶的不阻挡
        if (hi <= u + b.stepHeight + 1e-4 && c.walkable) continue
        if (lo >= u + b.height - 1e-4) continue
        if (hi <= u + 1e-4) continue
        const p = pushOut(c, b.x, b.z, b.radius)
        if (p) {
          b.x += p.px
          b.z += p.pz
          moved = true
        }
      }
      if (!moved) break
    }
  }

  // ---- 竖直 ----
  const pad = b.radius * 0.55
  let ground = -Infinity
  let groundC: Collider | null = null
  for (const c of active(worlds)) {
    if (!c.walkable) continue
    if (!containsXZ(c, b.x, b.z, c.kind === 'height' ? 0 : pad)) continue
    if (c.kind === 'height' && g < 0) continue
    const f = floorU(c, b.x, b.z, g)
    if (f <= u + b.stepHeight + 1e-3 && f > ground) {
      ground = f
      groundC = c
    }
  }
  b.vu -= grav * dt
  if (b.vu < -maxFall) b.vu = -maxFall
  let nu = u + b.vu * dt
  if (b.vu > 0) {
    // 顶头
    let ceil = Infinity
    for (const c of active(worlds)) {
      if (c.kind === 'height' || !c.solid) continue
      if (!containsXZ(c, b.x, b.z, -0.05)) continue
      const cu = ceilU(c, b.x, b.z, g)
      if (cu >= u + b.height - 0.02 && cu < ceil) ceil = cu
    }
    if (nu + b.height > ceil) {
      nu = ceil - b.height
      b.vu = 0
    }
  }
  if (groundC && b.vu <= 0 && nu <= ground) {
    u = ground
    b.vu = 0
    b.grounded = true
    b.ground = groundC
  } else if (groundC && b.grounded && b.vu <= 0 && u - ground < 0.3) {
    // 下楼梯 / 下坡时贴地
    u = ground
    b.vu = 0
    b.ground = groundC
  } else {
    u = nu
    b.grounded = false
    b.ground = null
  }
  b.y = g * u
}

/** 射线检测：返回最近命中距离（未命中返回 Infinity）。用于交互遮挡与镜头防穿透。 */
export function raycast(worlds: CollisionWorld[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, ignoreTag = ''): number {
  let best = maxDist
  for (const c of active(worlds)) {
    if (!c.solid || c.kind === 'height') continue
    if (ignoreTag && c.tag === ignoreTag) continue
    let t: number
    if (c.kind === 'cyl') t = rayCyl(c, ox, oy, oz, dx, dy, dz)
    else t = rayBox(c, ox, oy, oz, dx, dy, dz)
    if (t >= 0 && t < best) best = t
  }
  return best < maxDist ? best : Infinity
}

function rayBox(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  const { lx, lz } = local(c, ox, oz)
  const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c
  let tmin = -Infinity, tmax = Infinity
  const slab = (o: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) { tmin = Infinity; tmax = -Infinity }
      return
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    if (t1 > tmin) tmin = t1
    if (t2 < tmax) tmax = t2
  }
  slab(lx, ldx, -c.hx, c.hx)
  slab(lz, ldz, -c.hz, c.hz)
  slab(oy, dy, c.minY, c.maxY)
  if (tmax < Math.max(tmin, 0)) return -1
  return tmin >= 0 ? tmin : 0
}

function rayCyl(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  const px = ox - c.cx, pz = oz - c.cz
  const a = dx * dx + dz * dz
  const bq = 2 * (px * dx + pz * dz)
  const cq = px * px + pz * pz - c.r * c.r
  let t0: number, t1: number
  if (a < 1e-9) {
    if (cq > 0) return -1
    t0 = -Infinity; t1 = Infinity
  } else {
    const disc = bq * bq - 4 * a * cq
    if (disc < 0) return -1
    const sq = Math.sqrt(disc)
    t0 = (-bq - sq) / (2 * a); t1 = (-bq + sq) / (2 * a)
  }
  // 竖直范围
  let y0 = -Infinity, y1 = Infinity
  if (Math.abs(dy) > 1e-9) {
    y0 = (c.minY - oy) / dy; y1 = (c.maxY - oy) / dy
    if (y0 > y1) [y0, y1] = [y1, y0]
  } else if (oy < c.minY || oy > c.maxY) return -1
  const lo = Math.max(t0, y0), hi = Math.min(t1, y1)
  if (hi < Math.max(lo, 0)) return -1
  return lo >= 0 ? lo : 0
}

/** 角色是否站在某标签的碰撞体上 */
export const standingOn = (b: Body, tag: string) => !!b.ground && b.ground.tag === tag
