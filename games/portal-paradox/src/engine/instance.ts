import type { Engine } from './Engine'

let current: Engine | null = null

export function setEngine(e: Engine | null) {
  current = e
}

/** the running engine, for UI event handlers (never read inside React render for per-frame data) */
export function engine() {
  return current
}
