import { describe, expect, it } from 'vitest'
// ?raw 读源码做剔除守卫，避免为一条断言给 tracker tsconfig 引入 node 类型。
import observerSource from '@/tracker/observer/beliefEpochObserver.ts?raw'
import controllerSource from '@/tracker/runtime/trackerController.ts?raw'
import {
  classifyBeliefEvidence,
  createBeliefEpochObserver
} from '@/tracker/observer/beliefEpochObserver'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createPublicCandidate } from '@/tracker/candidate/publicCandidate'
import { createTestRoom } from './helpers/room'
import {
  createTrackerControllerHarness,
  protocolMove,
  returnToPileMove
} from './helpers/trackerController'

/**
 * Phase 1 只读 observer 回归（计划 §7 Phase 1、§8.3 / §8.4）。
 *
 * 重点验证三件事：
 *
 * 1. **只读契约**：observe() 不改动 Room 的任何可观察状态。
 * 2. **失效语义**：§8.3 的两层证据划分在真实 Room 上成立。
 * 3. **可剔除性**：全部实现位于 `import.meta.env.DEV` 之后。
 */

/** vitest 默认 DEV=true，因此这里能拿到实例；生产构建返回 null。 */
function createObserver() {
  const observer = createBeliefEpochObserver()
  if (!observer) throw new Error('测试环境应处于 DEV 模式')
  return observer
}

describe('Phase 1 belief epoch observer', () => {
  describe('只读契约', () => {
    it('observe() 不改动 Room 的可观察状态', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
      const observer = createObserver()

      const pileBefore = room.getPublicZone('pile').cards.map((card) => card.id)
      const dirtyBefore = room.viewDirty
      const eventsBefore = room.dirtyCardEvents.length

      observer.observe(room)
      observer.observe(room)

      expect(room.getPublicZone('pile').cards.map((card) => card.id)).toEqual(pileBefore)
      expect(room.viewDirty).toBe(dirtyBefore)
      expect(room.dirtyCardEvents.length).toBe(eventsBefore)
    })

    it('getEpochs() 返回副本，外部改动不影响账本', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2] })
      const observer = createObserver()

      const card = room.getPublicZone('pile').cards[0]
      card.isKnown = true
      observer.observe(room)

      const epochs = observer.getEpochs()
      expect(epochs.length).toBeGreaterThan(0)
      epochs[0].confirmedAt = 999

      expect(observer.getEpochs()[0].confirmedAt).toBeNull()
    })
  })

  describe('断言与证据', () => {
    it('牌堆正 ID 槽无论是否公开都产生基线 in-pile 断言', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)

      const epochs = observer.getEpochs()
      expect(epochs.map((epoch) => epoch.cardID)).toEqual([1, 2, 3])
      expect(epochs[0].invalidatedAt).toBeNull()
    })

    it('稳定负 ID 匿名槽不产生基线断言', () => {
      const { room } = createTestRoom({
        cardIDs: [1, 2, 3],
        materializeDeckIdentities: false
      })
      const observer = createObserver()

      observer.observe(room)

      expect(observer.getEpochs()).toEqual([])
    })

    it('牌堆来源揭示证实断言，不计入矛盾', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)
      observer.confirmFromPile([first.id])

      expect(observer.getEpochs()[0].confirmedAt).not.toBeNull()
      expect(observer.getMetrics().confirmedContradictionCount).toBe(0)
    })
  })

  describe('§8.3 两层证据划分', () => {
    it('未失效时的矛盾计入 confirmed', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)
      // 没有任何匿名消费介入，此时从手牌现身就是无合法解释的矛盾。
      observer.contradictFromHand([first.id])

      const metrics = observer.getMetrics()
      expect(metrics.confirmedContradictionCount).toBe(1)
      expect(metrics.explainedContradictionCount).toBe(0)
    })

    it('暗摸失效后的矛盾只能计入 explained', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)
      observer.invalidate('anonymous-pile-draw')
      observer.contradictFromHand([first.id])

      const metrics = observer.getMetrics()
      // 暗摸可以合法带走它，因此不能断言模型错了。
      expect(metrics.confirmedContradictionCount).toBe(0)
      expect(metrics.explainedContradictionCount).toBe(1)
    })

    it('失效记录原因，且不被后续失效覆盖', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)
      observer.invalidate('anonymous-pile-draw')
      observer.invalidate('pile-shuffle')

      // 首次失效即定性，后续事件不改写原因。
      expect(observer.getEpochs()[0].invalidationReason).toBe('anonymous-pile-draw')
    })

    it('失效未解决的断言累计风险暴露', () => {
      const { room } = createTestRoom({ cardIDs: [1] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)
      observer.invalidate('anonymous-pile-draw')
      observer.observe(room)
      observer.observe(room)

      const metrics = observer.getMetrics()
      expect(metrics.unresolvedRiskSetSize).toBe(1)
      expect(metrics.riskExposureEventCount).toBeGreaterThan(0)
    })
  })

  describe('指标语义', () => {
    it('确认下界为 0 时风险暴露仍留痕，避免误读为「模型没错」', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
      const observer = createObserver()

      const [first] = room.getPublicZone('pile').cards
      first.isKnown = true
      observer.observe(room)
      observer.invalidate('anonymous-pile-draw')
      observer.observe(room)

      const metrics = observer.getMetrics()
      // 这正是 §8.3 的实测结论在真实 Room 上的复现。
      expect(metrics.confirmedContradictionCount).toBe(0)
      expect(metrics.unresolvedRiskSetSize).toBeGreaterThan(0)
    })

    it('记录真实场上候选按钮数，而不是物理牌堆槽数', () => {
      const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5] })
      const observer = createObserver()

      room
        .getPublicZone('pile')
        .cards.slice(0, 2)
        .forEach((card) => {
          card.confirmKnown()
          room.suspendedKnownCards.add(card)
        })
      observer.observe(room)

      expect(observer.getMetrics().maxDisplayedCandidateCount).toBe(2)
      expect(observer.getMetrics().observedEventCount).toBe(1)
    })
  })
})

