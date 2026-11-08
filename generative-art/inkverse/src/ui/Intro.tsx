import { useEffect, useRef, useState } from 'react'
import { Noise2D } from '../util/noise'
import { Seal } from './Seal'

/** faint distant ranges washed onto the opening sheet (淡墨山影) */
function paintRanges(cv: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = (cv.width = Math.round(cv.clientWidth * dpr))
  const h = (cv.height = Math.round(cv.clientHeight * dpr))
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  const nz = new Noise2D(42)
  const layers = [
    { base: 0.8, amp: 0.2, freq: 1.6, alpha: 0.13, blur: 7, seed: 0 },
    { base: 0.86, amp: 0.15, freq: 2.6, alpha: 0.18, blur: 4, seed: 9 },
    { base: 0.93, amp: 0.1, freq: 3.8, alpha: 0.22, blur: 2, seed: 21 },
  ]
  for (const l of layers) {
    ctx.save()
    ctx.filter = `blur(${l.blur * dpr}px)`
    ctx.beginPath()
    ctx.moveTo(0, h)
    const peakX = 0.18 + l.seed * 0.02
    for (let x = 0; x <= w; x += 3) {
      const u = x / w
      const r = nz.ridged(u * l.freq + l.seed, l.seed * 0.7, 4)
      // one tall peak on the left like a hanging scroll, the rest a low range
      const peak = Math.exp(-Math.pow((u - peakX) / 0.09, 2)) * 0.22 * (l.seed === 0 ? 1.4 : 0.6)
      const y = h * (l.base - l.amp * r - peak)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, h * (l.base - l.amp - 0.25), 0, h)
    g.addColorStop(0, `rgba(30,27,24,${l.alpha})`)
    g.addColorStop(0.55, `rgba(30,27,24,${l.alpha * 0.45})`)
    g.addColorStop(1, 'rgba(30,27,24,0)')
    ctx.fillStyle = g
    ctx.fill()
    ctx.restore()
  }
  // a few drifting mist bands
  ctx.save()
  ctx.filter = `blur(${14 * dpr}px)`
  ctx.fillStyle = 'rgba(239,231,214,0.55)'
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.ellipse(w * (0.15 + i * 0.25), h * (0.83 + (i % 2) * 0.05), w * 0.16, h * 0.025, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function IntroOverlay({ onEnter }: { onEnter: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const c = cv.current
    if (!c) return
    paintRanges(c)
    const onR = () => paintRanges(c)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  const enter = () => {
    if (leaving) return
    setLeaving(true)
    setTimeout(onEnter, 900)
  }
  return (
    <div className={`intro ${leaving ? 'leaving' : ''}`}>
      <canvas ref={cv} className="intro-ranges" />
      <div className="intro-seal">
        <Seal text="江湖" size={46} />
      </div>
      <div className="intro-title">
        <h1>INKVERSE</h1>
        <h2>一笔入江湖</h2>
        <p>A WORLD BORN FROM INK.</p>
        <button className="enter" onClick={enter}>
          ENTER THE PAINTING
        </button>
      </div>
      <div className="intro-foot">每一笔，都可以创造一个世界 · EVERY STROKE CREATES A WORLD</div>
    </div>
  )
}
