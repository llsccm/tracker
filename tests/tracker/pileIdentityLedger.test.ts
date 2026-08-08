import { describe, expect, it } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { PileIdentityLedger, type PileIdentityLedgerMove } from '@/tracker/PileIdentityLedger'

type SharedMove = Omit<PileIdentityLedgerMove, 'discardCountAfter'>

function applyMove(ledger: PileIdentityLedger, move: SharedMove, discardCountAfter = 0): void {
  ledger.applyMove({ ...move, discardCountAfter })
  expect(ledger.assertConsistency(move.pileCountAfter, move.eventType)).toEqual([])
}

function createTwoCohortLedger(): PileIdentityLedger {
  const ledger = new PileIdentityLedger()
  ledger.initialize([4])
  applyMove(
    ledger,
    {
      eventType: 'discardKnown',
      fromZone: 0,
      toZone: 2,
      cardIDs: [1, 2, 3],
      cardCount: 3,
      pileCountAfter: 1
    },
    3
  )
  applyMove(ledger, {
    eventType: 'shuffleDiscardIntoPile',
    fromZone: 2,
    toZone: 9,
    cardIDs: [],
    cardCount: 4,
    pileCountAfter: 4
  })
  applyMove(ledger, {
    eventType: 'drawUnknown',
    fromZone: 1,
    toZone: 5,
    cardIDs: [],
    cardCount: 1,
    fromPosition: POSITION_BOTTOM,
    pileCountAfter: 3
  })
  return ledger
}

