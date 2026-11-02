import { useUI } from '../state/store'

/** demo captions, the end title, toasts and the demo badge */
export function TitleCard() {
  const title = useUI((s) => s.title)
  const caption = useUI((s) => s.caption)
  const demo = useUI((s) => s.demo)
  const toast = useUI((s) => s.toast)
  return (
    <>
      {demo && (
        <div className="demo-badge">
          <i />
          CINEMATIC DEMO · SIMULATED HEAD + HAND INPUT
        </div>
      )}
      {caption && demo && (
        <div className="caption" key={caption}>
          {caption}
        </div>
      )}
      <div className={`title-card ${title ? 'on' : ''}`}>
        <h2>BREAK THE SCREEN</h2>
        <p>REALITY HAS NO BOUNDARIES.</p>
      </div>
      {toast && !demo && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </>
  )
}
