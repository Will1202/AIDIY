import { useEffect, useRef } from 'react'
import { CREATION_MODES, GRAVITY_MODES, type GravityMode } from '../core/config'
import { getEngine } from '../engine/instance'
import { QUALITY_LEVELS } from '../engine/Quality'
import { useUI, type FrameMode } from '../state/store'
import { Calibration } from './Calibration'

const pct = (v: number) => `${Math.round(v * 100)}%`

function Meter({ v }: { v: number }) {
  return (
    <span className="meter">
      <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, v))})` }} />
    </span>
  )
}

function Status() {
  const s = useUI()
  const cam = s.camera === 'RUNNING'
  const headLabel =
    s.headSource === 'CAMERA' ? (s.calibrating ? 'CALIBRATING' : 'LOCKED') : s.headSource === 'SIMULATED' ? 'SIMULATED · MOUSE / KEYS' : s.headSource === 'DEMO' ? 'SIMULATED · DEMO' : cam ? (s.faces ? 'ACQUIRING' : 'NO FACE — REST VIEW') : 'OFF · REST VIEW'
  return (
    <div className="status">
      <div className="row">
        <b>HAND TRACKING</b>
        <span className={cam && s.hands ? 'ok' : ''}>{cam ? `${s.hands} HAND${s.hands === 1 ? '' : 'S'}` : 'OFF · MOUSE'}</span>
        {cam && <Meter v={s.handConf} />}
      </div>
      <div className="row">
        <b>HEAD TRACKING</b>
        <span className={s.headSource === 'CAMERA' ? 'ok' : ''}>{headLabel}</span>
        {cam && <Meter v={s.headConf} />}
      </div>
      <div className="row">
        <b>PHYSICS ENGINE</b>
        <span>
          RAPIER · {s.bodies} BODIES · {s.physMs.toFixed(1)} MS
        </span>
      </div>
      <div className="row dim">
        <b>RENDER</b>
        <span>
          {s.fps} FPS · {s.quality}
          {s.renderScale < 1 ? ` · ${Math.round(s.renderScale * 100)}% RES` : ''}
          {cam ? ` · VISION ${s.inferFps} FPS ${s.inferMs} MS` : ''}
        </span>
      </div>
      <div className="row dim">
        <b>EYE</b>
        <span>
          X {s.eyeCm[0].toFixed(1)} · Y {s.eyeCm[1].toFixed(1)} · Z {s.eyeCm[2].toFixed(1)} CM
        </span>
      </div>
      {s.gripStates.length > 0 && (
        <div className="row dim">
          <b>GESTURE</b>
          <span>{s.gripStates.join(' · ')}</span>
        </div>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group">
      <div className="group-label">{label}</div>
      <div className="group-body">{children}</div>
    </div>
  )
}

function Rail() {
  const s = useUI()
  const e = getEngine()
  if (!e) return null
  const cam = s.camera
  const camBusy = cam === 'REQUESTING' || cam === 'LOADING MODELS'
  const gravityLabel = (g: GravityMode) => (g === 'SIDEWAYS' && s.gravity === 'SIDEWAYS' ? (s.sideways > 0 ? 'SIDE →' : '← SIDE') : g === 'SIDEWAYS' ? 'SIDEWAYS' : g)
  return (
    <div className="rail">
      <Group label="OBJECT MODE">
        {CREATION_MODES.map((m, i) => (
          <button key={m.id} className={`chip ${s.mode === m.id ? 'on' : ''}`} onClick={() => e.setMode(m.id)} title={`Key ${i + 1}`}>
            {m.label}
          </button>
        ))}
        <button className="chip act" onClick={() => e.createAtPointer()} title="Key C · or pinch empty space with both hands">
          + CREATE
        </button>
      </Group>
      <Group label="GRAVITY">
        {GRAVITY_MODES.map((g) => (
          <button key={g} className={`chip ${s.gravity === g ? 'on' : ''}`} onClick={() => e.setGravity(g)} title="Key G cycles">
            {gravityLabel(g)}
          </button>
        ))}
      </Group>
      <Group label="QUALITY">
        <div className="seg">
          {QUALITY_LEVELS.map((q) => (
            <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => e.setQuality(q)}>
              {q === 'MEDIUM' ? 'MED' : q}
            </button>
          ))}
        </div>
      </Group>
      <Group label="CAMERA">
        {cam === 'RUNNING' ? (
          <button className="chip on" onClick={() => e.stopCamera()}>
            STOP CAMERA
          </button>
        ) : (
          <button className="chip act" disabled={camBusy} onClick={() => void e.startCamera()}>
            {camBusy ? cam : 'START CAMERA'}
          </button>
        )}
        <div className={`cam-status ${cam === 'RUNNING' ? 'ok' : cam === 'DENIED' || cam === 'ERROR' || cam === 'NO CAMERA' || cam === 'UNSUPPORTED' ? 'bad' : ''}`}>
          {cam}
          {s.trackingMode && cam === 'RUNNING' ? ` · ${s.trackingMode}` : ''}
        </div>
        {s.cameraMsg && cam !== 'RUNNING' && <div className="cam-msg">{s.cameraMsg}</div>}
        <button className="chip" onClick={() => useUI.setState({ calibOpen: !s.calibOpen })}>
          RECALIBRATE
        </button>
      </Group>
      <Group label="REALITY">
        <button className="chip warn" disabled={s.world === 'SHATTERED' || s.world === 'REBUILDING'} onClick={() => e.breakGlass()} title="Key B">
          BREAK
        </button>
        <button className="chip" disabled={s.world === 'REBUILDING'} onClick={() => e.rebuild()} title="Key R · or clap both hands">
          REBUILD
        </button>
        <button className="chip act" onClick={() => e.playDemo()} title="Key D">
          ▶ CINEMATIC DEMO
        </button>
      </Group>
      <Group label="VIEW">
        <div className="seg">
          {(['FULL', '16:9', '9:16'] as FrameMode[]).map((f) => (
            <button key={f} className={s.frame === f ? 'on' : ''} onClick={() => useUI.setState({ frame: f })}>
              {f}
            </button>
          ))}
        </div>
        <button
          className="chip"
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.())}
          title="Key F"
        >
          FULLSCREEN
        </button>
        <button className="chip" onClick={() => useUI.setState({ uiHidden: true })} title="Key H">
          HIDE UI
        </button>
      </Group>
    </div>
  )
}

function Integrity() {
  const glass = useUI((s) => s.glass)
  const world = useUI((s) => s.world)
  return (
    <div className="integrity">
      <div className="brand">BREAK THE SCREEN</div>
      <div className="row">
        <b>GLASS INTEGRITY</b>
        <span className={glass < 0.5 ? 'warn' : ''}>{world === 'SHATTERED' ? 'BREACHED' : pct(glass)}</span>
      </div>
      <span className={`meter wide ${glass < 0.5 ? 'warn' : ''}`}>
        <i style={{ transform: `scaleX(${glass})` }} />
      </span>
      <div className="row dim">
        <b>STATE</b>
        <span>{world}</span>
      </div>
    </div>
  )
}

function Hints() {
  const cam = useUI((s) => s.camera === 'RUNNING')
  const world = useUI((s) => s.world)
  const items = cam
    ? [
        ['PINCH', 'grab'],
        ['PULL HAND BACK', world === 'SHATTERED' ? 'draw it towards you' : 'pull it through the glass'],
        ['HOLD OPEN PALM', 'energy pulse'],
        ['SWIPE ↑ ↓ ← →', 'gravity'],
        ['TWO HANDS', 'scale · rotate · pinch air to create'],
        ['CLAP', 'rebuild'],
      ]
    : [
        ['DRAG', 'grab · throw'],
        ['WHEEL ↓', 'pull out of the screen'],
        ['RIGHT-CLICK', 'pulse'],
        ['ALT + MOVE / ARROWS', 'move your virtual head'],
        ['G · B · R · C', 'gravity · break · rebuild · create'],
        ['H', 'hide UI'],
      ]
  return (
    <div className="hints">
      {items.map(([k, v]) => (
        <span key={k}>
          <b>{k}</b> {v}
        </span>
      ))}
    </div>
  )
}

function CameraPreview() {
  const ref = useRef<HTMLCanvasElement>(null)
  const running = useUI((s) => s.camera === 'RUNNING')
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 66) return
      last = t
      const e = getEngine()
      const c = ref.current
      if (!e || !c) return
      const v = e.tracking.video
      const g = c.getContext('2d')!
      const W = c.width
      const H = c.height
      g.save()
      g.translate(W, 0)
      g.scale(-1, 1)
      if (v.readyState >= 2) {
        g.filter = 'grayscale(1) contrast(1.1) brightness(0.7)'
        g.drawImage(v, 0, 0, W, H)
        g.filter = 'none'
      }
      const r = e.tracking.latest
      if (r) {
        g.fillStyle = 'rgba(160,215,255,0.85)'
        for (const f of r.faces) {
          for (const i of [33, 133, 362, 263, 1, 10, 152, 234, 454]) g.fillRect(f.lm[i * 3] * W - 1.5, f.lm[i * 3 + 1] * H - 1.5, 3, 3)
        }
        g.fillStyle = 'rgba(255,214,160,0.9)'
        for (const h of r.hands) for (let i = 0; i < 21; i++) g.fillRect(h.lm[i * 3] * W - 1.5, h.lm[i * 3 + 1] * H - 1.5, 3, 3)
      }
      g.restore()
      const raw = e.head.state.raw
      if (raw) {
        // eye midpoint, drawn mirrored like the preview
        g.strokeStyle = 'rgba(160,215,255,0.9)'
        g.beginPath()
        g.arc((1 - raw.u) * W, raw.v * H, 6, 0, Math.PI * 2)
        g.stroke()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [running])
  if (!running) return null
  return (
    <div className="preview">
      <canvas ref={ref} width={192} height={144} />
      <span>LOCAL ONLY · NOT RECORDED</span>
    </div>
  )
}

export function Hud() {
  const hidden = useUI((s) => s.uiHidden)
  const demo = useUI((s) => s.demo)
  const calibOpen = useUI((s) => s.calibOpen)
  if (demo) {
    return (
      <button className="demo-stop" onClick={() => getEngine()?.stopDemo()}>
        ESC · EXIT DEMO
      </button>
    )
  }
  if (hidden) {
    return (
      <button className="unhide" onClick={() => useUI.setState({ uiHidden: false })} title="Key H">
        H
      </button>
    )
  }
  return (
    <div className="hud">
      <Integrity />
      <Status />
      <Rail />
      <Hints />
      <CameraPreview />
      {calibOpen && <Calibration />}
    </div>
  )
}
