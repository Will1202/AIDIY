import displayUrl from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'
import monoUrl from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url'

export const FONT_DISPLAY = 'EH Display'
export const FONT_MONO = 'EH Mono'

const faces = [
  { family: FONT_DISPLAY, url: displayUrl, desc: { weight: '100 900', stretch: '62% 125%', style: 'normal' } },
  { family: FONT_MONO, url: monoUrl, desc: { weight: '100 900', style: 'normal' } },
]

/** Self-hosted latin subsets only — the same files are embedded in page snapshots. */
export async function loadFonts() {
  await Promise.all(
    faces.map(async (f) => {
      const face = new FontFace(f.family, `url(${f.url}) format('woff2')`, f.desc)
      document.fonts.add(face)
      await face.load()
    }),
  ).catch((err) => console.warn('[event-horizon] font load failed', err))
}

let embedCss: Promise<string> | null = null

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** @font-face rules with inlined data URLs for html-to-image (avoids scanning every stylesheet). */
export function fontEmbedCss(): Promise<string> {
  if (!embedCss) {
    embedCss = Promise.all(
      faces.map(async (f) => {
        const blob = await (await fetch(f.url)).blob()
        const data = await toDataUrl(blob)
        const stretch = 'stretch' in f.desc ? `font-stretch:${f.desc.stretch};` : ''
        return `@font-face{font-family:'${f.family}';src:url(${data}) format('woff2');font-weight:${f.desc.weight};${stretch}font-style:normal;font-display:block;}`
      }),
    ).then((rules) => rules.join('\n'))
    embedCss.catch(() => (embedCss = null))
  }
  return embedCss
}
