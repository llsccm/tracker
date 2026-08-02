import { describe, expect, it } from 'vitest'
import { Card } from '@/tracker/Card'
import { CARD_INSTANCE_STATUS } from '@/tracker/CardCounter'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createTestRoom, getCard } from './helpers/room'

function ids(set: Set<number>): number[] {
  return Array.from(set).sort((a, b) => a - b)
}

describe('CardCounter 状态索引', () => {
  it('按未知、出现、弃牌、移出游戏四类同步派生索引', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })

    room.moveCards([0], 'player', {
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:hidden-hand' }
    })
    room.moveCards([2], 'player', {
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:known-hand' }
    })
    room.moveCards([3], 'discard', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:discard' }
    })
    room.moveCards([4], 'exile', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:exile' }
    })
    const placeholder = room.createExternalCards([], 1)[0]
    placeholder.bindCandidates([1], 'hand', null, { known: false })

    const hiddenHandCard = room.cards.find(
      (card) =>
        card.id < 0 &&
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.isKnown !== true
    )

    room.counter.update()

    expect(hiddenHandCard).toBeTruthy()
    expect(ids(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN])).toEqual([1, 5])
    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.UNKNOWN].has(placeholder)).toBe(true)
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN].has(placeholder.id)).toBe(false)
    expect(ids(room.counter.statusIndex[CARD_INSTANCE_STATUS.APPEARED])).toEqual([2])
    expect(ids(room.counter.statusIndex[CARD_INSTANCE_STATUS.DISCARD])).toEqual([3])
    expect(ids(room.counter.statusIndex[CARD_INSTANCE_STATUS.REMOVED])).toEqual([4])
    room.counter.statusIndex.forEach((statusSet, status) => {
      statusSet.forEach((id) => {
        expect(room.counter.cardInstances[id].status).toBe(status)
      })
    })
  })

  it('公开状态桶读取时会刷新游戏外新牌的当前位置', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })

    const [externalCard] = room.createExternalCards([2], 1)

    expect(room.deckIdentities.has(externalCard.id)).toBe(true)
    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.UNKNOWN].has(externalCard)).toBe(false)
    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.REMOVED].has(externalCard)).toBe(true)
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN].has(externalCard.id)).toBe(false)
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.REMOVED].has(externalCard.id)).toBe(true)
    expect(room.counter.cardInstances[externalCard.id].status).toBe(CARD_INSTANCE_STATUS.REMOVED)
  })

  it('显式注册追加实体后推进尾部游标，getter 不重复扫描已注册牌', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })

    const { stats } = collectTraversalStats(() => {
      const [externalCard] = room.createExternalCards([2], 1)
      expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.REMOVED]).toContain(externalCard)
    })

    expect(stats.sites.get('cardCounter:collectNewRoomCards')).toBeUndefined()
    expect(stats.sites.get('cardCounter:update')).toBeUndefined()
  })

  it('getter 刷新后仍保留通过 addCard 注册的非 room.cards 牌', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const registeredCard = new Card(2, room)

    room.counter.addCard(registeredCard)
    registeredCard.moveToPublicZone('outside')

    expect(room.cards).not.toContain(registeredCard)
    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.REMOVED].has(registeredCard)).toBe(true)
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.REMOVED].has(registeredCard.id)).toBe(true)
    expect(room.counter.cardInstances[registeredCard.id].status).toBe(CARD_INSTANCE_STATUS.REMOVED)
  })

  it('公开状态桶读取时会刷新占位牌的手牌明暗状态', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const [placeholder] = room.createExternalCards([], 1)

    placeholder.bindCandidates([1], 'hand', null, { known: false })

    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.UNKNOWN].has(placeholder)).toBe(true)
    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.APPEARED].has(placeholder)).toBe(false)

    placeholder.confirmKnown()

    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.UNKNOWN].has(placeholder)).toBe(false)
    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.APPEARED].has(placeholder)).toBe(true)
  })

  it('状态桶 getter 在无新变化时复用干净缓存', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)!

    card.bindTo([1], 'hand')

    const { stats } = collectTraversalStats(() => {
      const statusIndex = room.counter.statusIndex
      const cardsByStatus = room.counter.cardsByStatus
      const cardInstances = room.counter.cardInstances
      expect(statusIndex[CARD_INSTANCE_STATUS.APPEARED].has(1)).toBe(true)
      expect(cardsByStatus[CARD_INSTANCE_STATUS.APPEARED].has(card)).toBe(true)
      expect(cardInstances[1].status).toBe(CARD_INSTANCE_STATUS.APPEARED)
    })

    expect(stats.sites.get('cardCounter:update')).toEqual({
      calls: 1,
      visited: 1
    })
  })

  it('状态变化后状态桶 getter 会失效并重建缓存', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)!

    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN].has(1)).toBe(true)

    card.bindTo([1], 'hand')

    const { stats } = collectTraversalStats(() => {
      const statusIndex = room.counter.statusIndex
      const cardsByStatus = room.counter.cardsByStatus
      const cardInstances = room.counter.cardInstances
      expect(statusIndex[CARD_INSTANCE_STATUS.APPEARED].has(1)).toBe(true)
      expect(cardsByStatus[CARD_INSTANCE_STATUS.APPEARED].has(card)).toBe(true)
      expect(cardInstances[1].status).toBe(CARD_INSTANCE_STATUS.APPEARED)
    })

    expect(stats.sites.get('cardCounter:update')).toEqual({
      calls: 1,
      visited: 1
    })
  })
})
