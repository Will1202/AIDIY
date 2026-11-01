import { memo } from 'react'

/**
 * Scientific overlay locked onto the projected black hole. Geometry is driven by
 * CSS variables the Director writes from the camera: --bh-x/--bh-y (centre, px),
 * --bh-r (shadow radius, px), --bh-u (px per r_s on the sky plane), --bh-e (sin of
 * the viewing elevation, which flattens the disk-plane ellipses).
 * Every piece is its own gravity body (data-g="block") so the rings implode first.
 */
export const OrbitalHud = memo(function OrbitalHud() {
  return (
    <div className="hud" aria-hidden>
      <div className="hud-ring hud-shadow" data-g="block" data-ring>
        <svg viewBox="-100 -100 200 200">
          <circle r="96" className="dash" />
          {Array.from({ length: 72 }, (_, i) => {
            const a = (i / 72) * Math.PI * 2
            const l = i % 6 === 0 ? 7 : 3
            return <line key={i} x1={Math.cos(a) * 99} y1={Math.sin(a) * 99} x2={Math.cos(a) * (99 + l)} y2={Math.sin(a) * (99 + l)} />
          })}
        </svg>
      </div>
      <div className="hud-ring hud-isco" data-g="block" data-ring>
        <svg viewBox="-100 -100 200 200" preserveAspectRatio="none">
          <ellipse rx="99" ry="98" className="dash fine" />
        </svg>
      </div>
      <div className="hud-ring hud-outer" data-g="block" data-ring>
        <svg viewBox="-100 -100 200 200" preserveAspectRatio="none">
          <ellipse rx="99.5" ry="99" className="faint" />
        </svg>
      </div>
      {(['tl', 'tr', 'br', 'bl'] as const).map((c) => (
        <div key={c} className={`hud-bracket ${c}`} data-g="block" />
      ))}
      <div className="hud-label l-photon" data-g="block">
        <span className="lead" />
        <b>PHOTON RING</b>
        <em>r = 1.5 R<sub>s</sub> · b = 2.598 R<sub>s</sub></em>
      </div>
      <div className="hud-label l-isco" data-g="block">
        <span className="lead" />
        <b>ISCO</b>
        <em>r = 3 R<sub>s</sub> · v = 0.5 c</em>
      </div>
      <div className="hud-label l-disk" data-g="block">
        <span className="lead" />
        <b>ACCRETION DISK</b>
        <em>T ≈ 1.2 × 10⁷ K</em>
      </div>
      <div className="hud-scale" data-g="block">
        <i />
        <span>50 µas</span>
        <i />
      </div>
      <div className="hud-tag" data-g="block">
        TARGET LOCK <b>SGR A*</b>
      </div>
    </div>
  )
})
