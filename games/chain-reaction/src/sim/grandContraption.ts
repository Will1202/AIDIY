import { MachineBuilder, type Anchor } from './builder'
import type { SceneSpec } from './schema'
import type { V3 } from './math'

/**
 * THE GRAND CONTRAPTION — the pre-built, verified machine. Every hand-off between stages is a
 * real contact, a joint, a measured sensor state or an explicit wire; scene order = chain order
 * (the watchdog blames the first stage after the last one that fired).
 *
 *  01 gate → drop ramp → straight → U-turn → straight → spiral
 *  02 26 growing dominoes on the walnut deck
 *  03 lever → push button ─wire→ motor → 4-gear train ─cam→ hopper (3 marbles)
 *  04 chain-driven conveyor → chain-driven turntable → ramp → pulley bucket (needs 2 marbles)
 *  05 counterweight trip ─wire→ latch → pendulum
 *  06 pendulum strikes the launcher paddle → spring launcher → 5 m flight → funnel → chute
 *  07 load-sensing lift rides 18 m up the tower
 *  08 crown track → trigger cup → THE FINAL MACHINE
 */
export const DEFAULT_TUNE = {
  leverOffset: 1.45,
  leverPivot: 0.3,
  leverRest: 6,
  leverRatio: 0.5,
  leverWeight: 0.6,
  buttonH: 0.47,
  domCount: 26,
  launcherK: 1500,
  launcherAngle: 50,
}
export type Tune = typeof DEFAULT_TUNE

