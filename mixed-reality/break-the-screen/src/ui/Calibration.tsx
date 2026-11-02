import { getEngine } from '../engine/instance'
import { useUI } from '../state/store'
import type { ViewerSettings } from '../camera/Viewer'

function Slider({ label, k, min, max, step, unit, fmt }: { label: string; k: keyof ViewerSettings; min: number; max: number; step: number; unit: string; fmt?: (v: number) => string }) {
  const v = useUI((s) => s.settings[k]) as number
  return (
    <label className="slider">
      <span>
        {label}
        <b>
          {fmt ? fmt(v) : v}
          {unit}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => getEngine()?.updateSettings({ [k]: Number(e.target.value) })} />
    </label>
  )
}

/**
 * Calibration: a monocular webcam cannot know the real screen size or where the
 * eyes are in depth, so the user sets the screen width and their viewing
 * distance, captures a rest pose, and picks how strong the parallax should be.
 */
export function Calibration() {
  const s = useUI((st) => st.settings)
  const cam = useUI((st) => st.camera === 'RUNNING')
  const calibrating = useUI((st) => st.calibrating)
  const calibrated = useUI((st) => st.calibrated)
  const e = getEngine()
  return (
    <div className="calib">
      <div className="calib-head">
        <b>VIEWER CALIBRATION</b>
        <button onClick={() => useUI.setState({ calibOpen: false })}>×</button>
      </div>
      <p>
        Sit where you normally sit, look at the centre of the screen, then capture. Head motion is measured from this rest pose. Depth comes from the
        apparent size of your face — an estimate, not a measurement.
      </p>
      <button className="chip act wide" disabled={!cam || calibrating} onClick={() => e?.recalibrate()}>
        {!cam ? 'START THE CAMERA FIRST' : calibrating ? 'CAPTURING…' : calibrated ? 'RECAPTURE REST POSE' : 'CAPTURE REST POSE'}
      </button>
      <Slider label="PARALLAX STRENGTH" k="parallax" min={0} max={1.6} step={0.05} unit="" fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="VIEWING DISTANCE" k="viewDistanceCm" min={30} max={110} step={1} unit=" CM" />
      <Slider label="SCREEN WIDTH" k="screenWidthCm" min={20} max={90} step={0.5} unit=" CM" />
      <div className="toggles">
        <label>
          <input type="checkbox" checked={s.headEnabled} onChange={(ev) => e?.updateSettings({ headEnabled: ev.target.checked })} />
          HEAD-COUPLED PERSPECTIVE
        </label>
        <label>
          <input type="checkbox" checked={s.invertX} onChange={(ev) => e?.updateSettings({ invertX: ev.target.checked })} />
          MIRRORED WEBCAM (FLIP X)
        </label>
      </div>
      <p className="dim">100% is geometrically exact for the values above. Lower it if the motion feels uncomfortable; raise it for recording.</p>
    </div>
  )
}
