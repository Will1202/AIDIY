import { engine } from '../engine/instance'
import { QUALITY_LEVELS } from '../engine/Quality'
import { useStore } from '../state/store'

export const CONTROLS: [string, string][] = [
  ['W A S D', 'move'],
  ['MOUSE', 'look'],
  ['SHIFT', 'sprint'],
  ['SPACE', 'jump'],
  ['E / RMB', 'grab · drop'],
  ['LMB', 'throw · kinetic pulse · place portal'],
  ['1 / 2', 'portal tool α / Ω'],
  ['[ ]', 'rotate portal'],
  ['G', 'invert gravity'],
  ['R (hold)', 'rewind time'],
  ['L', 'layout: gateway / mirror'],
  ['C', '30 s showcase'],
  ['X', 'reset world'],
  ['V', 'frame 16:9 / 9:16'],
  ['Q', 'quality'],
  ['H', 'hide HUD'],
  ['ESC', 'pause'],
]

export function Menu() {
  const quality = useStore((s) => s.quality)
  const touch = useStore((s) => s.touch)
  return (
    <div className="overlay menu">
      <div className="menu-top">
        <span className="kicker">SECTOR 07 · SPATIAL TOPOLOGY GROUP</span>
        <span className="kicker dim">BUILD 1.0 · WEBGL2 · RAPIER</span>
      </div>
      <div className="menu-main">
        <div className="kicker accent">WHAT IF SPACE WAS JUST AN ILLUSION?</div>
        <h1 className="title">
          <span>PORTAL</span>
          <span>PARADOX</span>
        </h1>
        <p className="lede">
          Two real-time portals stitch a brutalist laboratory to a floating world beyond it. Walk through, throw mass across
          the gap, face the gates at each other, invert gravity, rewind time.
        </p>
        <div className="menu-actions">
          <button className="btn primary" onClick={() => engine()?.enterPlay()}>ENTER THE LAB</button>
          <button className="btn" onClick={() => engine()?.director?.start()}>WATCH SHOWCASE · 30 S</button>
        </div>
        <div className="seg">
          <span className="seg-label">QUALITY</span>
          {QUALITY_LEVELS.map((l) => (
            <button key={l} className={l === quality ? 'on' : ''} onClick={() => engine()?.setQuality(l)}>{l}</button>
          ))}
        </div>
      </div>
      {!touch && (
        <div className="menu-controls">
          {CONTROLS.map(([k, v]) => (
            <div key={k} className="ctl"><kbd>{k}</kbd><span>{v}</span></div>
          ))}
        </div>
      )}
    </div>
  )
}
