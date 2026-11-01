// Three "observation plates" painted procedurally at startup (no external images),
// so they are same-origin data URLs that page snapshots can embed safely.

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amt: number, seed: number) {
  const img = ctx.getImageData(0, 0, w, h)
  const r = rng(seed)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amt
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

/** 230 GHz interferometric image: a blurred, lopsided ring */
function radioPlate(w: number, h: number) {
  const { c, ctx } = canvas(w, h)
  ctx.fillStyle = '#060201'
  ctx.fillRect(0, 0, w, h)
  const cx = w * 0.5
  const cy = h * 0.52
  const R = h * 0.27
  ctx.filter = `blur(${Math.round(h * 0.05)}px)`
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2
    const b = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(a + 0.6), 1.6)
    ctx.fillStyle = `rgba(255,${Math.round(110 + 90 * b)},${Math.round(30 + 50 * b)},${0.22 * b + 0.05})`
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, h * 0.07, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.filter = 'none'
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75)
  g.addColorStop(0, 'rgba(0,0,0,0.85)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2)
  ctx.fill()
  grain(ctx, w, h, 14, 7)
  return c.toDataURL('image/png')
}

/** X-ray flare: hot core, bipolar jets, speckle */
function xrayPlate(w: number, h: number) {
  const { c, ctx } = canvas(w, h)
  ctx.fillStyle = '#02030a'
  ctx.fillRect(0, 0, w, h)
  const r = rng(91)
  for (let i = 0; i < 900; i++) {
    const x = r() * w
    const y = r() * h
    const d = Math.hypot(x - w / 2, y - h / 2) / h
    const a = Math.max(0, 0.6 - d) * r()
    ctx.fillStyle = `rgba(${120 + r() * 80},${120 + r() * 100},255,${a * 0.5})`
    ctx.fillRect(x, y, 1.5, 1.5)
  }
  ctx.filter = `blur(${Math.round(h * 0.03)}px)`
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate(-0.5)
  const jet = ctx.createLinearGradient(-w * 0.45, 0, w * 0.45, 0)
  jet.addColorStop(0, 'rgba(90,120,255,0)')
  jet.addColorStop(0.5, 'rgba(160,190,255,0.9)')
  jet.addColorStop(1, 'rgba(90,120,255,0)')
  ctx.fillStyle = jet
  ctx.fillRect(-w * 0.45, -h * 0.02, w * 0.9, h * 0.04)
  ctx.restore()
  const core = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.22)
  core.addColorStop(0, 'rgba(235,240,255,1)')
  core.addColorStop(0.3, 'rgba(140,160,255,0.6)')
  core.addColorStop(1, 'rgba(60,40,160,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, w, h)
  ctx.filter = 'none'
  grain(ctx, w, h, 10, 3)
  return c.toDataURL('image/png')
}

/** Spectrum strip with absorption lines */
function spectrumPlate(w: number, h: number) {
  const { c, ctx } = canvas(w, h)
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, w, h)
  const top = h * 0.3
  const bh = h * 0.4
  const g = ctx.createLinearGradient(0, 0, w, 0)
  const stops = ['#2a0010', '#a3141a', '#ff6a1a', '#ffd166', '#f2f7d0', '#58e6a8', '#2fb3ff', '#5a38ff', '#1a0a3a']
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s))
  ctx.fillStyle = g
  ctx.fillRect(0, top, w, bh)
  const r = rng(17)
  for (let i = 0; i < 26; i++) {
    const x = r() * w
    ctx.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.6})`
    ctx.fillRect(x, top, 1 + r() * 2.5, bh)
  }
  ctx.strokeStyle = 'rgba(255,240,220,0.75)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= w; x += 2) {
    const y = h * 0.86 - Math.exp(-Math.pow((x - w * 0.55) / (w * 0.22), 2)) * h * 0.11 - r() * 3
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  grain(ctx, w, h, 12, 5)
  return c.toDataURL('image/png')
}

let cache: string[] | null = null

export function getPlates(): string[] {
  if (!cache) {
    try {
      cache = [radioPlate(300, 200), xrayPlate(300, 200), spectrumPlate(300, 200)]
    } catch {
      cache = ['', '', '']
    }
  }
  return cache
}
