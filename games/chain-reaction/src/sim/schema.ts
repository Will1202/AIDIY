/** Versioned machine scene schema. Everything the editor saves and the simulator loads goes
 *  through these types, so the Grand Contraption is just another machine file. */

export const SCHEMA_ID = 'chain-reaction/machine'
export const SCHEMA_VERSION = 1

export type ComponentType =
  | 'track' | 'funnel' | 'marble' | 'hopper' | 'platform' | 'wall'
  | 'dominoes' | 'lever' | 'button' | 'motor' | 'gear'
  | 'conveyor' | 'turntable' | 'pulley' | 'pendulum' | 'launcher' | 'lift' | 'final'

export type ParamValue = number | boolean | string
export type Params = Record<string, ParamValue>

export interface ComponentSpec {
  id: string
  type: ComponentType
  /** world position of the component origin (metres) */
  pos: [number, number, number]
  /** yaw about +Y (radians) */
  rot: number
  params: Params
  /** optional display name, e.g. "Zone 02 · Domino Cascade" */
  label?: string
  /** zone index (1..8) the component belongs to, used by HUD / director */
  zone?: number
}

/** signal = event wire (switch → motor); mechanical = shaft / chain drive from a rotor */
export type ConnectionKind = 'signal' | 'mechanical'

export interface ConnectionSpec {
  id: string
  kind: ConnectionKind
  from: string
  output: string
  to: string
  input: string
  /** mechanical: speed ratio applied along the chain (driven ω = ratio · driver ω) */
  ratio?: number
}

export interface SceneSpec {
  schema: typeof SCHEMA_ID
  version: number
  name: string
  components: ComponentSpec[]
  connections: ConnectionSpec[]
  /** id of the component whose activation completes the machine */
  finalId?: string
  /** names for zone indices */
  zones?: Record<string, string>
}

export const ZONE_NAMES: Record<number, string> = {
  1: 'THE BEGINNING',
  2: 'DOMINO CASCADE',
  3: 'THE CLOCKWORK',
  4: 'GRAVITY ENGINE',
  5: 'THE PENDULUM HALL',
  6: 'SPRING CHAMBER',
  7: 'THE ASCENSION',
  8: 'THE FINAL MACHINE',
}

export function emptyScene(name = 'Untitled Machine'): SceneSpec {
  return { schema: SCHEMA_ID, version: SCHEMA_VERSION, name, components: [], connections: [] }
}
