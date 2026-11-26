// 真实 GPU 帧率测量：用本机 Chrome（ANGLE/D3D11）无头运行生产构建，
// 需要本机安装 Chrome（或用 CHROME_PATH 指定），命令见 package.json 的 bench / e2e 脚本。
// 通过请求拦截把 dist/ 当成网站提供，逐个世界测 1080p 帧时间并截图。
// 用法：node bench.cjs <distDir> <outDir> [quality...]
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')

const dist = process.argv[2]
const out = process.argv[3]
const qualities = process.argv.slice(4).length ? process.argv.slice(4) : ['MEDIUM']
fs.mkdirSync(out, { recursive: true })
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' }

const SCENES = [
  { name: 'menu', world: null },
  { name: 'station', world: 'station', pos: [-14, 1, 5.2], yaw: -1.15, pitch: 0.06 },
  { name: 'station-bench', world: 'station', pos: [-6, 1, 5.9], yaw: 0.1, pitch: -0.05 },
  { name: 'train', world: 'station', pos: [2, 1, 0.2], yaw: Math.PI / 2, pitch: 0 },
  { name: 'city', world: 'city', pos: [-5, 1, 22], yaw: Math.PI + 0.25, pitch: 0.42 },
  { name: 'city-upper', world: 'city', pos: [0, 34, 70], yaw: 0, pitch: 0, g: -1 },
  { name: 'abyss', world: 'abyss', pos: [1, 1, 40], yaw: Math.PI - 0.2, pitch: 0.18, power: true },
  { name: 'desert', world: 'desert', pos: [0, 1, 16], yaw: Math.PI, pitch: 0.08 },
  { name: 'museum', world: 'museum', pos: [0, 1, 18.5], yaw: Math.PI, pitch: 0.1 },
  { name: 'terminus', world: 'terminus', pos: [-10, 1, 6], yaw: -Math.PI / 2 - 0.3, pitch: 0.12 },
]

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  })
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = new URL(req.url())
    if (u.hostname !== 'lt.local') return req.abort()
    let p = decodeURIComponent(u.pathname)
    if (p.endsWith('/')) p += 'index.html'
    const f = path.join(dist, p)
    if (!fs.existsSync(f)) return req.respond({ status: 404, body: 'nf' })
    req.respond({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) })
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('http://lt.local/index.html?debug&test', { waitUntil: 'load' })
  await page.waitForFunction(() => window.__LT && window.__LT.game.booted, { timeout: 120000 })
  const gpu = await page.evaluate(() => {
    const gl = window.__LT.game.renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  })
  console.log('GPU:', gpu)
  const results = []
  for (const q of qualities) {
    await page.evaluate((q) => window.__LT.game.setQuality(q), q)
    for (const s of SCENES) {
      const r = await page.evaluate(async (s) => {
        const L = window.__LT, g = L.game
        g.manualClock = false
        if (s.world) {
          if (g.worldId !== s.world || g.mode !== 'play') await g.loadWorld(s.world)
          g.mode = 'play'
          L.play()
          if (s.power) { L.S.set('abyss.power'); g.world.power = 1 }
          g.player.setGravity(s.g || 1)
          L.tp(s.pos[0], s.pos[1], s.pos[2], s.yaw, s.pitch)
          g.player.locked = true
        }
        await new Promise((r) => setTimeout(r, 1500))
        const times = []
        let last = performance.now()
        await new Promise((res) => {
          const end = last + 4000
          const f = (t) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res() }
          requestAnimationFrame(f)
        })
        times.sort((a, b) => a - b)
        const avg = times.reduce((a, b) => a + b, 0) / times.length
        const info = g.renderer.info
        return { avg: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(2), calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures, programs: info.programs.length }
      }, s)
      await page.screenshot({ path: path.join(out, `${q}-${s.name}.jpg`), type: 'jpeg', quality: 82 })
      results.push({ q, scene: s.name, ...r })
      console.log(q.padEnd(7), s.name.padEnd(14), `${String(r.fps).padStart(6)} fps  avg ${r.avg}ms  p95 ${r.p95}ms  calls ${r.calls}  tris ${r.tris}`)
    }
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ gpu, results, errors }, null, 2))
  if (errors.length) console.log('ERRORS:', errors.slice(0, 10))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
