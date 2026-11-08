/** a small cinnabar seal (印章) with a slightly worn edge */
export function Seal({ text, size = 28 }: { text: string; size?: number }) {
  return (
    <svg className="seal" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <filter id="seal-rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="1.6" />
        </filter>
      </defs>
      <g filter="url(#seal-rough)">
        <rect x="2" y="2" width="36" height="36" rx="3" fill="#b3261e" />
        <rect x="5" y="5" width="30" height="30" rx="1.5" fill="none" stroke="#f1e6d2" strokeWidth="1.2" opacity="0.7" />
        {text.length === 1 ? (
          <text x="20" y="28.5" textAnchor="middle" fontFamily="'Ma Shan Zheng', serif" fontSize="23" fill="#f3ead8">
            {text}
          </text>
        ) : (
          <>
            <text x="20" y="19" textAnchor="middle" fontFamily="'Ma Shan Zheng', serif" fontSize="14" fill="#f3ead8">
              {text[0]}
            </text>
            <text x="20" y="33" textAnchor="middle" fontFamily="'Ma Shan Zheng', serif" fontSize="14" fill="#f3ead8">
              {text[1]}
            </text>
          </>
        )}
      </g>
    </svg>
  )
}
