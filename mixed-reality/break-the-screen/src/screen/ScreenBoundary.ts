import {
  BoxGeometry, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, ShaderMaterial, Shape, ShapeGeometry, SRGBColorSpace, Vector2, Vector3, Vector4, LinearFilter,
} from 'three'
import { BEZEL, REVEAL_DEPTH, WORLD_H, clamp, damp } from '../core/config'
import type { CrackPattern } from './voronoi'
import { roughnessTexture } from '../world/textures'

/**
 * The physical screen as an object in the scene, all at z = 0 (zero parallax,
 * so it stays glued to the real display while everything behind it moves):
 * an opaque bezel with an opening, a window reveal that you can see into when
 * you move your head, lit trim, printed calibration marks, and the glass.
 *
 * Occlusion is plain depth testing: the bezel is nearer than anything in the
 * room, so the room is only ever visible through the opening, while anything
 * that has come out (z > 0) is nearer than the bezel and draws over it.
 */
export class ScreenBoundary {
  readonly group = new Group()
  halfW = 8
  halfH = 4.4
  canvasW = 17.78
  /** 0..1: how broken the glass is (1 = shattered) */
  damage = 0
  intact = true
  readonly glassMat: ShaderMaterial
  private glass: Mesh | null = null
  private bezel: Mesh | null = null
  private reveal: Group | null = null
  private trim: Group | null = null
  private print: Mesh | null = null
  private readonly trimMat = new MeshBasicMaterial({ color: new Color(0xbfe6ff).multiplyScalar(2.2), toneMapped: true })
  private readonly bezelMat: MeshStandardMaterial
  private readonly revealMat: MeshStandardMaterial
  private crackCanvas: HTMLCanvasElement
  private crackTex: CanvasTexture
  private pattern: CrackPattern | null = null
  /** world radius the cracks have spread to */
  crackRadius = 0
  private drawnRadius = -1
  private heal = 0
  private trimFlicker = 0

