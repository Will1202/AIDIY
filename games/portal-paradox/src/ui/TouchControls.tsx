import { useRef } from 'react'
import { engine } from '../engine/instance'
import type { Action } from '../engine/Input'

/**
 * Mobile mode: left thumb is a floating move stick, right thumb drags to look,
 * buttons fire the same actions as the keyboard.
 */
export function TouchControls() {
  const stick = useRef<{ id: number; x: number; y: number } | null>(null)
  const look = useRef<{ id: number; x: number; y: number } | null>(null)
  const knob = useRef<HTMLDivElement>(null)

  const onDown = (e: React.PointerEvent) => {
    const en = engine()
    if (!en) return
    const left = e.clientX < window.innerWidth * 0.45
    if (left && !stick.current) stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    else if (!look.current) look.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const en = engine()
    if (!en) return
    if (stick.current?.id === e.pointerId) {
      const dx = (e.clientX - stick.current.x) / 60, dy = (e.clientY - stick.current.y) / 60
      const l = Math.hypot(dx, dy)
      const k = l > 1 ? 1 / l : 1
      en.input.stick.x = dx * k
      en.input.stick.y = dy * k
      en.input.touchSprint = l > 1.6
      if (knob.current) knob.current.style.transform = `translate(${dx * k * 40}px, ${dy * k * 40}px)`
    } else if (look.current?.id === e.pointerId) {
      en.input.lookX += (e.clientX - look.current.x) * 1.6
      en.input.lookY += (e.clientY - look.current.y) * 1.6
      look.current.x = e.clientX
      look.current.y = e.clientY
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const en = engine()
    if (stick.current?.id === e.pointerId) {
      stick.current = null
      if (en) { en.input.stick.x = en.input.stick.y = 0; en.input.touchSprint = false }
      if (knob.current) knob.current.style.transform = ''
    }
    if (look.current?.id === e.pointerId) look.current = null
  }
  const fire = (a: Action) => (ev: React.PointerEvent) => {
    ev.stopPropagation()
    engine()?.input.push(a)
  }
  return (
    <div className="touch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="stick"><div className="knob" ref={knob} /></div>
      <div className="tbtns" onPointerDown={(e) => e.stopPropagation()}>
        <button onPointerDown={fire('jump')}>JUMP</button>
        <button onPointerDown={fire('grab')}>GRAB</button>
        <button onPointerDown={fire('fire')}>FIRE</button>
        <button onPointerDown={fire('gravity')}>G</button>
        <button onPointerDown={fire('rewindStart')} onPointerUp={fire('rewindEnd')} onPointerLeave={fire('rewindEnd')}>◀◀</button>
        <button className="alpha" onPointerDown={fire('tool1')}>α</button>
        <button className="omega" onPointerDown={fire('tool2')}>Ω</button>
        <button onPointerDown={() => engine()?.pause()}>II</button>
      </div>
    </div>
  )
}
