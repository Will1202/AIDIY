import { useStore } from '../state/store'

export function Loader() {
  const p = useStore((s) => s.loading)
  const label = useStore((s) => s.loadingLabel)
  return (
    <div className="overlay loader">
      <div className="loader-box">
        <div className="kicker">PORTAL PARADOX · REAL-TIME PORTAL ENGINE</div>
        <div className="bar"><i style={{ transform: `scaleX(${p})` }} /></div>
        <div className="loader-row">
          <span>{label}</span>
          <span>{String(Math.round(p * 100)).padStart(3, '0')}%</span>
        </div>
      </div>
    </div>
  )
}
