import { describe, expect, it } from 'vitest'
import type { CardID } from '@/tracker/types'
import type { PileGenerationEvent } from './helpers/pileGenerationPoolModel'
import {
  countBaselineSlots,
  countCohortSlots,
  countGenerationSlots,
  evaluateAgainstOracle,
  evaluateCohortProjection,
  evaluateUnknownLocationProjection,
  getBaselineBelievedInPile,
  getCohortDefinitelyInPileIDs,
  getCohortUnknownLocationCandidateIDs,
  getGenerationUnresolvedIDs,
  getGenerationUnlocated,
  projectCohorts,
  runBaselineLedgerModel,
  runCohortPoolModel,
  runGenerationPoolModel,
  runOracle,
  sortIDs
} from './helpers/pileGenerationPoolModel'

/**
 * Phase 0/0.5：世代身份卡池、批次基数模型与当前账本对照。
 *
 * 对应 `docs/pile-identity-cohort-plan.md` 的 Phase 0/0.5 与纯模型证据。
 * 本文件不接触任何生产状态，只验证「世代卡池算法自身是否闭合」，并把它与当前正 ID
 * 暗槽账本在同一事件序列下的候选宽度并排量化。
 *
 * 计划的核心语义主张（§1.1、§4.5）是成立的：卡池表示「本世代尚未揭示的身份候选」，
 * 因此 `活动卡池大小 ≠ 牌堆张数` 不是守恒错误。下面的契约按这个定义断言。
 *
 * oracle 只用于验证纯夹具；真实回放没有服务器隐藏牌序，只能采集后续协议证实的矛盾下界。
 */

describe('世代身份卡池纯模型', () => {
  describe('计划 §1.2 的标准推演', () => {
    // 计划正文给出的五牌示例，是本方案的第一条契约。
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawUnknown', count: 3 },
      { type: 'revealFromHand', cardIDs: [1, 2] },
      { type: 'discardKnown', cardIDs: [1, 2] },
      { type: 'shuffle' }
    ]

    it('G01 初始化后牌堆槽、活动卡池与身份全集等量', () => {
      const { state } = runGenerationPoolModel([events[0]])

      expect(state.generation).toBe(0)
      expect(state.pileSlotCount).toBe(5)
      expect(sortIDs(state.activeIdentityIDs)).toEqual([1, 2, 3, 4, 5])
      expect(state.suspendedIdentityIDs.size).toBe(0)
      expect(sortIDs(getGenerationUnlocated(state))).toEqual([1, 2, 3, 4, 5])
    })

    it('G02 暗摸只消费物理槽，活动卡池完全不变', () => {
      const { state } = runGenerationPoolModel(events.slice(0, 2))

      expect(state.pileSlotCount).toBe(2)
      expect(state.playerAnonSlotCount).toBe(3)
      // §5.2：协议没有提供真实身份，任何删除都会虚构信息。
      expect(sortIDs(state.activeIdentityIDs)).toEqual([1, 2, 3, 4, 5])
      expect(state.suspendedIdentityIDs.size).toBe(0)
    })

    it('G03 身份揭示后从活动卡池移除', () => {
      const { state } = runGenerationPoolModel(events.slice(0, 3))

      expect(sortIDs(state.activeIdentityIDs)).toEqual([3, 4, 5])
      expect(sortIDs(state.locatedIdentityIDs)).toEqual([1, 2])
      // 揭示的 2 张各消费一个玩家暗占位；剩下 1 个暗占位仍是未知牌。
      expect(state.playerAnonSlotCount).toBe(1)
    })

    it('G04 弃牌洗回时执行世代滚动，三个集合数量互不相等', () => {
      const { state, shuffles } = runGenerationPoolModel(events)

      expect(state.generation).toBe(1)
      expect(state.pileSlotCount).toBe(4)
      expect(sortIDs(state.activeIdentityIDs)).toEqual([1, 2])
      expect(sortIDs(state.suspendedIdentityIDs)).toEqual([3, 4, 5])

      // §4.5：以下三个数量不要求相等，这是本方案有意的信息投影。
      expect(state.pileSlotCount).toBe(4)
      expect(state.activeIdentityIDs.size).toBe(2)
      expect(state.suspendedIdentityIDs.size).toBe(3)

      expect(shuffles).toHaveLength(1)
      expect(shuffles[0]).toMatchObject({
        generationBefore: 0,
        generationAfter: 1,
        expiredPoolIDs: [3, 4, 5],
        recycledIdentityIDs: [1, 2],
        activePoolIDsAfter: [1, 2],
        candidateWidth: 3
      })
    })

    it('物理槽总数在全过程中恒等于身份全集大小', () => {
      events.forEach((_event, index) => {
        const { state } = runGenerationPoolModel(events.slice(0, index + 1))
        expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)
      })
    })
  })

  describe('身份分区不变量', () => {
    it('G05 generation suspended 身份再揭示时恢复且不残留在多个集合', () => {
      const { state } = runGenerationPoolModel([
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'drawUnknown', count: 3 },
        { type: 'revealFromHand', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        { type: 'shuffle' },
        // 4 此前因世代过期进入 suspended；它从玩家暗区再次出现。
        { type: 'revealFromHand', cardIDs: [4] }
      ])

      expect(sortIDs(state.suspendedIdentityIDs)).toEqual([3, 5])
      expect(state.activeIdentityIDs.has(4)).toBe(false)
      expect(state.locatedIdentityIDs.has(4)).toBe(true)
      expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)
    })

    it('G06 活动卡池身份明摸时从池中移除并消耗牌堆槽', () => {
      const { state } = runGenerationPoolModel([
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'revealFromPile', cardIDs: [1] }
      ])

      expect(state.pileSlotCount).toBe(4)
      expect(sortIDs(state.activeIdentityIDs)).toEqual([2, 3, 4, 5])
      expect(state.suspendedIdentityIDs.size).toBe(0)
    })

    it('G09 空弃牌堆洗牌不滚动世代', () => {
      const { state, shuffles } = runGenerationPoolModel([
        { type: 'initialize', cardIDs: [1, 2, 3] },
        { type: 'drawUnknown', count: 1 },
        { type: 'shuffle' }
      ])

      // §5.5：空弃牌堆调用不得滚动世代，否则候选会无故暂停。
      expect(shuffles).toHaveLength(0)
      expect(state.generation).toBe(0)
      expect(sortIDs(state.activeIdentityIDs)).toEqual([1, 2, 3])
      expect(state.suspendedIdentityIDs.size).toBe(0)
    })

    it('G11 合法外部身份只扩展身份全集一次', () => {
      const { state } = runGenerationPoolModel([
        { type: 'initialize', cardIDs: [1, 2] },
        { type: 'introduceExternal', cardIDs: [60992] },
        { type: 'introduceExternal', cardIDs: [60992] }
      ])

      expect(state.identityUniverse.size).toBe(3)
      expect(state.activeIdentityIDs.has(60992)).toBe(false)
      expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)
    })

    it('活动卡池与 suspended 始终不重叠，且都属于身份全集', () => {
      const events: PileGenerationEvent[] = [
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8] },
        { type: 'drawUnknown', count: 2 },
        { type: 'revealFromPile', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        { type: 'shuffle' },
        { type: 'revealFromHand', cardIDs: [3, 4] },
        { type: 'discardKnown', cardIDs: [3] },
        { type: 'shuffle' },
        { type: 'drawUnknown', count: 2 },
        { type: 'discardKnown', cardIDs: [4] },
        { type: 'shuffle' }
      ]

      events.forEach((_event, index) => {
        const { state } = runGenerationPoolModel(events.slice(0, index + 1))
        const overlap = sortIDs(state.activeIdentityIDs).filter((cardID) =>
          state.suspendedIdentityIDs.has(cardID)
        )

        expect(overlap).toEqual([])
        // §4.4：活动卡池 ⊆ 未定位身份 ⊆ 身份全集。
        const unlocated = getGenerationUnlocated(state)
        sortIDs(state.activeIdentityIDs).forEach((cardID) => {
          expect(unlocated.has(cardID)).toBe(true)
          expect(state.identityUniverse.has(cardID)).toBe(true)
        })
        expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)
      })
    })
  })

  describe('G07 / G08 连续多轮洗牌', () => {
    // 每轮：摸 2 张暗牌 → 揭示上一轮摸到的 2 张 → 弃 1 张 → 洗牌。
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { type: 'revealFromPile', cardIDs: [1, 2] },
      { type: 'discardKnown', cardIDs: [1, 2] },
      { type: 'shuffle' },
      { type: 'revealFromPile', cardIDs: [3, 4] },
      { type: 'discardKnown', cardIDs: [3, 4] },
      { type: 'shuffle' },
      { type: 'revealFromPile', cardIDs: [5, 6] },
      { type: 'discardKnown', cardIDs: [5, 6] },
      { type: 'shuffle' }
    ]

    it('generation 逐次递增且新活动卡池等于本轮洗回身份', () => {
      const { state, shuffles } = runGenerationPoolModel(events)

      expect(shuffles.map((entry) => entry.generationAfter)).toEqual([1, 2, 3])
      expect(shuffles.map((entry) => entry.activePoolIDsAfter)).toEqual([
        [1, 2],
        [3, 4],
        [5, 6]
      ])
      expect(state.generation).toBe(3)
    })

    it('同一身份不会被重复加入 suspended，身份全集不丢失', () => {
      const { shuffles } = runGenerationPoolModel(events)

      shuffles.forEach((entry) => {
        // carried 与 newly 必须互斥，否则日志会把沿用身份误报成本轮新增。
        const repeated = entry.newlySuspendedIDs.filter((cardID) =>
          entry.carriedSuspendedIDs.includes(cardID)
        )
        expect(repeated).toEqual([])
        expect(entry.suspendedIDs).toEqual(
          sortIDs([...entry.carriedSuspendedIDs, ...entry.newlySuspendedIDs])
        )
      })

      events.forEach((_event, index) => {
        const { state } = runGenerationPoolModel(events.slice(0, index + 1))
        expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)
        expect(state.suspendedIdentityIDs.size).toBeLessThanOrEqual(state.identityUniverse.size)
      })
    })

    it('每代观测输出牌堆槽数与活动卡池大小，两者不等不算错误', () => {
      const { shuffles } = runGenerationPoolModel(events)

      const report = shuffles.map((entry) => ({
        generation: entry.generationAfter,
        pileSlotCount: entry.pileSlotCountAfter,
        activePoolSize: entry.activePoolIDsAfter.length,
        suspendedSize: entry.suspendedIDs.length
      }))

      // 牌堆槽数远大于活动卡池是正常状态：暗摸不收紧卡池，
      // 而洗回身份只有本轮弃牌那几张。
      expect(report).toEqual([
        { generation: 1, pileSlotCount: 10, activePoolSize: 2, suspendedSize: 8 },
        { generation: 2, pileSlotCount: 10, activePoolSize: 2, suspendedSize: 8 },
        { generation: 3, pileSlotCount: 10, activePoolSize: 2, suspendedSize: 8 }
      ])
    })
  })
})

