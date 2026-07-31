import { describe, expect, it } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { PileIdentityModelComparison } from '@/tracker/observer/pileIdentityModelComparison'

function drawUnknown(count: number, pileCountAfter: number) {
  return {
    eventType: 'drawUnknown',
    fromZone: 1,
    toZone: 5,
    cardIDs: [],
    cardCount: count,
    fromPosition: POSITION_TOP,
    pileCountAfter
  }
}

function createTwoCohortComparison() {
  const comparison = new PileIdentityModelComparison()
  comparison.initialize([1, 2, 3, 4, 5])
  comparison.applyMove(drawUnknown(2, 3), [], 0)
  comparison.applyMove(
    {
      eventType: 'discardKnown',
      fromZone: 5,
      toZone: 2,
      cardIDs: [1],
      cardCount: 1,
      pileCountAfter: 3
    },
    [],
    1
  )
  comparison.applyMove(
    {
      eventType: 'shuffleDiscardIntoPile',
      fromZone: 2,
      toZone: 9,
      cardIDs: [],
      cardCount: 4,
      pileCountAfter: 4
    },
    [],
    0
  )
  return comparison
}

describe('Phase 1 只读三模型对照', () => {
  it('匿名摸牌后区分当前 UI、世代候选与批次部分集合', () => {
    const comparison = new PileIdentityModelComparison()
    comparison.initialize([1, 2, 3, 4, 5])

    comparison.applyMove(drawUnknown(2, 3), [2], 0)

    const report = comparison.getReport()
    expect(report.snapshot.currentCandidateIDs).toEqual([2])
    expect(report.snapshot.generationCandidateIDs).toEqual([])
    expect(report.snapshot.cohortCandidateIDs).toEqual([1, 2, 3, 4, 5])
    expect(report.snapshot.cohortAddedCandidateIDs).toEqual([1, 3, 4, 5])
    expect(report.snapshot.cohortRemovedCandidateIDs).toEqual([])
    expect(report.snapshot.cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [1, 2, 3, 4, 5],
        remainingPileCount: 3,
        label: '这 5 张里有 3 张在牌堆'
      }
    ])
    expect(report.metrics.maxCurrentCandidateCount).toBe(1)
    expect(report.metrics.maxCohortCandidateCount).toBe(5)
    expect(report.metrics.maxCohortFlatCandidateWidth).toBe(5)
  })

  it('洗牌后把旧 active 投影为世代候选，并保留新旧批次基数', () => {
    const comparison = new PileIdentityModelComparison()
    comparison.initialize([1, 2, 3, 4, 5])
    comparison.applyMove(drawUnknown(2, 3), [], 0)

    comparison.applyMove(
      {
        eventType: 'discardKnown',
        fromZone: 5,
        toZone: 2,
        cardIDs: [1],
        cardCount: 1,
        pileCountAfter: 3
      },
      [1],
      1
    )
    comparison.applyMove(
      {
        eventType: 'shuffleDiscardIntoPile',
        fromZone: 2,
        toZone: 9,
        cardIDs: [],
        cardCount: 4,
        pileCountAfter: 4
      },
      [2, 3, 4, 5],
      0
    )

    const report = comparison.getReport()
    expect(report.snapshot.generation.activeIdentityIDs).toEqual([1])
    expect(report.snapshot.generationCandidateIDs).toEqual([2, 3, 4, 5])
    expect(report.snapshot.cohort.groups).toEqual([
      {
        generation: 1,
        kind: 'all-in-pile',
        cardIDs: [1],
        remainingPileCount: 1,
        label: '这 1 张都在牌堆'
      },
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [2, 3, 4, 5],
        remainingPileCount: 3,
        label: '这 4 张里有 3 张在牌堆'
      }
    ])
    expect(report.metrics.batchBoundaryDegradationCount).toBe(0)
  })

  it.each([3644, 9876])('匿名任意位置取牌收敛为全局未决，不绑定 SpellID=%s', (spellID) => {
    const comparison = createTwoCohortComparison()

    comparison.applyMove(
      {
        eventType: 'randomGain',
        fromZone: 1,
        toZone: 5,
        cardIDs: [],
        cardCount: 2,
        fromPosition: POSITION_RANDOM,
        moveType: 18,
        spellID,
        pileCountAfter: 2
      },
      [],
      0
    )

    const report = comparison.getReport()
    expect(report.snapshot.cohort.groups).toEqual([
      {
        generation: 1,
        kind: 'partial',
        cardIDs: [1, 2, 3, 4, 5],
        remainingPileCount: 2,
        label: '这 5 张里有 2 张在牌堆'
      }
    ])
    expect(report.metrics.batchBoundaryRiskEventCount).toBe(0)
    expect(report.metrics.batchBoundaryDegradationCount).toBe(0)
    expect(report.degradations.at(-1)).toMatchObject({
      reason: 'anonymous-pile-draw',
      spellID,
      boundaryRisk: false,
      boundaryDegraded: false,
      cohortGroupCountBefore: 2,
      cohortGroupCountAfter: 1
    })
  })

  it('任意位置取牌带 CardIDs 时精确扣所属批次', () => {
    const comparison = createTwoCohortComparison()

    comparison.applyMove(
      {
        eventType: 'gainKnown',
        fromZone: 1,
        toZone: 5,
        cardIDs: [2],
        cardCount: 1,
        fromPosition: POSITION_RANDOM,
        moveType: 18,
        spellID: 9876,
        pileCountAfter: 3
      },
      [],
      0
    )

    const report = comparison.getReport()
    expect(report.snapshot.cohort.groups).toEqual([
      {
        generation: 1,
        kind: 'all-in-pile',
        cardIDs: [1],
        remainingPileCount: 1,
        label: '这 1 张都在牌堆'
      },
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [3, 4, 5],
        remainingPileCount: 2,
        label: '这 3 张里有 2 张在牌堆'
      }
    ])
    expect(report.degradations).toEqual([])
  })

  it('匿名任意位置取牌失效后，新牌顶批次仍保持精确', () => {
    const comparison = createTwoCohortComparison()
    comparison.applyMove(
      {
        eventType: 'randomGain',
        fromZone: 1,
        toZone: 5,
        cardIDs: [],
        cardCount: 1,
        fromPosition: POSITION_RANDOM,
        moveType: 18,
        spellID: 3644,
        pileCountAfter: 3
      },
      [],
      0
    )
    comparison.applyMove(
      {
        eventType: 'returnKnown',
        fromZone: 0,
        toZone: 1,
        cardIDs: [6],
        cardCount: 1,
        toPosition: POSITION_TOP,
        moveType: 19,
        spellID: 0,
        pileCountAfter: 4
      },
      [],
      0
    )

    const groups = comparison.getReport().snapshot.cohort.groups
    expect(groups).toEqual([
      {
        generation: 1,
        kind: 'partial',
        cardIDs: [1, 2, 3, 4, 5],
        remainingPileCount: 3,
        label: '这 5 张里有 3 张在牌堆'
      },
      {
        generation: 1,
        kind: 'all-in-pile',
        cardIDs: [6],
        remainingPileCount: 1,
        label: '这 1 张都在牌堆'
      }
    ])
  })

  it('随机入堆合并批次并显式记录边界降级', () => {
    const comparison = new PileIdentityModelComparison()
    comparison.initialize([1, 2, 3])
    comparison.applyMove(
      {
        eventType: 'drawKnown',
        fromZone: 1,
        toZone: 5,
        cardIDs: [1],
        cardCount: 1,
        fromPosition: POSITION_TOP,
        pileCountAfter: 2
      },
      [],
      0
    )
    comparison.applyMove(
      {
        eventType: 'returnKnown',
        fromZone: 5,
        toZone: 1,
        cardIDs: [1],
        cardCount: 1,
        toPosition: POSITION_TOP,
        pileCountAfter: 3
      },
      [],
      0
    )

    comparison.applyMove(
      {
        eventType: 'returnToPile',
        fromZone: 0,
        toZone: 1,
        cardIDs: [4400],
        cardCount: 1,
        toPosition: POSITION_RANDOM,
        pileCountAfter: 4
      },
      [],
      0
    )

    const report = comparison.getReport()
    expect(report.snapshot.cohort.groups).toHaveLength(1)
    expect(report.snapshot.cohort.groups[0]).toMatchObject({
      kind: 'all-in-pile',
      cardIDs: [1, 2, 3, 4400],
      remainingPileCount: 4
    })
    expect(report.metrics.batchBoundaryRiskEventCount).toBe(1)
    expect(report.metrics.batchBoundaryDegradationCount).toBe(1)
    expect(report.degradations).toEqual([
      {
        eventSeq: 3,
        reason: 'random-pile-insertion',
        eventType: 'returnToPile',
        fromZone: 0,
        toZone: 1,
        cardIDs: [4400],
        cardCount: 1,
        fromPosition: null,
        toPosition: POSITION_RANDOM,
        moveType: null,
        spellID: null,
        pileCountAfter: 4,
        boundaryRisk: true,
        boundaryDegraded: true,
        cohortGroupCountBefore: 2,
        cohortGroupCountAfter: 1
      }
    ])
  })

  it('未知回牌堆与匿名任意位置取牌保留协议上下文', () => {
    const comparison = new PileIdentityModelComparison()
    comparison.initialize([1, 2, 3])
    comparison.applyMove(drawUnknown(1, 2), [], 0)

    comparison.applyMove(
      {
        eventType: 'hiddenReturn',
        fromZone: 5,
        toZone: 1,
        cardIDs: [],
        cardCount: 1,
        toPosition: POSITION_TOP,
        moveType: 19,
        spellID: 987,
        pileCountAfter: 3
      },
      [],
      0
    )
    comparison.applyMove(
      {
        eventType: 'randomGain',
        fromZone: 1,
        toZone: 5,
        cardIDs: [],
        cardCount: 1,
        fromPosition: POSITION_RANDOM,
        moveType: 18,
        spellID: 7011,
        pileCountAfter: 2
      },
      [],
      0
    )

    expect(comparison.getReport().degradations).toEqual([
      {
        eventSeq: 2,
        reason: 'unknown-return-to-pile',
        eventType: 'hiddenReturn',
        fromZone: 5,
        toZone: 1,
        cardIDs: [],
        cardCount: 1,
        fromPosition: null,
        toPosition: POSITION_TOP,
        moveType: 19,
        spellID: 987,
        pileCountAfter: 3,
        boundaryRisk: true,
        boundaryDegraded: false,
        cohortGroupCountBefore: 1,
        cohortGroupCountAfter: 1
      },
      {
        eventSeq: 3,
        reason: 'anonymous-pile-draw',
        eventType: 'randomGain',
        fromZone: 1,
        toZone: 5,
        cardIDs: [],
        cardCount: 1,
        fromPosition: POSITION_RANDOM,
        toPosition: null,
        moveType: 18,
        spellID: 7011,
        pileCountAfter: 2,
        boundaryRisk: false,
        boundaryDegraded: false,
        cohortGroupCountBefore: 1,
        cohortGroupCountAfter: 1
      }
    ])
    expect(comparison.getReport().metrics.batchBoundaryRiskEventCount).toBe(1)
    expect(comparison.getReport().metrics.batchBoundaryDegradationCount).toBe(0)
  })
})
