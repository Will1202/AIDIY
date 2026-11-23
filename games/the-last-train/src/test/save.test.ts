// 存档：IndexedDB 读写往返、自动存档开关、旧存档迁移、章节快照、全部重置。
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { S, Meta, gameStore, metaStore, loadAll, saveNow, setAutosave, resetEverything, migrate, newGameData } from '../state/store'
import { kvGet } from '../state/save'

describe('save system', () => {
  it('round-trips game state through IndexedDB', async () => {
    gameStore.setState(newGameData(), true)
    S.set('game.started')
    S.give('ticket')
    S.set('city.rotA', 2)
    S.addArchive('a1')
    S.markRead('a1')
    S.collect('t1')
    gameStore.setState({ world: 'city', player: { x: 1, y: 34, z: 63, yaw: 0.5, pitch: 0, g: -1 } })
    Meta.checkpoint('city', gameStore.getState())
    Meta.reachEnding('leave')
    setAutosave(true)
    await saveNow()
    const raw = await kvGet<{ world: string }>('save')
    expect(raw?.world).toBe('city')
    // 模拟刷新：清空内存再读回来
    gameStore.setState(newGameData(), true)
    metaStore.setState({ endings: [], moments: [], chapters: [], checkpoints: {} }, true)
    const { hasSave, save } = await loadAll()
    expect(hasSave).toBe(true)
    expect(save!.flags['city.rotA']).toBe(2)
    expect(save!.inventory).toContain('ticket')
    expect(save!.player!.g).toBe(-1)
    expect(metaStore.getState().endings).toContain('leave')
    expect(metaStore.getState().checkpoints.city?.world).toBe('city')
    await resetEverything()
    const again = await loadAll()
    expect(again.hasSave).toBe(false)
  })
  it('migrates partial saves', () => {
    const m = migrate({ world: 'abyss', flags: { x: true } } as never)!
    expect(m.inventory).toEqual([])
    expect(m.flags.x).toBe(true)
    expect(migrate({} as never)).toBeNull()
  })
})
