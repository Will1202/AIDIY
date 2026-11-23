// 暂停菜单：继续 / 任务日志 / 背包 / 档案 / 收藏 / 世界地图 / 设置 / 重新开始本章 / 返回主菜单
import { useEffect, useState } from 'react'
import { useUI, setUI, type PauseTab } from '../state/ui'
import { useGameData, gameStore } from '../state/store'
import { game } from '../game/Game'
import { QUESTS, currentStep, HINT_UNLOCK } from '../content/quests'
import { ITEMS } from '../content/items'
import { ARCHIVES, LOST_TICKETS } from '../content/archives'
import { WORLDS, WORLD_ORDER } from '../game/types'
import { SettingsPanel } from './Settings'
import { ItemViewer } from './ItemViewer'
import { audio } from '../audio/AudioEngine'

const TABS: { id: PauseTab; name: string }[] = [
  { id: 'journal', name: '任务日志' },
  { id: 'inventory', name: '背包' },
  { id: 'archives', name: '档案' },
  { id: 'collect', name: '收藏' },
  { id: 'map', name: '世界地图' },
  { id: 'settings', name: '设置' },
]

export function Pause() {
  const tab = useUI((s) => s.pauseTab)
  const world = useUI((s) => s.world)
  const playTime = useGameData((s) => s.playTime)
  const [confirm, setConfirm] = useState<null | 'restart' | 'menu'>(null)
  const m = WORLDS[world]
  return (
    <div className="pause" style={{ ['--accent' as string]: m.accent }}>
      <aside>
        <div className="wn">{String(m.index).padStart(2, '0')} · {m.name}</div>
        <div className="we">{m.en}</div>
        <button className="mi" onClick={() => game.pause(false)}>继续游戏</button>
        {TABS.map((t) => (
          <button key={t.id} className={'mi' + (tab === t.id ? ' on' : '')} onClick={() => { audio.play('click'); setUI({ pauseTab: t.id }) }}>{t.name}</button>
        ))}
        <div className="sp" />
        <button className="mi" onClick={() => setConfirm('restart')}>重新开始本章</button>
        <button className="mi" onClick={() => setConfirm('menu')}>返回主菜单</button>
        <div className="pt">游玩时间 {fmtTime(playTime)} · 已自动存档</div>
      </aside>
      <main>
        {tab === 'journal' && <Journal />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'archives' && <Archives />}
        {tab === 'collect' && <Collection />}
        {tab === 'map' && <MapView />}
        {tab === 'settings' && (<><h2>设置</h2><SettingsPanel /></>)}
      </main>
      {confirm && (
        <div className="confirm">
          <div className="box">
            <p>{confirm === 'restart' ? '回到本章开始时（列车刚到站）的状态？本章内的进度会丢失。' : '返回主菜单？进度已经自动保存。'}</p>
            <div className="btns">
              <button className="btn" onClick={() => setConfirm(null)}>取消</button>
              <button className="btn primary" onClick={() => {
                setConfirm(null)
                game.paused = false
                if (confirm === 'restart') game.restartChapter()
                else void game.toMenu()
              }}>{confirm === 'restart' ? '重新开始' : '返回'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function Journal() {
  useGameData((s) => s.flags)
  useGameData((s) => s.inventory)
  const stepTime = useGameData((s) => s.stepTime)
  const [open, setOpen] = useState<string | null>(null)
  const quests = QUESTS.filter((q) => q.visible())
  const mains = quests.filter((q) => q.kind === 'main').reverse()
  const sides = quests.filter((q) => q.kind === 'side')
  return (
    <div>
      <h2>任务日志</h2>
      {mains.map((q) => {
        const cur = currentStep(q)
        return (
          <div className="quest" key={q.id}>
            <div className="qt">{q.title}<small>{q.world ? WORLDS[q.world].en : ''}</small>{!cur && <span className="pg">已完成</span>}</div>
            <ol>
              {q.steps.map((s) => {
                const done = s.done()
                const isCur = cur?.id === s.id
                if (!done && !isCur) return null
                const t = stepTime[s.id] ?? 0
                return (
                  <li key={s.id} className={done ? 'done' : 'cur'}>
                    {s.text}
                    {isCur && s.hints.length > 0 && (
                      <div className="hints">
                        {open === s.id ? (
                          s.hints.map((h, i) => (t >= HINT_UNLOCK[i] ? <p key={i}>{h}</p> : <p key={i} className="lock">提示 {i + 1} 会在约 {Math.ceil((HINT_UNLOCK[i] - t) / 60)} 分钟后解锁</p>))
                        ) : (
                          <button className="btn" style={{ marginTop: 8, fontSize: 12, padding: '6px 14px' }} onClick={() => { setOpen(s.id); gameStore.setState({ hintsUsed: gameStore.getState().hintsUsed + 1 }) }}>查看提示</button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        )
      })}
      {sides.length > 0 && <div className="kicker" style={{ margin: '34px 0 4px' }}>支线与秘密</div>}
      {sides.map((q) => {
        const cur = currentStep(q)
        return (
          <div className="quest side" key={q.id}>
            <div className="qt">{q.title}{q.progress && <span className="pg">{q.progress()}</span>}{!cur && !q.progress && <span className="pg">已完成</span>}</div>
            <ol><li className={cur ? 'cur' : 'done'}>{q.steps[0].text}</li></ol>
          </div>
        )
      })}
    </div>
  )
}

function Inventory() {
  const inv = useGameData((s) => s.inventory)
  useGameData((s) => s.flags)
  const [sel, setSel] = useState<string | null>(inv[0] ?? null)
  const [combine, setCombine] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (sel && !inv.includes(sel)) setSel(inv[0] ?? null)
  }, [inv, sel])
  const pick = (id: string) => {
    audio.play('click')
    if (combine && combine !== id) {
      const r = game.combine(combine, id)
      setMsg(r ?? '这两样东西组合不到一起。')
      setCombine(null)
      return
    }
    setSel(id)
    setMsg(null)
  }
  const def = sel ? ITEMS[sel] : null
  const slots = [...inv, ...new Array(Math.max(0, 12 - inv.length)).fill('')]
  return (
    <div>
      <h2>背包</h2>
      <div className="inv">
        <div className="grid">
          {slots.map((id, i) => id ? (
            <button key={id} className={'slot' + (sel === id ? ' on' : '') + (combine === id ? ' sel2' : '')} onClick={() => pick(id)}>
              <span className="sw" style={{ background: ITEMS[id]?.color, color: ITEMS[id]?.color }} />
              {ITEMS[id]?.name ?? id}
            </button>
          ) : <div key={'e' + i} className="slot empty" />)}
        </div>
        <div className="viewer">
          {def ? (
            <>
              <ItemViewer id={def.id} />
              <div className="info">
                <h3>{def.name}</h3>
                <p>{def.desc()}</p>
                <div className="acts">
                  <button className="btn" onClick={() => { setCombine(def.id); setMsg('选择另一件物品与它组合。') }}>{combine === def.id ? '选择另一件物品…' : '组合'}</button>
                </div>
                {msg && <div className="msg">{msg}</div>}
              </div>
            </>
          ) : (
            <div className="info"><p>背包是空的。</p></div>
          )}
        </div>
      </div>
    </div>
  )
}

function Archives() {
  const got = useGameData((s) => s.archives)
  const ids = Object.keys(ARCHIVES)
  const [sel, setSel] = useState<string | null>(got[got.length - 1] ?? null)
  const a = sel ? ARCHIVES[sel] : null
  return (
    <div>
      <h2>异常档案</h2>
      <div className="arch">
        <div className="list">
          {ids.map((id) => got.includes(id) ? (
            <button key={id} className={sel === id ? 'on' : ''} onClick={() => setSel(id)}><small>{ARCHIVES[id].no}</small>{ARCHIVES[id].title}</button>
          ) : (
            <button key={id} className="lock"><small>{ARCHIVES[id].no}</small>— 未发现 —</button>
          ))}
        </div>
        {a ? (
          <div className="doc">
            <div className="stamp">零号线管理局</div>
            <div className="no">ANOMALY ARCHIVE {a.no}</div>
            <h3>{a.title}</h3>
            <div className="src">{a.world}</div>
            {a.body.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        ) : <p style={{ color: 'var(--ivory-faint)' }}>还没有发现任何档案。</p>}
      </div>
    </div>
  )
}

function Collection() {
  const got = useGameData((s) => s.collectibles)
  return (
    <div>
      <h2>失落的车票 · {got.length} / {Object.keys(LOST_TICKETS).length}</h2>
      <div className="coll">
        {Object.values(LOST_TICKETS).map((t) => got.includes(t.id) ? (
          <div className="c" key={t.id}><div className="n">{t.night} · {t.world}</div><p>{t.note}</p></div>
        ) : (
          <div className="c lock" key={t.id}><div className="n">？？？ · {t.world}</div><p>还没有找到。</p></div>
        ))}
      </div>
    </div>
  )
}

function MapView() {
  const visited = useGameData((s) => s.visited)
  const world = useUI((s) => s.world)
  useGameData((s) => s.flags)
  const placed = ['fragment_city', 'fragment_abyss', 'fragment_desert', 'fragment_museum'].filter((f) => gameStore.getState().flags[`console.${f}`]).length
  const R = 210
  const pts = WORLD_ORDER.map((w, i) => {
    const a = -Math.PI / 2 + (i / WORLD_ORDER.length) * Math.PI * 2
    return { w, x: 300 + Math.cos(a) * R, y: 260 + Math.sin(a) * R }
  })
  const ringClosed = placed >= 4
  return (
    <div className="mapv">
      <h2>零号线 · 线路图</h2>
      <svg viewBox="0 0 600 520">
        <circle cx={300} cy={260} r={R} fill="none" stroke="rgba(239,232,216,0.14)" strokeWidth={1} strokeDasharray={ringClosed ? '0' : '4 6'} />
        {pts.map((p, i) => {
          const nx = pts[(i + 1) % pts.length]
          const lit = visited.includes(p.w) && visited.includes(nx.w)
          return lit ? <line key={'l' + i} x1={p.x} y1={p.y} x2={nx.x} y2={nx.y} stroke={WORLDS[p.w].accent} strokeOpacity={0.5} strokeWidth={1.5} /> : null
        })}
        {pts.map((p) => {
          const v = visited.includes(p.w)
          const here = p.w === world
          return (
            <g key={p.w}>
              {here && <circle cx={p.x} cy={p.y} r={18} fill="none" stroke={WORLDS[p.w].accent} strokeOpacity={0.6}><animate attributeName="r" values="12;22;12" dur="2.4s" repeatCount="indefinite" /></circle>}
              <circle cx={p.x} cy={p.y} r={v ? 7 : 4} fill={v ? WORLDS[p.w].accent : 'rgba(239,232,216,0.25)'} />
              <text x={p.x} y={p.y + (p.y > 260 ? 34 : -20)} textAnchor="middle" fill={v ? '#efe8d8' : 'rgba(239,232,216,0.35)'} fontSize={15} letterSpacing={3}>{v ? WORLDS[p.w].name : '？？？'}</text>
            </g>
          )
        })}
        <text x={300} y={262} textAnchor="middle" fill="rgba(239,232,216,0.45)" fontSize={11} letterSpacing={4} fontFamily="monospace">{ringClosed ? '终点即起点' : `碎片 ${placed} / 4`}</text>
      </svg>
      <div className="legend">
        {WORLD_ORDER.map((w) => (
          <div key={w} className={visited.includes(w) ? 'v' : ''}><b>{WORLDS[w].index}</b>{visited.includes(w) ? `${WORLDS[w].name} — ${WORLDS[w].blurb}` : '尚未抵达'}</div>
        ))}
      </div>
    </div>
  )
}
