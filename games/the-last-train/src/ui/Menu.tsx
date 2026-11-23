// 主菜单：背景是实时渲染的午夜车站。
import { useState } from 'react'
import { useUI, setUI } from '../state/ui'
import { useMeta } from '../state/store'
import { game } from '../game/Game'
import { WORLDS, WORLD_ORDER, ENDINGS, MOMENTS, type MomentId, type EndingId } from '../game/types'
import { SettingsPanel } from './Settings'
import { audio } from '../audio/AudioEngine'

const click = () => audio.play('click')

export function Menu() {
  const hasSave = useUI((s) => s.hasSave)
  const panel = useUI((s) => s.menuPanel)
  const [busy, setBusy] = useState(false)
  const go = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="menu live">
      <div className="title">
        <div className="en"><span>Midnight · Platform 0</span>THE LAST TRAIN</div>
        <div className="cn">永不抵达的末班列车</div>
      </div>
      <nav>
        <button className="mi" onClick={() => { click(); if (hasSave) setUI({ menuPanel: 'confirmNew' }); else void go(() => game.newGame()) }}>开始旅程 <small>NEW JOURNEY</small></button>
        <button className="mi" disabled={!hasSave} onClick={() => { click(); void go(() => game.continueGame()) }}>继续游戏 <small>CONTINUE</small></button>
        <button className="mi" onClick={() => { click(); setUI({ menuPanel: 'chapters' }) }}>章节记录 <small>CHAPTERS</small></button>
        <button className="mi" onClick={() => { click(); setUI({ menuPanel: 'showcase' }) }}>展映模式 <small>SHOWCASE</small></button>
        <button className="mi" onClick={() => { click(); setUI({ menuPanel: 'settings' }) }}>设置 <small>SETTINGS</small></button>
        <button className="mi" onClick={() => { click(); setUI({ menuPanel: 'credits' }) }}>制作信息 <small>CREDITS</small></button>
      </nav>
      <div className="foot">
        AIDIY · WORK 08<br />
        一切画面、模型与声音均为实时程序生成<br />
        建议佩戴耳机 · 鼠标键盘 / 触屏
      </div>
      {panel === 'chapters' && <Chapters onGo={(w) => void go(() => game.loadChapter(w))} />}
      {panel === 'showcase' && <Showcase onGo={(m) => void go(() => game.showcase(m))} />}
      {panel === 'settings' && (
        <div className="panel">
          <button className="close" onClick={() => setUI({ menuPanel: null })}>关闭 ESC</button>
          <div className="kicker">Settings</div>
          <h2>设置</h2>
          <SettingsPanel />
          <div style={{ marginTop: 34 }}>
            <button className="btn danger" onClick={() => setUI({ menuPanel: 'confirmReset' })}>重置全部存档</button>
          </div>
        </div>
      )}
      {panel === 'credits' && <Credits />}
      {panel === 'confirmNew' && (
        <Confirm text="开始新的旅程会覆盖当前进度（章节记录、结局与展映解锁会保留）。确定吗？" ok="开始新旅程" onOk={() => { setUI({ menuPanel: null }); void go(() => game.newGame()) }} />
      )}
      {panel === 'confirmReset' && (
        <Confirm text="这会清除所有存档、章节记录、已达成的结局和展映解锁，无法恢复。确定吗？" ok="全部清除" danger onOk={() => void game.resetAll()} />
      )}
    </div>
  )
}

function Confirm({ text, ok, onOk, danger }: { text: string; ok: string; onOk: () => void; danger?: boolean }) {
  return (
    <div className="confirm">
      <div className="box">
        <p>{text}</p>
        <div className="btns">
          <button className="btn" onClick={() => setUI({ menuPanel: null })}>取消</button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={onOk}>{ok}</button>
        </div>
      </div>
    </div>
  )
}

function Chapters({ onGo }: { onGo: (w: (typeof WORLD_ORDER)[number]) => void }) {
  const chapters = useMeta((m) => m.chapters)
  const cps = useMeta((m) => m.checkpoints)
  const endings = useMeta((m) => m.endings)
  return (
    <div className="panel">
      <button className="close" onClick={() => setUI({ menuPanel: null })}>关闭 ESC</button>
      <div className="kicker">Chapters</div>
      <h2>章节记录</h2>
      {WORLD_ORDER.map((w) => {
        const m = WORLDS[w]
        const ok = chapters.includes(w) && !!cps[w]
        return (
          <button key={w} className="chapter" disabled={!ok} onClick={() => onGo(w)}>
            <span className="no">{String(m.index).padStart(2, '0')}</span>
            <span className="nm">{ok || chapters.includes(w) ? m.name : '？？？'}<small>{ok || chapters.includes(w) ? m.en : 'not yet reached'}</small></span>
            <span className="go">{ok ? '从章节开头开始' : ''}</span>
          </button>
        )
      })}
      <div className="kicker" style={{ marginTop: 34 }}>Endings · {endings.length} / 3</div>
      <div className="badges">
        {(Object.keys(ENDINGS) as EndingId[]).map((e) => (
          <span key={e} className={'badge' + (endings.includes(e) ? ' on' : '')}>{endings.includes(e) ? ENDINGS[e].name : '未达成'}</span>
        ))}
      </div>
      <p style={{ color: 'var(--ivory-faint)', fontSize: 13, lineHeight: 1.9 }}>从章节开头开始会以该章节到达时的存档覆盖当前进度。</p>
    </div>
  )
}

function Showcase({ onGo }: { onGo: (m: MomentId) => void }) {
  const seen = useMeta((m) => m.moments)
  return (
    <div className="panel">
      <button className="close" onClick={() => setUI({ menuPanel: null })}>关闭 ESC</button>
      <div className="kicker">Showcase · for recording</div>
      <h2>展映模式</h2>
      <p style={{ color: 'var(--ivory-faint)', fontSize: 13, lineHeight: 1.9, marginTop: -10 }}>回放已经在游戏里亲眼见过的标志性时刻。全部由实时 3D 场景与游戏事件驱动，不是视频。回放不会改动你的存档。</p>
      {(Object.keys(MOMENTS) as MomentId[]).map((id, i) => {
        const m = MOMENTS[id]
        const ok = seen.includes(id)
        return (
          <button key={id} className="chapter" disabled={!ok} onClick={() => onGo(id)}>
            <span className="no">{i + 1}</span>
            <span className="nm">{ok ? m.name : '尚未见到'}<small>{ok ? `${m.en} · ${m.desc}` : `在「${WORLDS[m.world].name}」里解锁`}</small></span>
            <span className="go">{ok ? '播放' : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

function Credits() {
  return (
    <div className="panel credits">
      <button className="close" onClick={() => setUI({ menuPanel: null })}>关闭 ESC</button>
      <div className="kicker">Credits</div>
      <h2>制作信息</h2>
      <p>THE LAST TRAIN — 永不抵达的末班列车<br />一个在浏览器里运行的第一人称探索解谜游戏。</p>
      <h3>原创内容</h3>
      <p>世界观、剧情、对白、档案文字、关卡与谜题均为原创。<br />全部模型、纹理（Canvas / 程序化噪声）与声音（Web Audio 实时合成）都在运行时生成，项目中不包含任何外部美术或音频素材。</p>
      <h3>技术</h3>
      <p>three.js（MIT）· React（MIT）· Zustand（MIT）· Vite（MIT）<br />字体：Cormorant Garamond（SIL OFL 1.1）· Geist Mono（SIL OFL 1.1）<br />中文使用系统自带字体。</p>
      <h3>致敬</h3>
      <p>所有在午夜站台上等过车的人。</p>
    </div>
  )
}
