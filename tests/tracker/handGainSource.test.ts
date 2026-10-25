import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { describe, expect, it } from 'vitest'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function setup() {
  const { controller } = createTrackerControllerHarness()
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [
      { SeatID: 1, ClientID: 100 },
      { SeatID: 3, ClientID: 300 }
    ],
    100
  )
  controller.initTrackerDeck([37, 92, 101, 102])
  return { controller, room: controller.getTrackerRoom()! }
}

describe('手牌获得技能来源', () => {
  it('暗槽物化和重复揭示保留来源，转交和普通摸牌更新来源', () => {
    const { controller, room } = setup()
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 1,
        ToZone: 5,
        ToID: 3,
        MoveType: 18,
        SpellID: 3644
      })
    )
    const slot = room.refreshPlayerSnapshot().find((card) => card.owner === 3)!
    expect(slot.isAnonymous).toBe(true)
    expect(slot.gainSpellID).toBe(3644)
    controller.revealTrackerCards({ type: 'player', seatID: 3, handMoveCount: 0 }, [37])
    const card = room.cardIndex.get(37)!
    expect(card).toBe(slot)
    expect(card.gainSpellID).toBe(3644)
    controller.revealTrackerCards({ type: 'player', seatID: 3, handMoveCount: 0 }, [37])
    expect(card.gainSpellID).toBe(3644)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [37],
        CardCount: 1,
        FromZone: 5,
        FromID: 3,
        ToZone: 5,
        ToID: 1,
        MoveType: 27,
        SpellID: 780
      })
    )
    expect(card.gainSpellID).toBe(780)
    expect(card.getHandGainSpellID(3)).toBeNull()
    room.moveCards([37], {
      from: { type: 'player', seatID: 1, subZone: 'hand' },
      to: { type: 'public', zone: 'pile', position: POSITION_TOP }
    })
    expect(card.gainSpellID).toBeNull()
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [37],
        CardCount: 1,
        FromZone: 1,
        ToZone: 5,
        ToID: 3,
        MoveType: 1,
        SpellID: 0
      })
    )
    expect(card.gainSpellID).toBeNull()
    expect(room.getPlayer(3)!.observedHandCount).toBe(1)
  })

  it('标记空间与获得技能不同，手牌来源保留协议技能', () => {
    const { controller, room } = setup()
    room.moveCards([37], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 3657 },
      triggerSpellID: 3657
    })
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [37],
        CardCount: 1,
        FromZone: 4,
        FromID: 1,
        FromZoneParam: 3657,
        ToZone: 5,
        ToID: 3,
        MoveType: 18,
        SpellID: 3658
      })
    )
    const card = room.cardIndex.get(37)!
    expect(card.spellID).toBeNull()
    expect(card.gainSpellID).toBe(3658)
    expect(card.getPossibleLocations()).toEqual([
      { type: 'player', seatID: 3, subZone: 'hand', spellID: null }
    ])
  })
})
