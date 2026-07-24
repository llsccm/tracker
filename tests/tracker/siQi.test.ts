import { describe, expect, it } from 'vitest'

import { POSITION_BOTTOM, POSITION_RANDOM } from '@/tracker/candidate/cardPositions'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import { Room } from '@/tracker/Room'
import { registerDefaultMoveEventHandlers } from '@/tracker/runtime/moveEventHandlers'

function createSiQiEvent(cardCount: number) {
  return normalizeMoveEvent({
    CardCount: cardCount,
    CardIDs: [],
    FromID: 255,
    FromZone: 2,
    FromZoneParam: 0,
    FromPosition: POSITION_RANDOM,
    MoveType: 15,
    SpellID: 3543,
    ToID: 255,
    ToZone: 1,
    ToZoneParam: 0,
    ToPosition: POSITION_BOTTOM
  })
}

function createRoomWithDiscard(
  cardConfigs: {
    color: number
    id: number
  }[]
) {
  const room = new Room()
  registerDefaultMoveEventHandlers(room)
  room.initDeck([])

  const cards = room.createExternalCards(
    cardConfigs.map(({ id }) => id),
    cardConfigs.length
  )
  cards.forEach((card, index) => {
    card.color = cardConfigs[index].color
  })
  room.zones.get('discard')!.add(cards)

  return { cards, room }
}

describe('思泣来源牌推断', () => {
  it('保持 CardIDs 为空并按弃牌堆从顶到下筛选红牌实体', () => {
    const { cards, room } = createRoomWithDiscard([
      { id: 17, color: 1 },
      { id: 18, color: 3 },
      { id: 19, color: 2 }
    ])

    const event = createSiQiEvent(2)
    const decorated = room.decorateMoveEvent(event)

    expect(decorated.cardIDs).toEqual([])
    expect(decorated.options.sourceCards).toEqual([cards[2], cards[0]])
    expect(decorated.options.combinationID).toMatch(/^siqi_candidate_3543_/)
  })

  it('部分红牌可识别时先移动明确来源，再用不同实体补足协议张数', () => {
    const { room } = createRoomWithDiscard([
      { id: 17, color: 1 },
      { id: 18, color: 3 }
    ])

    const event = createSiQiEvent(2)
    const decorated = room.decorateMoveEvent(event)
    room.moveCards(decorated.cardIDs, decorated.toZone, decorated.options)

    expect(room.zones.get('discard')!.cards).toEqual([])
    expect(room.zones.get('pile')!.cards.map((card) => card.id)).toEqual([18, 17])
    expect(new Set(room.zones.get('pile')!.cards).size).toBe(2)
  })
})
