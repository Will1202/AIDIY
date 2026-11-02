import type { Engine } from './Engine'

let engine: Engine | null = null

export function setEngine(e: Engine | null) {
  engine = e
}

export function getEngine() {
  return engine
}
