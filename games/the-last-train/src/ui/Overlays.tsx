// 对话、阅读、密码锁、收音机、声呐、拍照、结局、片尾字幕
import { useEffect, useRef, useState } from 'react'
import { useUI, setUI } from '../state/ui'
import { game } from '../game/Game'
import { bridges } from '../systems/bridges'
import { ENDINGS } from '../game/types'
import { audio } from '../audio/AudioEngine'

export function DialogueBox() {
  const d = useUI((s) => s.dialogue)
  const [shown, setShown] = useState(0)
  const text = d?.text ?? ''
  useEffect(() => {
    setShown(0)
    if (!text) return
    let i = 0
    const id = setInterval(() => {
      i += 1
      setShown(i)
      if (i >= text.length) clearInterval(id)
    }, 28)
    return () => clearInterval(id)
  }, [text])
  if (!d) return null
  const full = shown >= text.length
  const next = () => {
    if (!full) setShown(text.length)
    else game.advanceDialogue()
  }
  return (
    <div className="dialogue" onClick={() => !d.choices && next()}>
      {d.name && <div className="who">{d.name}</div>}
      <div className={'line' + (d.who === 'narrator' ? ' narr' : '')}>{text.slice(0, shown)}</div>
      {d.choices && full && (
        <div className="choices">
          {d.choices.map((c, i) => (
            <button key={c.id} onClick={(e) => { e.stopPropagation(); game.chooseDialogue(c.id) }}><span>{i + 1}</span>{c.text}</button>
          ))}
        </div>
      )}
      {!d.choices && <div className="cont">{full ? '点击 / E 继续' : ''}</div>}
    </div>
  )
}

export function Reading() {
  const r = useUI((s) => s.reading)
  if (!r) return null
  return (
    <div className="reading" onClick={() => game.closeModals()}>
      <div className={'doc ' + r.kind} onClick={(e) => e.stopPropagation()}>
        {r.kind === 'archive' && <div className="stamp">零号线管理局</div>}
        {r.kind === 'archive' && <div className="no">ANOMALY ARCHIVE</div>}
        <h3>{r.title}</h3>
        {r.sub && <div className="src">{r.sub}</div>}
        {r.body.map((p, i) => <p key={i} style={r.kind !== 'archive' && i === 0 ? { textIndent: 0, fontFamily: 'inherit', fontSize: 15, letterSpacing: 0, color: 'inherit' } : undefined}>{p}</p>)}
      </div>
      <div className="hint2">点击空白处 / E 关闭</div>
    </div>
  )
}

export function Keypad() {
  const k = useUI((s) => s.keypad)
  const [digits, setDigits] = useState<number[]>([])
  const [sel, setSel] = useState(0)
  const [shake, setShake] = useState(false)
  useEffect(() => {
    if (k) {
      setDigits(k.digits)
      setSel(0)
    }
  }, [k?.id])
  useEffect(() => {
    if (!k) return
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        setDigits((d) => d.map((v, i) => (i === sel ? Number(e.key) : v)))
        setSel((s) => Math.min(digits.length - 1, s + 1))
        audio.play('dial')
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') setSel((s) => Math.max(0, s - 1))
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') setSel((s) => Math.min(digits.length - 1, s + 1))
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') roll(sel, 1)
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') roll(sel, -1)
      else if (e.code === 'Enter' || e.code === 'KeyE') submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!k) return null
  function roll(i: number, d: number) {
    setDigits((ds) => ds.map((v, j) => (j === i ? (v + d + 10) % 10 : v)))
    setSel(i)
    audio.play('dial')
  }
  function submit() {
    const ok = game.keypadSubmit(digits)
    if (!ok) {
      setShake(true)
      setTimeout(() => setShake(false), 450)
    }
  }
  return (
    <div className="keypad">
      <div className={'box' + (shake ? ' shake' : '')}>
        <h3>{k.title}</h3>
        <div className="wheels">
          {digits.map((v, i) => (
            <div key={i} className={'wheel' + (i === sel ? ' sel' : '')}>
              <button onClick={() => roll(i, 1)}>▲</button>
              <div className="d" onWheel={(e) => roll(i, e.deltaY < 0 ? 1 : -1)}>{v}</div>
              <button onClick={() => roll(i, -1)}>▼</button>
            </div>
          ))}
        </div>
        <div className="btns">
          <button className="btn" onClick={() => game.closeModals()}>离开</button>
          <button className="btn primary" onClick={submit}>转动把手</button>
        </div>
        <div className="kh">数字键输入 · 方向键 / 滚轮转动 · ENTER 确认 · ESC 离开</div>
      </div>
    </div>
  )
}

export function Radio() {
  const on = useUI((s) => s.radio)
  const [f, setF] = useState(bridges.radio?.freq ?? 94.6)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => tick((x) => x + 1), 200)
    return () => clearInterval(id)
  }, [on])
  if (!on || !bridges.radio) return null
  const b = bridges.radio
  const pos = ((f - 76) / (108 - 76)) * 100
  return (
    <div className="device" onClick={() => game.closeModals()}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3>旧收音机 · FM</h3>
        <div className="sub2">旋钮很涩。拖动滑块调频。</div>
        <div className="scale">
          <div className="ticks">{[76, 80, 84, 88, 92, 96, 100, 104, 108].map((t) => <span key={t}>{t}</span>)}</div>
          <div className="needle" style={{ left: `calc(12px + (100% - 24px) * ${pos / 100})` }} />
        </div>
        <input type="range" min={76} max={108} step={0.1} value={f} onChange={(e) => { const v = Number(e.target.value); setF(v); b.setFreq(v) }} />
        <div className="read">{f.toFixed(1)} MHz · {b.text}</div>
        <div className="btns" style={{ marginTop: 18 }}><button className="btn" onClick={() => game.closeModals()}>关掉</button></div>
      </div>
    </div>
  )
}