export function grandContraption(over: Partial<Tune> = {}): SceneSpec {
  const T: Tune = { ...DEFAULT_TUNE, ...over }
  const b = new MachineBuilder('The Grand Contraption')
  const Z1 = 1, Z2 = 2, Z3 = 3, Z4 = 4, Z5 = 5, Z6 = 6, Z7 = 7, Z8 = 8
  const at = (pos: V3, yaw = 0): Anchor => ({ pos, yaw })

  // ---- ZONE 01 · THE BEGINNING ---------------------------------------------------------
  const gate = b.add('hopper', 'z1-gate', { x: -5.8, y: 21.6, z: 0.9 }, 0, { count: 1, slope: 12, openOnStart: false }, 'Release Gate', Z1)
  b.wire('@start', 'go', 'z1-gate', 'open')
  const z1 = b.run('z1-track-', b.out(gate), [
    { kind: 'straight', length: 3.0, drop: 1.1, profile: 's-curve' },
    { kind: 'straight', length: 3.6, drop: 0.3 },
    { kind: 'curve', radius: 1.0, angle: 180, drop: 0.15, bank: 15 },
    { kind: 'straight', length: 5.45, drop: 0.42 },
    { kind: 'spiral', radius: 1.2, turns: 1.5, drop: 1.5, dir: 'left', bank: 15 },
    { kind: 'straight', length: 1.0, drop: 0.1 },
  ], Z1, 'Marble Run')

  // ---- ZONE 02 · DOMINO CASCADE --------------------------------------------------------
  const deckY = z1.end.pos.y - 0.15 - 0.02
  const rowZ = z1.end.pos.z
  b.add('platform', 'z2-deck', { x: 0, y: deckY, z: 0.9 }, 0, { width: 12.4, depth: 4.2, thickness: 0.18, rim: 0.12, material: 'walnut' }, 'Domino Deck', Z2)
  const domX = z1.end.pos.x + 0.55
  const dom = b.add('dominoes', 'z2-dominoes', { x: domX, y: deckY, z: rowZ }, 0,
    { count: T.domCount, height: 0.32, width: 0.2, thickness: 0.05, spacing: 0.5, growth: 3.3, shape: 's-curve', curve: 50 }, 'Domino Cascade', Z2)

  // ---- ZONE 03 · THE CLOCKWORK ---------------------------------------------------------
  // last domino position, from the same layout the simulator uses
  const last = lastDomino(b, dom)
  const leverX = last.x + T.leverOffset
  b.add('lever', 'z3-lever', { x: leverX, y: deckY, z: last.z }, 0, { length: 2.2, pivot: T.leverPivot, ratio: T.leverRatio, weight: T.leverWeight, rest: T.leverRest, trip: 10 }, 'Tipping Lever', Z3)
  // the hammer reaches the cap after ~13° of travel past level
  const outArm = 2.2 * (1 - T.leverRatio)
  b.add('button', 'z3-button', { x: leverX + outArm - 0.15, y: deckY + T.leverPivot + T.buttonH, z: last.z }, 0, { facing: 'down', travel: 0.07, threshold: 0.5, size: 0.26 }, 'Push Switch', Z3)
  const motorPos = { x: 5.2, y: 15.4, z: -1.5 }
  b.add('motor', 'z3-motor', motorPos, 0, { rpm: 70, spinup: 0.8, teeth: 12, module: 0.07 }, 'Drive Motor', Z3)
  b.wire('z3-button', 'pressed', 'z3-motor', 'start')
  // gear train: positions follow from pitch radii so the meshes are exact
  const m = 0.07
  const g1 = place(motorPos, 200, m * (12 + 50) / 2, 0)
  b.add('gear', 'z3-gear1', g1, 0, { teeth: 50, module: m, thickness: 0.14, pinion: 14, pinionOffset: 0.16, style: 'spoked' }, 'Great Wheel', Z3)
  const g2 = place(g1, 160, m * (14 + 40) / 2, 0.16)
  b.add('gear', 'z3-gear2', g2, 0, { teeth: 40, module: m, thickness: 0.12, pinion: 16, pinionOffset: 0.16, style: 'spoked' }, 'Second Wheel', Z3)
  const g3 = place(g2, 195, m * (16 + 44) / 2, 0.16)
  b.add('gear', 'z3-gear3', g3, 0, { teeth: 44, module: m, thickness: 0.12, style: 'ring' }, 'Third Wheel', Z3)
  const g4 = place(g3, 170, m * (44 + 30) / 2, 0)
  b.add('gear', 'z3-gear4', g4, 0, { teeth: 30, module: m, thickness: 0.12, style: 'solid' }, 'Cam Wheel', Z3)
  const hop = b.add('hopper', 'z3-hopper', { x: -5.0, y: 15.2, z: 0.7 }, 0, { count: 3, slope: 10, openOnStart: false, camAngle: 30 }, 'Gravity Drop', Z3)
  b.chain('z3-gear4', 'z3-hopper', 2.5)

  // ---- ZONE 04 · GRAVITY ENGINE --------------------------------------------------------
  const hopOut = b.out(hop)
  const convOrigin = { x: hopOut.pos.x + 0.2, y: hopOut.pos.y - 0.15 - 0.07, z: 0.7 }
  const conv = b.add('conveyor', 'z4-conveyor', convOrigin, 0, { length: 5.6, incline: 5, width: 0.5, drum: 0.16, pitch: 0.2, cleatEvery: 3 }, 'Chain Conveyor', Z4)
  b.chain('z3-gear1', 'z4-conveyor', 5)
  const convEnd = b.out(conv)
  const turnPos = { x: convEnd.pos.x + 0.72, y: convEnd.pos.y - 0.15 - 0.6, z: 0.7 }
  // exit gap at the front: marbles leave tangentially towards +x into a felt catch box + funnel
  b.add('turntable', 'z4-turntable', turnPos, 0, { radius: 1.1, paddles: 4, fence: 0.46, gapAt: -90, gapWidth: 40, sweep: 35 }, 'Rotating Platform', Z4)
  b.chain('z3-gear2', 'z4-turntable', 6)
  const tx = turnPos.x, ty = turnPos.y, gz = turnPos.z + 1.14
  b.add('wall', 'z4-backstop', { x: tx + 1.62, y: ty - 0.55, z: gz + 0.2 }, 0, { width: 1.9, height: 1.3, thickness: 0.06, material: 'acrylic' }, 'Acrylic Backstop', Z4)
  b.add('wall', 'z4-sidestop', { x: tx + 0.85, y: ty - 0.55, z: gz + 1.05 }, Math.PI / 2, { width: 1.6, height: 1.0, thickness: 0.06, material: 'acrylic' }, 'Acrylic Side Shield', Z4)
  const catchF = { x: tx + 0.9, y: ty - 1.35, z: gz + 0.25 }
  b.add('funnel', 'z4-catch', catchF, 0, { top: 0.8, bottom: 0.3, height: 0.7, neck: 0.3 }, 'Catch Funnel', Z4)
  b.add('pulley', 'z4-pulley', { x: catchF.x, y: catchF.y - 0.3 - 0.42, z: catchF.z }, 0, { drop: 1.5, counter: 1.5, cup: 0.8, span: 1.6, wheel: 1.6, trip: 0.85 }, 'Pulley & Counterweight', Z4)

  // ---- ZONE 05 · THE PENDULUM HALL -----------------------------------------------------
  const pivot = { x: -1.0, y: 12.6, z: 0.9 }
  b.add('pendulum', 'z5-pendulum', pivot, 0, { length: 3.0, bob: 0.42, mass: 16, angle: 55, latched: true, friction: 0.05 }, 'Great Pendulum', Z5)
  b.wire('z4-pulley', 'lowered', 'z5-pendulum', 'release')

  // ---- ZONE 06 · SPRING CHAMBER --------------------------------------------------------
  const breech = { x: -0.2, y: 7.6, z: 0.9 }
  const hinge = { x: pivot.x + 0.42 + 0.06, y: pivot.y - 3.0 + 0.3 }
  // launcher fires towards −x (yaw π): local x = −(world x − breech x)
  b.add('launcher', 'z6-launcher', breech, Math.PI, {
    angle: T.launcherAngle, stiffness: T.launcherK, compression: 0.3, barrel: 1.1, trigger: 'paddle',
    paddleX: -(hinge.x - breech.x), paddleY: hinge.y - breech.y, preload: true,
  }, 'Spring Launcher', Z6)
  const funnel = { x: -5.7, y: 6.1, z: 0.9 }
  b.add('funnel', 'z6-funnel', funnel, 0, { top: 0.9, bottom: 0.26, height: 0.8, neck: 0.25 }, 'Catch Funnel', Z6)
  // felt net behind the funnel kills the marble's flight speed so it drops in instead of orbiting
  b.add('wall', 'z6-net', { x: funnel.x - 0.62, y: funnel.y + 1.0, z: 0.9 }, 0, { width: 1.8, height: 1.6, thickness: 0.06, material: 'felt' }, 'Catch Net', Z6)
  // the chute starts behind the throat (with an end stop) so a swirling exit still lands in it
  b.add('wall', 'z6-chute-stop', { x: funnel.x + 0.56, y: 5.3, z: 0.9 }, 0, { width: 0.5, height: 0.5, thickness: 0.05, material: 'felt' }, 'Chute Stop', Z6)
  b.track('z6-chute', at({ x: funnel.x + 0.5, y: 5.6, z: 0.9 }, Math.PI), { kind: 'straight', length: 1.9, drop: 0.42 }, 'Loading Chute', Z6)

  // ---- ZONE 07 · THE ASCENSION ---------------------------------------------------------
  const lift = b.add('lift', 'z7-lift', { x: -7.55, y: 4.55, z: 0.9 }, 0, { height: 18.45, speed: 6, size: 0.8, tilt: 7, auto: true }, 'Ascension Lift', Z7)

  // ---- ZONE 08 · THE FINAL MACHINE -----------------------------------------------------
  const crown = b.track('z8-crown', b.out(lift), { kind: 'straight', length: 6.0, drop: 0.55 }, 'Crown Track', Z8)
  const ce = b.out(crown)
  b.add('final', 'z8-final', { x: ce.pos.x + 0.41, y: ce.pos.y - 0.15 - 0.02, z: ce.pos.z }, 0, { scale: 1, cup: 0.36, opening: 70, wall: 0.36, show: 14 }, 'The Final Machine', Z8)

  return b.scene('z8-final')
}

/** a point at `deg` from `from` in the x–y gear plane, `dz` further along the axle */
function place(from: V3, deg: number, dist: number, dz: number): V3 {
  const a = (deg * Math.PI) / 180
  return { x: from.x + Math.cos(a) * dist, y: from.y + Math.sin(a) * dist, z: from.z + dz }
}

import { createComponent } from './components'
import type { Dominoes } from './components/dominoes'
import type { ComponentSpec } from './schema'
function lastDomino(_b: MachineBuilder, spec: ComponentSpec) {
  const d = createComponent(spec) as Dominoes
  const l = d.layout()
  const p = l[l.length - 1]
  return d.w(p.x, 0, p.z)
}
