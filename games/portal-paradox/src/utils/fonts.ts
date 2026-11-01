import displayUrl from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'
import monoUrl from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url'

export const FONT_DISPLAY = 'PP Display'
export const FONT_MONO = 'PP Mono'

/** Self-hosted latin subsets; canvas-painted signage in the lab uses the same faces. */
export async function loadFonts() {
  const faces = [
    new FontFace(FONT_DISPLAY, `url(${displayUrl}) format('woff2')`, { weight: '100 900', stretch: '62% 125%' }),
    new FontFace(FONT_MONO, `url(${monoUrl}) format('woff2')`, { weight: '100 900' }),
  ]
  await Promise.all(
    faces.map(async (f) => {
      document.fonts.add(f)
      await f.load()
    }),
  ).catch((err) => console.warn('[portal-paradox] font load failed', err))
}
