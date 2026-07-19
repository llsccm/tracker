import { describe, expect, it } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { collectTraversalStats } from '@/tracker/traversalStats'
import type { TraversalStats } from '@/tracker/traversalStats'
import { createTestRoom, getCard } from './helpers/room'

// 覆盖 plans/cards-traversal-optimization-final.md 第一节的四个基线场景。
// 快照数字是遍历量护栏：结构性优化（如 A1/E2）应使数字下降并用 `vitest run -u` 刷新，
// 无关改动使数字上升时需要先解释再更新。
const DECK_IDS = Array.from({ length: 40 }, (_, index) => index + 1)

function summarize(stats: TraversalStats) {
  const summary: Record<string, string> = {}
  let totalVisited = 0

  Array.from(stats.sites.keys())
    .sort()
    .forEach((site) => {
      const entry = stats.sites.get(site)
      summary[site] = `calls=${entry.calls} visited=${entry.visited}`
      totalVisited += entry.visited
    })

  summary.total = `visited=${totalVisited}`
  return summary
}

describe('Room.cards 遍历基线', () => {
  it('常规摸牌：已知牌从牌堆移入手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2, 3] })

    const { stats } = collectTraversalStats(() => {
      room.moveCards([1], 'player', {
        seatID: 1,
        subZone: 'hand',
        fromZone: 'pile',
        cardCount: 1,
        sourceEvent: { type: 'baseline:draw-known' }
      })
    })

    expect(getCard(room, 1).location).toBe('player')
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=1",
        "cardCounter:update": "calls=1 visited=1",
        "handSlotCounts:collectBySeat": "calls=2 visited=41",
        "locationIndex:applyDirty": "calls=1 visited=1",
        "reconcileAnonymousHandCards:group": "calls=2 visited=2",
        "resolveConstraints:constraint1": "calls=2 visited=2",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=1",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=1",
        "total": "visited=50",
      }
    `)
  })

  it('暗牌分配：纯计数暗牌移入手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2, 3] })

    const { stats } = collectTraversalStats(() => {
      room.moveCards([], 'player', {
        seatID: 2,
        subZone: 'hand',
        fromZone: 'pile',
        cardCount: 2,
        sourceEvent: { type: 'baseline:draw-hidden' }
      })
    })

    const hiddenHandCards = room.cards.filter(
      (card) => card.location === 'player' && card.seats.has(2) && card.isKnown !== true
    )
    expect(hiddenHandCards).toHaveLength(2)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=2",
        "cardCounter:update": "calls=1 visited=2",
        "handSlotCounts:collectBySeat": "calls=2 visited=42",
        "locationIndex:applyDirty": "calls=1 visited=2",
        "reconcileAnonymousHandCards:group": "calls=1 visited=2",
        "resolveConstraints:constraint1": "calls=1 visited=2",
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=2",
        "total": "visited=54",
      }
    `)
  })

  it('约束三排他触发：暗牌额度归零排除候选明牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2] })
    const first = getCard(room, 5)
    const second = getCard(room, 6)

    room.clearCardsFromPublicZones([first, second])
    first.bindCandidates([1, 2], 'hand', null, { known: true })
    second.bindCandidates([1, 2], 'hand', null, { known: true })
    // 先让候选态收敛完毕，测量只覆盖排他触发本身。
    room.resolveConstraints()

    const { stats } = collectTraversalStats(() => {
      room.syncObservedPlayerHandCount(1, 0)
    })

    expect(first.seats.has(1)).toBe(false)
    expect(second.seats.has(1)).toBe(false)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=2",
        "cardCounter:update": "calls=1 visited=2",
        "handSlotCounts:collectBySeat": "calls=3 visited=44",
        "locationIndex:applyDirty": "calls=1 visited=2",
        "reconcileAnonymousHandCards:group": "calls=2 visited=4",
        "resolveConstraints:constraint1": "calls=2 visited=4",
        "resolveConstraints:constraint3:exclusion": "calls=2 visited=4",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=2",
        "total": "visited=64",
      }
    `)
  })

  it('洗牌：弃牌堆回收并按协议张数重建牌堆', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2] })
    room.moveCards([10, 11, 12], 'player', {
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'baseline:draw-before-discard' }
    })
    room.moveCards([10, 11, 12], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'baseline:discard' }
    })
    const pileCount = room.zones.get('pile').cards.length
    const discardCount = room.zones.get('discard').cards.length
    expect(discardCount).toBe(3)

    const { stats } = collectTraversalStats(() => {
      room.shufflePile({ cardCount: pileCount + discardCount })
    })

    expect(room.zones.get('discard').cards).toHaveLength(0)
    expect(room.zones.get('pile').cards).toHaveLength(pileCount + 3)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=0",
        "cardCounter:update": "calls=1 visited=40",
        "handSlotCounts:collectBySeat": "calls=1 visited=0",
        "locationIndex:applyDirty": "calls=1 visited=0",
        "reconcileAnonymousHandCards:group": "calls=1 visited=0",
        "resolveConstraints:constraint1": "calls=1 visited=0",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=0",
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=0",
        "shufflePile:classify": "calls=1 visited=0",
        "total": "visited=40",
      }
    `)
  })

  // reconcileAnonymousHandCards 现改用 playerCardsSnapshot 一次性归组（替代过去对每个已观测玩家
  // 各扫一遍 this.cards 全量）。新增站点 reconcileAnonymousHandCards:group 的 visited 反映真实的
  // 玩家区扫描量——远小于旧的隐藏 40 张全量过滤。本场景用带 observedHandCount 的多玩家未知手牌
  // 把该扫描量显式护栏化：两名已观测玩家、3 张明牌快照 → 归组 visited=3 且补齐 3 个匿名实体。
  it('主动匿名对账：按玩家区快照归组补齐未知手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2, 3] })
    const seat1Known = [getCard(room, 1), getCard(room, 2)]
    const seat2Known = [getCard(room, 3)]

    room.clearCardsFromPublicZones([...seat1Known, ...seat2Known])
    seat1Known.forEach((card) => card.bindCandidates([1], 'hand', null, { known: true }))
    seat2Known.forEach((card) => card.bindCandidates([2], 'hand', null, { known: true }))
    room.getPlayer(1).syncObservedHandCount(4)
    room.getPlayer(2).syncObservedHandCount(2)

    const { stats } = collectTraversalStats(() => {
      room.resolveConstraints()
    })

    const anonymousHandCards = room.cards.filter(
      (card) => isAnonymous(card) && card.location === 'player'
    )
    expect(anonymousHandCards).toHaveLength(3)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=6",
        "anonymousSlot:createExternalCardsFallback": "calls=2 visited=3",
        "cardCounter:update": "calls=1 visited=6",
        "handSlotCounts:collectBySeat": "calls=3 visited=15",
        "locationIndex:applyDirty": "calls=1 visited=6",
        "reconcileAnonymousHandCards:group": "calls=2 visited=9",
        "resolveConstraints:constraint1": "calls=2 visited=9",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=6",
        "total": "visited=60",
      }
    `)
  })
})
