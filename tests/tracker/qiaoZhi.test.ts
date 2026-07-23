import { describe, expect, it } from 'vitest'

import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('巧织暗取牌推断', () => {
  it('明弃未选牌后用展示牌差集确认暗取牌身份', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 3, ClientID: 300 }], 300)
    controller.initTrackerDeck([37, 92])

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 2,
        CardIDs: [37, 92],
        FromID: 255,
        FromZone: 1,
        MoveType: 6,
        SpellID: 3544,
        ToID: 255,
        ToZone: 8
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 3544,
        FromZone: 8,
        MoveType: 18,
        SpellID: 3544,
        ToID: 3,
        ToZone: 5
      })
    )

    const room = controller.getTrackerRoom()
    const anonymousHandCardsBefore = room.cards.filter(
      (card) =>
        card.entityID < 0 &&
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(3)
    )
    expect(anonymousHandCardsBefore).toHaveLength(1)

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [92],
        FromID: 3544,
        FromZone: 8,
        MoveType: 4,
        SpellID: 3544,
        ToID: 255,
        ToZone: 2
      })
    )

    const selectedCard = room.cardIndex.get(37)!
    const discardedCard = room.cardIndex.get(92)!
    const anonymousHandCardsAfter = room.cards.filter(
      (card) =>
        card.entityID < 0 &&
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(3)
    )

    expect(selectedCard.location).toBe('player')
    expect(selectedCard.subZone).toBe('hand')
    expect(selectedCard.seats.has(3)).toBe(true)
    expect(discardedCard.location).toBe('discard')
    expect(room.zones.get('discard')!.cards).toContain(discardedCard)
    expect(anonymousHandCardsAfter).toEqual([])
    expect(
      room.cards.filter(
        (card) => card.location === 'player' && card.subZone === 'mark' && card.spellID === 3544
      )
    ).toEqual([])
    expect(room.skillState.has('qiaozhiSelection')).toBe(false)
  })
})
