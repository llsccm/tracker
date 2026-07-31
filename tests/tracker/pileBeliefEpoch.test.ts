import { describe, expect, it } from 'vitest'
import type { PileGenerationEvent } from './helpers/pileGenerationPoolModel'
import {
  evaluateAgainstOracle,
  getBaselineBelievedInPile,
  runBaselineLedgerModel,
  runOracle,
  sortIDs
} from './helpers/pileGenerationPoolModel'
import { collectAllModelBeliefEpochs, collectBeliefEpochs } from './helpers/pileBeliefEpoch'

/**
 * §10 第 5 项：belief epoch 与只读采集 schema 的纯模型验证。
 *
 * 这里回答的核心问题不是「模型对不对」，而是「**回放侧能看到多少**」：
 * 纯模型夹具有 oracle，可以知道完整假阴性；真实回放没有，只能记录后续协议证实的下界。
 * 两者的差值决定了 Phase 1 采集是否值得做。
 */

describe('§10-5 belief epoch 与只读采集 schema', () => {
  describe('schema 完整性', () => {
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawUnknown', count: 2 },
      { type: 'revealFromHand', cardIDs: [1] }
    ]

    it('每条 epoch 都带齐 §8.1 要求的字段', () => {
      const { epochs } = collectBeliefEpochs(events, 'baseline')

      expect(epochs.length).toBeGreaterThan(0)
      epochs.forEach((epoch) => {
        expect(Object.keys(epoch).sort()).toEqual([
          'beliefType',
          'cardID',
          'cohortGeneration',
          'confirmedAt',
          'contradictedAt',
          'invalidatedAt',
          'invalidationReason',
          'model',
          'sourceEvidence',
          'startEventSeq'
        ])
      })
    })

    it('metrics 覆盖 §8.2 全部指标名', () => {
      const { metrics } = collectBeliefEpochs(events, 'cohort')

      expect(Object.keys(metrics).sort()).toEqual([
        'batchBoundaryDegradationCount',
        'cohortCandidateWidth',
        'cohortCardinalitySummaries',
        'cohortCount',
        'confirmedContradictionCount',
        'confirmedProjectionOmissionCount',
        'explainedContradictionCount',
        'maxDisplayedCandidateCount',
        'riskExposureEventCount',
        'unresolvedRiskSetSize'
      ])
    })

    it('开局建堆的 epoch 记为 initial-deck 证据', () => {
      const { epochs } = collectBeliefEpochs(events, 'baseline')
      const initial = epochs.filter((epoch) => epoch.startEventSeq === 0)

      expect(initial.length).toBe(5)
      initial.forEach((epoch) => {
        expect(epoch.sourceEvidence).toBe('initial-deck')
        expect(epoch.beliefType).toBe('in-pile')
      })
    })
  })

  describe('失效语义：暗摸让断言失去可证伪性', () => {
    it('暗摸使全部在途断言失效并记录原因', () => {
      const { epochs } = collectBeliefEpochs(
        [
          { type: 'initialize', cardIDs: [1, 2, 3] },
          { type: 'drawUnknown', count: 1 }
        ],
        'baseline'
      )

      epochs.forEach((epoch) => {
        expect(epoch.invalidatedAt).toBe(1)
        expect(epoch.invalidationReason).toBe('anonymous-pile-draw')
      })
    })

    it('暗摸后的矛盾只能记为 explained，不得计入 confirmed', () => {
      // 1 在暗摸后才被证明位于暗区：它完全可能就是那次暗摸带走的，模型未必错。
      const { metrics } = collectBeliefEpochs(
        [
          { type: 'initialize', cardIDs: [1, 2, 3] },
          { type: 'drawUnknown', count: 1 },
          { type: 'revealFromHand', cardIDs: [1] }
        ],
        'baseline'
      )

      expect(metrics.confirmedContradictionCount).toBe(0)
      expect(metrics.explainedContradictionCount).toBe(1)
    })

    it('牌堆来源揭示证实断言，不产生矛盾', () => {
      const { epochs, metrics } = collectBeliefEpochs(
        [
          { type: 'initialize', cardIDs: [1, 2, 3] },
          { type: 'revealFromPile', cardIDs: [3] }
        ],
        'baseline'
      )

      expect(epochs.find((epoch) => epoch.cardID === 3)?.confirmedAt).toBe(1)
      expect(metrics.confirmedContradictionCount).toBe(0)
      expect(metrics.explainedContradictionCount).toBe(0)
    })

    it('批次降级记入 batchBoundaryDegradationCount', () => {
      const { metrics } = collectBeliefEpochs(
        [
          { type: 'initialize', cardIDs: [1, 2, 3] },
          { type: 'insertExternalAtRandom', cardIDs: [4400] }
        ],
        'cohort'
      )

      expect(metrics.batchBoundaryDegradationCount).toBe(1)
    })
  })

  describe('§20.5 双向采集', () => {
    /** §6.2 的可达两周期夹具。 */
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { type: 'drawUnknown', count: 2 },
      { type: 'revealFromPile', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'discardKnown', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawAcrossShuffle', count: 4 },
      { type: 'revealFromHand', cardIDs: [6, 7] },
      { type: 'discardKnown', cardIDs: [6, 7] },
      { type: 'shuffle' }
    ]

    it('三个模型并排采集，不只测基线', () => {
      const collections = collectAllModelBeliefEpochs(events)

      expect(Object.keys(collections).sort()).toEqual(['baseline', 'cohort', 'generation'])
      Object.values(collections).forEach((collection) => {
        expect(collection.epochs.length).toBeGreaterThan(0)
      })
    })

    it('世代模型同样产生矛盾记录，验证 §20.3 的同源假阴性', () => {
      // §20.3：世代模型只对**上一世代**停止断言；对当前世代的洗回批次，它同样断言
      // 「这批身份仍在牌堆」。因此必须构造「洗回批次被暗摸消费后又从手牌现身」的序列，
      // 否则采集会偏向基线，违反 §20.5。
      const currentGenerationEvents: PileGenerationEvent[] = [
        { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
        { type: 'revealFromPile', cardIDs: [1, 2] },
        { type: 'discardKnown', cardIDs: [1, 2] },
        // 洗回后活动卡池 = {1,2}，旧卡池 {3,4,5} 过期为 suspended。
        // 洗回批次在牌底侧，因此必须摸穿牌顶批次 {3,4,5}（3 张）才能触及它。
        { type: 'shuffle' },
        { type: 'drawUnknown', count: 4 },
        // 1 属于当前世代卡池，世代模型此前断言它在牌堆。
        { type: 'revealFromHand', cardIDs: [1] }
      ]

      const collections = collectAllModelBeliefEpochs(currentGenerationEvents)
      const generationTotal =
        collections.generation.metrics.confirmedContradictionCount +
        collections.generation.metrics.explainedContradictionCount

      expect(generationTotal).toBeGreaterThan(0)
    })

    it('世代模型对已过期的旧世代不再断言，因此不产生矛盾', () => {
      // 同一夹具的对照面：6、7 在 drawAcrossShuffle 时已过期为 suspended，
      // 之后从手牌现身不构成矛盾。这正是世代模型相对基线的收益所在。
      const collections = collectAllModelBeliefEpochs(events)

      expect(collections.generation.metrics.confirmedContradictionCount).toBe(0)
      expect(collections.generation.metrics.explainedContradictionCount).toBe(0)
      // 基线没有这个机制，同一序列下留下了风险暴露。
      expect(collections.baseline.metrics.riskExposureEventCount).toBeGreaterThan(0)
    })

    it('批次模型的集合级断言不被单张揭示证伪', () => {
      const collections = collectAllModelBeliefEpochs(events)

      // 批次模型只对「整组都在牌堆」做具体身份断言（definitelyInPile），
      // partial 组不指认具体身份，因此矛盾数应不高于基线。
      expect(collections.cohort.metrics.confirmedContradictionCount).toBeLessThanOrEqual(
        collections.baseline.metrics.confirmedContradictionCount
      )
    })
  })

  describe('回放可见性下界：与 oracle 的差值', () => {
    /**
     * 这是本模块存在的理由。同一序列下：
     *
     * - oracle 知道**完整**假阴性（需要服务器隐藏牌序）。
     * - epoch 采集只知道**后续协议证实**的部分。
     *
     * 差值就是「回放看不见的部分」。它必须被诚实记录，否则 Phase 1 会把一个恒为 0 的
     * 下界误读成「模型没有错」。
     */
    const events: PileGenerationEvent[] = [
      { type: 'initialize', cardIDs: [1, 2, 3, 4, 5] },
      { type: 'drawUnknown', count: 2 },
      { type: 'revealFromHand', cardIDs: [1] }
    ]

    it('oracle 能证明的假阴性严格多于回放能确认的矛盾', () => {
      // 真实牌序：牌顶两张是 1、2，因此暗摸带走的正是 1 和 2。
      const oracle = runOracle(events, { deckOrder: [5, 4, 3, 2, 1] })
      const baseline = runBaselineLedgerModel(events).state
      const verdict = evaluateAgainstOracle(
        getBaselineBelievedInPile(baseline),
        getBaselineBelievedInPile(baseline),
        oracle
      )

      const { metrics } = collectBeliefEpochs(events, 'baseline')

      // oracle 看得见：暗摸真实带走了 1 和 2。1 已由 revealFromHand 定位，
      // 因此基线此刻仍错误相信在牌堆的是 2。
      expect(sortIDs(verdict.falseNegativeIDs)).toContain(2)
      // 回放看不见：暗摸提供了合法解释，严格确认数为 0。
      expect(metrics.confirmedContradictionCount).toBe(0)
      expect(verdict.falseNegativeIDs.length).toBeGreaterThan(metrics.confirmedContradictionCount)
    })

    it('风险暴露量非零，避免下界恒为 0 时误读为「模型没错」', () => {
      const { metrics } = collectBeliefEpochs(events, 'baseline')

      // 严格确认为 0，但风险暴露必须留痕，这是 §8.2 设计 unresolvedRiskSet 的原因。
      expect(metrics.confirmedContradictionCount).toBe(0)
      expect(metrics.explainedContradictionCount).toBeGreaterThan(0)
      expect(metrics.unresolvedRiskSetSize).toBeGreaterThan(0)
      expect(metrics.riskExposureEventCount).toBeGreaterThan(0)
    })
  })
})