export function Sonar() {
  const on = useUI((s) => s.sonar)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => tick((x) => x + 1), 120)
    return () => clearInterval(id)
  }, [on])
  if (!on || !bridges.sonar) return null
  const b = bridges.sonar
  return (
    <div className="device sonar" onClick={() => game.closeModals()}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3>声呐阵列 · SONAR ARRAY</h3>
        <div className="sub2">{b.powered ? '调整三组发射频率，让波形与声碑的回声重合。听：越接近，拍音越慢。' : '没有电。'}</div>
        {[0, 1, 2].map((i) => (
          <div key={i} className={'sonarRow' + (b.solved[i] ? ' ok' : '')}>
            <span>CH-{i + 1}{b.solved[i] ? ' ✓' : ''}</span>
            <Wave value={b.values[i]} target={b.known[i] ? b.targets[i] : null} solved={b.solved[i]} min={b.min} max={b.max} />
            <span className={b.known[i] ? '' : 'lock'}>{b.values[i].toFixed(0)} Hz</span>
            <span />
            <input type="range" min={b.min} max={b.max} step={1} value={b.values[i]} disabled={!b.powered || b.solved[i]} onChange={(e) => b.set(i, Number(e.target.value))} />
            <span className={b.known[i] ? '' : 'lock'}>{b.known[i] ? (b.solved[i] ? '共振' : '目标已知') : '未照亮'}</span>
          </div>
        ))}
        <div className="read sonar">{b.solved.every(Boolean) ? '三座声碑同时共鸣。海底有什么东西打开了。' : '用探照灯照亮声碑，才能看见它的回声波形。'}</div>
        <div className="btns" style={{ marginTop: 14 }}>
          <button className="btn" disabled={!b.powered} onClick={() => b.ping()}>发送脉冲</button>
          <button className="btn" onClick={() => game.closeModals()}>离开</button>
        </div>
      </div>
    </div>
  )
}

