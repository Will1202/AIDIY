// 真实 GPU 上播放结局过场与展映回放，按时间点截图并收集页面错误。
// 需要本机安装 Chrome（或用 CHROME_PATH 指定），命令见 package.json 的 bench / e2e 脚本。
// 用法：node scenes.cjs <distDir> <outDir> [only...]
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')

const dist = process.argv[2]
const out = process.argv[3]
const only = process.argv.slice(4)
fs.mkdirSync(out, { recursive: true })
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JOBS = [
  { name: 'intro', setup: `void g.newGame()`, shots: [3, 8, 12, 17, 21, 25, 30, 36] },
  { name: 'ending-leave', setup: `S.give('ticket'); S.set('ticket.punched'); S.set('ticket.final'); S.set('terminus.arrived'); await g.loadWorld('terminus'); g.mode='play'; L.play(); L.tp(34.4, 1, 5.6, -Math.PI/2, 0); await new Promise(r=>setTimeout(r,400)); L.use('gate')`, shots: [1.5, 5, 9, 15] },
  { name: 'ending-conductor', setup: `S.set('terminus.arrived'); S.set('terminus.capOffered'); await g.loadWorld('terminus'); g.mode='play'; L.play(); L.tp(15.0, 1, 0, -Math.PI/2, 0); await new Promise(r=>setTimeout(r,400)); L.use('cap'); L.use('cabLever')`, shots: [2, 7, 12, 18] },
  { name: 'ending-loop', setup: `S.set('terminus.arrived'); S.set('terminus.handsIn'); S.set('terminus.firstIn'); S.set('terminus.clockOk'); for (const a of ['a1','a2','a3','a4']) { S.addArchive(a); S.markRead(a) } await g.loadWorld('terminus'); g.mode='play'; L.play(); L.tp(0, 1, 5.2, Math.PI, 0.3); await new Promise(r=>setTimeout(r,400)); L.use('clockHands')`, shots: [3, 8, 14, 20, 25] },
  { name: 'show-rain', setup: `g.showcase('rain')`, shots: [6, 12, 17, 22, 28, 35] },
  { name: 'show-invert', setup: `g.showcase('invert')`, shots: [9, 13, 16, 19, 22, 24] },
  { name: 'show-whale', setup: `g.showcase('whale')`, shots: [12, 15, 17, 19, 21] },
  { name: 'show-freeze', setup: `g.showcase('freeze')`, shots: [2, 5, 8] },
  { name: 'show-reversal', setup: `g.showcase('reversal')`, shots: [6, 14, 22, 30] },
]

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
  })
  for (const job of JOBS) {
    if (only.length && !only.includes(job.name)) continue
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
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()) })
    await page.goto('http://lt.local/index.html?debug&test', { waitUntil: 'load' })
    await page.waitForFunction(() => window.__LT && window.__LT.game.booted, { timeout: 120000 })
    await page.evaluate(`(async () => { const L = window.__LT, g = L.game, S = L.S; ${job.setup} })()`)
    const t0 = Date.now()
    for (const t of job.shots) {
      const wait = t * 1000 - (Date.now() - t0)
      if (wait > 0) await sleep(wait)
      await page.screenshot({ path: path.join(out, `${job.name}-${String(t).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 75 })
    }
    await sleep(2500)
    const state = await page.evaluate(() => ({ screen: window.__LT.ui().screen, ending: window.__LT.ui().ending, world: window.__LT.game.worldId, dir: window.__LT.game.director.active, moments: window.__LT.meta().moments }))
    console.log(job.name.padEnd(18), JSON.stringify(state), errors.length ? 'ERR ' + errors.slice(0, 4).join(' | ') : '')
    await page.close()
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
