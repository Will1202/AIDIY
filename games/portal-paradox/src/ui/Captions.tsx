import { useEffect, useState } from 'react'
import { useStore } from '../state/store'

/** Cinematic captions: chapter cards slide in bottom-left; the title card sits centred. */
export function Captions() {
  const caption = useStore((s) => s.caption)
  const phase = useStore((s) => s.phase)
  const [shown, setShown] = useState(caption)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!caption) { setShown(null); return }
    setShown(caption)
    setLeaving(false)
    if (caption.kind === 'title') return
    const a = setTimeout(() => setLeaving(true), 2500)
    const b = setTimeout(() => setShown((c) => (c?.id === caption.id ? null : c)), 3100)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [caption])
  if (phase !== 'cinematic' || !shown) return null
  if (shown.kind === 'title') {
    return (
      <div className="caption-title" key={shown.id}>
        <h1>{shown.title.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${i * 0.045}s` }}>{ch === ' ' ? ' ' : ch}</span>)}</h1>
        <p>{shown.sub}</p>
      </div>
    )
  }
  return (
    <div className={`caption ${leaving ? 'out' : ''}`} key={shown.id}>
      <i className="caption-rule" />
      <h2>{shown.title}</h2>
      {shown.sub && <p>{shown.sub}</p>}
    </div>
  )
}
