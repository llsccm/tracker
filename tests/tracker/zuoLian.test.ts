import { describe, expect, it } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import { registerDefaultMoveEventHandlers } from '@/tracker/runtime/moveEventHandlers'
import { createTestRoom, getCard } from './helpers/room'

function createRoomWithDiscard(cardNames: string[]) {
  const cardIDs = cardNames.map((_, index) => index + 1)
  const { room } = createTestRoom({ cardIDs, seatIDs: [2] })
  const discard = room.zones.get('discard')!

  registerDefaultMoveEventHandlers(room)
  cardIDs.forEach((cardID, index) => {
    const card = getCard(room, cardID)!
    card.name = cardNames[index]
    card.isKnown = true
    discard.add(card, POSITION_TOP)
  })

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
  room.moveCards(event.cardIDs, event.toZone, event.options)
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
})
