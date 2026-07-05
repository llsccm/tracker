import { describe, expect, it } from 'vitest'
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
        "resolveConstraints:constraint1": "calls=2 visited=2",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=1",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=1",
        "total": "visited=48",
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
        "resolveConstraints:constraint1": "calls=1 visited=2",
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=2",
        "total": "visited=52",
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
        "resolveConstraints:constraint1": "calls=2 visited=4",
        "resolveConstraints:constraint3:exclusion": "calls=2 visited=4",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=2",
        "total": "visited=60",
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
        "resolveConstraints:constraint1": "calls=1 visited=0",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=0",
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=0",
        "shufflePile:classify": "calls=1 visited=0",
        "total": "visited=40",
      }
    `)
  })
})
