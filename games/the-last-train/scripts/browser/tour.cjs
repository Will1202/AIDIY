// 美术巡检：在真实 GPU 上按玩家视角走一遍六个世界的关键位置，逐张截图，供人工比对画面。
// 需要本机安装 Chrome（或用 CHROME_PATH 指定）。
// 用法：node tour.cjs <distDir> <outDir> [world...]
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')

const dist = process.argv[2]
const out = process.argv[3]
const only = process.argv.slice(4)
fs.mkdirSync(out, { recursive: true })
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' }

// pos 是脚底位置，look 是视线目标；g:-1 表示倒悬（站在上城的楼板底面）
const TOUR = {
  station: [
    { pos: [-5.5, 1, 3], look: [-14, 2.2, 11] },
    { pos: [-14, 1, 8], look: [-16.4, 1.6, 15] },
    { pos: [-5, 1, 6.5], look: [6, 1.6, 0] },
    { pos: [12, 1, 5], look: [-12, 3, 7] },
  ],
  city: [
    { pos: [0, 1, 6], look: [0, 5, 30] },
    { pos: [3, 1, 24], look: [0, 1.5, 45] },
    { pos: [-4, 1, 17], look: [-11.5, 1.6, 12] },
    { pos: [6, 1, 14], look: [-6, 1, 24] },
    { pos: [0, 1, 54], look: [0, 6, 63] },
    { pos: [0, 34, 76], look: [0, 34, 95], g: -1 },
    { pos: [6, 1, 6], look: [-85, 14, 31] },
    { pos: [-14, 1, 3.4], look: [-18, 4.2, 7.35] },
  ],
  abyss: [
    { pos: [0, 1, 4], look: [0, 3, 22] },
    { pos: [0, 1, 18], look: [0, 4, 34] },
    { pos: [-3, 1, 28], look: [-14, 1.4, 34] },
    { pos: [10, 1, 34], look: [18, 1.4, 34] },
    { pos: [2, 1, 36], look: [-30, -4, 60] },
    { pos: [0, -19, 39], look: [0, -18, 47] },
    { pos: [-5, -19, 33], look: [6, -17.5, 44] },
  ],
  desert: [
    { pos: [0, 1, 5], look: [0, 3, 22] },
    { pos: [2.2, 1, 14], look: [0, 5, 40] },
    { pos: [0, 1, 36], look: [0, 3, 47] },
    { pos: [6, 1, 44], look: [-6, 2, 40] },
    { pos: [1.5, 1, 22.5], look: [-8, -14, 40] },
    { pos: [0, 1, 20], look: [55, 12, -83] },
    { pos: [-7, 1, 3.4], look: [-10, 3.4, 6.9] },
  ],
  museum: [
    { pos: [0, 1, 9], look: [0, 2.2, 20] },
    { pos: [-6, 1, 24], look: [-14, 2, 27] },
    { pos: [6, 1, 24], look: [26, 2, 24] },
    { pos: [18, 1, 11], look: [38, 2, 10] },
    { pos: [0, 1, 30], look: [0, 2.4, 42] },
    { pos: [0, 1, 46], look: [3.6, 1.5, 51.8] },
    { pos: [0, 1, 50], look: [0, 2.2, 60] },
    { pos: [36.5, 1, 9], look: [46, 3.2, 10] },
    { pos: [24.5, 1, 23], look: [32, 2, 27] },
    { pos: [-17, 1, 21], look: [-10, 2.6, 28] },
    { pos: [18.5, 1, 24], look: [22, 3.6, 24] },
  ],
  terminus: [
    { pos: [4, 1, 3], look: [15, 1.5, 0] },
    { pos: [28, 1, 5.6], look: [40, 2, 5.6] },
    { pos: [0, 1, 8], look: [0, 4, 0] },
    { pos: [-10, 1, 6], look: [-30, 3, 2] },
    { pos: [-6, 1, 5.4], look: [-9, 2.4, 9] },
  ],
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
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
  await page.addStyleTag({ content: '.clickToPlay{display:none!important}' })
  for (const [world, views] of Object.entries(TOUR)) {
    if (only.length && !only.includes(world)) continue
    for (let i = 0; i < views.length; i++) {
      const v = views[i]
      await page.evaluate(async (world, v) => {
        const L = window.__LT, g = L.game
        if (g.worldId !== world || g.mode !== 'play') await g.loadWorld(world)
        g.mode = 'play'
        L.play()
        if (world === 'abyss') { L.S.set('abyss.power'); g.world.power = 1 }
        g.player.setGravity(v.g || 1)
        L.tp(v.pos[0], v.pos[1], v.pos[2], 0, 0)
        L.look(v.look[0], v.look[1], v.look[2])
        g.player.locked = true
        await new Promise((r) => setTimeout(r, 1200))
      }, world, v)
      await page.screenshot({ path: path.join(out, `${world}-${i + 1}.jpg`), type: 'jpeg', quality: 80 })
    }
    console.log(world, views.length, 'shots')
  }
  if (errors.length) console.log('ERRORS:', errors.slice(0, 10))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
