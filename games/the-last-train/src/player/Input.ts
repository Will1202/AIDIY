// 输入：键盘（按 code，不受输入法影响）、鼠标（指针锁定）、触屏（左半屏虚拟摇杆，右半屏转视角）。
export class Input {
  private keys = new Set<string>()
  private hits = new Set<string>()
  private ups = new Set<string>()
  lookDX = 0
  lookDY = 0
  /** 触屏摇杆 -1..1 */
  moveX = 0
  moveY = 0
  touchRun = false
  /** 在 UI 打开时屏蔽游戏输入 */
  enabled = true
  private el: HTMLElement | null = null
  private off: (() => void)[] = []
  private joyId: number | null = null
  private lookId: number | null = null
  private joyStart = { x: 0, y: 0 }
  private lookLast = { x: 0, y: 0 }
  /** 触屏摇杆的显示位置（UI 读取） */
  joy: { x: number; y: number; dx: number; dy: number } | null = null
  onKey: ((code: string, e: KeyboardEvent) => void) | null = null

  attach(el: HTMLElement) {
    this.el = el
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (['Tab', 'Space'].includes(e.code)) e.preventDefault()
        return
      }
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (['Tab', 'Space', 'F3'].includes(e.code)) e.preventDefault()
      this.keys.add(e.code)
      this.hits.add(e.code)
      this.onKey?.(e.code, e)
    }
    const ku = (e: KeyboardEvent) => {
      this.keys.delete(e.code)
      this.ups.add(e.code)
    }
    const blur = () => this.keys.clear()
    const mm = (e: MouseEvent) => {
      if (document.pointerLockElement === this.el || this.manipulating) {
        this.lookDX += e.movementX
        this.lookDY += e.movementY
      }
    }
    const md = (e: MouseEvent) => {
      if (e.button === 0) { this.keys.add('Mouse0'); this.hits.add('Mouse0') }
      if (e.button === 2) { this.keys.add('Mouse2'); this.hits.add('Mouse2') }
    }
    const mu = (e: MouseEvent) => {
      if (e.button === 0) { this.keys.delete('Mouse0'); this.ups.add('Mouse0') }
      if (e.button === 2) { this.keys.delete('Mouse2'); this.ups.add('Mouse2') }
    }
    const ctx = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', blur)
    window.addEventListener('mousemove', mm)
    el.addEventListener('mousedown', md)
    window.addEventListener('mouseup', mu)
    el.addEventListener('contextmenu', ctx)
    // 触屏
    const ts = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const left = t.clientX < window.innerWidth * 0.45
        if (left && this.joyId === null) {
          this.joyId = t.identifier
          this.joyStart = { x: t.clientX, y: t.clientY }
          this.joy = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 }
        } else if (!left && this.lookId === null) {
          this.lookId = t.identifier
          this.lookLast = { x: t.clientX, y: t.clientY }
        }
      }
    }
    const tm = (e: TouchEvent) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          const dx = t.clientX - this.joyStart.x, dy = t.clientY - this.joyStart.y
          const r = 60
          const l = Math.hypot(dx, dy)
          const k = l > r ? r / l : 1
          this.moveX = (dx * k) / r
          this.moveY = (-dy * k) / r
          this.touchRun = l > r * 1.6
          this.joy = { x: this.joyStart.x, y: this.joyStart.y, dx: dx * k, dy: dy * k }
        } else if (t.identifier === this.lookId) {
          this.lookDX += (t.clientX - this.lookLast.x) * 2.2
          this.lookDY += (t.clientY - this.lookLast.y) * 2.2
          this.lookLast = { x: t.clientX, y: t.clientY }
        }
      }
    }
    const te = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          this.joyId = null
          this.moveX = this.moveY = 0
          this.touchRun = false
          this.joy = null
        }
        if (t.identifier === this.lookId) this.lookId = null
      }
    }
    el.addEventListener('touchstart', ts, { passive: true })
    el.addEventListener('touchmove', tm, { passive: false })
    el.addEventListener('touchend', te)
    el.addEventListener('touchcancel', te)
    this.off.push(() => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('blur', blur)
      window.removeEventListener('mousemove', mm)
      el.removeEventListener('mousedown', md)
      window.removeEventListener('mouseup', mu)
      el.removeEventListener('contextmenu', ctx)
      el.removeEventListener('touchstart', ts)
      el.removeEventListener('touchmove', tm)
      el.removeEventListener('touchend', te)
      el.removeEventListener('touchcancel', te)
    })
  }

  /** 操纵模式（拖动探照灯等）：不需要指针锁定也接收鼠标位移 */
  manipulating = false

  /** 触屏虚拟按键 */
  press(code: string) {
    this.keys.add(code)
    this.hits.add(code)
  }
  release(code: string) {
    this.keys.delete(code)
    this.ups.add(code)
  }

  down(code: string) {
    return this.enabled && this.keys.has(code)
  }
  hit(code: string) {
    return this.enabled && this.hits.has(code)
  }
  up(code: string) {
    return this.enabled && this.ups.has(code)
  }
  /** 无视 enabled 的原始状态（暂停菜单等） */
  rawHit(code: string) {
    return this.hits.has(code)
  }

  endFrame() {
    this.hits.clear()
    this.ups.clear()
    this.lookDX = 0
    this.lookDY = 0
  }

  clear() {
    this.keys.clear()
    this.endFrame()
  }

  dispose() {
    for (const f of this.off.splice(0)) f()
  }
}