describe('Phase 0.5：批次集合 + 在牌堆数量', () => {
  it('五牌示例保留“3 个候选中恰有 2 张仍在牌堆”', () => {
    const state = runCohortPoolModel([
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawUnknown', count: 3 },
      { type: 'revealFromHand', cardIDs: [1, 2] },
      { type: 'discardKnown', cardIDs: [1, 2] },
      { type: 'shuffle', cause: 'explicit-recycle' }
    ])

    expect(
      state.cohorts.map((cohort) => ({
        generation: cohort.generation,
        candidateIDs: sortIDs(cohort.candidateIdentityIDs),
        remainingPileCount: cohort.remainingPileCount
      }))
    ).toEqual([
      { generation: 1, candidateIDs: [1, 2], remainingPileCount: 2 },
      { generation: 0, candidateIDs: [3, 4, 5], remainingPileCount: 2 }
    ])
    expect(sortIDs(getCohortUnknownLocationCandidateIDs(state))).toEqual([3, 4, 5])
    expect(sortIDs(getCohortDefinitelyInPileIDs(state))).toEqual([1, 2])
    expect(countCohortSlots(state)).toBe(state.identityUniverse.size)
  })

  it('暗摸只减少批次基数，不虚构离开牌堆的具体身份', () => {
    const state = runCohortPoolModel([
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawUnknown', count: 2 }
    ])

    expect(state.cohorts).toHaveLength(1)
    expect(sortIDs(state.cohorts[0].candidateIdentityIDs)).toEqual([1, 2, 3, 4, 5])
    expect(state.cohorts[0].remainingPileCount).toBe(3)
    expect(sortIDs(getCohortUnknownLocationCandidateIDs(state))).toEqual([1, 2, 3, 4, 5])
    expect(getCohortDefinitelyInPileIDs(state).size).toBe(0)
  })

  it('初始化按身份去重，三个纯模型的物理槽与身份全集一致', () => {
    const events: PileGenerationEvent[] = [{ type: 'initialize', cardIDs: [1, 1, 2, -1] }]
    const generation = runGenerationPoolModel(events).state
    const baseline = runBaselineLedgerModel(events).state
    const cohort = runCohortPoolModel(events)

    expect(countGenerationSlots(generation)).toBe(2)
    expect(countBaselineSlots(baseline)).toBe(2)
    expect(countCohortSlots(cohort)).toBe(2)
    expect(generation.identityUniverse).toEqual(new Set([1, 2]))
    expect(baseline.identityUniverse).toEqual(new Set([1, 2]))
    expect(cohort.identityUniverse).toEqual(new Set([1, 2]))
  })

  it('随机位置入堆按归一化身份数扩展三个纯模型', () => {
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2] },
      { type: 'insertExternalAtRandom', cardIDs: [3, 3, 0, -1] }
    ]
    const generation = runGenerationPoolModel(events).state
    const baseline = runBaselineLedgerModel(events).state
    const cohort = runCohortPoolModel(events)

    expect(countGenerationSlots(generation)).toBe(3)
    expect(countBaselineSlots(baseline)).toBe(3)
    expect(countCohortSlots(cohort)).toBe(3)
    expect(generation.identityUniverse).toEqual(new Set([1, 2, 3]))
    expect(baseline.identityUniverse).toEqual(new Set([1, 2, 3]))
    expect(cohort.identityUniverse).toEqual(new Set([1, 2, 3]))
  })

  it('基线模型拒绝洗牌后仍超过物理牌堆的摸牌请求', () => {
    expect(() =>
      runBaselineLedgerModel([
        { type: 'initialize', cardIDs: [1, 2] },
        { type: 'revealFromPile', cardIDs: [1] },
        { type: 'discardKnown', cardIDs: [1] },
        { type: 'drawAcrossShuffle', count: 3 }
      ])
    ).toThrow(/超过洗牌后牌堆物理槽/)
  })
})