describe('协议证据分类', () => {
  it('弃牌洗回牌堆判为 pile-shuffle 失效', () => {
    const actions = classifyBeliefEvidence({ FromZone: 2, ToZone: 9 })

    expect(actions.invalidationReason).toBe('pile-shuffle')
  })

  it('牌堆来源不带 CardID 判为匿名消费', () => {
    // 暗摸：协议只给张数，无法证伪任何具体身份的牌堆断言。
    const actions = classifyBeliefEvidence({ FromZone: 1, ToZone: 5, CardIDs: [] })

    expect(actions.invalidationReason).toBe('anonymous-pile-draw')
    expect(actions.confirmedFromPileIDs).toEqual([])
  })

  it('牌堆来源带 CardID 证实身份在牌堆，不失效', () => {
    // 明摸/搜牌：协议给出 CardID 本身就证明该身份此刻在牌堆。
    const actions = classifyBeliefEvidence({ FromZone: 1, ToZone: 5, CardIDs: [7, 8] })

    expect(actions.invalidationReason).toBeNull()
    expect(actions.confirmedFromPileIDs).toEqual([7, 8])
  })

  it('负 ID 暗槽不构成身份证据', () => {
    const actions = classifyBeliefEvidence({ FromZone: 1, ToZone: 5, CardIDs: [-3, -4] })

    expect(actions.invalidationReason).toBe('anonymous-pile-draw')
    expect(actions.confirmedFromPileIDs).toEqual([])
  })

  it('手牌来源的明牌可证伪牌堆断言', () => {
    const actions = classifyBeliefEvidence({ FromZone: 5, ToZone: 2, CardIDs: [9] })

    expect(actions.contradictedFromHandIDs).toEqual([9])
    expect(actions.invalidationReason).toBeNull()
  })

  it('与牌堆无关的移动不产生任何证据', () => {
    const actions = classifyBeliefEvidence({ FromZone: 6, ToZone: 2, CardIDs: [1] })

    expect(actions).toEqual({
      invalidationReason: null,
      confirmedFromPileIDs: [],
      contradictedFromHandIDs: []
    })
  })
})

