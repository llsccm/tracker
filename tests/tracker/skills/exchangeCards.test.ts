import { describe, expect, it } from 'vitest'
import {
  commitExchangeKnownCards,
  planExchangeKnownCards,
  splitExchangeCards
} from '@/tracker/skill/exchangeCards'
import { createTestRoom, getCard, takeAnonymousCard } from '../helpers/room'

describe('交换批次身份预检', () => {
  it('混合明暗批次只物化自己的槽，计划阶段不公开身份或增加实体', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const knownCard = getCard(room, 1)!
    const anonymousCard = takeAnonymousCard(room)
    const otherBatchCard = takeAnonymousCard(room)
    room.clearCardsFromPublicZones([knownCard])
    const exchange = room.getZone('exchange')
    exchange.add(otherBatchCard)
    exchange.add(knownCard)
    exchange.add(anonymousCard)
    const cards = [anonymousCard, knownCard]
    const plan = planExchangeKnownCards(room, [1, 2], cards)

    expect(plan.cards).toEqual([knownCard, anonymousCard])
    expect(anonymousCard.isAnonymous).toBe(true)
    expect(room.cardIndex.has(2)).toBe(false)
    expect(room.unlocatedIdentities.has(2)).toBe(true)

    expect(commitExchangeKnownCards(room, plan)).toBe(true)
    expect(room.cardIndex.get(2)).toBe(anonymousCard)
    expect(otherBatchCard.isAnonymous).toBe(true)
    expect(splitExchangeCards(cards)).toEqual({ knownIDs: [2, 1], unknownCards: [] })
    expect(exchange.cards).toEqual([otherBatchCard, knownCard, anonymousCard])
    expect(room.cards).toHaveLength(4)
  })

  it('已定位在其它批次的身份不能借用本桶暗槽，后续 ID 仍可预检同一空槽', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const otherBatchCard = getCard(room, 3)!
    const target = takeAnonymousCard(room)
    room.clearCardsFromPublicZones([otherBatchCard])
    room.getZone('exchange').add(otherBatchCard)
    room.getZone('exchange').add(target)

    const plan = planExchangeKnownCards(room, [3, 1], [target])

    expect(plan.cards).toEqual([target])
    expect(plan.cards).not.toContain(otherBatchCard)
    expect(target.isAnonymous).toBe(true)
    expect(room.cardIndex.has(1)).toBe(false)
    expect(room.unlocatedIdentities.has(1)).toBe(true)
    expect(room.cardIndex.get(3)).toBe(otherBatchCard)
  })

  it('预检后某个槽被其它身份占用时，提交不会提前物化前面的槽', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const candidates = room.getZone('pile').cards.slice(0, 2)
    const plan = planExchangeKnownCards(room, [1, 2], candidates)
    room.materialize(3, candidates[1])

    expect(commitExchangeKnownCards(room, plan)).toBe(false)
    expect(candidates[0].isAnonymous).toBe(true)
    expect(room.cardIndex.has(1)).toBe(false)
    expect(room.cardIndex.has(2)).toBe(false)
    expect(room.unlocatedIdentities.has(1)).toBe(true)
    expect(room.unlocatedIdentities.has(2)).toBe(true)
    expect(room.cardIndex.get(3)).toBe(candidates[1])
  })
})
