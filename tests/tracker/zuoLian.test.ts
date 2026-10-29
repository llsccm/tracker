import { createReadyControllerHarness, protocolMove } from './helpers/trackerController'
import { describe, expect, it } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import { registerDefaultMoveEventHandlers } from '@/tracker/skill/registerHandlers'
import { createTestRoom, getCard, seedDiscardCards } from './helpers/room'

function createRoomWithDiscard(cardNames: string[]) {
  const cardIDs = cardNames.map((_, index) => index + 1)
  const { room } = createTestRoom({ cardIDs, seatIDs: [2] })

  registerDefaultMoveEventHandlers(room)
  const cards = cardIDs.map((cardID, index) => {
    const card = getCard(room, cardID)!
    card.name = cardNames[index]
    card.isKnown = true
    return card
  })

  seedDiscardCards(room, cards)
  return room
}

function createZuoLianMove(fromZone: number) {
  return normalizeMoveEvent({
    CardIDs: [],
    CardCount: 1,
    FromID: 255,
    FromPosition: POSITION_RANDOM,
    FromZone: fromZone,
    FromZoneParam: 0,
    MoveType: 11,
    SpellID: 3488,
    ToID: 0,
    ToPosition: POSITION_TOP,
    ToZone: 10,
    ToZoneParam: 0
  })
}

function applyMove(room: Room, fromZone = 2) {
  const event = room.decorateMoveEvent(createZuoLianMove(fromZone))
  room.moveCards(event.cardIDs, {
    ...event.options,
    from: event.from,
    to: event.to,
    triggerSpellID: event.protocol.SpellID
  })
  return event
}

describe('佐练弃牌堆取牌', () => {
  it('优先取最后入弃牌堆的火杀，即使之后还有雷杀', () => {
    const room = createRoomWithDiscard(['雷杀', '火杀', '火杀', '雷杀'])

    applyMove(room)

    expect(room.zones.get('exchange')!.cards.map((card) => card.id)).toEqual([3])
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 2, 4])
  })

  it('弃牌堆没有火杀时取最后入堆的雷杀', () => {
    const room = createRoomWithDiscard(['雷杀', '杀', '雷杀'])

    applyMove(room)

    expect(room.zones.get('exchange')!.cards.map((card) => card.id)).toEqual([3])
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 2])
  })

  it('牌堆取牌不应用弃牌堆的火杀雷杀优先级', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [2] })
    registerDefaultMoveEventHandlers(room)
    getCard(room, 1)!.name = '火杀'
    getCard(room, 2)!.name = '雷杀'

    const event = room.decorateMoveEvent(createZuoLianMove(1))

    expect(event.options?.sourceCards).toBeUndefined()
  })

  it('弃牌堆无火杀和雷杀时保留普通匿名取牌路径', () => {
    const room = createRoomWithDiscard(['冰杀', '杀'])

    const event = room.decorateMoveEvent(createZuoLianMove(2))

    expect(event.options?.sourceCards).toBeUndefined()
  })
  it('佐练随机明牌进入交换区时复用牌堆匿名槽，不因公开牌顶补建实体', () => {
    const { controller } = createReadyControllerHarness({
      players: [
        { SeatID: 0, ClientID: 100 },
        { SeatID: 6, ClientID: 600 }
      ],
      cardIDs: [39, 112, 113]
    })

    // 先给 0 号位一张暗手牌，再保留一张公开牌顶，复现 RANDOM 来源不能按牌顶端点取牌的场景。
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromPosition: POSITION_TOP,
        MoveType: 1,
        ToID: 0
      })
    )
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, [113])

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')
    const exchange = room.zones.get('exchange')
    const randomPileSlot = pile.cards.find((card) => card.isAnonymous)
    const entityCountBefore = room.cards.length

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [39],
        CardCount: 1,
        FromID: 0,
        FromZone: 5,
        MoveType: 21,
        SpellID: 3488,
        ToID: 0,
        ToPosition: POSITION_RANDOM,
        ToZone: 5
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [39],
        CardCount: 1,
        FromID: 0,
        FromZone: 5,
        MoveType: 11,
        SpellID: 3488,
        ToID: 6,
        ToPosition: POSITION_RANDOM,
        ToZone: 10
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [112],
        CardCount: 1,
        FromID: 255,
        FromPosition: POSITION_RANDOM,
        FromZone: 1,
        MoveType: 11,
        SpellID: 3488,
        ToID: 6,
        ToPosition: POSITION_BOTTOM,
        ToZone: 10
      })
    )

    expect(randomPileSlot).toBeDefined()
    expect(room.cardIndex.get(112)).toBe(randomPileSlot)
    expect(room.cards).toHaveLength(entityCountBefore)
    expect(pile.cards).toHaveLength(1)
    expect(pile.cards.at(-1)).toMatchObject({ id: 113, isKnown: true })
    expect(new Set(exchange.cards.map((card) => card.id))).toEqual(new Set([39, 112]))
    expect(room.assertPileIdentityLedgerConsistency('test:zuolian-random-known')).toEqual([])
  })
})
