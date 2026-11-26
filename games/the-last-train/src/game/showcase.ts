// 展映模式：回放已解锁的标志性时刻。全部是实时 3D 场景与游戏事件（列车真的在驶入、鲸真的在游），
// 不是视频。回放前后由 Game.showcase() 保存 / 还原存档，回放不会改动玩家进度。
import type { Game } from './Game'
import type { MomentId } from './types'
import { gameStore, newGameData, S } from '../state/store'
import { setUI } from '../state/ui'
import { FLOOR_Y } from '../world/shared/Train'
import type { Shot } from './api'

type Arrival = { forceMoment?: boolean; momentShots(): Shot[]; approachTime: number }

export async function playMoment(game: Game, id: MomentId) {
  const g = game as unknown as {
    loadWorld(w: string, menu?: boolean): Promise<unknown>
    world: (Arrival & { id: string }) | null
    mode: string
    paused: boolean
    replayArrival(): void
  }
  setUI({ showcase: id, screen: 'play', cinema: true })
  gameStore.setState(newGameData(), true)
  S.set('game.started')
  switch (id) {
    case 'rain': {
      await g.loadWorld('station')
      setUI({ screen: 'play', cinema: true })
      g.mode = 'play'
      g.paused = false
      const st = game.world as unknown as { intro(): Promise<void> }
      await st.intro()
      break
    }
    case 'invert':
    case 'whale':
    case 'reversal': {
      const w = id === 'invert' ? 'city' : id === 'whale' ? 'abyss' : 'terminus'
      await g.loadWorld(w)
      setUI({ screen: 'play', cinema: true })
      g.mode = 'play'
      g.paused = false
      const world = g.world!
      world.forceMoment = true
      game.player.setGravity(1)
      game.player.teleport(1.1, FLOOR_Y, -0.8, Math.PI, 0)
      g.replayArrival()
      await game.cinematic(world.momentShots(), { letterbox: true, skippable: true })
      break
    }
    case 'freeze': {
      await g.loadWorld('desert')
      setUI({ screen: 'play', cinema: true })
      g.mode = 'play'
      g.paused = false
      game.player.teleport(0, 1, 9.6, Math.PI, 0)
      const d = game.world as unknown as { activateTime(c: boolean): void; momentShots(): Shot[] }
      S.give('watch')
      d.activateTime(false)
      ;(game.world as unknown as { rise: number }).rise = 0
      await game.cinematic(d.momentShots(), { letterbox: true, skippable: true })
      break
    }
  }
  setUI({ cinema: false })
}
