import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import type { MoveEventInput } from '@/tracker/room/moveEvents'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'

function createRoom() {
  return createTestRoom({ cardIDs: [1, 2, 3], materializeDeckIdentities: false }).room
}

function createEvent() {
  return normalizeMoveEvent({
    FromZone: 1,
    ToZone: 5,
    ToID: 1,
    CardIDs: [1],
    CardCount: 1,
    SpellID: 42
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Room 移动事件装饰', () => {
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

    const event = createEvent()
    event.options.spellID = '42'
    const decorated = room.decorateMoveEvent(event)
    expect(calls).toEqual(['*', '42:first', '42:second'])
    expect(decorated.options.combinationID).toBe('wildcard')

    calls.length = 0
    event.options.spellID = 99
    room.decorateMoveEvent(event)
    expect(calls).toEqual(['*', '42:first', '42:second', '99'])
  })

  it('领域输入补齐协议字段，显式数量与身份覆盖 raw，不修改原输入', () => {
    const room = createRoom()
    const event: MoveEventInput = {
      toZone: 'player',
      cardIDs: [2],
      cardCount: 3,
      raw: { CardIDs: [1], CardCount: 1, SpellID: 42, MoveType: 7 },
      options: { spellID: 99, seatID: 1 }
    }
    const calls: number[] = []
    room.registerMoveEventHandler(42, () => {
      calls.push(42)
    })
    room.registerMoveEventHandler(99, () => {
      calls.push(99)
    })

    const decorated = room.decorateMoveEvent(event)
    expect(decorated.protocol).toMatchObject({
      CardIDs: [2],
      CardCount: 3,
      SpellID: 42,
      MoveType: 7
    })
    expect(decorated).toMatchObject({ type: 'moveCards', cardIDs: [2], cardCount: 3, moveType: 7 })
    expect(decorated.options).toBe(event.options)
    expect(event.protocol).toBeUndefined()
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