describe('接线：syncTrackerMove 采集', () => {
  /** 开局到牌堆就绪，返回可直接同步协议的 controller。 */
  function createReadyController(deckIDs: number[]) {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.initTrackerDeck(deckIDs)
    return controller
  }

  it('开发构建下采集到协议移动', () => {
    const controller = createReadyController([1, 2, 3, 4, 5])

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    const report = controller.getBeliefEpochReport()
    expect(report).not.toBeNull()
    expect(report!.metrics.observedEventCount).toBe(1)
  })

  it('暗摸使在途断言失效并记入风险暴露', () => {
    const controller = createReadyController([1, 2, 3, 4, 5])

    // 揭示牌顶两张，形成 in-pile 断言。
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, [1, 2])
    // 先走一次与牌堆无关的移动，让断言进入 observer 账本。
    controller.syncTrackerMove(protocolMove({ FromZone: 6, ToZone: 2, CardIDs: [], CardCount: 0 }))
    expect(controller.getBeliefEpochReport()!.metrics.unresolvedRiskSetSize).toBe(0)

    // 暗摸：协议不给 CardID，只消费牌堆暗槽，不用牌顶明牌代表未知身份。
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    const report = controller.getBeliefEpochReport()!
    expect(report.metrics.observedEventCount).toBe(3)
    // 1、2 都仍是牌堆明牌，但匿名消费使原断言 epoch 失效，因此都进入未决风险集合。
    expect(report.unresolvedRiskCardIDs).toEqual([1, 2])
  })

  it('报告带读数说明，避免把下界误读为错误率', () => {
    const controller = createReadyController([1, 2, 3])

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    const report = controller.getBeliefEpochReport()!
    expect(report.note).toContain('下界')
    expect(report.metrics.confirmedContradictionCount).toBe(0)
  })

  it('采集不影响记牌器状态：牌堆张数与正常流程一致', () => {
    const controller = createReadyController([1, 2, 3, 4, 5])
    const room = controller.getTrackerRoom()!
    const before = room.getPublicZone('pile').cards.length

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    // 摸走 1 张，牌堆应减少 1；observer 不得额外改动。
    expect(room.getPublicZone('pile').cards.length).toBe(before - 1)
  })

  it('每局独立采集：重新开局后计数归零', () => {
    const controller = createReadyController([1, 2, 3])
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))
    expect(controller.getBeliefEpochReport()!.metrics.observedEventCount).toBe(1)

    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3])

    expect(controller.getBeliefEpochReport()!.metrics.observedEventCount).toBe(0)
  })

  it('对局结束后仍可取到本局报告', () => {
    const controller = createReadyController([1, 2, 3])
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    controller.destroyTrackerRoom()

    // 结算阶段读数是主要使用场景，destroy 不得清空账本。
    expect(controller.getBeliefEpochReport()!.metrics.observedEventCount).toBe(1)
  })
})

