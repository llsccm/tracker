import { describe, expect, it } from 'vitest'
import { isAnonymous, type Card } from '@/tracker/Card'
import { POSITION_RANDOM } from '@/tracker/candidate/cardPositions'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import decorateGuanXu, { GUAN_XU_STATE_KEY } from '@/tracker/skill/GuanXu'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

type RawMoveOverrides = NonNullable<Parameters<typeof protocolMove>[0]>

function guanXuMove(overrides: RawMoveOverrides): RawMoveOverrides {
  return protocolMove({
    CardIDs: [],
    CardCount: 0,
    FromPosition: POSITION_RANDOM,
    ToPosition: POSITION_RANDOM,
    MoveType: 11,
    SpellID: 987,
    ...overrides
  })
}

function decorateGuanXuMove(room: Room, overrides: RawMoveOverrides): void {
  decorateGuanXu(normalizeMoveEvent(guanXuMove(overrides)), room)
}

/** 只快照物化/确认会触碰的身份权威与实体字段，避免测试耦合无关增量缓存。 */
function captureMaterializationState(room: Room, cards: Card[]) {
  return {
    entityCount: room.cards.length,
    cardIndex: Array.from(room.cardIndex, ([cardID, card]) => [cardID, card.entityID]).sort(
      ([left], [right]) => Number(left) - Number(right)
    ),
    deckIdentities: Array.from(room.deckIdentities).sort((left, right) => left - right),
    unlocatedIdentities: Array.from(room.unlocatedIdentities).sort((left, right) => left - right),
    cards: cards.map((card) => ({
      entityID: card.entityID,
      id: card.id,
      isKnown: card.isKnown,
      location: card.location,
      subZone: card.subZone,
      suspended: card.suspended,
      round: card.round,
      phase: card.phase,
      turn: card.turn
    }))
  }
}