describe('候选宽度对照：世代卡池 vs 当前正 ID 暗槽账本', () => {
  /**
   * `pile-slot-identity-decoupling-reopen.md` §0-A 的实测夹具：
   * 10 张牌 / 摸 2 弃 5 / 连续两次洗牌。归档记录的 suspended 数量为
   * 基线 5 → 3（IDs `[8,9,10]`），洗回即匿名化 5 → 8（IDs `[1,2,3,4,5,8,9,10]`）。
   *
   * **该序列不满足普通自动补牌的触发前置条件**（见 §18.2）：第二次 `shuffle` 发生时
   * 牌堆里还有 8 张牌。它仍可能代表显式回收或未知原因的 `2 -> 9`，但不得作为相邻两个
   * 自动补牌周期的候选宽度证据。
   */
  const unreachableFixture: PileGenerationEvent[] = [
    { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { type: 'drawUnknown', count: 2 },
    { type: 'revealFromPile', cardIDs: [1, 2, 3, 4, 5] },
    { type: 'discardKnown', cardIDs: [1, 2, 3, 4, 5] },
    { type: 'shuffle' },
    { type: 'revealFromHand', cardIDs: [6, 7] },
    { type: 'discardKnown', cardIDs: [6, 7] },
    { type: 'shuffle' }
  ]

  it('§18.6-5：归档夹具不满足普通自动补牌的触发前置条件', () => {
    const { state } = runGenerationPoolModel(unreachableFixture.slice(0, -1))

    // 洗牌只在「牌堆不足以满足下一次摸牌」时触发。这里牌堆仍有 8 张，
    // 因此归档夹具描述的 k=0 状态不能由该自动补牌路径触发。
    expect(state.pileSlotCount).toBe(8)
    expect(() =>
      runGenerationPoolModel([
        ...unreachableFixture.slice(0, -1),
        { type: 'drawAcrossShuffle', count: 1 }
      ])
    ).toThrow(/摸牌未超过牌堆剩余量/)
  })

  it('归档 k=0 数据仍可复现，但只作为非自动补牌对照', () => {
    const baseline = runBaselineLedgerModel(unreachableFixture)
    const generation = runGenerationPoolModel(unreachableFixture)

    expect(baseline.shuffles.map((entry) => entry.candidateWidth)).toEqual([5, 3])
    expect(baseline.shuffles.at(-1)!.suspendedIDs).toEqual([8, 9, 10])
    expect(generation.shuffles.map((entry) => entry.candidateWidth)).toEqual([5, 8])
    expect(generation.shuffles.at(-1)!.suspendedIDs).toEqual([1, 2, 3, 4, 5, 8, 9, 10])

    // 身份全集在两个模型中都不丢失，差异纯粹在候选宽度。
    expect(countGenerationSlots(generation.state)).toBe(10)
    expect(countBaselineSlots(baseline.state)).toBe(10)
    expect(generation.state.identityUniverse).toEqual(baseline.state.identityUniverse)
  })

  /**
   * §18.3 的批次暴露矩阵。
   *
   * `k` = 第二次洗牌前，从上一轮洗回批次 `{1,2,3,4,5}` 中被不透明摸走的槽数。
   * 第一次洗牌后牌堆 = `[1..5 洗回] + [3 个原匿名槽]`，牌顶从原匿名槽一侧消费，
   * 所以摸 `3 + k` 张即可精确控制 k。真实可达范围从 `k=1` 起。
   */
  function buildReachableFixture(k: number): PileGenerationEvent[] {
    return [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { type: 'drawUnknown', count: 2 },
      { type: 'revealFromPile', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'discardKnown', cardIDs: [1, 2, 3, 4, 5] },
      // 第一次洗牌：此时牌堆仅剩 3 槽，一次摸 3+k 张必然超量，触发洗牌。
      { type: 'drawAcrossShuffle', count: 3 + k },
      // 第一轮暗摸到的 6、7 揭示并弃出，为第二次洗牌提供弃牌。
      { type: 'revealFromHand', cardIDs: [6, 7] },
      { type: 'discardKnown', cardIDs: [6, 7] },
      { type: 'shuffle' }
    ]
  }

  it('§18.3 矩阵：k=1 起世代模型输出 8，基线随 k 增长', () => {
    const matrix = [1, 2, 3, 4, 5].map((k) => ({
      k,
      baseline: runBaselineLedgerModel(buildReachableFixture(k)).shuffles.at(-1)!.candidateWidth,
      generation: runGenerationPoolModel(buildReachableFixture(k)).shuffles.at(-1)!.candidateWidth
    }))

    // 基线的 4～7 来自「历史 suspended {8,9,10} + 本地牌序恰好绑定到被摸槽的 k 个正 ID」，
    // 是依赖本地代表绑定的欠近似，不是语义上正确的候选宽度。
    expect(matrix).toEqual([
      { k: 1, baseline: 4, generation: 8 },
      { k: 2, baseline: 5, generation: 8 },
      { k: 3, baseline: 6, generation: 8 },
      { k: 4, baseline: 7, generation: 8 },
      { k: 5, baseline: 8, generation: 8 }
    ])
  })

  it('§18.3：k>0 时洗回批次整体失去可信牌堆归因', () => {
    const { state } = runGenerationPoolModel(buildReachableFixture(1))

    // 只要 k>0，{1,2,3,4,5} 中任意身份都可能是被摸走者；协议没有提供 CardID，
    // 无法证明具体是哪一张。整体列入未知位置候选是正确的保守投影。
    expect(state.suspendedIdentityIDs).toEqual(new Set([1, 2, 3, 4, 5, 8, 9, 10]))
    expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)
  })

  it('§18.5-3：基线在可达序列中排除的身份数就是其假阴性风险面', () => {
    const baseline = runBaselineLedgerModel(buildReachableFixture(1))
    const lastShuffle = baseline.shuffles.at(-1)!

    // k=1 时基线仍把 {1..5} 中的 4 张当作「确定仍在牌堆」而排除在候选外。
    // 其中恰好有 1 张在真实牌序下已经离开牌堆，但协议无从指认是哪张——
    // 这 4 张就是当前实现的假阴性风险面，Phase 1 的
    // baselineExcludedThenRevealedCount 正是用来实测它。
    const excludedFromCandidates = [1, 2, 3, 4, 5].filter(
      (cardID) => !lastShuffle.suspendedIDs.includes(cardID)
    )
    expect(excludedFromCandidates).toHaveLength(4)
    expect(lastShuffle.candidateWidth).toBe(4)
  })

  it('可达序列下两个模型的身份全集都不丢失', () => {
    ;[1, 3, 5].forEach((k) => {
      const events = buildReachableFixture(k)
      const generation = runGenerationPoolModel(events)
      const baseline = runBaselineLedgerModel(events)

      expect(countGenerationSlots(generation.state)).toBe(10)
      expect(countBaselineSlots(baseline.state)).toBe(10)
      expect(generation.state.identityUniverse).toEqual(baseline.state.identityUniverse)
    })
  })
})

