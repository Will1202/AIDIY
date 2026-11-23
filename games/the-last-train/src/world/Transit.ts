// 世界之间的“缝隙”：列车行驶在一条看不见的隧道里，光线从车窗外掠过，偶尔穿过一道光环。
// 全部由一个 Shader 驱动（实例化），切换世界时它负责遮住远处的卸载 / 加载。
import { AdditiveBlending, Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, TorusGeometry } from 'three'

export class Transit {
  readonly group = new Group()
  private streaks: InstancedMesh
  private mat: ShaderMaterial
  private rings: Mesh[] = []
  private ringMat: ShaderMaterial
  private t = 0
  speed = 0
  visible = 0

  constructor(count: number) {
    this.group.name = 'transit'
    const geo = new PlaneGeometry(1, 1)
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSpeed: { value: 0 }, uColor: { value: new Color(0.9, 0.8, 0.6) }, uVis: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uSpeed;
        varying float vA; varying vec2 vUv;
        void main() {
          float L = 600.0;
          float x = mod(aSeed.x * L - uTime * uSpeed * (0.6 + aSeed.w * 0.8), L) - L * 0.5;
          float ang = aSeed.y * 6.2831;
          float r = 7.0 + aSeed.z * 60.0;
          vec3 c = vec3(x, 1.8 + sin(ang) * r * 0.55, cos(ang) * r);
          float len = 2.0 + uSpeed * 0.35 * (0.5 + aSeed.w);
          vec3 p = c + vec3(position.x * len, position.y * (0.05 + aSeed.w * 0.08), 0.0);
          // 始终朝向车厢（绕 x 轴的公告板）
          vec3 toCam = normalize(cameraPosition - c);
          vec3 side = normalize(cross(vec3(1.0, 0.0, 0.0), toCam));
          p = c + vec3(position.x * len, 0.0, 0.0) + side * position.y * (0.05 + aSeed.w * 0.1);
          vA = (0.35 + aSeed.w * 0.65) * smoothstep(300.0, 120.0, abs(x));
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uVis;
        varying float vA; varying vec2 vUv;
        void main() {
          float a = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x) * (1.0 - abs(vUv.y - 0.5) * 2.0);
          gl_FragColor = vec4(uColor * a * vA * uVis * 3.0, 1.0);
        }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false,
    })
    this.streaks = new InstancedMesh(geo, this.mat, count)
    const seeds = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i++) seeds[i] = Math.random()
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
    const id = new Matrix4()
    for (let i = 0; i < count; i++) this.streaks.setMatrixAt(i, id)
    this.streaks.frustumCulled = false
    this.group.add(this.streaks)
    this.ringMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(1, 0.85, 0.6) }, uA: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main(){ float k = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 3.0); gl_FragColor = vec4(uColor * k * uA * 4.0, 1.0); }`,
      blending: AdditiveBlending, transparent: true, depthWrite: false,
    })
    for (let i = 0; i < 3; i++) {
      const r = new Mesh(new TorusGeometry(9, 0.35, 8, 64), this.ringMat)
      r.rotation.y = Math.PI / 2
      r.position.set(200 + i * 200, 1.8, 0)
      r.frustumCulled = false
      this.rings.push(r)
      this.group.add(r)
    }
    this.group.visible = false
  }

  setColor(hex: string) {
    ;(this.mat.uniforms.uColor.value as Color).set(hex)
    ;(this.ringMat.uniforms.uColor.value as Color).set(hex)
  }

  update(dt: number) {
    this.t += dt
    this.mat.uniforms.uTime.value = this.t
    this.mat.uniforms.uSpeed.value = this.speed
    this.mat.uniforms.uVis.value = this.visible
    this.ringMat.uniforms.uA.value = this.visible * 0.6
    for (const r of this.rings) {
      r.position.x -= this.speed * dt * 0.8
      if (r.position.x < -300) r.position.x += 600
    }
    this.group.visible = this.visible > 0.001
  }

  dispose() {
    this.streaks.geometry.dispose()
    this.mat.dispose()
    this.ringMat.dispose()
    this.rings.forEach((r) => r.geometry.dispose())
  }
}