  constructor() {
    this.crackCanvas = document.createElement('canvas')
    this.crackCanvas.width = 1024
    this.crackCanvas.height = 576
    this.crackTex = new CanvasTexture(this.crackCanvas)
    this.crackTex.colorSpace = SRGBColorSpace
    this.crackTex.minFilter = LinearFilter
    this.crackTex.generateMipmaps = false

    this.bezelMat = new MeshStandardMaterial({ color: 0x07080a, metalness: 0.7, roughness: 0.42, roughnessMap: roughnessTexture(41) })
    this.revealMat = new MeshStandardMaterial({ color: 0x15181c, metalness: 0.85, roughness: 0.3 })

    this.glassMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCracks: { value: this.crackTex },
        uHalf: { value: new Vector2(8, 4.4) },
        uEye: { value: new Vector3(0, 0, 28) },
        uPress: { value: new Vector3() },
        uRipple: { value: new Vector4(0, 0, -10, 0) },
        uTime: { value: 0 },
        uDamage: { value: 0 },
        uHeal: { value: 0 },
        uStress: { value: 0 },
        uImpact: { value: new Vector2() },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uPress; uniform vec4 uRipple; uniform float uTime;
        varying vec2 vUv; varying vec3 vW;
        void main(){
          vec3 p = position;
          float d2 = dot(p.xy - uPress.xy, p.xy - uPress.xy);
          p.z += uPress.z * exp(-d2 / 6.0);
          float rt = uTime - uRipple.z;
          if (rt > 0.0 && rt < 1.5) {
            float rd = length(p.xy - uRipple.xy);
            p.z += sin(rd*4.0 - rt*18.0) * exp(-rt*3.0) * exp(-rd*0.25) * uRipple.w * 0.06;
          }
          vUv = uv;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCracks; uniform vec2 uHalf; uniform vec3 uEye; uniform vec4 uRipple; uniform float uTime;
        uniform float uDamage; uniform float uHeal; uniform float uStress; uniform vec2 uImpact;
        varying vec2 vUv; varying vec3 vW;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 V = normalize(uEye - vW);
          // a broad soft studio reflection that slides with the head: the glass reads as a real surface
          vec2 rp = vW.xy + V.xy * 14.0;
          float sheen = smoothstep(0.0, 1.0, 1.0 - abs(rp.x * 0.07 + rp.y * 0.11 - 0.25)) ;
          sheen = pow(sheen, 6.0) * 0.06;
          float streak = pow(1.0 - abs(fract((rp.x - rp.y*0.4) * 0.035) - 0.5) * 2.0, 40.0) * 0.05;
          float smudge = vnoise(vW.xy * 1.7) * vnoise(vW.xy * 0.6 + 3.1);
          float edge = 1.0 - smoothstep(0.0, 0.35, min(uHalf.x - abs(vW.x), uHalf.y - abs(vW.y)));
          float fres = pow(1.0 - abs(V.z), 3.0);
          vec3 col = vec3(0.75, 0.88, 1.0) * (sheen + streak + fres * 0.08 + smudge * 0.012 + edge * 0.05);
          float a = 0.035 + sheen + streak + fres * 0.1 + smudge * 0.02 + edge * 0.12;

          // cracks (procedural canvas); they glint as the eye moves
          vec4 ck = texture2D(uCracks, vUv);
          float crack = ck.a * (1.0 - uHeal); // canvas rgb is un-premultiplied: coverage lives in alpha
          float glint = 0.6 + 0.4 * sin(dot(vW.xy, vec2(3.1, 2.3)) + V.x * 40.0 + V.y * 30.0);
          vec3 crackCol = mix(vec3(0.85, 0.94, 1.0), vec3(1.0, 0.86, 0.66), uStress * 0.4);
          col += crackCol * crack * (0.9 + glint * 0.9 + uStress * 0.8);
          a = max(a, crack * 0.75);
          // frosted spall around the impact
          float sp = exp(-length(vW.xy - uImpact) * 2.4) * uDamage;
          col += vec3(0.8, 0.9, 1.0) * sp * 0.18 * (1.0 - uHeal);
          a = max(a, sp * 0.3 * (1.0 - uHeal));
          // impact ripple ring
          float rt = uTime - uRipple.z;
          if (rt > 0.0 && rt < 1.2) {
            float rd = length(vW.xy - uRipple.xy);
            float ring = exp(-pow((rd - rt * 9.0) * 1.6, 2.0)) * (1.0 - rt / 1.2) * uRipple.w;
            col += vec3(0.6, 0.85, 1.0) * ring * 0.8;
            a = max(a, ring * 0.35);
          }
          // healing sweep
          if (uHeal > 0.0 && uHeal < 1.0) {
            float hr = length(vW.xy - uImpact);
            float band = exp(-pow((hr - uHeal * 24.0) * 2.4, 2.0)) * (1.0 - uHeal);
            col += vec3(0.7, 0.9, 1.0) * band * 0.55;
            a = max(a, band * 0.22);
          }
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }`,
    })
  }

  /** rebuild the frame for the canvas aspect (world height is fixed) */
  layout(aspect: number) {
    const W = WORLD_H * aspect
    this.canvasW = W
    this.halfW = W / 2 - BEZEL
    this.halfH = WORLD_H / 2 - BEZEL
    const hw = this.halfW
    const hh = this.halfH
    for (const o of [this.glass, this.bezel, this.reveal, this.trim, this.print]) {
      if (!o) continue
      o.removeFromParent()
      o.traverse((c) => {
        if (c instanceof Mesh) c.geometry.dispose()
      })
    }

    // bezel: a big plane with the opening cut out
    const s = new Shape()
    s.moveTo(-80, -50)
    s.lineTo(80, -50)
    s.lineTo(80, 50)
    s.lineTo(-80, 50)
    s.lineTo(-80, -50)
    const hole = new Shape()
    hole.moveTo(-hw, -hh)
    hole.lineTo(-hw, hh)
    hole.lineTo(hw, hh)
    hole.lineTo(hw, -hh)
    hole.lineTo(-hw, -hh)
    s.holes.push(hole)
    this.bezel = new Mesh(new ShapeGeometry(s), this.bezelMat)
    this.bezel.renderOrder = 0
    this.group.add(this.bezel)

    // reveal: the inner faces of the opening, receding into the room
    const rv = new Group()
    const D = REVEAL_DEPTH
    const side = (w: number, x: number, y: number, rx: number, ry: number) => {
      const m = new Mesh(new PlaneGeometry(w, D), this.revealMat)
      m.position.set(x, y, -D / 2)
      m.rotation.set(rx, ry, 0)
      m.receiveShadow = true
      rv.add(m)
    }
    side(hw * 2, 0, hh, Math.PI / 2, 0) // top, facing down
    side(hw * 2, 0, -hh, -Math.PI / 2, 0) // bottom, facing up
    const l = new Mesh(new PlaneGeometry(D, hh * 2), this.revealMat)
    l.position.set(-hw, 0, -D / 2)
    l.rotation.y = Math.PI / 2
    const r = new Mesh(new PlaneGeometry(D, hh * 2), this.revealMat)
    r.position.set(hw, 0, -D / 2)
    r.rotation.y = -Math.PI / 2
    rv.add(l, r)
    this.reveal = rv
    this.group.add(rv)

    // lit trim at the lip of the opening and a second line deep in the reveal
    const tg = new Group()
    const bar = (w: number, h: number, x: number, y: number, z: number) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.02), this.trimMat)
      m.position.set(x, y, z)
      tg.add(m)
    }
    const t = 0.018
    for (const z of [0.012, -D + 0.02]) {
      bar(hw * 2 + t * 2, t, 0, hh + t / 2, z)
      bar(hw * 2 + t * 2, t, 0, -hh - t / 2, z)
      bar(t, hh * 2, -hw - t / 2, 0, z)
      bar(t, hh * 2, hw + t / 2, 0, z)
    }
    this.trim = tg
    this.group.add(tg)

    // printed marks on the bezel: ticks, corner brackets, a little technical type
    this.print = new Mesh(new PlaneGeometry(W, WORLD_H), new MeshBasicMaterial({ map: this.printTexture(W), transparent: true, depthWrite: false }))
    this.print.position.z = 0.006
    this.print.renderOrder = 1
    this.group.add(this.print)

    // the glass
    this.glass = new Mesh(new PlaneGeometry(hw * 2, hh * 2, 96, 54), this.glassMat)
    this.glass.renderOrder = 10
    this.glass.visible = this.intact
    this.glassMat.uniforms.uHalf.value.set(hw, hh)
    this.group.add(this.glass)
    const cw = 1024
    this.crackCanvas.width = cw
    this.crackCanvas.height = Math.round((cw * hh) / hw)
    this.crackTex.dispose()
    this.drawnRadius = -1
    this.drawCracks()
  }

  private printTexture(W: number) {
    const px = 160
    const c = document.createElement('canvas')
    c.width = Math.round(W * px)
    c.height = WORLD_H * px
    const g = c.getContext('2d')!
    const X = (x: number) => (x + W / 2) * px
    const Y = (y: number) => (WORLD_H / 2 - y) * px
    const hw = this.halfW
    const hh = this.halfH
    g.strokeStyle = 'rgba(190,225,255,0.55)'
    g.fillStyle = 'rgba(190,225,255,0.6)'
    g.lineWidth = 2
    const gap = 0.12
    // tick rulers along the opening
    for (let x = -Math.floor(hw); x <= hw; x += 0.5) {
      const major = Math.abs(x % 2.5) < 1e-6
      const L = major ? 0.2 : 0.09
      for (const sy of [1, -1]) {
        g.beginPath()
        g.moveTo(X(x), Y(sy * (hh + gap)))
        g.lineTo(X(x), Y(sy * (hh + gap + L)))
        g.stroke()
      }
    }
    for (let y = -Math.floor(hh); y <= hh; y += 0.5) {
      const major = Math.abs(y % 2.5) < 1e-6
      const L = major ? 0.2 : 0.09
      for (const sx of [1, -1]) {
        g.beginPath()
        g.moveTo(X(sx * (hw + gap)), Y(y))
        g.lineTo(X(sx * (hw + gap + L)), Y(y))
        g.stroke()
      }
    }
    // corner brackets
    g.lineWidth = 4
    g.strokeStyle = 'rgba(220,240,255,0.85)'
    const B = 0.42
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = sx * (hw + 0.3)
      const cy = sy * (hh + 0.3)
      g.beginPath()
      g.moveTo(X(cx - sx * -B), Y(cy))
      g.lineTo(X(cx), Y(cy))
      g.lineTo(X(cx), Y(cy - sy * B))
      g.stroke()
    }
    g.font = `500 ${Math.round(px * 0.12)}px "Martian Mono Variable", ui-monospace, monospace`
    g.fillStyle = 'rgba(200,230,255,0.55)'
    const wide = hw > 5
    g.fillText(wide ? 'BTS-01 · DIMENSIONAL WINDOW' : 'BTS-01', X(-hw), Y(hh + 0.47))
    g.textAlign = 'right'
    g.fillText(wide ? 'PLANE Z = 0.000 · FIELD-LOCKED' : 'Z = 0.000', X(hw), Y(hh + 0.47))
    g.fillText(`${wide ? 'APERTURE ' : ''}${(hw * 2).toFixed(2)} × ${(hh * 2).toFixed(2)}`, X(hw), Y(-hh - 0.38))
    g.textAlign = 'left'
    g.fillText(wide ? 'HEAD-COUPLED PERSPECTIVE' : 'HEAD-COUPLED', X(-hw), Y(-hh - 0.38))
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    return t
  }

  /** start (or grow) a fracture around an impact point (world x/y on the glass) */
  setPattern(p: CrackPattern) {
    this.pattern = p
    this.glassMat.uniforms.uImpact.value.set(p.impact[0], p.impact[1])
    this.drawnRadius = -1
    this.crackRadius = 0
    this.heal = 0
    this.glassMat.uniforms.uHeal.value = 0
  }

  get hasPattern() {
    return !!this.pattern
  }

  get impact() {
    return this.pattern?.impact ?? null
  }

  addDamage(d: number) {
    if (!this.intact) return
    this.damage = clamp(this.damage + d, 0, 1)
  }

  ripple(x: number, y: number, strength: number, time: number) {
    this.glassMat.uniforms.uRipple.value.set(x, y, time, clamp(strength, 0, 2))
  }

  private drawCracks() {
    const c = this.crackCanvas
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    const p = this.pattern
    if (!p) {
      this.crackTex.needsUpdate = true
      return
    }
    const R = this.crackRadius
    const sx = c.width / (this.halfW * 2)
    const X = (x: number) => (x + this.halfW) * sx
    const Y = (y: number) => (this.halfH - y) * sx
    g.lineCap = 'round'
    const pass = (blur: boolean) => {
      for (const e of p.edges) {
        if (e.da > R) continue
        const f = e.db <= R ? 1 : (R - e.da) / Math.max(1e-4, e.db - e.da)
        const bx = e.ax + (e.bx - e.ax) * f
        const by = e.ay + (e.by - e.ay) * f
        const near = 1 - clamp(e.da / p.maxDist, 0, 1)
        g.lineWidth = blur ? 2.5 + near * 3 : 0.8 + near * 1.3
        g.strokeStyle = blur ? `rgba(255,255,255,${0.04 + near * 0.06})` : `rgba(255,255,255,${0.5 + near * 0.5})`
        g.beginPath()
        g.moveTo(X(e.ax), Y(e.ay))
        g.lineTo(X(bx), Y(by))
        g.stroke()
      }
    }
    pass(true)
    pass(false)
    // a tight star of micro-cracks at the point of impact
    const [ix, iy] = p.impact
    g.strokeStyle = 'rgba(255,255,255,0.9)'
    g.lineWidth = 1
    const n = 18
    const rr = Math.min(R, 0.55)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.sin(k * 7.1) * 0.2
      g.beginPath()
      g.moveTo(X(ix), Y(iy))
      g.lineTo(X(ix + Math.cos(a) * rr * (0.5 + 0.5 * Math.abs(Math.sin(k * 3.7)))), Y(iy + Math.sin(a) * rr * (0.5 + 0.5 * Math.abs(Math.sin(k * 3.7)))))
      g.stroke()
    }
    this.crackTex.needsUpdate = true
  }

  /** the glass has gone: hide it (the fracture system has spawned the shards) */
  shatter() {
    this.intact = false
    this.damage = 1
    if (this.glass) this.glass.visible = false
    this.trimFlicker = 1
  }

  /** glass is back: cracks glow and heal away from the impact point outwards */
  restore() {
    this.intact = true
    this.damage = 0
    if (this.glass) this.glass.visible = true
    this.heal = 0.001
  }

  update(dt: number, time: number, eye: Vector3, stress: number) {
    const u = this.glassMat.uniforms
    u.uTime.value = time
    u.uEye.value.copy(eye)
    u.uDamage.value = this.damage
    u.uStress.value = stress
    if (this.intact && this.pattern) {
      // cracks spread towards a radius set by the damage, with a little inertia
      const target = this.damage <= 0 ? 0 : 0.6 + Math.pow(this.damage, 0.8) * this.pattern.maxDist * 0.92
      this.crackRadius += (target - this.crackRadius) * damp(7, dt)
      if (Math.abs(this.crackRadius - this.drawnRadius) > 0.04) {
        this.drawCracks()
        this.drawnRadius = this.crackRadius
      }
    }
    if (this.heal > 0) {
      this.heal = Math.min(1, this.heal + dt / 1.4)
      u.uHeal.value = this.heal
      if (this.heal >= 1) {
        this.heal = 0
        u.uHeal.value = 0
        this.pattern = null
        this.crackRadius = 0
        this.drawCracks()
      }
    }
    // the trim reacts: steady when calm, flickers under stress, stutters when broken
    this.trimFlicker = Math.max(0, this.trimFlicker - dt * 0.4)
    let k = 1.3 + stress * 2.5
    if (stress > 0.3) k *= 0.75 + 0.25 * Math.sin(time * 60) * Math.sin(time * 23)
    if (!this.intact) k *= 0.55 + 0.45 * (Math.sin(time * 37) > 0.2 ? 1 : 0.3)
    const warm = clamp(stress, 0, 1)
    this.trimMat.color.setRGB(0.75 + warm * 0.25, 0.9 - warm * 0.15, 1.0 - warm * 0.4).multiplyScalar(k)
  }
}
