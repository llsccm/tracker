import { describe, expect, it } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { CARD_INSTANCE_STATUS } from '@/tracker/CardCounter'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createTestRoom } from './helpers/room'

describe('阶段 1 匿名牌堆 spike', () => {
  it('牌堆初始化为匿名槽并把整副牌登记为未定位身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    expect(pile.cards).toHaveLength(3)
    expect(pile.cards.every(isAnonymous)).toBe(true)
    expect(new Set(pile.cards.map((card) => card.entityID)).size).toBe(3)
    expect(room.cardIndex.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN]).toEqual(new Set([1, 2, 3]))
  })

  it('未知摸牌只移动匿名槽且不提前认领真实身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown' }
    })

    const hiddenHand = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand'
    )
    expect(hiddenHand).toHaveLength(2)
    expect(hiddenHand.every(isAnonymous)).toBe(true)
    expect(room.zones.get('pile')!.cards).toHaveLength(2)
    expect(room.cardIndex.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3, 4]))
  })

  it('牌堆来源明牌原地物化且不触发旧冲突修复路径', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const originalTopSlot = pile.cards.at(-1)

    const { stats } = collectTraversalStats(() => {
      room.moveCards([4], 'player', {
        seatID: 1,
        fromZone: 'pile',
        cardCount: 1,
        sourceEvent: { type: 'stage1:draw-known' }
      })
    })

    const card = room.cardIndex.get(4)
    expect(card).toBe(originalTopSlot)
    expect(card?.entityID).toBe(4)
    expect(card?.location).toBe('player')
    expect(card?.isKnown).toBe(true)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(pile.cards).toHaveLength(3)
    expect(stats.sites.has('anonymousSlot:swapKnownCardWithPublicSourcePlaceholder')).toBe(false)
    expect(stats.sites.has('anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal')).toBe(
      false
    )
    expect(stats.sites.has('anonymousSlot:insertUnknownPlaceholderIntoPile')).toBe(false)
  })

  it('游戏外匿名手牌首次揭示时扩展并物化身份全集', () => {
    const { room } = createTestRoom({
      cardIDs: [1],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const [placeholder] = room.createExternalCards([], 1)
    placeholder.bindCandidates([1], 'hand', null, { known: false })

    room.moveCards([60992], 'player', {
      seatID: 1,
      fromSeatID: 1,
      fromZone: null,
      fromSubZone: 'hand',
      subZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'stage1:reveal-external-hand' }
    })

    expect(room.cardIndex.get(60992)).toBe(placeholder)
    expect(placeholder.id).toBe(60992)
    expect(placeholder.isKnown).toBe(true)
    expect(room.deckIdentities.has(60992)).toBe(true)
    expect(room.unlocatedIdentities.has(60992)).toBe(false)
  })
})
