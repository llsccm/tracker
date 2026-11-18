import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { fromPublicCandidate } from '@/tracker/candidate/locationCandidate'
import { createPublicCandidate } from '@/tracker/candidate/publicCandidate'
import {
  commitExchangeKnownCards,
  planExchangeKnownCards,
  splitExchangeCards
} from '@/tracker/skill/exchangeCards'
import { createTestRoom, getCard, takeAnonymousCard } from '../helpers/room'

describe('交换批次身份预检', () => {
  it('范围身份在本批匿名槽上物化，预检保留载体和物理顺序', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const pile = room.getZone('pile')
    const physicalCards = [...room.cards]
    const pileBefore = [...pile.cards]
    const candidate = fromPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 3))!
    const [identity] = room.revealPublicCandidates([1], candidate)
    const candidates = pile.cards.slice(-2)
    const plan = planExchangeKnownCards(room, [1, 2], candidates)

    expect(plan.cards).toEqual(candidates)
    expect(candidates.every((card) => card.isAnonymous)).toBe(true)
    expect(room.cardIndex.get(1)).toBe(identity)
    expect(room.detachedKnownCards.has(identity)).toBe(true)
    expect(room.cardIndex.has(2)).toBe(false)
    expect(pile.cards).toEqual(pileBefore)

    expect(commitExchangeKnownCards(room, plan)).toBe(true)
    expect(room.cardIndex.get(1)).toBe(candidates[0])
    expect(room.cardIndex.get(2)).toBe(candidates[1])
    expect(room.detachedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities.has(2)).toBe(false)
    expect(candidates.map((card) => card.id)).toEqual([1, 2])
    expect(room.cards).toEqual(physicalCards)
    expect(pile.cards).toEqual(pileBefore)
  })

  it('后续槽失效时整批拒绝，前面的范围身份不会提前迁移', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const candidate = fromPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 3))!
    const [identity] = room.revealPublicCandidates([1], candidate)
    const candidates = room.getZone('pile').cards.slice(-2)
    const plan = planExchangeKnownCards(room, [1, 2], candidates)
    room.materialize(3, candidates[1])

    expect(commitExchangeKnownCards(room, plan)).toBe(false)
    expect(candidates[0].isAnonymous).toBe(true)
    expect(room.cardIndex.get(1)).toBe(identity)
    expect(room.detachedKnownCards.has(identity)).toBe(true)
    expect(room.cardIndex.has(2)).toBe(false)
    expect(room.unlocatedIdentities.has(2)).toBe(true)
  })

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
    expect(plan.commits).toEqual([{ card: target, cardID: 1, materialize: true }])
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