describe('§18.6-3 真实隐藏牌序 oracle：假阳性与假阴性', () => {
  /**
   * 关键夹具：让本地代表绑定与真实牌序**不一致**。
   *
   * 真实牌序（末尾是牌顶）：先被暗摸走的是 7、6，随后从牌堆明摸的恰是 {1..5}，
   * 因此夹具本身可实现。洗回批次 {1,2,3,4,5} 在真实牌序里以 [5,4,3,2,1] 排列——
   * 1 最靠牌顶侧，会被最先摸走。
   *
   * 而两个追踪模型都只能假设本地顺序 [1,2,3,4,5]（牌底侧优先），因此基线会认为
   * 离开牌堆的是别的身份。这正是 §18.4 所说「批次开始被消费后，具体剩余身份受
   * 本地代表顺序影响」。
   */
  const trueDeckOrder = [8, 9, 10, 1, 2, 3, 4, 5, 6, 7]
  const trueRecycledOrder = [5, 4, 3, 2, 1]

  function buildFixture(k: number): PileGenerationEvent[] {
    return [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { type: 'drawUnknown', count: 2 },
      { type: 'revealFromPile', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'discardKnown', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawAcrossShuffle', count: 3 + k },
      { type: 'revealFromHand', cardIDs: [6, 7] },
      { type: 'discardKnown', cardIDs: [6, 7] },
      { type: 'shuffle' }
    ]
  }

  function evaluate(k: number) {
    const events = buildFixture(k)
    const oracle = runOracle(events, {
      deckOrder: trueDeckOrder,
      recycledOrders: [trueRecycledOrder]
    })
    const generation = runGenerationPoolModel(events)
    const baseline = runBaselineLedgerModel(events)
    const cohort = runCohortPoolModel(events)

    return {
      generationProjection: evaluateUnknownLocationProjection(
        generation.state.suspendedIdentityIDs,
        getGenerationUnresolvedIDs(generation.state),
        oracle
      ),
      baseline: evaluateAgainstOracle(
        baseline.state.suspendedIdentityIDs,
        getBaselineBelievedInPile(baseline.state),
        oracle
      ),
      cohort: evaluateAgainstOracle(
        getCohortUnknownLocationCandidateIDs(cohort),
        getCohortDefinitelyInPileIDs(cohort),
        oracle
      )
    }
  }

  it('oracle 拒绝与真实牌序不符的牌堆揭示夹具', () => {
    // 夹具自身必须可实现，否则整个对照没有意义。
    expect(() =>
      runOracle(
        [
          { type: 'initialize', cardIDs: [1, 2, 3] },
          { type: 'revealFromPile', cardIDs: [1] }
        ],
        { deckOrder: [1, 2, 3] }
      )
    ).toThrow(/牌堆揭示与真实牌序不符/)
  })

  it('oracle 拒绝与初始化身份全集不一致的牌序', () => {
    expect(() =>
      runOracle([{ type: 'initialize', cardIDs: [1, 2, 3] }], {
        deckOrder: [1, 2, 4]
      })
    ).toThrow(/初始牌序/)
  })

  it('空弃牌堆洗牌不消费下一次真实洗回顺序', () => {
    const state = runOracle(
      [
        { type: 'initialize', cardIDs: [1, 2, 3, 4] },
        { type: 'shuffle' },
        { type: 'revealFromPile', cardIDs: [4, 3] },
        { type: 'discardKnown', cardIDs: [4, 3] },
        { type: 'shuffle' }
      ],
      {
        deckOrder: [1, 2, 3, 4],
        recycledOrders: [[3, 4]]
      }
    )

    expect(state.truePile).toEqual([3, 4, 1, 2])
  })

  it('单洗牌周期内：基线产生错误断言，另外两模型保持集合语义', () => {
    const { generationProjection, baseline, cohort } = evaluate(1)

    // 全局世代模型把上一世代整体列入候选；active pool 只是未展示的未决集合，
    // 不能再被解释为「确定仍在牌堆」。本夹具此时没有已离开牌堆却未展示的 active 身份。
    expect(generationProjection.candidateWidth).toBe(8)
    expect(generationProjection.omittedOutsidePileIDs).toEqual([])

    // 批次模型展示同样 8 张，但还保留「洗回五张中仍有四张在牌堆」的基数关系。
    expect(cohort.candidateWidth).toBe(8)
    expect(cohort.falseNegativeIDs).toEqual([])

    // 基线更窄（4），但它「相信仍在牌堆」的集合里有身份真实已经进入暗区。
    // 这就是 §18.4 所说的代表绑定假阴性，候选宽度指标完全看不到它。
    expect(baseline.candidateWidth).toBe(4)
    expect(baseline.falseNegativeIDs.length).toBeGreaterThan(0)
  })

  it('三个模型在同一 k 下区分错误断言与 UI 遗漏', () => {
    const matrix = [1, 2, 3, 4, 5].map((k) => {
      const { generationProjection, baseline, cohort } = evaluate(k)
      return {
        k,
        baselineWidth: baseline.candidateWidth,
        baselineFalseNegative: baseline.falseNegativeIDs.length,
        generationWidth: generationProjection.candidateWidth,
        generationOmission: generationProjection.omittedOutsidePileIDs.length,
        cohortWidth: cohort.candidateWidth,
        cohortFalseNegative: cohort.falseNegativeIDs.length
      }
    })

    expect(matrix.every((row) => row.generationOmission === 0)).toBe(true)
    expect(matrix.every((row) => row.cohortFalseNegative === 0)).toBe(true)
    expect(matrix.some((row) => row.baselineFalseNegative > 0)).toBe(true)
    expect(matrix).toMatchInlineSnapshot(`
      [
        {
          "baselineFalseNegative": 1,
          "baselineWidth": 4,
          "cohortFalseNegative": 0,
          "cohortWidth": 8,
          "generationOmission": 0,
          "generationWidth": 8,
          "k": 1,
        },
        {
          "baselineFalseNegative": 2,
          "baselineWidth": 5,
          "cohortFalseNegative": 0,
          "cohortWidth": 8,
          "generationOmission": 0,
          "generationWidth": 8,
          "k": 2,
        },
        {
          "baselineFalseNegative": 2,
          "baselineWidth": 6,
          "cohortFalseNegative": 0,
          "cohortWidth": 8,
          "generationOmission": 0,
          "generationWidth": 8,
          "k": 3,
        },
        {
          "baselineFalseNegative": 1,
          "baselineWidth": 7,
          "cohortFalseNegative": 0,
          "cohortWidth": 8,
          "generationOmission": 0,
          "generationWidth": 8,
          "k": 4,
        },
        {
          "baselineFalseNegative": 0,
          "baselineWidth": 8,
          "cohortFalseNegative": 0,
          "cohortWidth": 8,
          "generationOmission": 0,
          "generationWidth": 8,
          "k": 5,
        },
      ]
    `)
  })

  it('全局世代投影的宽候选是保守展示，不等于 active pool 的牌堆断言', () => {
    const events = buildFixture(2)
    const oracle = runOracle(events, {
      deckOrder: trueDeckOrder,
      recycledOrders: [trueRecycledOrder]
    })
    const generation = runGenerationPoolModel(events)
    const verdict = evaluateUnknownLocationProjection(
      generation.state.suspendedIdentityIDs,
      getGenerationUnresolvedIDs(generation.state),
      oracle
    )

    verdict.displayedStillInPileIDs.forEach((cardID) => {
      expect(oracle.truePile).toContain(cardID)
    })
    expect(verdict.omittedOutsidePileIDs).toEqual([])
  })
})

describe('§18.6-4 摸穿原剩余槽后继续消费洗回批次', () => {
  /**
   * 更长序列：连续两个自动洗牌周期，每次都摸穿原剩余牌堆并深入洗回批次。
   * 用于观察候选宽度在真实可达序列下的长期走向，而不是单点比较。
   *
   * 真实牌序（末尾是牌顶）：8、9、10 先被暗摸走，{1..5} 随后从牌堆明摸。
   */
  const trueDeckOrder = [6, 7, 1, 2, 3, 4, 5, 10, 9, 8]

  const events: PileGenerationEvent[] = [
    { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { type: 'drawUnknown', count: 3 },
    { type: 'revealFromPile', cardIDs: [1, 2, 3, 4, 5] },
    { type: 'discardKnown', cardIDs: [1, 2, 3, 4, 5] },
    // 周期 1：牌堆剩 2，摸 4 张 —— 摸穿原剩余槽并消费 2 张洗回牌。
    { type: 'drawAcrossShuffle', count: 4 },
    { type: 'revealFromHand', cardIDs: [8, 9, 10] },
    { type: 'discardKnown', cardIDs: [8, 9, 10] },
    // 周期 2：牌堆剩 3，摸 5 张 —— 再次摸穿并深入新洗回批次。
    { type: 'drawAcrossShuffle', count: 5 }
  ]

  it('多周期下身份全集始终守恒', () => {
    events.forEach((_event, index) => {
      const slice = events.slice(0, index + 1)
      expect(countGenerationSlots(runGenerationPoolModel(slice).state)).toBe(10)
      expect(countBaselineSlots(runBaselineLedgerModel(slice).state)).toBe(10)
      expect(countCohortSlots(runCohortPoolModel(slice))).toBe(10)
    })
  })

  it('多周期候选宽度走向', () => {
    const generationWidths = runGenerationPoolModel(events).shuffles.map(
      (entry) => entry.candidateWidth
    )
    const baselineWidths = runBaselineLedgerModel(events).shuffles.map(
      (entry) => entry.candidateWidth
    )
    const cohortWidths = [5, events.length].map(
      (eventCount) =>
        getCohortUnknownLocationCandidateIDs(runCohortPoolModel(events.slice(0, eventCount))).size
    )

    expect({ generationWidths, baselineWidths, cohortWidths }).toMatchInlineSnapshot(`
      {
        "baselineWidths": [
          5,
          4,
        ],
        "cohortWidths": [
          10,
          10,
        ],
        "generationWidths": [
          5,
          7,
        ],
      }
    `)
  })

  it('多周期：区分世代 UI 遗漏与批次模型的精确基数', () => {
    const oracle = runOracle(events, {
      deckOrder: trueDeckOrder,
      recycledOrders: [
        [5, 4, 3, 2, 1],
        [10, 9, 8]
      ]
    })
    const baseline = runBaselineLedgerModel(events)
    const generation = runGenerationPoolModel(events)
    const cohort = runCohortPoolModel(events)

    const baselineVerdict = evaluateAgainstOracle(
      baseline.state.suspendedIdentityIDs,
      getBaselineBelievedInPile(baseline.state),
      oracle
    )
    const generationProjection = evaluateUnknownLocationProjection(
      generation.state.suspendedIdentityIDs,
      getGenerationUnresolvedIDs(generation.state),
      oracle
    )
    const cohortVerdict = evaluateAgainstOracle(
      getCohortUnknownLocationCandidateIDs(cohort),
      getCohortDefinitelyInPileIDs(cohort),
      oracle
    )

    // active pool 按计划正文只是「仍保留牌堆来源可能性」，所以 8、9 是未显示的未决身份，
    // 不是模型声称仍在牌堆的身份。批次模型把它们纳入候选并保留 3 选 1 的基数关系。
    expect(generationProjection.omittedOutsidePileIDs).toEqual([8, 9])
    expect(cohortVerdict.falseNegativeIDs).toEqual([])

    expect({
      baselineWidth: baselineVerdict.candidateWidth,
      baselineFalseNegative: baselineVerdict.falseNegativeIDs,
      generationWidth: generationProjection.candidateWidth,
      generationOmission: generationProjection.omittedOutsidePileIDs,
      cohortWidth: cohortVerdict.candidateWidth,
      cohortFalseNegative: cohortVerdict.falseNegativeIDs,
      cohortCardinalities: cohort.cohorts.map((entry) => ({
        generation: entry.generation,
        candidateIDs: sortIDs(entry.candidateIdentityIDs),
        remainingPileCount: entry.remainingPileCount
      }))
    }).toMatchInlineSnapshot(`
      {
        "baselineFalseNegative": [
          8,
        ],
        "baselineWidth": 4,
        "cohortCardinalities": [
          {
            "candidateIDs": [
              8,
              9,
              10,
            ],
            "generation": 2,
            "remainingPileCount": 1,
          },
          {
            "candidateIDs": [
              1,
              2,
              3,
              4,
              5,
            ],
            "generation": 1,
            "remainingPileCount": 0,
          },
          {
            "candidateIDs": [
              6,
              7,
            ],
            "generation": 0,
            "remainingPileCount": 0,
          },
        ],
        "cohortFalseNegative": [],
        "cohortWidth": 10,
        "generationOmission": [
          8,
          9,
        ],
        "generationWidth": 7,
      }
    `)
  })
})

describe('§5.3 批次边界事件回归', () => {
  /**
   * 计划 §5.3.2 枚举了 14 类会触碰牌堆的真实协议路径。本文件只覆盖由通用批次规则处理
   * 的那些；B8–B11（潜伏、伊籍机捷、骋烈/天辩/宴戏、特殊装备牌）另由各自的特殊路径
   * 实现，不在本纯模型范围内。
   *
   * 覆盖到的两类处理：
   *
   * - 保持边界：普通摸牌、洗回、牌顶展示、搜牌取指定牌等。
   * - 合并批次（B3 浑天仪 / B4 回魂牌）：以未知位置进入牌堆。
   *
   * 本模型内破坏边界的只有 RANDOM 入堆这一条低频技能路径，因此 §9.2 首条 NO-GO 条件
   * 「批次边界在普通技能中频繁失效」当前不成立。
   */

  describe('B3 / B4 随机位置入堆：合并批次', () => {
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'revealFromPile', cardIDs: [1, 2] },
      { type: 'discardKnown', cardIDs: [1, 2] },
      { type: 'shuffle' },
      // 回魂牌 4400 以未知位置进入牌堆。
      { type: 'insertExternalAtRandom', cardIDs: [4400] }
    ]

    it('合并全部批次并记录降级次数', () => {
      const state = runCohortPoolModel(events)

      // 合并前是 {1,2}/2 + {3,4,5}/3；合并后只保留集合级真信息。
      expect(state.cohorts).toHaveLength(1)
      expect(sortIDs(state.cohorts[0].candidateIdentityIDs)).toEqual([1, 2, 3, 4, 5, 4400])
      expect(state.cohorts[0].remainingPileCount).toBe(6)
      expect(state.cohortDegradationCount).toBe(1)
    })

    it('合并后仍保持物理守恒与基数守恒', () => {
      const state = runCohortPoolModel(events)

      expect(countCohortSlots(state)).toBe(state.identityUniverse.size)
      const totalRemaining = state.cohorts.reduce(
        (sum, cohort) => sum + cohort.remainingPileCount,
        0
      )
      expect(totalRemaining).toBe(state.pileSlotCount)
    })

    it('合并是诚实降级：六张全在牌堆时仍是确定信息', () => {
      const state = runCohortPoolModel(events)

      // 此时 remainingPileCount === candidateIdentityIDs.size，
      // 因此合并没有丢失「都在牌堆」这条真信息，只丢失了更细的分组。
      expect(sortIDs(getCohortDefinitelyInPileIDs(state))).toEqual([1, 2, 3, 4, 5, 4400])
      expect(getCohortUnknownLocationCandidateIDs(state).size).toBe(0)
    })

    it('合并后再暗摸，整个合并批次转为未知位置候选', () => {
      const state = runCohortPoolModel([...events, { type: 'drawUnknown', count: 1 }])

      // 这就是降级的代价：本可只让牌顶批次变模糊，现在整批都变模糊。
      expect(getCohortDefinitelyInPileIDs(state).size).toBe(0)
      expect(sortIDs(getCohortUnknownLocationCandidateIDs(state))).toEqual([1, 2, 3, 4, 5, 4400])
    })
  })

  describe('降级 vs 保持边界的信息量对照', () => {
    /**
     * 同一牌局，唯一差别是中途是否发生一次 RANDOM 入堆。
     * 用于量化 §8.2 的 batchBoundaryDegradationCount 对信息表达的实际影响。
     */
    const baseEvents: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6] },
      { type: 'revealFromPile', cardIDs: [1, 2] },
      { type: 'discardKnown', cardIDs: [1, 2] },
      { type: 'shuffle' },
      { type: 'drawUnknown', count: 1 }
    ]

    it('保持边界时，未被摸过的批次仍是确定信息', () => {
      const state = runCohortPoolModel(baseEvents)

      // 摸牌只消费牌顶批次 {3,4,5,6}，牌底批次 {1,2} 未受影响。
      expect(sortIDs(getCohortDefinitelyInPileIDs(state))).toEqual([1, 2])
      expect(sortIDs(getCohortUnknownLocationCandidateIDs(state))).toEqual([3, 4, 5, 6])
      expect(state.cohortDegradationCount).toBe(0)
    })

    it('降级后同一次摸牌让全部身份变模糊', () => {
      const events: PileGenerationEvent[] = [
        ...baseEvents.slice(0, 4),
        { type: 'insertExternalAtRandom', cardIDs: [4400] },
        { type: 'drawUnknown', count: 1 }
      ]
      const state = runCohortPoolModel(events)

      expect(getCohortDefinitelyInPileIDs(state).size).toBe(0)
      expect(sortIDs(getCohortUnknownLocationCandidateIDs(state))).toEqual([1, 2, 3, 4, 5, 6, 4400])
      expect(state.cohortDegradationCount).toBe(1)
    })
  })

  describe('oracle 校验降级后的模型仍不产生假阴性', () => {
    it('RANDOM 入堆真实落在牌底时，批次模型不做错误断言', () => {
      const events: PileGenerationEvent[] = [
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'revealFromPile', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        { type: 'shuffle' },
        { type: 'insertExternalAtRandom', cardIDs: [4400] },
        { type: 'drawUnknown', count: 2 }
      ]

      const oracle = runOracle(events, {
        // 真实牌序末尾是牌顶：明摸 {1,2} 需要它们在牌顶。
        deckOrder: [5, 4, 3, 2, 1],
        recycledOrders: [[1, 2]],
        // 回魂牌真实插入牌底（下标 0），而基线只能按牌顶追加。
        randomInsertPositions: [0]
      })
      const cohort = runCohortPoolModel(events)

      const verdict = evaluateUnknownLocationProjection(
        getCohortUnknownLocationCandidateIDs(cohort),
        getCohortUnknownLocationCandidateIDs(cohort),
        oracle
      )

      // 降级把全部身份列为未知位置候选，因此不可能漏报「已离开牌堆」。
      expect(verdict.omittedOutsidePileIDs).toEqual([])
      // 而 definitelyInPile 为空，意味着模型没有做任何可被证伪的牌堆断言。
      expect(getCohortDefinitelyInPileIDs(cohort).size).toBe(0)
    })
  })
})

