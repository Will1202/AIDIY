/**
 * Keyboard / mouse / pointer-lock / touch input. Continuous state (held keys,
 * accumulated look delta) is polled once per frame; discrete actions are
 * queued so a key held down never re-triggers (`repeat` events are ignored).
 */
export type Action =
  | 'jump' | 'grab' | 'fire' | 'tool1' | 'tool2' | 'gravity' | 'rewindStart' | 'rewindEnd'
  | 'cinematic' | 'layout' | 'reset' | 'hud' | 'frame' | 'quality' | 'fullscreen' | 'mute' | 'rotateL' | 'rotateR' | 'help'

const ACTION_KEYS: Record<string, Action> = {
  Space: 'jump', KeyE: 'grab', Digit1: 'tool1', Digit2: 'tool2', KeyG: 'gravity', KeyC: 'cinematic',
  KeyL: 'layout', KeyX: 'reset', KeyH: 'hud', KeyV: 'frame', KeyQ: 'quality', KeyF: 'fullscreen', KeyM: 'mute',
  BracketLeft: 'rotateL', BracketRight: 'rotateR', Slash: 'help',
}

export class Input {
  readonly keys = new Set<string>()
  lookX = 0
  lookY = 0
  wheel = 0
  /** analogue move from the touch stick, −1..1 */
  readonly stick = { x: 0, y: 0 }
  touchSprint = false
  locked = false
  enabled = true
  private queue: Action[] = []
  private readonly el: HTMLElement
  onLockChange?: (locked: boolean) => void

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('pointerlockchange', this.onLock)
    document.addEventListener('mousemove', this.onMouseMove)
    el.addEventListener('mousedown', this.onMouseDown)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('wheel', this.onWheel, { passive: true })
  }

  requestLock() {
    if (document.pointerLockElement === this.el) return
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined
      p?.catch?.(() => {})
    } catch {
      /* not allowed outside a user gesture */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  push(a: Action) {
    this.queue.push(a)
  }

  drain(): Action[] {
    const q = this.queue
    this.queue = []
    return q
  }

  consumeLook() {
    const r = [this.lookX, this.lookY] as const
    this.lookX = this.lookY = 0
    return r
  }

  consumeWheel() {
    const w = this.wheel
    this.wheel = 0
    return w
  }

  down(code: string) {
    return this.keys.has(code)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    this.keys.add(e.code)
    if (e.repeat) return
    if (e.code === 'KeyR') this.queue.push('rewindStart')
    const a = ACTION_KEYS[e.code]
    if (a) this.queue.push(a)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
    if (e.code === 'KeyR') this.queue.push('rewindEnd')
  }

  private onBlur = () => {
    if (this.keys.has('KeyR')) this.queue.push('rewindEnd')
    this.keys.clear()
  }

  private onLock = () => {
    this.locked = document.pointerLockElement === this.el
    this.onLockChange?.(this.locked)
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return
    // some browsers report a huge spike on the first event after locking
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return
    this.lookX += e.movementX
    this.lookY += e.movementY
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return
    if (!this.locked) return
    if (e.button === 0) this.queue.push('fire')
    if (e.button === 2) this.queue.push('grab')
  }

  private onWheel = (e: WheelEvent) => {
    if (this.locked) this.wheel += Math.sign(e.deltaY)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('pointerlockchange', this.onLock)
    document.removeEventListener('mousemove', this.onMouseMove)
    this.el.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('wheel', this.onWheel)
  }
}
