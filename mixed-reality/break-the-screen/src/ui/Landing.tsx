import { getEngine } from '../engine/instance'
import { useUI } from '../state/store'

export function Landing() {
  const enter = (demo: boolean) => {
    const e = getEngine()
    if (!e) return
    e.audio.start()
    e.mouse.autoSway = false
    e.mouse.resetHead()
    useUI.setState({ phase: 'experience' })
    if (demo) e.playDemo()
  }
  return (
    <div className="landing">
      <div />
      <div className="landing-center">
        <p className="kicker">WHAT IF YOUR SCREEN WAS A WINDOW INTO ANOTHER DIMENSION?</p>
        <h1 className="title">
          BREAK
          <br />
          THE SCREEN
        </h1>
        <p className="subtitle">REALITY HAS NO BOUNDARIES.</p>
        <div className="landing-actions">
          <button className="btn primary" onClick={() => enter(false)}>
            <span>ENTER EXPERIENCE</span>
          </button>
          <button className="btn" onClick={() => enter(true)}>
            <span>WATCH DEMO</span>
            <em>30 s</em>
          </button>
        </div>
        <div className="landing-foot">
          <span>CAMERA OPTIONAL · MOUSE WORKS EVERYWHERE</span>
          <span>VIDEO IS ANALYSED ON THIS DEVICE ONLY — NOTHING IS UPLOADED OR STORED</span>
        </div>
      </div>
      <div />
    </div>
  )
}
