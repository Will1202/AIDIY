import * as THREE from 'three'

export const DEG = Math.PI / 180
/** critical impact parameter of a Schwarzschild hole, in units of r_s */
export const B_CRIT = 1.5 * Math.sqrt(3)

export interface Framing {
  tanY: number
  shiftX: number
  shiftY: number
  dist: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Composition for the observatory. Landscape keeps the hole right of centre so the
 * page reads on the left; portrait (9:16) lifts it into the upper third and widens
 * the lens so the whole disk survives the narrow frame instead of being cropped.
 */
export function observatoryFraming(aspect: number): Framing {
  const land = { tanY: Math.tan(17 * DEG), shiftX: 0.3, shiftY: 0.03, dist: 29 }
  const portraitTanY = Math.tan(28 * DEG) / Math.max(aspect, 0.3)
  const port = { tanY: Math.min(portraitTanY, 1.25), shiftX: 0, shiftY: 0.3, dist: 22 }
  const t = smooth(0.72, 1.3, aspect)
  return {
    tanY: port.tanY + (land.tanY - port.tanY) * t,
    shiftX: port.shiftX + (land.shiftX - port.shiftX) * t,
    shiftY: port.shiftY + (land.shiftY - port.shiftY) * t,
    dist: port.dist + (land.dist - port.dist) * t,
  }
}

export function universeTanY(aspect: number): number {
  const land = Math.tan(23 * DEG)
  const port = Math.min(Math.tan(31 * DEG) / Math.max(aspect, 0.3), 1.3)
  const t = smooth(0.72, 1.3, aspect)
  return port + (land - port) * t
}

export interface ScreenPoint {
  x: number
  y: number
  depth: number
}

/**
 * A pin-hole camera with an off-axis lens shift. The raymarch shaders build their
 * rays from exactly these basis vectors, and the DOM engine projects/unprojects
 * through the same math — so page elements are pulled to the hole that is drawn.
 */
export class CameraRig {
  readonly pos = new THREE.Vector3(0, 0, 30)
  readonly target = new THREE.Vector3()
  readonly fwd = new THREE.Vector3(0, 0, -1)
  readonly right = new THREE.Vector3(1, 0, 0)
  readonly up = new THREE.Vector3(0, 1, 0)
  tanX = 0.5
  tanY = 0.3
  shiftX = 0
  shiftY = 0
  width = 1
  height = 1

  setViewport(w: number, h: number) {
    this.width = Math.max(1, w)
    this.height = Math.max(1, h)
  }

  setLens(tanY: number, shiftX = 0, shiftY = 0) {
    this.tanY = tanY
    this.tanX = tanY * (this.width / this.height)
    this.shiftX = shiftX
    this.shiftY = shiftY
  }

  orbit(dist: number, elev: number, azim: number) {
    const ce = Math.cos(elev)
    this.pos.set(
      this.target.x + dist * Math.sin(azim) * ce,
      this.target.y + dist * Math.sin(elev),
      this.target.z + dist * Math.cos(azim) * ce,
    )
    this.updateBasis()
  }

  lookAt(pos: THREE.Vector3, target: THREE.Vector3, roll = 0) {
    this.pos.copy(pos)
    this.target.copy(target)
    this.updateBasis(roll)
  }

  updateBasis(roll = 0) {
    this.fwd.subVectors(this.target, this.pos).normalize()
    const worldUp = Math.abs(this.fwd.y) > 0.995 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)
    this.right.crossVectors(this.fwd, worldUp).normalize()
    this.up.crossVectors(this.right, this.fwd).normalize()
    if (roll !== 0) {
      const c = Math.cos(roll)
      const s = Math.sin(roll)
      const rx = this.right.x * c + this.up.x * s
      const ry = this.right.y * c + this.up.y * s
      const rz = this.right.z * c + this.up.z * s
      this.up.set(this.up.x * c - this.right.x * s, this.up.y * c - this.right.y * s, this.up.z * c - this.right.z * s)
      this.right.set(rx, ry, rz)
    }
  }

  get dist() {
    return this.pos.distanceTo(this.target)
  }

  /** world → stage CSS px. Returns false when the point is behind the camera. */
  project(x: number, y: number, z: number, out: ScreenPoint): boolean {
    const dx = x - this.pos.x
    const dy = y - this.pos.y
    const dz = z - this.pos.z
    const vz = dx * this.fwd.x + dy * this.fwd.y + dz * this.fwd.z
    const vx = dx * this.right.x + dy * this.right.y + dz * this.right.z
    const vy = dx * this.up.x + dy * this.up.y + dz * this.up.z
    const d = Math.max(vz, 1e-3)
    const nx = vx / (d * this.tanX) + this.shiftX
    const ny = vy / (d * this.tanY) + this.shiftY
    out.x = (nx + 1) * 0.5 * this.width
    out.y = (1 - ny) * 0.5 * this.height
    out.depth = vz
    return vz > 1e-3
  }

  /** stage px → the plane through the target facing the camera (the "sky plane"). */
  unprojectToSkyPlane(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const nx = (px / this.width) * 2 - 1 - this.shiftX
    const ny = 1 - (py / this.height) * 2 - this.shiftY
    const dist = this.dist
    out.copy(this.fwd)
      .addScaledVector(this.right, nx * this.tanX)
      .addScaledVector(this.up, ny * this.tanY)
      .multiplyScalar(dist)
      .add(this.pos)
    return out
  }

  /** stage px → the disk plane y = 0 (null if the ray misses it) */
  unprojectToDisk(px: number, py: number, out: THREE.Vector3): THREE.Vector3 | null {
    const nx = (px / this.width) * 2 - 1 - this.shiftX
    const ny = 1 - (py / this.height) * 2 - this.shiftY
    const dir = new THREE.Vector3().copy(this.fwd).addScaledVector(this.right, nx * this.tanX).addScaledVector(this.up, ny * this.tanY)
    if (Math.abs(dir.y) < 1e-4) return null
    const t = -this.pos.y / dir.y
    if (t <= 0) return null
    return out.copy(this.pos).addScaledVector(dir, t)
  }

  /** world units per CSS pixel at a given view depth */
  worldPerPx(depth: number) {
    return (2 * depth * this.tanY) / this.height
  }

  /** stage px of the target (the black hole) */
  targetScreen(out: { x: number; y: number }) {
    out.x = (this.shiftX + 1) * 0.5 * this.width
    out.y = (1 - this.shiftY) * 0.5 * this.height
    return out
  }

  /** apparent radius of the shadow in px: sin α = b_c √(1 − r_s/D) / D */
  shadowRadiusPx() {
    const D = Math.max(this.dist, 1.0001)
    const s = Math.min(0.9999, (B_CRIT * Math.sqrt(1 - 1 / D)) / D)
    const t = s / Math.sqrt(1 - s * s)
    return (t / this.tanY) * 0.5 * this.height
  }

  viewMatrix(out: THREE.Matrix4) {
    const r = this.right
    const u = this.up
    const f = this.fwd
    const p = this.pos
    return out.set(
      r.x, r.y, r.z, -r.dot(p),
      u.x, u.y, u.z, -u.dot(p),
      -f.x, -f.y, -f.z, f.dot(p),
      0, 0, 0, 1,
    )
  }

  projMatrix(out: THREE.Matrix4, near = 0.5, far = 5000) {
    out.makePerspective(-near * this.tanX, near * this.tanX, near * this.tanY, -near * this.tanY, near, far)
    out.elements[8] = -this.shiftX
    out.elements[9] = -this.shiftY
    return out
  }
}
