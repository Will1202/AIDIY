import { useEffect, useRef } from 'react'

/** Runs a callback every animation frame without re-rendering React. */
export function useRaf(cb: (dt: number) => void) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    let id = 0
    let last = performance.now()
    const loop = (now: number) => {
      ref.current(Math.min(0.1, (now - last) / 1000))
      last = now
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}

export function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}