describe('生产构建剔除', () => {
  /**
   * observer 实现必须整体位于 `import.meta.env.DEV` 之后。这里断言的是源码形态，
   * 真正的产物验证靠 `pnpm build:prod` + 产物检索（见计划 Phase 1 小节）。
   */
  it('createBeliefEpochObserver 是唯一入口，且由 DEV 收口', () => {
    const source = observerSource

    // 工厂里必须有 DEV 判定；否则实现会被打进生产产物。
    expect(source).toMatch(/if \(!import\.meta\.env\.DEV\) return null/)
    // 实现类不得直接导出，避免绕过工厂。
    expect(source).not.toMatch(/export class ReadOnlyBeliefEpochObserver/)
  })

  it('热路径调用由 DEV 收口，生产构建零开销', () => {
    const source = controllerSource

    expect(source).toMatch(/if \(import\.meta\.env\.DEV\) this\.observeBeliefEpochs\(/)
  })
})

describe('全零结果的判读', () => {
  /**
   * 首次真实对局采集回来全零（722 事件 / 130 张牌堆）。必须能区分：
   * 「整局没做过断言」与「断言都成立」——两者含义完全不同。
   */
  it('牌堆无已知身份时判为 no-belief-made，而非「断言都成立」', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3, 4, 5])

    // 不揭示任何牌堆牌，只走暗摸——这正是真实对局的常态。
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    const report = controller.getBeliefEpochReport()!
    expect(report.metrics.totalEpochCount).toBe(0)
    expect(report.metrics.maxKnownInPileCount).toBe(0)
    expect(report.verdict).toBe('no-belief-made')
    expect(report.note).toContain('无断言可证伪')
  })

  it('有断言但全部失效时判为 all-invalidated', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3, 4, 5])

    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, [1, 2])
    controller.syncTrackerMove(protocolMove({ FromZone: 6, ToZone: 2, CardIDs: [], CardCount: 0 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    const report = controller.getBeliefEpochReport()!
    expect(report.metrics.totalEpochCount).toBeGreaterThan(0)
    expect(report.verdict).toBe('all-invalidated')
  })

  it('存在被证实的断言时判为 has-evidence', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3, 4, 5])

    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, [1, 2])
    // 先走一次无关移动让断言进入账本：证据只能证实**已经持有**的断言。
    controller.syncTrackerMove(protocolMove({ FromZone: 6, ToZone: 2, CardIDs: [], CardCount: 0 }))
    // 明摸：协议给出 CardID，证实该身份此刻在牌堆。
    controller.syncTrackerMove(protocolMove({ CardIDs: [1], CardCount: 1 }))

    const report = controller.getBeliefEpochReport()!
    expect(report.verdict).toBe('has-evidence')
    expect(report.note).toContain('数据可用')
  })
})

describe('风险暴露比值', () => {
  it('按事件数归一，便于跨对局对照', () => {
    const { room } = createTestRoom({ cardIDs: [1] })
    const observer = createObserver()

    const [first] = room.getPublicZone('pile').cards
    first.isKnown = true
    observer.observe(room)
    observer.invalidate('anonymous-pile-draw')
    observer.observe(room)
    observer.observe(room)

    const metrics = observer.getMetrics()
    // 3 个事件里有 2 个事件该断言处于已失效未解决状态。
    expect(metrics.riskExposureEventCount).toBe(2)
    expect(metrics.observedEventCount).toBe(3)
    expect(metrics.riskExposurePerEvent).toBeCloseTo(0.67, 2)
  })

  it('无观测事件时不产生除零', () => {
    const observer = createObserver()

    expect(observer.getMetrics().riskExposurePerEvent).toBe(0)
  })
})

describe('§8.5.4-3 三模型 belief exposure', () => {
  it('同一事件流分别记录基线、世代与批次模型 epoch', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3, 4, 5])

    // 首个无关事件只建立影子断言，不改变牌堆。
    controller.syncTrackerMove(protocolMove({ FromZone: 6, ToZone: 2, CardIDs: [], CardCount: 0 }))

    let report = controller.getBeliefEpochReport()!
    expect(report.modelMetrics.baseline.totalEpochCount).toBe(0)
    expect(report.modelMetrics.generation.totalEpochCount).toBe(5)
    expect(report.modelMetrics.cohort.totalEpochCount).toBe(5)
    expect(report.modelComparison.snapshot.cohort.groups[0]).toMatchObject({
      kind: 'all-in-pile',
      remainingPileCount: 5
    })

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))

    report = controller.getBeliefEpochReport()!
    expect(report.modelComparison.snapshot.generation.definitelyInPileIDs).toEqual([])
    expect(report.modelComparison.snapshot.cohort.groups[0]).toMatchObject({
      kind: 'partial',
      remainingPileCount: 4
    })
    expect(report.modelEpochs).toHaveLength(10)
    expect(
      report.modelEpochs.every((epoch) => epoch.invalidationReason === 'anonymous-pile-draw')
    ).toBe(true)
  })
})