function Wave({ value, target, solved, min, max }: { value: number; target: number | null; solved: boolean; min: number; max: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    c.width = c.clientWidth * 2
    c.height = c.clientHeight * 2
    const W = c.width, H = c.height
    g.clearRect(0, 0, W, H)
    const draw = (f: number, color: string, amp: number, phase: number) => {
      g.strokeStyle = color
      g.lineWidth = 3
      g.beginPath()
      const cycles = 1 + ((f - min) / (max - min)) * 9
      for (let x = 0; x <= W; x += 4) {
        const y = H / 2 + Math.sin((x / W) * cycles * Math.PI * 2 + phase) * H * amp
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
    const t = performance.now() / 1000
    if (target !== null) draw(target, 'rgba(255,210,140,0.55)', 0.34, 0)
    draw(value, solved ? '#c8ffe8' : '#4cc9ff', 0.28, target !== null ? (value - target) * t * 0.5 : t)
  })
  return <canvas ref={ref} />
}

export function PhotoPanel() {
  const on = useUI((s) => s.photo)
  const [, tick] = useState(0)
  if (!on) return null
  const p = game.photo
  const upd = () => tick((x) => x + 1)
  return (
    <>
      <div className="grid3" />
      <div className="photo">
        <h3>拍照模式 · PHOTO</h3>
        <div className="set"><label>视野</label><input type="range" min={20} max={100} value={p.fov} onChange={(e) => { p.fov = Number(e.target.value); upd() }} /><output>{p.fov.toFixed(0)}°</output></div>
        <div className="set"><label>曝光</label><input type="range" min={-2} max={2} step={0.1} value={p.exposure} onChange={(e) => { p.exposure = Number(e.target.value); upd() }} /><output>{p.exposure.toFixed(1)}</output></div>
        <div className="set"><label>倾斜</label><input type="range" min={-0.6} max={0.6} step={0.01} value={p.roll} onChange={(e) => { p.roll = Number(e.target.value); upd() }} /><output>{(p.roll * 57.3).toFixed(0)}°</output></div>
        <div className="set"><label>黑边</label><div className="seg"><button className={p.letterbox ? 'on' : ''} onClick={() => { p.letterbox = true; upd() }}>开</button><button className={!p.letterbox ? 'on' : ''} onClick={() => { p.letterbox = false; upd() }}>关</button></div><output /></div>
        <div className="btns" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => game.setPhoto(false)}>退出</button>
          <button className="btn primary" onClick={() => void game.takePhoto()}>拍摄 PNG</button>
        </div>
        <div className="hk">WASD / Q E 移动镜头 · 鼠标转向（需锁定指针：点击画面）<br />[ ] 倾斜 · ENTER 拍摄 · P / ESC 退出<br />时间已暂停，镜头不能穿墙</div>
      </div>
    </>
  )
}

export function Ending() {
  const e = useUI((s) => s.ending)
  const lines = useUI((s) => s.endingLines)
  if (!e) return null
  const d = ENDINGS[e]
  return (
    <div className="ending">
      <div className="k1">ENDING</div>
      <h1>{d.name}</h1>
      <div className="en">{d.en}</div>
      {lines.map((l, i) => <p key={i} style={{ animationDelay: `${1.6 + i * 1.3}s` }}>{l}</p>)}
      <div className="btns">
        <button className="btn primary" onClick={() => { setUI({ ending: null }); void game.afterEnding() }}>继续</button>
      </div>
    </div>
  )
}

export function CreditsRoll() {
  const on = useUI((s) => s.screen === 'credits')
  useEffect(() => {
    if (!on) return
    const id = setTimeout(() => void game.toMenu(), 44000)
    return () => clearTimeout(id)
  }, [on])
  if (!on) return null
  return (
    <div className="creditsRoll">
      <div className="inner">
        <h1>THE LAST TRAIN</h1>
        <p>永不抵达的末班列车</p>
        <h3>故事 · 关卡 · 程序</h3><p>AIDIY 工作室（与 Claude 一起完成）</p>
        <h3>世界</h3><p>午夜车站 · 倒悬都市 · 深海终点站<br />时间沙漠 · 记忆博物馆 · 不存在的终点</p>
        <h3>声音</h3><p>全部由 Web Audio 实时合成</p>
        <h3>画面</h3><p>three.js 实时渲染 · 程序化模型与纹理</p>
        <h3>感谢游玩</h3><p>结局还有其他的。列车会等你。</p>
      </div>
      <button className="btn skipc" onClick={() => void game.toMenu()}>回到主菜单</button>
    </div>
  )
}

export function Loading() {
  const s = useUI((st) => st.screen)
  const t = useUI((st) => st.loadingText)
  if (s !== 'loading') return null
  return (
    <div className="loading">
      <div className="n">{t}</div>
      <div className="bar" />
    </div>
  )
}
