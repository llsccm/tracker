import { getMoveMarkSpellID, getMoveCallbackSpellID } from '@/tracker/helper/moveEndpoint'
import { describe, expect, it, vi } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { summarizeMoveContext, summarizeMoveEvent } from '@/tracker/helper/moveSummary'
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
  it.each([{ CardIDs: [] }, { CardIDs: [1] }])(
    'CardIDs=$CardIDs 获得、揭示和转交分别保留本次动作技能',
    ({ CardIDs }) => {
      const { controller } = createTrackerControllerHarness()
      controller.initTrackerRoom()
      controller.registerTrackerPlayers(
        [
          { SeatID: 1, ClientID: 100 },
          { SeatID: 3, ClientID: 300 }
        ],
        100
      )
      controller.initTrackerDeck([1, 2])
      const room = controller.getTrackerRoom()!
      const placement = vi.spyOn(room.movement, 'moveKnownCardsForContext')
      controller.syncTrackerMove(
        protocolMove({ CardIDs, CardCount: 1, ToID: 3, MoveType: 18, SpellID: 3644 })
      )
      const slot = room.refreshPlayerSnapshot().find((card) => card.owner === 3)!
      expect(slot.isAnonymous).toBe(CardIDs.length === 0)
      expect(summarizeMoveContext(placement.mock.calls.at(-1)![0])).toMatchObject({
        triggerSpellID: 3644,
        targetHandSeat: 3
      })

      controller.revealTrackerCards(
        { type: 'player', seatID: 3, spellID: 42, handMoveCount: 0 },
        [1]
      )
      expect(room.cardIndex.get(1)).toBe(slot)
      expect(summarizeMoveContext(placement.mock.calls.at(-1)![0])).toMatchObject({
        triggerSpellID: 42,
        sourceHandSeat: 3,
        targetHandSeat: 3,
        handMoveCount: 0
      })
      expect(room.getPlayer(3)!.observedHandCount).toBe(1)

      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [1],
          FromZone: 5,
          FromID: 3,
          ToID: 1,
          MoveType: 27,
          SpellID: 780
        })
      )
      expect(summarizeMoveContext(placement.mock.calls.at(-1)![0])).toMatchObject({
        triggerSpellID: 780,
        sourceHandSeat: 3,
        targetHandSeat: 1
      })
      expect(slot.getPossibleLocations()).toEqual([
        { type: 'player', seatID: 1, subZone: 'hand', spellID: null }
      ])
      expect(room.getPlayer(3)!.observedHandCount).toBe(0)
      expect(room.getPlayer(1)!.observedHandCount).toBe(1)
      expect(room.assertPileIdentityLedgerConsistency('moveEventSpellID')).toEqual([])
      controller.destroyTrackerRoom()
    }
  )

  it.each([3543, 0])('公共区移动保留协议 SpellID=%s，摘要与事件一致', (SpellID) => {
    const patched = { ...returnMove, SpellID }
    const event = normalizeMoveEvent(patched)

    expect(event.protocol).toBe(patched)
    expect(event).toMatchObject({
      type: 'returnToPile',
      from: { type: 'public', zone: 'discard', position: 65282 },
      to: { type: 'public', zone: 'pile', position: 0 },
      protocol: { SpellID }
    })
    expect(getMoveMarkSpellID(event.from)).toBeNull()
    expect(summarizeMoveEvent(event).triggerSpellID).toBe(SpellID)
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
    expect(getMoveCallbackSpellID(event, event.protocol.SpellID)).toBe(spellID)
    expect(getMoveMarkSpellID(event.from)).toBe(fromSpellID ?? null)
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
      expect.objectContaining({
        triggerSpellID: 3543,
        to: { type: 'public', zone: 'pile', position: 0 }
      })
    )
    expect(debug).toHaveBeenCalledWith(
      '移动事件归一化',
      expect.objectContaining({
        triggerSpellID: 3543
      })
    )
    expect(room.zones.get('pile')?.cards[0].id).toBe(1)
    expect(room.cardIndex.get(1)?.spellID).toBeNull()
    expect(room.cardIndex.get(1)?.subZone).toBeNull()
    expect(room.zones.get('discard')?.cards).toHaveLength(0)
    controller.destroyTrackerRoom()
  })
})
