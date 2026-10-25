import type { Room } from '@/tracker/Room'
import type { NormalizedMoveEvent } from '@/tracker/types'
import { protocolMove } from './helpers/trackerController'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'

function createRoom() {
  return createTestRoom({ cardIDs: [1, 2, 3], materializeDeckIdentities: false }).room
}

function createEvent() {
  return normalizeMoveEvent(
    protocolMove({
      FromZone: 1,
      ToZone: 5,
      ToID: 1,
      CardIDs: [1],
      CardCount: 1,
      SpellID: 42
    })
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Room 移动事件装饰', () => {
  it('装饰入口只接收完整归一化事件', () => {
    expectTypeOf<Parameters<Room['decorateMoveEvent']>[0]>().toEqualTypeOf<NormalizedMoveEvent>()
  })

  it('先执行通配处理器，再按技能顺序执行，同技能入口去重', () => {
    const room = createRoom()
    const calls: string[] = []
    room.registerMoveEventHandler('*', (event, currentRoom) => {
      expect(currentRoom).toBe(room)
      calls.push('*')
      return { ...event, options: { ...event.options, combinationID: 'wildcard' } }
    })
    room.registerMoveEventHandler(42, (event) => {
      expect(event.options.combinationID).toBe('wildcard')
      calls.push('42:first')
    })
    room.registerMoveEventHandler(42, () => {
      calls.push('42:second')
    })
    room.registerMoveEventHandler(99, (event) => {
      calls.push('99')
      return event
    })

    let event = createEvent()
    event = { ...event, to: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 42 } }
    const decorated = room.decorateMoveEvent(event)
    expect(calls).toEqual(['*', '42:first', '42:second'])
    expect(decorated.options.combinationID).toBe('wildcard')

    calls.length = 0
    event = { ...event, to: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 99 } }
    room.decorateMoveEvent(event)
    expect(calls).toEqual(['*', '42:first', '42:second', '99'])
  })

  it('完整协议与领域修正分离，装饰时不重写原始协议字段', () => {
    const room = createRoom()
    let event = normalizeMoveEvent(
      protocolMove({
        CardIDs: [1],
        CardCount: 1,
        SpellID: 42,
        MoveType: 7
      })
    )
    event.cardIDs = [2]
    event.cardCount = 3
    event = { ...event, to: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 99 } }
    const calls: number[] = []
    room.registerMoveEventHandler(42, () => {
      calls.push(42)
    })
    room.registerMoveEventHandler(99, () => {
      calls.push(99)
    })

    const decorated = room.decorateMoveEvent(event)
    expect(decorated.protocol).toBe(event.protocol)
    expect(decorated.protocol).toMatchObject({
      CardIDs: [1],
      CardCount: 1,
      SpellID: 42,
      MoveType: 7
    })
    expect(decorated.cardIDs).toEqual([2])
    expect(decorated.cardCount).toBe(3)
    expect(decorated.options).toBe(event.options)
    expect(decorated.raw).toBe(event.raw)
    expect(calls).toEqual([42, 99])
  })

  it('空返回或异常保留上一事件，后续处理器继续执行', () => {
    const room = createRoom()
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = createEvent()
    room.registerMoveEventHandler('*', () => undefined)
    room.registerMoveEventHandler('*', () => null)
    room.registerMoveEventHandler('*', () => {
      throw new Error('test:handler')
    })
    room.registerMoveEventHandler(42, (nextEvent) => {
      expect(nextEvent).toBe(event)
      return { ...nextEvent, cardCount: 2 }
    })

    expect(room.decorateMoveEvent(event).cardCount).toBe(2)
    expect(event.cardCount).toBe(1)
    expect(warn).toHaveBeenCalledWith('移动事件装饰失败', expect.any(Object))
  })

  it('销毁清理两类处理器，不影响其他 Room 的注册表', () => {
    const room = createRoom()
    const otherRoom = createRoom()
    room.registerSkillHandler(42, () => undefined)
    room.registerMoveEventHandler(42, () => undefined)
    otherRoom.registerSkillHandler(42, () => undefined)
    otherRoom.registerMoveEventHandler(42, () => undefined)

    room.destroy()
    expect(room.skillHandlers.size).toBe(0)
    expect(room.moveEventHandlers.size).toBe(0)
    expect(otherRoom.skillHandlers.size).toBe(1)
    expect(otherRoom.moveEventHandlers.size).toBe(1)
  })
})