describe('黄承彦观虚目标视角交换', () => {
  it('目标手牌按 ToPosition 的确定槽位回堆，选中的牌堆身份进入目标手牌且不补建实体', () => {
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
        ToPosition: 2
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
    const returnedPileTopFive = pile.cards.slice(-5).reverse()
    expect(returnedPileTopFive[2]).toBe(returnedHandCard)
    expect(returnedHandCard.publicCandidates).toEqual([])
    expect(pile.cards).not.toContain(gainedPileCard)
    expect(exchange.cards).toHaveLength(0)
    expect(room.cards).toHaveLength(entityCountBefore)
    expect(room.skillState.has(GUAN_XU_STATE_KEY)).toBe(false)
  })

  it('交换桶 ToPosition 为 RANDOM 时仍保留牌顶范围候选', () => {
    const targetSeat = 1
    const actorSeat = 6
    const returnedHandCardID = 16
    const gainedPileCardID = 142
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: targetSeat, ClientID: 100 },
        { SeatID: actorSeat, ClientID: 600 }
      ],
      100
    )
    controller.initTrackerDeck([
      returnedHandCardID,
      gainedPileCardID,
      201,
      202,
      203,
      204,
      205,
      206,
      207,
      208
    ])

    const room = controller.getTrackerRoom()!
    const pile = room.zones.get('pile')!
    const returnedHandCard = room.materialize(returnedHandCardID, pile.cards[0])!
    room.clearCardsFromPublicZones([returnedHandCard])
    returnedHandCard.bindCandidates([targetSeat], 'hand', null, { known: true })
    room.getPlayer(targetSeat)!.syncObservedHandCount(1)
    room.resolveConstraints()

    const moves = [
      guanXuMove({
        CardCount: 5,
        FromID: 255,
        FromZone: 1,
        ToID: actorSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [returnedHandCardID],
        FromID: targetSeat,
        FromZone: 5,
        ToID: targetSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [gainedPileCardID],
        FromID: actorSeat,
        FromZone: 10,
        ToID: targetSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [returnedHandCardID],
        FromID: targetSeat,
        FromZone: 10,
        ToID: actorSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 5,
        FromID: actorSeat,
        FromZone: 10,
        ToID: 255,
        ToZone: 1
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [gainedPileCardID],
        FromID: targetSeat,
        FromZone: 10,
        ToID: targetSeat,
        ToZone: 5
      })
    ]
    moves.forEach((move) => controller.syncTrackerMove(move))

    expect(pile.cards.slice(-5)).toContain(returnedHandCard)
    expect(returnedHandCard.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 5,
        label: '牌堆顶前5张'
      })
    ])
  })

  it('主视角完整回堆 CardIDs 不会被目标视角范围候选覆盖', () => {
    const targetSeat = 1
    const actorSeat = 6
    const returnedHandCardID = 16
    const gainedPileCardID = 142
    const observedPileTopIDs = [62, 67, 37, 53, gainedPileCardID]
    const deckIDs = [returnedHandCardID, ...observedPileTopIDs, 201, 202, 203, 204, 205, 206]
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
    const returnedHandCard = room.materialize(returnedHandCardID, pile.cards[0])!
    room.clearCardsFromPublicZones([returnedHandCard])
    returnedHandCard.bindCandidates([targetSeat], 'hand', null, { known: true })
    room.getPlayer(targetSeat)!.syncObservedHandCount(1)
    room.resolveConstraints()

    // 等价于主视角 handleRoleOptTargetNtf：先建立精确、top-first 的五张牌顶。
    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile',
        reposition: true,
        cardIDsTopFirst: true
      },
      observedPileTopIDs
    )
    expect(
      pile.cards
        .slice(-5)
        .reverse()
        .map((card) => card.id)
    ).toEqual(observedPileTopIDs)

    const exchangeMoves = [
      guanXuMove({
        CardCount: 5,
        CardIDs: observedPileTopIDs,
        FromID: 255,
        FromZone: 1,
        ToID: actorSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [returnedHandCardID],
        FromID: targetSeat,
        FromZone: 5,
        ToID: targetSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [gainedPileCardID],
        FromID: actorSeat,
        FromZone: 10,
        ToID: targetSeat,
        ToZone: 10
      }),
      guanXuMove({
        CardCount: 1,
        CardIDs: [returnedHandCardID],
        FromID: targetSeat,
        FromZone: 10,
        ToID: actorSeat,
        ToZone: 10,
        ToPosition: 2
      })
    ]
    exchangeMoves.forEach((move) => controller.syncTrackerMove(move))

    const guanXuState = room.skillState.get(GUAN_XU_STATE_KEY) as {
      bySpell: Record<string, { buckets: Record<string, { cards: Card[] }> }>
    }
    const returnedPileCardIDs = guanXuState.bySpell[String(987)].buckets[String(actorSeat)].cards
      .filter((card) => card.location === 'exchange')
      .map((card) => card.id)
    expect(returnedPileCardIDs).toHaveLength(5)
    expect(returnedPileCardIDs[2]).toBe(returnedHandCardID)
    expect(returnedPileCardIDs).not.toContain(gainedPileCardID)

    controller.syncTrackerMove(
      guanXuMove({
        CardCount: 5,
        CardIDs: returnedPileCardIDs,
        FromID: actorSeat,
        FromZone: 10,
        ToID: 255,
        ToZone: 1
      })
    )

    expect(returnedHandCard.location).toBe('pile')
    expect(returnedHandCard.publicCandidates).toEqual([])
  })

  it('牌堆分桶校验失败不会确认暗身份或物化部分 CardID', () => {
    const actorSeat = 6
    const deckIDs = Array.from({ length: 10 }, (_, index) => index + 1)
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: actorSeat, ClientID: 600 }
      ],
      100
    )
    controller.initTrackerDeck(deckIDs)

    const room = controller.getTrackerRoom()!
    const pile = room.zones.get('pile')!
    const pileTopFive = pile.cards.slice(-5).reverse()
    const hiddenIdentity = room.materialize(deckIDs[0], pileTopFive[0])!
    hiddenIdentity.isKnown = false
    const before = captureMaterializationState(room, pileTopFive)

    decorateGuanXuMove(room, {
      CardCount: 5,
      CardIDs: [hiddenIdentity.id, 60000, 60001, 60002, 60003, 60004],
      FromID: 255,
      FromZone: 1,
      ToID: actorSeat,
      ToZone: 10
    })

    expect(captureMaterializationState(room, pileTopFive)).toEqual(before)
    expect(room.skillState.has(GUAN_XU_STATE_KEY)).toBe(false)
  })

  it('手牌分桶校验失败不会把匿名手牌提前物化', () => {
    const targetSeat = 1
    const actorSeat = 6
    const deckIDs = Array.from({ length: 12 }, (_, index) => index + 1)
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

    controller.syncTrackerMove(
      protocolMove({ CardCount: 1, CardIDs: [], ToID: targetSeat, ToZone: 5 })
    )
    controller.syncTrackerMove(
      guanXuMove({
        CardCount: 5,
        CardIDs: [],
        FromID: 255,
        FromZone: 1,
        ToID: actorSeat,
        ToZone: 10
      })
    )

    const room = controller.getTrackerRoom()!
    const handCards = room
      .refreshPlayerSnapshot()
      .filter((card) => card.subZone === 'hand' && card.seats.has(targetSeat))
    expect(handCards).toHaveLength(1)
    expect(handCards.every(isAnonymous)).toBe(true)
    const before = captureMaterializationState(room, handCards)

    decorateGuanXuMove(room, {
      CardCount: 1,
      CardIDs: [60010, 60011],
      FromID: targetSeat,
      FromZone: 5,
      ToID: targetSeat,
      ToZone: 10
    })

    expect(captureMaterializationState(room, handCards)).toEqual(before)
    expect(room.skillState.has(GUAN_XU_STATE_KEY)).toBe(false)
  })

  it('交换桶转移校验失败不会消耗后续匿名槽', () => {
    const targetSeat = 1
    const actorSeat = 6
    const deckIDs = Array.from({ length: 12 }, (_, index) => index + 1)
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

    controller.syncTrackerMove(
      protocolMove({ CardCount: 1, CardIDs: [], ToID: targetSeat, ToZone: 5 })
    )
    controller.syncTrackerMove(
      guanXuMove({
        CardCount: 5,
        CardIDs: [],
        FromID: 255,
        FromZone: 1,
        ToID: actorSeat,
        ToZone: 10
      })
    )
    controller.syncTrackerMove(
      guanXuMove({
        CardCount: 1,
        CardIDs: [],
        FromID: targetSeat,
        FromZone: 5,
        ToID: targetSeat,
        ToZone: 10
      })
    )

    const room = controller.getTrackerRoom()!
    const exchangeCards = [...room.zones.get('exchange')!.cards]
    expect(exchangeCards).toHaveLength(6)
    expect(exchangeCards.every(isAnonymous)).toBe(true)
    const before = captureMaterializationState(room, exchangeCards)

    decorateGuanXuMove(room, {
      CardCount: 6,
      CardIDs: [60020],
      FromID: actorSeat,
      FromZone: 10,
      ToID: targetSeat,
      ToZone: 10
    })

    expect(captureMaterializationState(room, exchangeCards)).toEqual(before)
    expect(room.skillState.has(GUAN_XU_STATE_KEY)).toBe(true)
  })
})
