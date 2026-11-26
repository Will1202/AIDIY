// 集成测试：在真实 GPU 浏览器里把整条旅程串起来——新游戏 → 车站 → 五次真实行驶（控制台放碎片、选路线、拉杆、出站、隧道、驶入、停靠）
// 需要本机安装 Chrome（或用 CHROME_PATH 指定），命令见 package.json 的 bench / e2e 脚本。
// → 终点结局 → 刷新页面后存档恢复。谜题本身由 Node 测试覆盖，这里检查各系统衔接。
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')
const dist = process.argv[2]
const out = process.argv[3]
fs.mkdirSync(out, { recursive: true })
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' }

;(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 }, userDataDir: path.join(out, 'profile') })
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
  const boot = async () => {
    await page.goto('http://lt.local/index.html?debug&test')
    await page.waitForFunction(() => window.__LT && window.__LT.game.booted, { timeout: 120000 })
  }
  const step = (fn, arg) => page.evaluate(fn, arg)
  const log = (...a) => console.log(...a)
  await boot()
  // ---------- 新游戏 + 开场 ----------
  await step(async () => {
    const L = window.__LT, g = L.game
    g.manualClock = true
    const p = g.newGame()
    for (let i = 0; i < 400 && !g.director.active; i++) { g.frame(1 / 30); await new Promise((r) => setTimeout(r, 5)) }
    L.skip()
    await new Promise((r) => setTimeout(r, 50))
    void p
  })
  // ---------- 车站 ----------
  const st = await step(async () => {
    const L = window.__LT, g = L.game
    L.play()
    L.tp(-5.6, 1, 5.9, 0, -0.3); L.frames(2); L.use('ticket')
    L.use('locker'); g.keypadSubmit([2, 3, 5, 9]); L.frames(10)
    L.use('punch'); g.combine('ticket', 'punch')
    L.tp(5.4, 1, 3.4, -Math.PI / 2, 0); L.frames(2); L.use('conductor')
    for (let i = 0; i < 12; i++) { const v = L.ui().dialogue; if (!v) break; if (v.choices) g.chooseDialogue(v.choices[0].id); else g.advanceDialogue() }
    L.tp(5.5, 1, 0.2, 0, 0)
    for (let i = 0; i < 120; i++) g.frame(1 / 30)
    await new Promise((r) => setTimeout(r, 3000))
    return { flags: Object.keys(L.state().flags).length, phase: g.phase, boardOk: L.S.is('station.boardOk') }
  })
  log('station', JSON.stringify(st))
  // 行驶直到停靠
  const ride = async (label) => {
    const r = await step(async () => {
      const L = window.__LT, g = L.game
      let n = 0
      while (n < 6000) {
        g.frame(1 / 30)
        n++
        if (n % 60 === 0) await new Promise((r) => setTimeout(r, 15))
        if (g.phase === 'docked' && n > 60) break
      }
      for (let i = 0; i < 60; i++) g.frame(1 / 30)
      return { world: g.worldId, phase: g.phase, n, roots: g.scene.children.filter((c) => c.name.startsWith('world:')).map((c) => c.name), cond: g.conductor.group.parent?.name, visited: L.state().visited }
    })
    log(label, JSON.stringify(r))
    await page.screenshot({ path: path.join(out, `${label}.jpg`), type: 'jpeg', quality: 70 })
    return r
  }
  await ride('arrive-city')
  // ---------- 每个世界：拿到碎片（谜题由 Node 测试覆盖），回车厢用控制台去下一站 ----------
  const legs = [['fragment_city', 'abyss'], ['fragment_abyss', 'desert'], ['fragment_desert', 'museum'], ['fragment_museum', 'terminus']]
  for (const [frag, next] of legs) {
    const r = await step(async ([frag, next]) => {
      const L = window.__LT, g = L.game
      L.S.give(frag)
      if (frag === 'fragment_desert') L.S.give('hands')
      if (frag === 'fragment_museum') { L.S.give('first_ticket'); L.S.set('museum.mirror') }
      g.player.setGravity(1)
      L.tp(8.6, 1, 0.3, -Math.PI / 2, 0)
      L.frames(3)
      const placeRes = L.use('console.place')
      // 转旋钮直到选中下一站
      let k = 0
      while (L.S.flag('route') !== next && k < 8) { L.use('console.place'); k++ }
      const lever = L.use('console.lever')
      return { placeRes, route: L.S.flag('route'), lever, phase: g.phase, slots: ['fragment_city', 'fragment_abyss', 'fragment_desert', 'fragment_museum'].filter((f) => L.S.is('console.' + f)).length }
    }, [frag, next])
    log('depart->' + next, JSON.stringify(r))
    await ride('arrive-' + next)
  }
  // ---------- 终点：对话 → 结局（离开列车） ----------
  const end = await step(async () => {
    const L = window.__LT, g = L.game
    L.tp(5.5, 1, 3.0, 0, 0); L.frames(20)
    L.tp(2.0, 1, 4.6, -Math.PI / 2, 0); L.frames(3)
    const talk = L.use('conductor')
    let chose = false
    for (let i = 0; i < 20; i++) {
      const v = L.ui().dialogue
      if (!v) break
      if (v.choices) { const c = v.choices.find((x) => x.id === 'leave'); g.chooseDialogue(c ? c.id : v.choices[0].id); chose = !!c } else g.advanceDialogue()
    }
    L.tp(34.4, 1, 5.6, -Math.PI / 2, 0); L.frames(3)
    const gate = L.use('gate')
    for (let i = 0; i < 900 && L.ui().screen !== 'ending'; i++) { g.frame(1 / 30); if (i % 60 === 0) await new Promise((r) => setTimeout(r, 10)) }
    return { talk, chose, gate, screen: L.ui().screen, ending: L.ui().ending, endings: L.meta().endings }
  })
  log('ending', JSON.stringify(end))
  await page.screenshot({ path: path.join(out, 'ending.jpg'), type: 'jpeg', quality: 70 })
  await step(async () => { await window.__LT.game.afterEnding(); await window.__LT.game.toMenu() })
  // ---------- 刷新：存档是否恢复 ----------
  await boot()
  const after = await step(async () => {
    const L = window.__LT, g = L.game
    const hasSave = L.ui().hasSave
    await g.continueGame()
    return { hasSave, world: g.worldId, endings: L.meta().endings, chapters: L.meta().chapters, inv: L.state().inventory, frags: ['fragment_city', 'fragment_abyss', 'fragment_desert', 'fragment_museum'].filter((f) => L.S.is('console.' + f)).length }
  })
  log('reload', JSON.stringify(after))
  log('errors', JSON.stringify(errors.slice(0, 10)))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
