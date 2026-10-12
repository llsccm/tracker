import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createTestRoom } from './helpers/room'

function createRoom() {
  return createTestRoom({ cardIDs: [1, 2, 3], materializeDeckIdentities: false }).room
}

afterEach(() => vi.restoreAllMocks())

describe('玩家快照与实体创建顺序', () => {
  it('同批新实体乱序入手时按创建顺序排列，刷新不搜索全牌池', () => {
    const room = createRoom()
    const [first, second, third] = room.createExternalCards([], 3)
    third.bindCandidates([1], 'hand', null, { known: false })
    first.bindCandidates([1], 'hand', null, { known: false })
    second.bindCandidates([2], 'hand', null, { known: false })
    const indexOf = vi.spyOn(room.cards, 'indexOf')

    const { result, stats } = collectTraversalStats(() => room.refreshPlayerSnapshot())
    expect(result).toEqual([first, second, third])
    expect(room.playerCardsSnapshot).toBe(result)
    expect(indexOf).not.toHaveBeenCalled()
    expect(stats.sites.get('resolveConstraints:playerSnapshot')).toBeUndefined()

    second.moveToPublicZone('outside')
    expect(room.refreshPlayerSnapshot()).toEqual([first, third])
    second.bindCandidates([2], 'hand', null, { known: false })
    expect(room.refreshPlayerSnapshot()).toEqual([first, second, third])
    expect(indexOf).not.toHaveBeenCalled()
  })

  it('身份物化和匿名化不改变同一实体的快照顺序', () => {
    const room = createRoom()
    const [first, second] = room.zones.get('pile')!.cards
    second.bindCandidates([1], 'hand', null, { known: false })
    first.bindCandidates([1], 'hand', null, { known: false })
    expect(room.refreshPlayerSnapshot()).toEqual([first, second])

    expect(room.materialize(1, first)).toBe(first)
    expect(room.anonymizeLocatedIdentity(first, 'test:snapshot', { preservePlacement: true })).toBe(
      1
    )
    expect(first.id).toBeLessThan(0)
    expect(room.refreshPlayerSnapshot()).toEqual([first, second])
    expect(room.materialize(1, first)).toBe(first)
    expect(room.refreshPlayerSnapshot()).toEqual([first, second])
  })

  it('事件断档时全量重建，之后继续增量维护', () => {
    const room = createRoom()
    const [card] = room.createExternalCards([], 1)
    room.refreshPlayerSnapshot()
    card.bindCandidates([1], 'hand', null, { known: false })
    for (let index = 0; index < 501; index += 1) room.notifyCardChanged(card)

    const rebuilt = collectTraversalStats(() => room.refreshPlayerSnapshot())
    expect(rebuilt.result).toEqual([card])
    expect(rebuilt.stats.sites.get('resolveConstraints:playerSnapshot')).toEqual({
      calls: 1,
      visited: room.cards.length
    })

    card.moveToPublicZone('outside')
    const incremental = collectTraversalStats(() => room.refreshPlayerSnapshot())
    expect(incremental.result).toEqual([])
    expect(incremental.stats.sites.get('resolveConstraints:playerSnapshot')).toBeUndefined()
  })

  it('重新建牌堆后清理旧快照和创建顺序', () => {
    const room = createRoom()
    const [oldCard] = room.createExternalCards([], 1)
    oldCard.bindCandidates([1], 'hand', null, { known: false })
    room.refreshPlayerSnapshot()

    room.initDeck([4, 5, 6])
    expect(room.playerCardsSnapshot).toEqual([])
    const [first, second] = room.createExternalCards([], 2)
    second.bindCandidates([1], 'hand', null, { known: false })
    first.bindCandidates([1], 'hand', null, { known: false })
    expect(room.refreshPlayerSnapshot()).toEqual([first, second])
    expect(room.playerCardsSnapshot).not.toContain(oldCard)
  })
})