describe('固定 seed 属性序列', () => {
  /**
   * §10-3b：自动搜索违反 §4.2 批次守恒的事件组合。
   *
   * §5.3 的边界规则是手工枚举的，容易漏掉事件组合。属性测试用固定 seed 生成合法
   * 序列，在每一步验证不变量，从而补上这张网。失败时输出 seed 与完整事件序列。
   *
   * 生成器只产出**协议可达**的序列：例如洗牌必须有弃牌，摸牌不能超过牌堆张数。
   */

  /** 确定性 PRNG（mulberry32），避免依赖被禁用的 Math.random()。 */
  function createRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  interface SequenceModelState {
    pileSlotCount: number
    playerAnonSlotCount: number
    playerKnownIDs: CardID[]
    discardKnownIDs: CardID[]
  }

  /**
   * 生成一条合法事件序列。
   *
   * 这里只跟踪生成序列所需的最小状态（各区张数），真正的不变量校验交给三个模型。
   *
   * 注意：`revealFromPile` 必须从**牌顶批次**的候选中取。这是批次模型的一条可证伪
   * 预测——牌堆顶被揭示的身份，物理上只能来自牌顶批次。生成器遵守它，否则会造出
   * 协议不可能产生的序列；Phase 1 若在真实回放中观察到违反，说明批次边界模型有误。
   */
  function generateSequence(seed: number, steps: number): PileGenerationEvent[] {
    const random = createRandom(seed)
    const pick = (limit: number) => Math.floor(random() * limit)

    const deckSize = 8 + pick(5)
    const cardIDs = Array.from({ length: deckSize }, (_, index) => index + 1)
    const events: PileGenerationEvent[] = [{ type: 'initialize', cardIDs }]
    const state: SequenceModelState = {
      pileSlotCount: deckSize,
      playerAnonSlotCount: 0,
      playerKnownIDs: [],
      discardKnownIDs: []
    }
    // 已被揭示或已进入弃牌堆的身份不能再次从牌堆明摸。
    const availablePileIdentities = new Set(cardIDs)
    let nextExternalID = 60000
    let hasGeneratedGainFromPile = false

    /** 当前牌顶批次里仍可揭示的身份；空表示这一步不能做牌堆明摸。 */
    const topCohortCandidates = (): CardID[] => {
      const cohortState = runCohortPoolModel(events)
      // cohorts 末尾靠牌顶；取第一个仍有牌在牌堆的批次。
      for (let index = cohortState.cohorts.length - 1; index >= 0; index -= 1) {
        const cohort = cohortState.cohorts[index]
        if (cohort.remainingPileCount <= 0) continue
        return sortIDs(cohort.candidateIdentityIDs).filter((cardID) =>
          availablePileIdentities.has(cardID)
        )
      }
      return []
    }

    /** 搜牌事件故意选择仍有牌在堆、但不属于当前牌顶批次的候选身份。 */
    const nonTopCohortCandidates = (): CardID[] => {
      const topCandidates = new Set(topCohortCandidates())
      const cohortState = runCohortPoolModel(events)
      const candidates = new Set<CardID>()

      cohortState.cohorts.forEach((cohort) => {
        if (cohort.remainingPileCount <= 0) return
        cohort.candidateIdentityIDs.forEach((cardID) => {
          if (availablePileIdentities.has(cardID) && !topCandidates.has(cardID)) {
            candidates.add(cardID)
          }
        })
      })

      return sortIDs(candidates)
    }

    for (let step = 0; step < steps; step += 1) {
      // 一旦显式洗牌形成了仍在牌顶批次之外的可取身份，优先覆盖一次任意位置搜牌。
      // 这使固定 seed 集合稳定包含 B13，而不是把覆盖率寄托在短暂窗口内的随机 roll。
      if (!hasGeneratedGainFromPile && state.pileSlotCount > 0) {
        const pool = nonTopCohortCandidates()
        if (pool.length > 0) {
          const cardID = pool[pick(pool.length)]
          events.push({ type: 'gainFromPile', cardIDs: [cardID] })
          availablePileIdentities.delete(cardID)
          state.pileSlotCount -= 1
          state.playerKnownIDs.push(cardID)
          hasGeneratedGainFromPile = true
          continue
        }
      }

      const roll = pick(100)

      if (roll < 22 && state.pileSlotCount > 0) {
        const count = 1 + pick(Math.min(3, state.pileSlotCount))
        events.push({ type: 'drawUnknown', count })
        state.pileSlotCount -= count
        state.playerAnonSlotCount += count
        continue
      }

      if (roll < 42 && state.pileSlotCount > 0) {
        // 明摸：只能从牌顶批次取，否则是协议不可能产生的序列。
        const pool = topCohortCandidates()
        if (pool.length === 0) continue

        const cardID = pool[pick(pool.length)]
        events.push({ type: 'revealFromPile', cardIDs: [cardID] })
        availablePileIdentities.delete(cardID)
        state.pileSlotCount -= 1
        state.playerKnownIDs.push(cardID)
        continue
      }

      if (roll < 50 && state.pileSlotCount > 0) {
        const pool = nonTopCohortCandidates()
        if (pool.length === 0) continue

        const cardID = pool[pick(pool.length)]
        events.push({ type: 'gainFromPile', cardIDs: [cardID] })
        availablePileIdentities.delete(cardID)
        state.pileSlotCount -= 1
        state.playerKnownIDs.push(cardID)
        hasGeneratedGainFromPile = true
        continue
      }

      if (roll < 58 && state.pileSlotCount > 0) {
        const count = 1 + pick(Math.min(3, state.pileSlotCount))
        const rangeSize = count + pick(state.pileSlotCount - count + 1)
        events.push({ type: 'gainUnknownFromPileTopRange', count, rangeSize })
        state.pileSlotCount -= count
        state.playerAnonSlotCount += count
        continue
      }

      if (roll < 68 && state.playerAnonSlotCount > 0 && availablePileIdentities.size > 0) {
        // 从手牌揭示不受批次顺序约束：暗摸可能来自任何批次。
        const pool = sortIDs(availablePileIdentities)
        const cardID = pool[pick(pool.length)]
        events.push({ type: 'revealFromHand', cardIDs: [cardID] })
        availablePileIdentities.delete(cardID)
        state.playerAnonSlotCount -= 1
        state.playerKnownIDs.push(cardID)
        continue
      }

      if (roll < 78 && state.playerKnownIDs.length > 0) {
        const index = pick(state.playerKnownIDs.length)
        const [cardID] = state.playerKnownIDs.splice(index, 1)
        events.push({ type: 'discardKnown', cardIDs: [cardID] })
        state.discardKnownIDs.push(cardID)
        continue
      }

      if (roll < 86 && state.discardKnownIDs.length > 0) {
        events.push({ type: 'shuffle' })
        state.discardKnownIDs.forEach((cardID) => availablePileIdentities.add(cardID))
        state.pileSlotCount += state.discardKnownIDs.length
        state.discardKnownIDs = []
        continue
      }

      if (
        roll < 93 &&
        state.discardKnownIDs.length > 0 &&
        state.pileSlotCount + state.discardKnownIDs.length >= 1
      ) {
        // 自动补牌：必须超过洗牌前牌堆量，且不超过洗牌后总量。
        const postShuffleCount = state.pileSlotCount + state.discardKnownIDs.length
        const minDraw = state.pileSlotCount + 1
        if (minDraw > postShuffleCount) continue

        const count = minDraw + pick(postShuffleCount - minDraw + 1)
        events.push({ type: 'drawAcrossShuffle', count })
        state.discardKnownIDs.forEach((cardID) => availablePileIdentities.add(cardID))
        state.pileSlotCount = postShuffleCount - count
        state.discardKnownIDs = []
        state.playerAnonSlotCount += count
        continue
      }

      if (roll < 97) {
        // B3/B4：随机位置入堆，触发批次合并降级。
        const cardID = nextExternalID
        nextExternalID += 1
        events.push({ type: 'insertExternalAtRandom', cardIDs: [cardID] })
        availablePileIdentities.add(cardID)
        state.pileSlotCount += 1
      }
    }

    return events
  }

  /** 把 seed 与完整序列格式化为可重放的失败上下文。 */
  function describeSequence(seed: number, events: PileGenerationEvent[]): string {
    return `seed=${seed}\n${JSON.stringify(events, null, 2)}`
  }

  /** 属性序列 JSON 只在断言失败时生成，避免每个成功前缀都重复序列化。 */
  function withSequenceContext(
    seed: number,
    events: PileGenerationEvent[],
    runAssertions: () => void
  ): void {
    try {
      runAssertions()
    } catch (error) {
      const context = describeSequence(seed, events)
      if (!(error instanceof Error)) {
        throw new Error(`${context}\n${String(error)}`, { cause: error })
      }
      error.message = `${context}\n${error.message}`
      throw error
    }
  }

  const SEEDS = [1, 7, 42, 101, 256, 1337, 20260731, 99991]

  it('批次模型在所有 seed 下保持物理与基数守恒', () => {
    SEEDS.forEach((seed) => {
      const events = generateSequence(seed, 40)

      events.forEach((_event, index) => {
        const slice = events.slice(0, index + 1)
        withSequenceContext(seed, slice, () => {
          const state = runCohortPoolModel(slice)

          // §4.1 物理守恒。
          expect(countCohortSlots(state)).toBe(state.identityUniverse.size)

          // §4.2 批次守恒。
          const totalRemaining = state.cohorts.reduce(
            (sum, cohort) => sum + cohort.remainingPileCount,
            0
          )
          expect(totalRemaining).toBe(state.pileSlotCount)

          state.cohorts.forEach((cohort) => {
            expect(cohort.remainingPileCount).toBeGreaterThanOrEqual(0)
            expect(cohort.remainingPileCount).toBeLessThanOrEqual(cohort.candidateIdentityIDs.size)
          })

          // 批次候选两两互斥。
          const seen = new Set<CardID>()
          state.cohorts.forEach((cohort) => {
            cohort.candidateIdentityIDs.forEach((cardID) => {
              expect(seen.has(cardID), `重复身份 ${cardID}`).toBe(false)
              seen.add(cardID)
            })
          })

          // 批次身份不得同时位于 locatedIdentityIDs。
          seen.forEach((cardID) => {
            expect(state.locatedIdentityIDs.has(cardID), `身份 ${cardID} 同时已定位`).toBe(false)
          })
        })
      })
    })
  })

  it('世代模型在所有 seed 下保持身份分区唯一', () => {
    SEEDS.forEach((seed) => {
      const events = generateSequence(seed, 40)

      events.forEach((_event, index) => {
        const slice = events.slice(0, index + 1)
        withSequenceContext(seed, slice, () => {
          const { state } = runGenerationPoolModel(slice)

          expect(countGenerationSlots(state)).toBe(state.identityUniverse.size)

          // active 与 suspended 不重叠。
          const overlap = sortIDs(state.activeIdentityIDs).filter((cardID) =>
            state.suspendedIdentityIDs.has(cardID)
          )
          expect(overlap).toEqual([])

          // active ⊆ 未定位。
          const unlocated = getGenerationUnlocated(state)
          state.activeIdentityIDs.forEach((cardID) => {
            expect(unlocated.has(cardID), `active ${cardID} 已定位`).toBe(true)
          })
        })
      })
    })
  })

  it('基线模型在所有 seed 下保持物理守恒', () => {
    SEEDS.forEach((seed) => {
      const events = generateSequence(seed, 40)

      events.forEach((_event, index) => {
        const slice = events.slice(0, index + 1)
        withSequenceContext(seed, slice, () => {
          const state = runBaselineLedgerModel(slice).state
          expect(countBaselineSlots(state)).toBe(state.identityUniverse.size)
        })
      })
    })
  })

  it('降级只由 RANDOM 或跨批次牌顶范围事件触发，且单调不减', () => {
    SEEDS.forEach((seed) => {
      const events = generateSequence(seed, 40)
      withSequenceContext(seed, events, () => {
        let previous = 0
        events.forEach((event, index) => {
          const current = runCohortPoolModel(events.slice(0, index + 1)).cohortDegradationCount
          const delta = current - previous

          expect(current).toBeGreaterThanOrEqual(previous)
          expect(delta).toBeLessThanOrEqual(1)
          if (event.type === 'insertExternalAtRandom') expect(delta).toBe(1)
          else if (event.type !== 'gainUnknownFromPileTopRange') expect(delta).toBe(0)

          previous = current
        })
      })
    })
  })

  it('生成器确实覆盖了全部事件类型', () => {
    const covered = new Set<string>()
    SEEDS.forEach((seed) => {
      generateSequence(seed, 40).forEach((event) => covered.add(event.type))
    })

    // 若某类事件从未被生成，上面的守恒断言就是空跑，必须暴露出来。
    expect(Array.from(covered).sort()).toEqual([
      'discardKnown',
      'drawAcrossShuffle',
      'drawUnknown',
      'gainFromPile',
      'gainUnknownFromPileTopRange',
      'initialize',
      'insertExternalAtRandom',
      'revealFromHand',
      'revealFromPile',
      'shuffle'
    ])
  })
})