describe('§8.5.4-2 批次基数断言', () => {
  /**
   * publicCandidates 端点断言补充生产基线与影子批次模型，专门记录实际候选 UI 的端点
   * 模糊度；它不依赖 isKnown。
   */

  it('玩家暗牌回牌堆时，其已知手牌成为牌堆端点候选', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.initTrackerDeck([1, 2, 3, 4, 5])

    // 先让 seat1 持有两张已知手牌（明摸）。
    controller.syncTrackerMove(protocolMove({ CardIDs: [1, 2], CardCount: 2, ToID: 1 }))
    // 再从 seat1 暗置一张回牌堆：协议不知道是哪张，于是两张已知手牌都成为牌堆候选。
    controller.syncTrackerMove(returnToPileMove({ CardIDs: [], CardCount: 1, FromID: 1 }))

    const report = controller.getBeliefEpochReport()!
    // 全程没有牌被揭示在牌堆里，in-pile 断言为 0；批次断言却能建立。
    expect(report.metrics.maxKnownInPileCount).toBe(0)
    expect(report.metrics.totalCohortBeliefCount).toBeGreaterThan(0)
    expect(report.metrics.maxCohortCandidateCount).toBeGreaterThan(0)
  })

  it('批次断言与 in-pile 断言共用失效语义', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const observer = createObserver()

    const [first] = room.getPublicZone('pile').cards
    first.addPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 2))
    observer.observe(room)
    observer.invalidate('anonymous-pile-draw')

    const report = observer.getReport()
    expect(report.cohortBeliefs.length).toBeGreaterThan(0)
    report.cohortBeliefs.forEach((belief) => {
      expect(belief.invalidationReason).toBe('anonymous-pile-draw')
    })
  })

  it('同端点的候选身份聚合为一条断言，并记录候选宽度峰值', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const observer = createObserver()

    // 三张牌都可能位于牌堆顶 2 张范围内：这是一条「4 选 2」的集合级断言。
    room
      .getPublicZone('pile')
      .cards.slice(0, 3)
      .forEach((card) => {
        card.addPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 2))
      })
    observer.observe(room)

    const report = observer.getReport()
    expect(report.cohortBeliefs).toHaveLength(1)
    expect(report.cohortBeliefs[0].declaredCount).toBe(2)
    expect(report.cohortBeliefs[0].maxCandidateCardCount).toBe(3)
    expect(report.metrics.maxCohortCandidateCount).toBe(3)
  })

  it('只有批次断言时不再判为 no-belief-made', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })
    const observer = createObserver()

    const [first] = room.getPublicZone('pile').cards
    first.addPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 1))
    observer.observe(room)

    const report = observer.getReport()
    expect(report.metrics.totalEpochCount).toBe(0)
    expect(report.metrics.totalCohortBeliefCount).toBe(1)
    // 有可分析对象，不该再被判成「本局什么都没采到」。
    expect(report.verdict).not.toBe('no-belief-made')
  })

  it('非牌堆端点的公共候选不计入批次断言', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const observer = createObserver()

    const [first] = room.getPublicZone('pile').cards
    first.addPublicCandidate(createPublicCandidate('discard', POSITION_TOP, 1))
    observer.observe(room)

    expect(observer.getReport().cohortBeliefs).toEqual([])
  })
})
