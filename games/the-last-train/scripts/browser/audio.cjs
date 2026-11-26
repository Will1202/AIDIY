// 声音冒烟测试：在真实 Chrome 里启动 AudioContext，逐个触发全部音效、环境声、配乐、列车声与持续音，收集异常。
// 需要本机安装 Chrome（或用 CHROME_PATH 指定），命令见 package.json 的 bench / e2e 脚本。
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')
const dist = process.argv[2]
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' }
;(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11'] })
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
  await page.goto('http://lt.local/index.html?debug&test')
  await page.waitForFunction(() => window.__LT && window.__LT.game.booted, { timeout: 120000 })
  const r = await page.evaluate(async () => {
    const a = window.__LT.game.audio
    await a.start()
    const names = ['pickup', 'objective', 'success', 'deny', 'click', 'hover', 'open', 'close', 'inspect', 'doorOpen', 'doorClose', 'horn', 'thunder', 'thunderNear', 'lever', 'servo', 'heavy', 'powerUp', 'gravity', 'ping', 'bubbles', 'timeStop', 'timeResume', 'tick', 'chime', 'locker', 'dial', 'punch', 'glass', 'whale', 'insert', 'paper', 'bell', 'clockStrike']
    const failed = []
    for (const n of names) {
      try { a.play(n, { x: 3, y: 1, z: 2 }); a.play(n) } catch (e) { failed.push(n + ': ' + e) }
    }
    for (const s of ['concrete', 'metal', 'wood', 'wet', 'glass', 'sand', 'marble', 'carpet', 'stone', 'grate']) { try { a.step(s, 1) } catch (e) { failed.push('step ' + s + ': ' + e) } }
    for (const w of ['menu', 'station', 'city', 'abyss', 'desert', 'museum', 'terminus', 'transit', 'none']) { try { a.setScore(w) } catch (e) { failed.push('score ' + w + ': ' + e) } }
    try {
      a.setRain(1, 0.3); a.setWind(0.5, 0.5); a.setSea(0.8); a.setOpenness(0.6)
      for (let i = 0; i < 120; i++) { a.setTrain(i * 0.3, i % 2 === 0, i > 60); a.update(1 / 60) }
      const t = a.toneLoop(311, { x: 1, y: 1, z: 1 }); t?.freq?.(320); t?.gain(0.02); t?.stop()
      const n = a.noiseLoop('pink', 'bandpass', 400, 1, 0.1); n?.freq?.(800); n?.stop()
      a.murmur(2, { x: 0, y: 2, z: 0 })
      a.setVolumes({ master: 0.5, music: 0.5, ambience: 0.5, sfx: 0.5, muted: true })
    } catch (e) { failed.push('misc: ' + e) }
    // 等前面一连串音效（含混响尾巴）完全消失再测电平
    await new Promise((r) => setTimeout(r, 7000))
    // 电平：在主输出上挂分析器，分别测雨声环境、汽笛、拾取音、雷声的峰值与 RMS
    a.setVolumes({ master: 0.85, music: 0.7, ambience: 0.8, sfx: 0.85, muted: false })
    const an = a.ctx.createAnalyser(); an.fftSize = 2048
    a['master'].connect(an)
    const buf = new Float32Array(2048)
    const measure = async (ms) => { let peak = 0, sum = 0, n = 0; const end = performance.now() + ms; while (performance.now() < end) { an.getFloatTimeDomainData(buf); for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++ } await new Promise((r) => setTimeout(r, 40)) } return { peakDb: +(20 * Math.log10(peak + 1e-9)).toFixed(1), rmsDb: +(10 * Math.log10(sum / n + 1e-12)).toFixed(1) } }
    a.setScore('none'); a.setTrain(0, false, false)
    a.setRain(1, 0); a.setWind(0.35, 0.3)
    const levels = {}
    const tick = setInterval(() => a.update(0.04), 40)
    levels.rain = await measure(1500)
    a.setScore('station'); await new Promise((r) => setTimeout(r, 2500)); levels.rainScore = await measure(1500)
    a.play('horn'); levels.horn = await measure(1500)
    a.play('pickup'); levels.pickup = await measure(800)
    a.play('thunderNear'); levels.thunder = await measure(2000)
    a.setRain(0); a.setWind(0); a.setTrain(30, true, false); levels.trainInside = await measure(2000)
    clearInterval(tick)
    return { state: a.ctx && a.ctx.state, rate: a.ctx && a.ctx.sampleRate, failed, levels }
  })
  console.log(JSON.stringify(r), 'pageErrors:', JSON.stringify(errors.slice(0, 8)))
  await browser.close()
})()