describe('PileIdentityLedger', () => {
  it('初始化一致性按归一化身份数校验', () => {
    const warnings: Record<string, unknown>[] = []
    const ledger = new PileIdentityLedger({
      onWarning: (_message, detail) => warnings.push(detail)
    })

    ledger.initialize([1, 1, 2, 0, -1])

    expect(ledger.getSnapshot().accountedPileCount).toBe(2)
    expect(warnings).toEqual([])
  })

  it('匿名弃牌洗回只降级 cohort，不报告账本异常', () => {
    const warnings: Record<string, unknown>[] = []
    const ledger = new PileIdentityLedger({
      onWarning: (_message, detail) => warnings.push(detail)
    })
    ledger.initialize([1, 2, 3, 4])

    applyMove(ledger, {
      eventType: 'drawUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      pileCountAfter: 3
    })
    applyMove(
      ledger,
      {
        eventType: 'discardUnknown',
        fromZone: 5,
        toZone: 2,
        cardIDs: [],
        cardCount: 1,
        pileCountAfter: 3
      },
      1
    )
    applyMove(ledger, {
      eventType: 'shuffleDiscardIntoPile',
      fromZone: 2,
      toZone: 9,
      cardIDs: [],
      cardCount: 4,
      pileCountAfter: 4
    })

    expect(ledger.getSnapshot().accountedPileCount).toBe(4)
    expect(warnings).toEqual([])
  })

  it('开局整副牌暂存弃牌堆时恢复 generation 0 而不滚动世代', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3, 4])

    applyMove(
      ledger,
      {
        eventType: 'discardKnown',
        fromZone: 1,
        toZone: 2,
        cardIDs: [1, 2, 3, 4],
        cardCount: 4,
        pileCountAfter: 0
      },
      4
    )
    applyMove(ledger, {
      eventType: 'shuffleDiscardIntoPile',
      fromZone: 2,
      toZone: 9,
      cardIDs: [],
      cardCount: 4,
      pileCountAfter: 4
    })

    expect(ledger.getSnapshot().cohort).toMatchObject({
      generation: 0,
      groups: [
        {
          generation: 0,
          kind: 'all-in-pile',
          cardIDs: [1, 2, 3, 4],
          remainingPileCount: 4
        }
      ]
    })
  })

  it('完整协议序列保持 cohort 基数与身份分区守恒', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3, 4, 5, 6])

    const events: { move: SharedMove; discardCountAfter?: number }[] = [
      {
        move: {
          eventType: 'drawUnknown',
          fromZone: 1,
          toZone: 5,
          cardIDs: [],
          cardCount: 2,
          fromPosition: POSITION_TOP,
          pileCountAfter: 4
        }
      },
      {
        move: {
          eventType: 'discardKnown',
          fromZone: 5,
          toZone: 2,
          cardIDs: [1],
          cardCount: 1,
          pileCountAfter: 4
        },
        discardCountAfter: 1
      },
      {
        move: {
          eventType: 'shuffleDiscardIntoPile',
          fromZone: 2,
          toZone: 9,
          cardIDs: [],
          cardCount: 5,
          pileCountAfter: 5
        }
      },
      {
        move: {
          eventType: 'drawUnknown',
          fromZone: 1,
          toZone: 5,
          cardIDs: [],
          cardCount: 1,
          fromPosition: POSITION_BOTTOM,
          pileCountAfter: 4
        }
      },
      {
        move: {
          eventType: 'moveKnown',
          fromZone: 1,
          toZone: 5,
          cardIDs: [3],
          cardCount: 1,
          fromPosition: POSITION_RANDOM,
          moveType: 18,
          spellID: 8123,
          pileCountAfter: 3
        }
      },
      {
        move: {
          eventType: 'moveKnown',
          fromZone: 0,
          toZone: 1,
          cardIDs: [7],
          cardCount: 1,
          toPosition: POSITION_TOP,
          pileCountAfter: 4
        }
      },
      {
        move: {
          eventType: 'moveKnown',
          fromZone: 0,
          toZone: 1,
          cardIDs: [8],
          cardCount: 1,
          toPosition: POSITION_RANDOM,
          pileCountAfter: 5
        }
      },
      {
        move: {
          eventType: 'moveUnknown',
          fromZone: 1,
          toZone: 5,
          cardIDs: [],
          cardCount: 2,
          fromPosition: POSITION_RANDOM,
          moveType: 18,
          spellID: 9999,
          pileCountAfter: 3
        }
      },
      {
        move: {
          eventType: 'returnToPile',
          fromZone: 5,
          toZone: 1,
          cardIDs: [],
          cardCount: 2,
          toPosition: POSITION_RANDOM,
          pileCountAfter: 5
        }
      },
      {
        move: {
          eventType: 'showCards',
          fromZone: 1,
          toZone: 1,
          cardIDs: [7],
          cardCount: 1,
          fromPosition: POSITION_TOP,
          toPosition: POSITION_TOP,
          moveType: 21,
          spellID: 7011,
          pileCountAfter: 5
        }
      }
    ]

    events.forEach(({ move, discardCountAfter = 0 }) => {
      applyMove(ledger, move, discardCountAfter)
    })

    expect(ledger.getSnapshot()).toMatchObject({
      revision: events.length + 1,
      knownPileIdentityIDs: [7],
      hiddenPileSlotCount: 4,
      accountedPileCount: 5,
      cohort: {
        generation: 1,
        groups: [
          {
            generation: 1,
            kind: 'partial',
            cardIDs: [1, 2, 4, 5, 6, 8],
            remainingPileCount: 4
          }
        ]
      }
    })
  })

  it('正式目标态允许 cohort 身份由未定位池或 suspended 展示实体承载', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3])

    expect(
      ledger.assertConsistency(3, 'test:target-partition', {
        deckIdentityIDs: new Set([1, 2, 3]),
        unlocatedIdentityIDs: new Set([1]),
        suspendedIdentityIDs: new Set([2])
      })
    ).toContainEqual({
      context: 'test:target-partition',
      reason: 'cohort-identity-missing-from-room-partition',
      cardID: 3
    })
  })

  it('B1/B2 同区或范围揭示把身份从暗批次转为已知牌堆身份', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3])

    applyMove(ledger, {
      eventType: 'showCards',
      fromZone: 1,
      toZone: 1,
      cardIDs: [1],
      cardCount: 1,
      fromPosition: POSITION_TOP,
      toPosition: POSITION_TOP,
      moveType: 21,
      spellID: 7011,
      pileCountAfter: 3
    })

    ledger.applyReveal({
      cardIDs: [2],
      location: 'pile',
      pileCountAfter: 3,
      discardCountAfter: 0
    })

    expect(ledger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [1, 2],
      hiddenPileSlotCount: 1,
      accountedPileCount: 3
    })
  })

  it('明牌揭示只有在身份确实离开弃牌堆时才撤销弃牌记录', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3])
    applyMove(
      ledger,
      {
        eventType: 'discardKnown',
        fromZone: 1,
        toZone: 2,
        cardIDs: [1],
        cardCount: 1,
        pileCountAfter: 2
      },
      1
    )

    ledger.applyReveal({
      cardIDs: [1],
      location: 'discard',
      pileCountAfter: 2,
      discardCountAfter: 1
    })
    expect(ledger.getSnapshot().knownDiscardIdentityIDs).toEqual([1])

    ledger.applyReveal({
      cardIDs: [1],
      location: 'outside',
      pileCountAfter: 2,
      discardCountAfter: 0
    })
    expect(ledger.getSnapshot().knownDiscardIdentityIDs).toEqual([])
  })

  it('常规匿名摸牌分别扣除牌顶明牌身份与暗槽', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1])

    applyMove(ledger, {
      eventType: 'moveKnown',
      fromZone: 0,
      toZone: 1,
      cardIDs: [2],
      cardCount: 1,
      toPosition: POSITION_TOP,
      visiblePileIdentityIDsAfter: [2],
      pileCountBefore: 1,
      pileCountAfter: 2
    })
    applyMove(ledger, {
      eventType: 'drawUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 2,
      pileCountBefore: 2,
      pileCountAfter: 0,
      anonymousPileConsumptionCount: 1,
      knownPileIdentityIDsConsumed: [2],
      fromPosition: POSITION_TOP,
      moveType: 1
    })

    expect(ledger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [],
      hiddenPileSlotCount: 0,
      accountedPileCount: 0
    })
    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'none-in-pile',
        cardIDs: [1],
        remainingPileCount: 0
      }
    ])
  })

  it('B3/B4 随机插入身份时合并全部批次', () => {
    const ledger = createTwoCohortLedger()

    applyMove(ledger, {
      eventType: 'moveKnown',
      fromZone: 0,
      toZone: 1,
      cardIDs: [4400],
      cardCount: 1,
      toPosition: POSITION_TOP,
      pileCountAfter: 4
    })

    const snapshot = ledger.getSnapshot()
    expect(snapshot.cohort.groups).toHaveLength(1)
    expect(snapshot.cohort.groups[0]).toMatchObject({
      cardIDs: [1, 2, 3, 4, 4400],
      remainingPileCount: 4
    })
  })

  it('B5 明确牌顶加入登记为已知牌堆身份', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3])

    applyMove(ledger, {
      eventType: 'moveKnown',
      fromZone: 0,
      toZone: 1,
      cardIDs: [4],
      cardCount: 1,
      toPosition: POSITION_TOP,
      pileCountAfter: 4
    })

    expect(ledger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [4],
      cohort: {
        groups: [{ cardIDs: [1, 2, 3], remainingPileCount: 3 }]
      }
    })
  })

  it('B6 匿名随机回堆在多批次时合并，但不虚构具体身份', () => {
    const ledger = createTwoCohortLedger()

    applyMove(ledger, {
      eventType: 'returnToPile',
      fromZone: 5,
      toZone: 1,
      cardIDs: [],
      cardCount: 1,
      toPosition: POSITION_RANDOM,
      moveType: 19,
      spellID: 0,
      pileCountAfter: 4
    })

    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 1,
        kind: 'all-in-pile',
        cardIDs: [1, 2, 3, 4],
        remainingPileCount: 4
      }
    ])
  })

  it('B7/B8 弃牌洗回建立新批次，明确回堆登记已知牌堆身份', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3])
    applyMove(ledger, {
      eventType: 'drawUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_TOP,
      pileCountAfter: 2
    })
    applyMove(
      ledger,
      {
        eventType: 'discardKnown',
        fromZone: 5,
        toZone: 2,
        cardIDs: [1],
        cardCount: 1,
        pileCountAfter: 2
      },
      1
    )
    applyMove(ledger, {
      eventType: 'shuffleDiscardIntoPile',
      fromZone: 2,
      toZone: 9,
      cardIDs: [],
      cardCount: 3,
      pileCountAfter: 3
    })

    expect(ledger.getSnapshot().cohort.groups.map((group) => group.cardIDs)).toEqual([[1], [2, 3]])

    applyMove(ledger, {
      eventType: 'returnToPile',
      fromZone: 2,
      toZone: 1,
      cardIDs: [4],
      cardCount: 1,
      toPosition: POSITION_TOP,
      moveType: 15,
      pileCountAfter: 4
    })
    expect(ledger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [4],
      cohort: {
        groups: [
          { cardIDs: [1], remainingPileCount: 1 },
          { cardIDs: [2, 3], remainingPileCount: 2 }
        ]
      }
    })
  })

  it('B9/B10 分别从牌底和牌顶批次消费暗槽', () => {
    const bottomLedger = createTwoCohortLedger()
    applyMove(bottomLedger, {
      eventType: 'drawUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_BOTTOM,
      spellID: 3101,
      pileCountAfter: 2
    })
    expect(bottomLedger.getSnapshot().cohort.groups[0].remainingPileCount).toBe(1)

    const topLedger = createTwoCohortLedger()
    applyMove(topLedger, {
      eventType: 'drawUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_TOP,
      spellID: 3208,
      pileCountAfter: 2
    })
    expect(topLedger.getSnapshot().cohort.groups.at(-1)?.remainingPileCount).toBe(0)
  })

  it('B11/B15 匿名任意位置取牌统一合并未决身份且不依赖 SpellID', () => {
    const ledger = createTwoCohortLedger()

    applyMove(ledger, {
      eventType: 'moveUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_TOP,
      moveType: 18,
      spellID: 4567,
      pileCountAfter: 2
    })

    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 1,
        kind: 'partial',
        cardIDs: [1, 2, 3, 4],
        remainingPileCount: 2
      }
    ])
  })

  it('B15 匿名任意位置获得保留全部已知牌堆身份直到明确展示', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3, 4])

    applyMove(ledger, {
      eventType: 'showCards',
      fromZone: 1,
      toZone: 1,
      cardIDs: [1, 2],
      cardCount: 2,
      visiblePileIdentityIDsAfter: [1],
      pileCountBefore: 4,
      pileCountAfter: 4
    })
    applyMove(ledger, {
      eventType: 'moveUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_RANDOM,
      moveType: 18,
      spellID: 4567,
      visiblePileIdentityIDsAfter: [1],
      pileCountBefore: 4,
      pileCountAfter: 3
    })

    expect(ledger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [1, 2],
      hiddenPileSlotCount: 1,
      accountedPileCount: 3
    })
    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [3, 4],
        remainingPileCount: 1
      }
    ])

    applyMove(ledger, {
      eventType: 'discardKnown',
      fromZone: 5,
      toZone: 2,
      cardIDs: [2],
      cardCount: 1,
      pileCountBefore: 3,
      pileCountAfter: 3
    })

    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'all-in-pile',
        cardIDs: [3, 4],
        remainingPileCount: 2
      }
    ])
    expect(ledger.getSnapshot().knownPileIdentityIDs).toEqual([1])
  })

  it('B12 回收区 noop 不改变批次状态', () => {
    const ledger = createTwoCohortLedger()
    const before = ledger.getSnapshot().cohort

    applyMove(ledger, {
      eventType: 'noop',
      fromZone: 12,
      toZone: 12,
      cardIDs: [],
      cardCount: 0,
      pileCountAfter: 3
    })

    expect(ledger.getSnapshot().cohort).toEqual(before)
  })

  it('B13 任意位置给出 CardID 时只扣该身份所属批次', () => {
    const ledger = createTwoCohortLedger()

    applyMove(ledger, {
      eventType: 'moveKnown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [2],
      cardCount: 1,
      fromPosition: POSITION_RANDOM,
      moveType: 18,
      spellID: 8888,
      pileCountAfter: 2
    })

    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 1,
        kind: 'partial',
        cardIDs: [1, 3],
        remainingPileCount: 1
      },
      {
        generation: 0,
        kind: 'all-in-pile',
        cardIDs: [4],
        remainingPileCount: 1
      }
    ])
  })

  it('B14 单批次保持边界，多批次在范围未知时保守合并', () => {
    const warnings: Record<string, unknown>[] = []
    const singleLedger = new PileIdentityLedger({
      onWarning(_message, detail) {
        warnings.push(detail)
      }
    })
    singleLedger.initialize([1, 2, 3])
    singleLedger.applyMove({
      eventType: 'moveUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_TOP,
      moveType: 18,
      spellID: 7011,
      pileCountAfter: 2,
      discardCountAfter: 0
    })
    expect(warnings).toEqual([])
    expect(singleLedger.getSnapshot().cohort.groups).toHaveLength(1)
    expect(singleLedger.getSnapshot().cohort.groups[0].remainingPileCount).toBe(2)

    const ledger = createTwoCohortLedger()
    applyMove(ledger, {
      eventType: 'moveUnknown',
      fromZone: 1,
      toZone: 5,
      cardIDs: [],
      cardCount: 1,
      fromPosition: POSITION_TOP,
      moveType: 18,
      spellID: 7011,
      pileCountAfter: 2
    })

    expect(ledger.getSnapshot().cohort.groups).toHaveLength(1)
    expect(ledger.getSnapshot().cohort.groups[0]).toMatchObject({
      cardIDs: [1, 2, 3, 4],
      remainingPileCount: 2
    })
  })

  it('直接枚举全部 cohort 未决身份且不受剩余牌堆基数影响', () => {
    const ledger = new PileIdentityLedger()
    ledger.initialize([1, 2, 3, 4])

    ledger.applyReveal({
      cardIDs: [1],
      location: 'pile',
      pileCountAfter: 4,
      discardCountAfter: 0
    })
    expect(ledger.getUnresolvedIdentityIDs()).toEqual([2, 3, 4])

    ledger.consumeAnonymous(3, POSITION_TOP, 'test:consume-all-hidden-slots')

    expect(ledger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'none-in-pile',
        cardIDs: [2, 3, 4],
        remainingPileCount: 0
      }
    ])
    expect(ledger.getUnresolvedIdentityIDs()).toEqual([2, 3, 4])
  })
})
