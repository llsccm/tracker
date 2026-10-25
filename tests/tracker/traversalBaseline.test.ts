import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { protocolMove } from './helpers/trackerController'
import { describe, expect, it } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { registerDefaultMoveEventHandlers } from '@/tracker/skill/registerHandlers'
import { collectTraversalStats } from '@/tracker/traversalStats'
import type { TraversalStats } from '@/tracker/traversalStats'
import { createTestRoom, getCard, getSuspendedIdentityIDs } from './helpers/room'

// 覆盖 Room 高频移动与收敛路径的遍历基线场景。
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

function createShuffleBaselineRoom(materializeDeckIdentities: boolean) {
  const { room } = createTestRoom({
    cardIDs: DECK_IDS,
    seatIDs: [1, 2]
  })
  room.moveCards([10, 11, 12], {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'player', seatID: 1, subZone: 'hand' },
    cardCount: 3,
    sourceEvent: { type: 'baseline:draw-before-discard' }
  })
  room.moveCards([10, 11, 12], {
    from: { type: 'player', seatID: 1, subZone: 'hand' },
    to: { type: 'public', zone: 'discard', position: POSITION_TOP },
    cardCount: 3,
    sourceEvent: { type: 'baseline:discard' }
  })

  // 移动现已自动完成 cohort 匿名化；历史暗实体对照在准备移动结束后再构造。
  if (materializeDeckIdentities) {
    const pileCards = room.zones.get('pile')!.cards
    Array.from(room.unlocatedIdentities).forEach((cardID, index) => {
      room.materialize(cardID, pileCards[index])!.isKnown = false
    })
    room.resolveConstraints()
  }

  return {
    room,
    pileCount: room.zones.get('pile').cards.length,
    discardCount: room.zones.get('discard').cards.length
  }
}