describe('§5.3 从牌堆任意位置获取牌（MoveType=18）', () => {
  /**
   * 协议 `FromZone=1 && MoveType=18` 是「从牌堆获取牌」，见
   * `MoveEventNormalizer.getProtocolMoveSpecialLabel()`。它不等同于牌顶摸牌：
   * 搜牌类技能可以从牌堆任意位置拿走指定牌。
   *
   * 生产侧 `Zone.remove()` 没有 RANDOM 分支（`POSITION_RANDOM` 落入牌顶弹出），
   * 即把「任意位置取牌」按牌顶取牌处理——这是当前实现的已知近似。
   */

  describe('B13 带 CardID 的搜牌：不要求位于牌顶批次', () => {
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'revealFromPile', cardIDs: [1, 2] },
      { type: 'discardKnown', cardIDs: [1, 2] },
      // 洗回后：批次 {1,2}/2 在牌底侧，批次 {3,4,5}/3 在牌顶侧。
      { type: 'shuffle' },
      // 搜牌拿走牌底批次的 1，协议给出 CardID 就证明它此刻在牌堆。
      { type: 'gainFromPile', cardIDs: [1] }
    ]

    it('从非牌顶批次搜牌只扣该批次基数', () => {
      const state = runCohortPoolModel(events)

      const summaries = state.cohorts.map((cohort) => ({
        candidateIDs: sortIDs(cohort.candidateIdentityIDs),
        remainingPileCount: cohort.remainingPileCount
      }))

      expect(summaries).toEqual([
        { candidateIDs: [2], remainingPileCount: 1 },
        { candidateIDs: [3, 4, 5], remainingPileCount: 3 }
      ])
      expect(state.locatedIdentityIDs.has(1)).toBe(true)
      expect(countCohortSlots(state)).toBe(state.identityUniverse.size)
    })

    it('搜牌不触发批次降级', () => {
      expect(runCohortPoolModel(events).cohortDegradationCount).toBe(0)
    })

    it('所属批次已无在牌堆名额时报错', () => {
      expect(() =>
        runCohortPoolModel([
          { type: 'initialize', cardIDs: [1, 2] },
          { type: 'drawUnknown', count: 2 },
          { type: 'gainFromPile', cardIDs: [1] }
        ])
      ).toThrow(/所属批次已无在牌堆名额/)
    })
  })

  describe('B14 权变 7011：牌顶 X 张取一张，无 CardID', () => {
    /**
     * 实测样例：
     *
     * ```text
     * CardCount: 1, CardIDs: [], FromID: 255, FromZone: 1,
     * MoveType: 18, SpellID: 7011, ToID: 2, ToZone: 5
     * ```
     *
     * 主视角能看到牌顶 X 张，非主视角只知道「从牌顶 X 张里拿走了一张」。
     */

    it('范围落在牌顶批次内时只扣该批次，不降级', () => {
      const state = runCohortPoolModel([
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'revealFromPile', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        { type: 'shuffle' },
        // 牌顶批次 {3,4,5} 有 3 张，范围 3 张恰好不越界。
        { type: 'gainUnknownFromPileTopRange', count: 1, rangeSize: 3 }
      ])

      expect(state.cohortDegradationCount).toBe(0)
      expect(
        state.cohorts.map((cohort) => ({
          candidateIDs: sortIDs(cohort.candidateIdentityIDs),
          remainingPileCount: cohort.remainingPileCount
        }))
      ).toEqual([
        { candidateIDs: [1, 2], remainingPileCount: 2 },
        { candidateIDs: [3, 4, 5], remainingPileCount: 2 }
      ])
      // {1,2} 全在牌堆 → 仍是确定信息。
      expect(sortIDs(getCohortDefinitelyInPileIDs(state))).toEqual([1, 2])
    })

    it('范围跨批次边界时合并降级', () => {
      const state = runCohortPoolModel([
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'revealFromPile', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        { type: 'shuffle' },
        // 牌顶批次只有 3 张，范围 4 张必然跨到牌底批次 {1,2}。
        // 此时无法确定各批次分别丢了几张，只能合并。
        { type: 'gainUnknownFromPileTopRange', count: 1, rangeSize: 4 }
      ])

      expect(state.cohortDegradationCount).toBe(1)
      expect(state.cohorts).toHaveLength(1)
      expect(sortIDs(state.cohorts[0].candidateIdentityIDs)).toEqual([1, 2, 3, 4, 5])
      expect(state.cohorts[0].remainingPileCount).toBe(4)
      // 降级代价：{1,2} 不再是确定在牌堆。
      expect(getCohortDefinitelyInPileIDs(state).size).toBe(0)
      expect(countCohortSlots(state)).toBe(state.identityUniverse.size)
    })

    it('取牌数超过范围或牌堆时报错', () => {
      const base: PileGenerationEvent[] = [{ type: 'initialize', cardIDs: [1, 2, 3] }]

      expect(() =>
        runCohortPoolModel([
          ...base,
          { type: 'gainUnknownFromPileTopRange', count: 2, rangeSize: 1 }
        ])
      ).toThrow(/牌顶范围小于取牌数/)

      expect(() =>
        runCohortPoolModel([
          ...base,
          { type: 'gainUnknownFromPileTopRange', count: 5, rangeSize: 5 }
        ])
      ).toThrow(/牌顶范围取牌超过牌堆物理槽/)
    })

    it('oracle：真实拿走范围内任意一张，模型都不产生假阴性', () => {
      const events: PileGenerationEvent[] = [
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'revealFromPile', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        { type: 'shuffle' },
        { type: 'gainUnknownFromPileTopRange', count: 1, rangeSize: 3 }
      ]

      // 真实牌序末尾是牌顶：明摸 {1,2} 需要它们在牌顶。
      // 洗回后 truePile = [1,2] + [5,4,3]，牌顶三张是 5、4、3。
      // 真实拿走的是 5（范围内最靠底的一张），而不是最靠顶的 3。
      const oracle = runOracle(events, {
        deckOrder: [5, 4, 3, 2, 1],
        recycledOrders: [[1, 2]],
        topRangePicks: [[5]]
      })
      const cohort = runCohortPoolModel(events)

      const verdict = evaluateUnknownLocationProjection(
        getCohortUnknownLocationCandidateIDs(cohort),
        getCohortUnknownLocationCandidateIDs(cohort),
        oracle
      )

      // 批次模型把整个牌顶批次 {3,4,5} 列为未知位置候选，因此不会漏报 5 已离开牌堆。
      expect(verdict.omittedOutsidePileIDs).toEqual([])
      expect(sortIDs(getCohortUnknownLocationCandidateIDs(cohort))).toEqual([3, 4, 5])
      // {1,2} 未被范围触及，仍是确定信息，且 oracle 证实它们确实在牌堆。
      expect(sortIDs(getCohortDefinitelyInPileIDs(cohort))).toEqual([1, 2])
      expect(oracle.truePile).toContain(1)
      expect(oracle.truePile).toContain(2)
    })
  })
})

