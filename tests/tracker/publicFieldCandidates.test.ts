import { describe, expect, it, vi } from 'vitest'
import { getPublicFieldCandidateCards } from '@/tracker/view/publicFieldCandidates'
import { createTestRoom } from './helpers/room'

describe('公共区模糊明牌候选', () => {
  it('索引缺项时合并当前手牌候选扫描结果', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const indexedCard = room.cardIndex.get(1)!
    const missingCard = room.cardIndex.get(2)!

    indexedCard.bindCandidates([1, 2], 'hand', null, { known: true })
    room.ambiguousKnownIndex.rebuild()
    missingCard.bindCandidates([1, 2], 'hand', null, { known: true })

    expect(getPublicFieldCandidateCards(room).map((card) => card.id)).toEqual([1, 2])
    expect(getPublicFieldCandidateCards(room).map((card) => card.id)).toEqual([1, 2])
  })

  it('索引过期时移除已经进入弃牌堆的候选', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = room.cardIndex.get(1)!

    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.ambiguousKnownIndex.rebuild()
    room.zones.get('discard').add(card)

    expect(getPublicFieldCandidateCards(room)).toEqual([])
  })

  it('索引完整时不全量扫描房间卡牌池', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = room.cardIndex.get(1)!

    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.ambiguousKnownIndex.rebuild()

    const filterSpy = vi.spyOn(room.cards, 'filter')
    try {
      expect(getPublicFieldCandidateCards(room).map((item) => item.id)).toEqual([1])
      expect(filterSpy).not.toHaveBeenCalled()
    } finally {
      filterSpy.mockRestore()
    }
  })

  it('脏牌事件日志被裁剪时兜底扫描 dirtyCards', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const indexedCard = room.cardIndex.get(1)!
    const missingCard = room.cardIndex.get(2)!

    indexedCard.bindCandidates([1, 2], 'hand', null, { known: true })
    room.ambiguousKnownIndex.rebuild()
    missingCard.bindCandidates([1, 2], 'hand', null, { known: true })
    room.dirtyCardEvents = [room.dirtyCardEvents[room.dirtyCardEvents.length - 1]]

    expect(getPublicFieldCandidateCards(room).map((card) => card.id)).toEqual([1, 2])
  })

  it('销毁房间时清理脏牌事件日志', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = room.cardIndex.get(1)!

    card.bindCandidates([1, 2], 'hand', null, { known: true })
    expect(room.dirtyCards.size).toBeGreaterThan(0)
    expect(room.dirtyCardSeq).toBeGreaterThan(0)
    expect(room.dirtyCardEvents.length).toBeGreaterThan(0)

    room.destroy()

    expect(room.dirtyCards.size).toBe(0)
    expect(room.dirtyCardSeq).toBe(0)
    expect(room.dirtyCardEvents).toEqual([])
  })
})
