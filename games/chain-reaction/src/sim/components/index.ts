import type { Component, ComponentCtor, ParamDef } from '../component'
import type { ComponentSpec, ComponentType } from '../schema'
import { Hopper, HOPPER_PARAMS, Marble, MARBLE_PARAMS, Platform, PLATFORM_PARAMS, Wall, WALL_PARAMS } from './basic'
import { Track, TRACK_PARAMS } from './track'
import { Dominoes, DOMINO_PARAMS } from './dominoes'
import { Button, BUTTON_PARAMS, Lever, LEVER_PARAMS } from './switches'
import { Gear, GEAR_PARAMS, Motor, MOTOR_PARAMS } from './clockwork'
import { Conveyor, CONVEYOR_PARAMS, Lift, LIFT_PARAMS, Turntable, TURNTABLE_PARAMS } from './transport'
import { Launcher, LAUNCHER_PARAMS, Pendulum, PENDULUM_PARAMS, Pulley, PULLEY_PARAMS } from './gravity'
import { Final, FINAL_PARAMS, Funnel, FUNNEL_PARAMS } from './misc'

export interface ComponentInfo {
  ctor: ComponentCtor
  params: ParamDef[]
}

export const REGISTRY: Record<ComponentType, ComponentInfo> = {
  track: { ctor: Track, params: TRACK_PARAMS },
  funnel: { ctor: Funnel, params: FUNNEL_PARAMS },
  marble: { ctor: Marble, params: MARBLE_PARAMS },
  hopper: { ctor: Hopper, params: HOPPER_PARAMS },
  platform: { ctor: Platform, params: PLATFORM_PARAMS },
  wall: { ctor: Wall, params: WALL_PARAMS },
  dominoes: { ctor: Dominoes, params: DOMINO_PARAMS },
  lever: { ctor: Lever, params: LEVER_PARAMS },
  button: { ctor: Button, params: BUTTON_PARAMS },
  motor: { ctor: Motor, params: MOTOR_PARAMS },
  gear: { ctor: Gear, params: GEAR_PARAMS },
  conveyor: { ctor: Conveyor, params: CONVEYOR_PARAMS },
  turntable: { ctor: Turntable, params: TURNTABLE_PARAMS },
  pulley: { ctor: Pulley, params: PULLEY_PARAMS },
  pendulum: { ctor: Pendulum, params: PENDULUM_PARAMS },
  launcher: { ctor: Launcher, params: LAUNCHER_PARAMS },
  lift: { ctor: Lift, params: LIFT_PARAMS },
  final: { ctor: Final, params: FINAL_PARAMS },
}

export function createComponent(spec: ComponentSpec): Component | null {
  const r = REGISTRY[spec.type]
  return r ? new r.ctor(spec) : null
}