describe('§10-4 批次分组投影原型', () => {
  /**
   * Phase 0.5 的最后一项：验证「候选集合中 K 张仍在牌堆」能否投影成用户读得懂的分组。
   *
   * 投影不引入任何新推断，只是把 `PileIdentityCohort` 按
   * `remainingPileCount` 与集合大小的关系分成三类陈述。因此它的正确性完全继承自批次
   * 模型；这里用 oracle 校验的是「这三类陈述是否真的成立」。
   */

  /** §6.2 的可达两周期夹具：k 控制第一批洗回牌被暗摸走的张数。 */
  function buildReachableFixture(k: number): PileGenerationEvent[] {
    return [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { type: 'drawUnknown', count: 2 },
      { type: 'revealFromPile', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'discardKnown', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawAcrossShuffle', count: 3 + k },
      { type: 'revealFromHand', cardIDs: [6, 7] },
      { type: 'discardKnown', cardIDs: [6, 7] },
      { type: 'shuffle' }
    ]
  }

  describe('三类分组陈述', () => {
    it('k=1 时投影成「全在/部分在/全不在」三组', () => {
      const projection = projectCohorts(runCohortPoolModel(buildReachableFixture(1)))

      expect(
        projection.groups.map((group) => ({
          kind: group.kind,
          cardIDs: group.cardIDs,
          label: group.label
        }))
      ).toEqual([
        { kind: 'all-in-pile', cardIDs: [6, 7], label: '这 2 张都在牌堆' },
        { kind: 'partial', cardIDs: [1, 2, 3, 4, 5], label: '这 5 张里有 4 张在牌堆' },
        { kind: 'none-in-pile', cardIDs: [8, 9, 10], label: '这 3 张都不在牌堆' }
      ])
    })

    it('分组数远小于扁平候选宽度：3 组 vs 8 张', () => {
      const state = runCohortPoolModel(buildReachableFixture(1))
      const projection = projectCohorts(state)

      // 扁平投影要列出全部 8 张未定位身份。
      expect(sortIDs(getCohortUnknownLocationCandidateIDs(state)).length).toBe(8)
      // 分组投影只需 3 行；其中两行是确定陈述，只有 1 行是真正的模糊集合。
      expect(projection.groupCount).toBe(3)
      expect(projection.flatCandidateWidth).toBe(5)
    })

    it('none-in-pile 组表达了扁平投影说不出的事', () => {
      const state = runCohortPoolModel(buildReachableFixture(1))
      const projection = projectCohorts(state)

      // 扁平投影把 8、9、10 与其它候选混在一起，无法表达「它们已确定离开牌堆」。
      expect(getCohortUnknownLocationCandidateIDs(state).has(8)).toBe(true)
      expect(projection.definitelyOutsidePileIDs).toEqual([8, 9, 10])
      expect(projection.definitelyInPileIDs).toEqual([6, 7])
    })

    it('k 增大时 partial 组收紧为 none-in-pile，分组数不增长', () => {
      const kinds = [1, 3, 5].map((k) =>
        projectCohorts(runCohortPoolModel(buildReachableFixture(k))).groups.map(
          (group) => group.kind
        )
      )

      expect(kinds).toEqual([
        ['all-in-pile', 'partial', 'none-in-pile'],
        ['all-in-pile', 'partial', 'none-in-pile'],
        ['all-in-pile', 'none-in-pile', 'none-in-pile']
      ])
    })
  })

  describe('oracle 校验：分组陈述必须为真', () => {
    /**
     * `all-in-pile` 与 `none-in-pile` 都是对用户的确定陈述。一旦为假，就是记牌器在
     * 说谎——这比候选偏宽严重得多，因此必须逐 k 校验。
     */
    it('k=1..5 的分组陈述在 oracle 下全部成立', () => {
      ;[1, 2, 3, 4, 5].forEach((k) => {
        const events = buildReachableFixture(k)
        const oracle = runOracle(events, {
          // 牌底→牌顶。牌顶 2 张是暗摸走的 6、7（后续从手牌揭示），
          // 其下 5 张是明摸的 {1..5}，最底 3 张 {8,9,10} 整局没被摸到。
          deckOrder: [8, 9, 10, 1, 2, 3, 4, 5, 7, 6],
          recycledOrders: [
            [1, 2, 3, 4, 5],
            [6, 7]
          ]
        })
        const projection = projectCohorts(runCohortPoolModel(events))
        const verdict = evaluateCohortProjection(projection, oracle)

        expect(verdict.brokenAllInPileIDs, `k=${k}`).toEqual([])
        expect(verdict.brokenNoneInPileIDs, `k=${k}`).toEqual([])
        expect(verdict.brokenPartialCounts, `k=${k}`).toEqual([])
      })
    })

    it('分组基数之和恒等于物理牌堆张数', () => {
      // 没有 oracle 牌序时仍可校验自洽：分组声明的在堆张数之和必须等于物理牌堆。
      ;[1, 2, 3, 4, 5].forEach((k) => {
        const state = runCohortPoolModel(buildReachableFixture(k))
        const projection = projectCohorts(state)

        const declaredTotal = projection.groups.reduce(
          (sum, group) => sum + group.remainingPileCount,
          0
        )
        expect(declaredTotal, `k=${k}`).toBe(state.pileSlotCount)

        // 三类分组必须覆盖全部未定位身份，不能凭空少列。
        const projectedIDs = sortIDs(projection.groups.flatMap((group) => group.cardIDs))
        expect(projectedIDs, `k=${k}`).toEqual(
          sortIDs([
            ...getCohortUnknownLocationCandidateIDs(state),
            ...getCohortDefinitelyInPileIDs(state)
          ])
        )
      })
    })
  })

  describe('降级对可读性的影响', () => {
    it('RANDOM 入堆合并批次后，分组投影退化为单组', () => {
      const state = runCohortPoolModel([
        ...buildReachableFixture(1),
        { type: 'insertExternalAtRandom', cardIDs: [4400] }
      ])
      const projection = projectCohorts(state)

      // 降级的代价在这里可以直接量化：3 组精确陈述塌缩成 1 组模糊陈述。
      expect(projection.groupCount).toBe(1)
      expect(projection.groups[0].kind).toBe('partial')
      expect(projection.definitelyOutsidePileIDs).toEqual([])
      expect(state.cohortDegradationCount).toBe(1)
    })
  })
})