describe('Room.cards 遍历基线', () => {
  it('常规摸牌：已知牌从牌堆移入手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2, 3] })

    const { stats } = collectTraversalStats(() => {
      room.moveCards([1], {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 1, subZone: 'hand' },
        cardCount: 1,
        sourceEvent: { type: 'baseline:draw-known' }
      })
    })

    expect(getCard(room, 1).location).toBe('player')
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=1",
        "cardCounter:update": "calls=1 visited=1",
        "handSlotCounts:collectBySeat": "calls=2 visited=1",
        "locationIndex:applyDirty": "calls=1 visited=1",
        "resolveConstraints:constraint1": "calls=2 visited=2",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=1",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=1",
        "total": "visited=8",
      }
    `)
  })

  it('暗牌分配：纯计数暗牌移入手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2, 3] })

    const { stats } = collectTraversalStats(() => {
      room.moveCards([], {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 2, subZone: 'hand' },
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
        "handSlotCounts:collectBySeat": "calls=2 visited=2",
        "locationIndex:applyDirty": "calls=1 visited=2",
        "resolveConstraints:constraint1": "calls=1 visited=2",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=2",
        "total": "visited=12",
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
        "handSlotCounts:collectBySeat": "calls=3 visited=6",
        "locationIndex:applyDirty": "calls=1 visited=2",
        "resolveConstraints:constraint1": "calls=2 visited=4",
        "resolveConstraints:constraint3:exclusion": "calls=2 visited=4",
        "resolveConstraints:playerSnapshotIncremental": "calls=3 visited=2",
        "total": "visited=22",
      }
    `)
  })

  it('洗牌：弃牌堆回收并按协议张数重建牌堆', () => {
    // 生产 trackerController 只调用 Room.initDeck()，因此 false 才与实际匿名牌堆路径一致。
    // 37 个旧 cohort 身份仍会创建 suspended 展示实体，但它们从未进入位置投影，直接按终态
    // 注册即可；只有 3 张洗回牌需要匿名化并进入通用增量索引，因此四个消费者各访问 3 张。
    const { room, pileCount, discardCount } = createShuffleBaselineRoom(false)
    expect(discardCount).toBe(3)

    const { stats } = collectTraversalStats(() => {
      room.shufflePile({ cardCount: pileCount + discardCount })
    })

    expect(room.zones.get('discard').cards).toHaveLength(0)
    expect(room.zones.get('pile').cards).toHaveLength(pileCount + 3)
    expect(getSuspendedIdentityIDs(room)).toHaveLength(37)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=3",
        "cardCounter:update": "calls=1 visited=3",
        "handSlotCounts:collectBySeat": "calls=1 visited=0",
        "locationIndex:applyDirty": "calls=1 visited=3",
        "resolveConstraints:constraint1": "calls=1 visited=0",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=0",
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=3",
        "total": "visited=12",
      }
    `)
  })

  it('洗牌对照：已物化牌堆会额外匿名化旧身份实体', () => {
    // true 是测试 helper 提供的历史对照路径，不是生产初始化方式。它还要匿名化牌堆中
    // 37 个正 ID 暗实体；新 suspended 实体仍直接按终态注册，所以只有 40 个原实体进入索引。
    const { room, pileCount, discardCount } = createShuffleBaselineRoom(true)
    expect(discardCount).toBe(3)

    const { stats } = collectTraversalStats(() => {
      room.shufflePile({ cardCount: pileCount + discardCount })
    })

    expect(room.zones.get('discard').cards).toHaveLength(0)
    expect(room.zones.get('pile').cards).toHaveLength(pileCount + 3)
    expect(getSuspendedIdentityIDs(room)).toHaveLength(37)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=40",
        "cardCounter:update": "calls=1 visited=40",
        "handSlotCounts:collectBySeat": "calls=1 visited=0",
        "locationIndex:applyDirty": "calls=1 visited=40",
        "resolveConstraints:constraint1": "calls=1 visited=0",
        "resolveConstraints:constraint3:exclusion": "calls=1 visited=0",
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=40",
        "total": "visited=160",
      }
    `)
  })

  // 统一分配在 handSlotCounts:collectBySeat 中一次归组明暗实体，匿名对账直接消费结果，
  // 不再单独扫描玩家快照；本场景同时守住初轮 3 张和补位后 6 张的归组量及 3 个匿名实体。
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
      (card) => card.isAnonymous && card.location === 'player'
    )
    expect(anonymousHandCards).toHaveLength(3)
    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "ambiguousKnownIndex:applyDirty": "calls=1 visited=6",
        "cardCounter:update": "calls=1 visited=6",
        "handSlotCounts:collectBySeat": "calls=2 visited=9",
        "locationIndex:applyDirty": "calls=1 visited=6",
        "resolveConstraints:constraint1": "calls=2 visited=9",
        "resolveConstraints:playerSnapshotIncremental": "calls=2 visited=3",
        "total": "visited=39",
      }
    `)
  })

  it('天候候选：进交换区时只扫描增量玩家快照', () => {
    const { room } = createTestRoom({ cardIDs: DECK_IDS, seatIDs: [1, 2] })
    const knownCards = [getCard(room, 1), getCard(room, 2)]
    const hiddenCards = [getCard(room, 3), getCard(room, 4)]

    room.clearCardsFromPublicZones([...knownCards, ...hiddenCards])
    knownCards.forEach((card) => card.bindCandidates([2], 'hand', null, { known: true }))
    hiddenCards.forEach((card) => {
      card.bindCandidates([2], 'hand', null, { known: false })
      card.isKnown = false
    })
    room.getPlayer(2).syncObservedHandCount(4)
    room.resolveConstraints()
    registerDefaultMoveEventHandlers(room)

    const pileStage = room.decorateMoveEvent(
      normalizeMoveEvent(
        protocolMove({
          CardCount: 2,
          CardIDs: [],
          FromID: 255,
          FromZone: 1,
          MoveType: 11,
          SpellID: 3903,
          ToID: 2,
          ToZone: 10
        })
      )
    )
    room.moveCards(pileStage.cardIDs, {
      ...pileStage.options,
      from: pileStage.from,
      to: pileStage.to,
      triggerSpellID: pileStage.protocol.SpellID
    })

    const { stats } = collectTraversalStats(() => {
      room.decorateMoveEvent(
        normalizeMoveEvent(
          protocolMove({
            CardCount: 2,
            CardIDs: [],
            FromID: 2,
            FromZone: 5,
            MoveType: 11,
            SpellID: 3903,
            ToID: 2,
            ToZone: 10
          })
        )
      )
    })

    expect(summarize(stats)).toMatchInlineSnapshot(`
      {
        "resolveConstraints:playerSnapshotIncremental": "calls=1 visited=0",
        "tianHou:playerHand": "calls=1 visited=4",
        "total": "visited=4",
      }
    `)
  })
})
