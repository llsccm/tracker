import { describe, expect, it } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_RANDOM } from '@/tracker/candidate/cardPositions'
import { GUAN_XU_STATE_KEY } from '@/tracker/skill/GuanXu'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('黄承彦观虚目标视角交换', () => {
  it('目标手牌随五张牌顶回堆，选中的牌堆身份进入目标手牌且不补建实体', () => {
    const targetSeat = 1
    const actorSeat = 6
    const returnedHandCardID = 16
    const gainedPileCardID = 142
    const deckIDs = [returnedHandCardID, gainedPileCardID, 201, 202, 203, 204, 205, 206, 207, 208]
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: targetSeat, ClientID: 100 },
        { SeatID: actorSeat, ClientID: 600 }
      ],
      100
    )
    controller.initTrackerDeck(deckIDs)

    const room = controller.getTrackerRoom()!
    const pile = room.zones.get('pile')!
    const exchange = room.zones.get('exchange')!
    const returnedHandCard = room.materialize(returnedHandCardID, pile.cards[0])!
    room.clearCardsFromPublicZones([returnedHandCard])
    returnedHandCard.bindCandidates([targetSeat], 'hand', null, { known: true })
    room.getPlayer(targetSeat)!.syncObservedHandCount(1)
    room.resolveConstraints()

    const entityCountBefore = room.cards.length
    const pileCountBefore = pile.cards.length
    const originalPileTopFive = pile.cards.slice(-5)
    expect(originalPileTopFive.every(isAnonymous)).toBe(true)
    expect(room.cardIndex.has(gainedPileCardID)).toBe(false)
    expect(room.unlocatedIdentities.has(gainedPileCardID)).toBe(true)

    const moves = [
      protocolMove({
        CardCount: 5,
        CardIDs: [],
        FromID: 255,
        FromZone: 1,
        FromPosition: POSITION_RANDOM,
        MoveType: 11,
        SpellID: 987,
        ToID: actorSeat,
        ToZone: 10,
        ToPosition: POSITION_RANDOM
      }),
      protocolMove({
        CardCount: 1,
        CardIDs: [returnedHandCardID],
        FromID: targetSeat,
        FromZone: 5,
        FromPosition: POSITION_RANDOM,
        MoveType: 11,
        SpellID: 987,
        ToID: targetSeat,
        ToZone: 10,
        ToPosition: POSITION_RANDOM
      }),
      protocolMove({
        CardCount: 1,
        CardIDs: [gainedPileCardID],
        FromID: actorSeat,
        FromZone: 10,
        FromPosition: POSITION_RANDOM,
        MoveType: 11,
        SpellID: 987,
        ToID: targetSeat,
        ToZone: 10,
        ToPosition: POSITION_RANDOM
      }),
      protocolMove({
        CardCount: 1,
        CardIDs: [returnedHandCardID],
        FromID: targetSeat,
        FromZone: 10,
        FromPosition: POSITION_RANDOM,
        MoveType: 11,
        SpellID: 987,
        ToID: actorSeat,
        ToZone: 10,
        ToPosition: POSITION_RANDOM
      }),
      protocolMove({
        CardCount: 5,
        CardIDs: [],
        FromID: actorSeat,
        FromZone: 10,
        FromPosition: POSITION_RANDOM,
        MoveType: 11,
        SpellID: 987,
        ToID: 255,
        ToZone: 1,
        ToPosition: POSITION_RANDOM
      }),
      protocolMove({
        CardCount: 1,
        CardIDs: [gainedPileCardID],
        FromID: targetSeat,
        FromZone: 10,
        FromPosition: POSITION_RANDOM,
        MoveType: 11,
        SpellID: 987,
        ToID: targetSeat,
        ToZone: 5,
        ToPosition: POSITION_RANDOM
      })
    ]

    moves.slice(0, 3).forEach((move) => controller.syncTrackerMove(move))

    const gainedPileCard = room.cardIndex.get(gainedPileCardID)!
    expect(originalPileTopFive).toContain(gainedPileCard)
    expect(room.unlocatedIdentities.has(gainedPileCardID)).toBe(false)
    expect(room.cards).toHaveLength(entityCountBefore)

    moves.slice(3).forEach((move) => controller.syncTrackerMove(move))

    const targetHandCards = room
      .refreshPlayerSnapshot()
      .filter((card) => card.subZone === 'hand' && card.seats.has(targetSeat))

    expect(targetHandCards).toContain(gainedPileCard)
    expect(targetHandCards).not.toContain(returnedHandCard)
    expect(pile.cards).toHaveLength(pileCountBefore)
    expect(pile.cards.slice(-5)).toContain(returnedHandCard)
    expect(returnedHandCard.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 5,
        label: '牌堆顶前5张'
      })
    ])
    expect(pile.cards).not.toContain(gainedPileCard)
    expect(exchange.cards).toHaveLength(0)
    expect(room.cards).toHaveLength(entityCountBefore)
    expect(room.skillState.has(GUAN_XU_STATE_KEY)).toBe(false)
  })
})
