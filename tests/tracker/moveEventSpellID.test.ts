import { describe, expect, it, vi } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { summarizeMoveEvent } from '@/tracker/helper/moveSummary'
import {
  createErrorSpy,
  createTrackerControllerHarness,
  protocolMove
} from './helpers/trackerController'

const returnMove = protocolMove({
  CardCount: 1,
  CardIDs: [1],
  FromID: 255,
  FromPosition: 65282,
  FromZone: 2,
  FromZoneParam: 0,
  MoveType: 15,
  SpellID: 3543,
  ToID: 255,
  ToPosition: 0,
  ToZone: 1,
  ToZoneParam: 0
})

describe('移动事件技能 ID', () => {
  it.each([3543, 0])('公共区移动保留协议 SpellID=%s，摘要与事件一致', (SpellID) => {
    const patched = { ...returnMove, SpellID }
    const event = normalizeMoveEvent(patched)

    expect(event.protocol).toBe(patched)
    expect(event).toMatchObject({
      type: 'returnToPile',
      toZone: 'pile',
      options: { spellID: SpellID, fromZone: 'discard', fromPosition: 65282, position: 0 }
    })
    expect(event.options.fromSpellID).toBeUndefined()
    expect(summarizeMoveEvent(event).options.spellID).toBe(SpellID)
  })

  it.each([
    {
      FromZone: 2,
      ToZone: 4,
      FromZoneParam: 0,
      ToZoneParam: 3370,
      spellID: 3370,
      fromSpellID: undefined
    },
    {
      FromZone: 4,
      ToZone: 1,
      FromZoneParam: 3370,
      ToZoneParam: 0,
      spellID: 3370,
      fromSpellID: 3370
    },
    {
      FromZone: 4,
      ToZone: 5,
      FromZoneParam: 3370,
      ToZoneParam: 0,
      spellID: 3543,
      fromSpellID: 3370
    }
  ])('标记端点 $FromZone->$ToZone 仍按区域参数映射，不被触发技能覆盖', (fields) => {
    const { spellID, fromSpellID, ...zones } = fields
    const event = normalizeMoveEvent({ ...returnMove, ...zones })

    expect(event.protocol.SpellID).toBe(3543)
    expect(event.options.spellID).toBe(spellID)
    expect(event.options.fromSpellID).toBe(fromSpellID)
  })

  it('弃牌回牌堆底将技能传到 Room，但不把公共牌变成技能标记', () => {
    const debug = vi.fn()
    const errorSpy = createErrorSpy()
    const { controller } = createTrackerControllerHarness({
      logger: { debug, info: vi.fn(), warn: vi.fn() }
    })
    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3])
    controller.syncTrackerMove(protocolMove({ CardIDs: [1], ToID: 255, ToZone: 2, MoveType: 4 }))
    const room = controller.getTrackerRoom()!
    const moveCards = vi.spyOn(room, 'moveCards')
    debug.mockClear()

    controller.syncTrackerMove(returnMove)

    expect(errorSpy).not.toHaveBeenCalled()
    expect(moveCards).toHaveBeenCalledWith(
      [1],
      'pile',
      expect.objectContaining({ spellID: 3543, position: 0 })
    )
    expect(debug).toHaveBeenCalledWith(
      '移动事件归一化',
      expect.objectContaining({
        options: expect.objectContaining({ spellID: 3543 })
      })
    )
    expect(room.zones.get('pile')?.cards[0].id).toBe(1)
    expect(room.cardIndex.get(1)?.spellID).toBeNull()
    expect(room.cardIndex.get(1)?.subZone).toBeNull()
    expect(room.zones.get('discard')?.cards).toHaveLength(0)
    controller.destroyTrackerRoom()
  })
})
