import { memo } from 'react'

interface Props {
  text: string
  mode?: 'chars' | 'words'
  className?: string
}

/**
 * Pre-splits text at render time into inline-block pieces the gravity engine can
 * move individually (data-g="char" / "word"). Splitting up-front means the layout
 * never jumps when the destruction starts.
 */
export const Split = memo(function Split({ text, mode = 'chars', className }: Props) {
  if (mode === 'words') {
    const words = text.split(' ')
    return (
      <span className={className} aria-label={text}>
        {words.map((w, i) => (
          <span key={i}>
            <span className="w" data-g="word" aria-hidden>
              {w}
            </span>
            {i < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>
    )
  }
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) =>
        ch === ' ' ? (
          ' '
        ) : (
          <span key={i} className="ch" data-g="char" aria-hidden style={{ ['--i' as string]: i }}>
            {ch}
          </span>
        ),
      )}
    </span>
  )
})
