import { isAmbiguousKnownCard } from '../AmbiguousKnownIndex'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { CardID, PublicPosition } from '../types'
import {
  PileIdentityModelComparison,
  type PileIdentityComparisonModel,
  type PileIdentityComparisonReport
} from './pileIdentityModelComparison'

/**
 * Phase 1 只读 belief epoch observer（计划 §7 Phase 1、§8.3 / §8.4）。
 *
 * ## 只读契约
 *
 * 本模块**只读取** `Room` 状态，不写 `Room`、不写视图、不写任何索引。它自己维护一份
 * 独立的 epoch 账本，生命周期与 `Room` 绑定但互不影响。
 *
 * 全部入口都由 `import.meta.env.DEV` 收口（见 `createBeliefEpochObserver`），生产构建
 * 中被摇树移除——这是 Phase 1 前置条件第 4 条。
 *
 * ## 采集什么
 *
 * 记录追踪器对「某身份仍在牌堆」的每一次断言，以及后续协议对它的证实/失效/证伪。
 * 按 §8.3，一旦断言与证据之间隔着一次匿名消费（暗摸等），矛盾就存在合法解释，
 * 只能计入 `explainedContradictionCount`，**不得**计入确认下界。
 *
 * ## 不采集什么
 *
 * 不计算假阴性率。真实回放没有服务器隐藏牌序，`confirmedContradictionCount` 在多数
 * 对局里恒为 0；把它读成「模型没有错」是 §8.3 明确警告的误读。
 */

export type ObserverInvalidationReason =
  /** 暗摸：可以合法带走牌堆里的任意一张。 */
  | 'anonymous-pile-draw'
  /** 洗牌重建牌堆，旧断言的位置依据消失。 */
  | 'pile-shuffle'

export interface ObserverBeliefEpoch {
  cardID: CardID
  startEventSeq: number
  invalidatedAt: number | null
  invalidationReason: ObserverInvalidationReason | null
  confirmedAt: number | null
  contradictedAt: number | null
}

export interface ModelBeliefEpoch extends ObserverBeliefEpoch {
  model: PileIdentityComparisonModel
}

export interface ModelBeliefMetrics {
  confirmedContradictionCount: number
  explainedContradictionCount: number
  unresolvedRiskSetSize: number
  riskExposureEventCount: number
  riskExposurePerEvent: number
  totalEpochCount: number
  maxBelievedInPileCount: number
}

/**
 * 批次基数断言（§8.1 的 `cohort-cardinality`）。
 *
 * 与 `in-pile` 的关键差别：它不指认具体身份，只声明「这 N 个候选身份里有 K 张在牌堆
 * 的某个端点范围内」。生产侧载体是 `Card.publicCandidates` 中 `zone === 'pile'` 的条目
 * ——一张牌位置未定但可能在牌堆时就会带上它，**不依赖观星类技能**。
 *
 * 这正是批次模型要改善的对象：§8.5.4 指出 `in-pile` 断言覆盖不到暗槽，而暗槽的候选
 * 表达才是 Phase 2 的判据所在。
 */
export interface CohortCardinalityBelief {
  /** 端点描述，如 `pile:top:3`。同一 key 视为同一批断言。 */
  key: string
  position: string
  /** 协议声明的端点范围张数；`null` 表示未知。 */
  declaredCount: number | null
  /** 当前持有该候选的身份数量，即候选集合大小。 */
  candidateCardCount: number
  startEventSeq: number
  invalidatedAt: number | null
  invalidationReason: ObserverInvalidationReason | null
  /**
   * 观测到的最大候选集合大小。
   * 与 `declaredCount` 的差值就是这条断言的模糊程度：候选越多、能指认的越少。
   */
  maxCandidateCardCount: number
}

/** §8.2 指标的回放侧子集。命名严格遵守「下界」语义，禁止改称错误率。 */
export interface ObserverMetrics {
  confirmedContradictionCount: number
  explainedContradictionCount: number
  unresolvedRiskSetSize: number
  riskExposureEventCount: number
  observedEventCount: number
  /** 观测期间出现过的最大扁平候选按钮数。 */
  maxDisplayedCandidateCount: number
  /**
   * 整局建立过的 in-pile 断言总数。
   *
   * **这是判读全零结果的关键**：若它为 0，说明追踪器整局就没做过任何牌堆身份断言，
   * 上面的矛盾计数是「无断言可证伪」，而不是「断言都成立」。两者含义完全不同。
   */
  totalEpochCount: number
  /** 观测期间牌堆里同时可见的已知身份峰值。为 0 即牌堆全程无已知身份。 */
  maxKnownInPileCount: number
  /**
   * 平均每个事件处于「已失效但未解决」状态的断言数
   * （`riskExposureEventCount / observedEventCount`，保留两位小数）。
   *
   * 这是当前证据水平下最可用的对照量：`confirmedContradictionCount` 因失效语义恒为 0
   * （§8.3），而本值能反映断言在多大比例的时间里处于无法证伪的悬空状态。
   */
  riskExposurePerEvent: number
  /** 整局建立过的批次基数断言总数（§8.5.4 第 2 项）。 */
  totalCohortBeliefCount: number
  /** 同时存在的批次基数断言峰值。 */
  maxConcurrentCohortBeliefCount: number
  /**
   * 批次候选集合大小的峰值。
   *
   * 这是分组投影要压缩的量：`projectCohorts()` 的收益等于「把这些候选表达成一条
   * 集合级陈述」与「逐卡列出」之间的差。
   */
  maxCohortCandidateCount: number
}

export interface BeliefEpochObserver {
  /** `Room.initDeck()` 完成后建立本局影子身份全集。 */
  initialize(room: Room, cardIDs: readonly CardID[]): void
  /** 每次协议移动后调用；只读快照，不改动 Room。 */
  observe(room: Room): void
  /** 匿名消费牌堆的事件发生时调用，使在途断言失效。 */
  invalidate(reason: ObserverInvalidationReason): void
  /** 协议明确这些身份此刻来自牌堆 → 证实断言。 */
  confirmFromPile(cardIDs: readonly CardID[]): void
  /** 协议明确这些身份此刻来自玩家暗区 → 可证伪牌堆断言。 */
  contradictFromHand(cardIDs: readonly CardID[]): void
  /**
   * 接线入口：按正确顺序处理一次协议移动。
   *
   * 顺序不可交换——协议证据描述的是**事件发生前**的位置事实，因此必须先记证据、
   * 再失效、最后重新快照断言集合。单独暴露这个方法就是为了让接线方无从写错。
   */
  applyProtocolMove(room: Room, event: BeliefEvidenceInput): void
  /** 非移动协议的区域明示入口，例如观星类牌堆观看与手牌快照。 */
  applyReveal(room: Room, event: BeliefRevealInput): void
  getMetrics(): ObserverMetrics
  getEpochs(): ObserverBeliefEpoch[]
  getPileIdentityCohortSnapshot(): PileIdentityComparisonReport['snapshot']['cohort']
  /** 导出可直接粘贴的采集报告（对局验证用）。 */
  getReport(): BeliefEpochReport
}

/** 一次对局的采集报告。字段命名严格遵守 §8.3 的「下界」语义。 */
export interface BeliefEpochReport {
  metrics: ObserverMetrics
  /** 当前基线、全局世代与批次基数模型的只读并排投影。 */
  modelComparison: PileIdentityComparisonReport
  /** 同一事件流上三个模型各自的 belief exposure 与矛盾下界。 */
  modelMetrics: Record<PileIdentityComparisonModel, ModelBeliefMetrics>
  /** generation / cohort 影子模型的 epoch 明细；基线明细继续由 `getEpochs()` 提供。 */
  modelEpochs: ModelBeliefEpoch[]
  /** 已被证伪的断言明细，按事件序号排列。 */
  contradictions: {
    cardID: CardID
    startEventSeq: number
    contradictedAt: number
    /** 无失效原因 = 无合法解释 = 计入 confirmed。 */
    invalidationReason: ObserverInvalidationReason | null
  }[]
  /** 失效后一直没有后续证据的断言，即 §8.2 的未决风险集合。 */
  unresolvedRiskCardIDs: CardID[]
  /**
   * 整局出现过的批次基数断言（§8.5.4 第 2 项）。
   *
   * 每条对应一个牌堆端点。`maxCandidateCardCount` 与 `declaredCount` 的差就是该端点的
   * 模糊程度，也是分组投影要压缩的量。
   */
  cohortBeliefs: CohortCardinalityBelief[]
  /**
   * 本局结果的判读结论。区分三种全零成因，避免把「没采到」当成「没错」。
   *
   * - `no-belief-made`：整局没建立过任何 in-pile 断言，本次采集无信息量。
   * - `all-invalidated`：有断言，但都被匿名消费失效，只剩风险暴露。
   * - `has-evidence`：存在被证实或证伪的断言，数据可用。
   */
  verdict: 'no-belief-made' | 'all-invalidated' | 'has-evidence'
  /** 读数说明，避免把恒为 0 的下界误读成「模型没有错」。 */
  note: string
}

const BASE_NOTE =
  'confirmedContradictionCount 是下界不是错误率：暗摸能合法带走牌堆任意一张，' +
  '因此断言与证据之间隔着匿名消费时无法判定模型错误。该值为 0 不代表模型没有错，' +
  '需结合 explainedContradictionCount 与 unresolvedRiskSetSize 一起看（见计划 §8.3）。'

const REPORT_NOTES: Record<BeliefEpochReport['verdict'], string> = {
  'no-belief-made':
    '本局没有建立过任何断言（totalEpochCount 与 totalCohortBeliefCount 均为 0），' +
    '全部计数为 0 属于「无断言可证伪」，不是「断言都成立」。' +
    'in-pile 断言来自牌堆正 ID 槽（含未公开的身份绑定槽）；批次基数断言来自' +
    'publicCandidates 的牌堆端点。两者都没有即本局无可分析对象。' +
    BASE_NOTE,
  'all-invalidated':
    '本局建立过断言，但没有后续协议给出证实或证伪。批次基数断言本身不指认具体身份，' +
    '无法被单张揭示证实/证伪，因此只带批次断言的对局通常落在这一档：' +
    '可用的是 cohortBeliefs 里的候选宽度与暴露量。' +
    BASE_NOTE,
  'has-evidence': '本局存在被证实或证伪的断言，数据可用于 Phase 2 判据。' + BASE_NOTE
}

/**
 * 当前追踪器断言「确定仍在牌堆」的身份集合。
 *
 * 判据是牌堆区里绑定了正 ID 的卡牌。`id > 0 && isKnown !== true` 的牌堆暗槽虽然
 * 不展示牌面，但当前生产模型仍把具体身份绑定在物理槽上，正是三模型对照要验证的
 * 基线断言；稳定负 ID 的匿名槽才不产生 epoch。
 */
function collectBelievedInPile(room: Room): Set<CardID> {
  const believed = new Set<CardID>()
  const pile = room.getPublicZone('pile')
  if (!pile) return believed

  pile.cards.forEach((card: Card) => {
    if (card.id > 0) believed.add(card.id)
  })
  return believed
}

function collectDisplayedCandidateIDs(room: Room): CardID[] {
  const cardIDs = new Set<CardID>()
  room.ambiguousKnownIndex.items.forEach(({ card }) => {
    if (isAmbiguousKnownCard(card) && card.id > 0) cardIDs.add(card.id)
  })
  room.cards.forEach((card) => {
    const isSupplementalHandCandidate =
      card.location === 'player' && card.subZone === 'hand' && card.isKnown && card.seats.size > 1
    if (isSupplementalHandCandidate && card.id > 0) cardIDs.add(card.id)
  })
  room.suspendedKnownCards.forEach((card) => {
    if (card.id > 0 && card.isKnown) cardIDs.add(card.id)
  })
  return Array.from(cardIDs).sort((left, right) => left - right)
}

/**
 * 采集当前存在的批次基数断言（§8.5.4 第 2 项）。
 *
 * 扫描全部卡牌的 `publicCandidates`，把 `zone === 'pile'` 的条目按端点（位置 + 声明
 * 张数）聚合。同一端点的候选身份构成一个批次：「这些身份里有 declaredCount 张在牌堆
 * 的该端点范围内」。
 *
 * 与 `collectBelievedInPile` 的关键差别是它**不依赖 `isKnown`**，因此不受观星类技能
 * 有无的影响——这正是 §8.5.3 双峰分布问题的解法。
 */
function collectCohortBeliefs(
  room: Room
): Map<string, { position: string; declaredCount: number | null; candidateCardCount: number }> {
  const cohorts = new Map<
    string,
    { position: string; declaredCount: number | null; candidateCardCount: number }
  >()

  room.cards.forEach((card: Card) => {
    card.publicCandidates?.forEach((candidate) => {
      if (candidate.zone !== 'pile') return

      const position = String(candidate.position ?? 'any')
      const declaredCount = candidate.count === null ? null : Number(candidate.count)
      const key = `pile:${position}:${declaredCount ?? 'any'}`
      const existing = cohorts.get(key)

      if (existing) existing.candidateCardCount += 1
      else cohorts.set(key, { position, declaredCount, candidateCardCount: 1 })
    })
  })

  return cohorts
}

class ShadowModelEpochLedger {
  private readonly epochs: ModelBeliefEpoch[] = []
  private readonly openEpochs = new Map<CardID, ModelBeliefEpoch>()
  private previousBelieved = new Set<CardID>()
  private confirmedContradictionCount = 0
  private explainedContradictionCount = 0
  private riskExposureEventCount = 0
  private maxBelievedInPileCount = 0

  constructor(private readonly model: Exclude<PileIdentityComparisonModel, 'baseline'>) {}

  observe(believed: Set<CardID>, eventSeq: number): void {
    this.previousBelieved.forEach((cardID) => {
      if (!believed.has(cardID)) this.openEpochs.delete(cardID)
    })

    believed.forEach((cardID) => {
      if (this.openEpochs.has(cardID)) return
      const epoch: ModelBeliefEpoch = {
        model: this.model,
        cardID,
        startEventSeq: eventSeq,
        invalidatedAt: null,
        invalidationReason: null,
        confirmedAt: null,
        contradictedAt: null
      }
      this.openEpochs.set(cardID, epoch)
      this.epochs.push(epoch)
    })

    this.openEpochs.forEach((epoch) => {
      if (epoch.invalidatedAt !== null && epoch.contradictedAt === null) {
        this.riskExposureEventCount += 1
      }
    })
    this.maxBelievedInPileCount = Math.max(this.maxBelievedInPileCount, believed.size)
    this.previousBelieved = believed
  }

  invalidate(reason: ObserverInvalidationReason, eventSeq: number): void {
    this.openEpochs.forEach((epoch) => {
      if (epoch.invalidatedAt !== null) return
      epoch.invalidatedAt = eventSeq
      epoch.invalidationReason = reason
    })
  }

  confirm(cardIDs: readonly CardID[], eventSeq: number): void {
    cardIDs.forEach((cardID) => {
      const epoch = this.openEpochs.get(cardID)
      if (epoch && epoch.confirmedAt === null) epoch.confirmedAt = eventSeq
    })
  }

  contradict(cardIDs: readonly CardID[], eventSeq: number): void {
    cardIDs.forEach((cardID) => {
      const epoch = this.openEpochs.get(cardID)
      if (!epoch || epoch.contradictedAt !== null) return

      epoch.contradictedAt = eventSeq
      if (epoch.invalidatedAt === null) this.confirmedContradictionCount += 1
      else this.explainedContradictionCount += 1
    })
  }

  getMetrics(observedEventCount: number): ModelBeliefMetrics {
    const unresolvedRiskSetSize = Array.from(this.openEpochs.values()).filter(
      (epoch) => epoch.invalidatedAt !== null && epoch.contradictedAt === null
    ).length

    return {
      confirmedContradictionCount: this.confirmedContradictionCount,
      explainedContradictionCount: this.explainedContradictionCount,
      unresolvedRiskSetSize,
      riskExposureEventCount: this.riskExposureEventCount,
      riskExposurePerEvent:
        observedEventCount === 0
          ? 0
          : Math.round((this.riskExposureEventCount / observedEventCount) * 100) / 100,
      totalEpochCount: this.epochs.length,
      maxBelievedInPileCount: this.maxBelievedInPileCount
    }
  }

  getEpochs(): ModelBeliefEpoch[] {
    return this.epochs.map((epoch) => ({ ...epoch }))
  }
}

class ReadOnlyBeliefEpochObserver implements BeliefEpochObserver {
  private readonly modelComparison = new PileIdentityModelComparison()
  private readonly generationEpochs = new ShadowModelEpochLedger('generation')
  private readonly cohortEpochs = new ShadowModelEpochLedger('cohort')
  private readonly epochs: ObserverBeliefEpoch[] = []
  private readonly openEpochs = new Map<CardID, ObserverBeliefEpoch>()
  private previousBelieved = new Set<CardID>()
  private eventSeq = 0
  private confirmedContradictionCount = 0
  private explainedContradictionCount = 0
  private riskExposureEventCount = 0
  private maxDisplayedCandidateCount = 0
  private maxKnownInPileCount = 0
  private readonly cohortBeliefs: CohortCardinalityBelief[] = []
  private readonly openCohortBeliefs = new Map<string, CohortCardinalityBelief>()
  private maxConcurrentCohortBeliefCount = 0
  private maxCohortCandidateCount = 0

  initialize(room: Room, cardIDs: readonly CardID[]): void {
    this.modelComparison.initialize(cardIDs, collectDisplayedCandidateIDs(room))
    this.modelComparison.observeProjection(
      collectDisplayedCandidateIDs(room),
      room.getPublicZone('discard')?.cards.length ?? 0
    )
  }

  observe(room: Room): void {
    this.eventSeq += 1

    const believed = collectBelievedInPile(room)
    const displayedCandidateIDs = collectDisplayedCandidateIDs(room)

    // 断言消失：该身份不再被认为在牌堆，epoch 自然结束。
    this.previousBelieved.forEach((cardID) => {
      if (!believed.has(cardID)) this.openEpochs.delete(cardID)
    })

    believed.forEach((cardID) => {
      if (this.openEpochs.has(cardID)) return
      const epoch: ObserverBeliefEpoch = {
        cardID,
        startEventSeq: this.eventSeq,
        invalidatedAt: null,
        invalidationReason: null,
        confirmedAt: null,
        contradictedAt: null
      }
      this.openEpochs.set(cardID, epoch)
      this.epochs.push(epoch)
    })

    // 风险暴露：已失效但仍未被后续协议解决的断言，每经过一个事件累计一次。
    this.openEpochs.forEach((epoch) => {
      if (epoch.invalidatedAt !== null && epoch.contradictedAt === null) {
        this.riskExposureEventCount += 1
      }
    })

    this.maxDisplayedCandidateCount = Math.max(
      this.maxDisplayedCandidateCount,
      displayedCandidateIDs.length
    )
    this.maxKnownInPileCount = Math.max(this.maxKnownInPileCount, believed.size)
    this.observeCohortBeliefs(room)
    this.modelComparison.observeProjection(
      displayedCandidateIDs,
      room.getPublicZone('discard')?.cards.length ?? 0
    )
    this.generationEpochs.observe(
      this.modelComparison.getGenerationDefinitelyInPileIDs(),
      this.eventSeq
    )
    this.cohortEpochs.observe(this.modelComparison.getCohortDefinitelyInPileIDs(), this.eventSeq)
    this.previousBelieved = believed
  }

  /** 批次基数断言的建立/更新/关闭。与 in-pile 断言共用同一套失效语义。 */
  private observeCohortBeliefs(room: Room): void {
    const current = collectCohortBeliefs(room)

    // 端点消失 → 该批断言结束。
    Array.from(this.openCohortBeliefs.keys()).forEach((key) => {
      if (!current.has(key)) this.openCohortBeliefs.delete(key)
    })

    current.forEach((snapshot, key) => {
      const existing = this.openCohortBeliefs.get(key)
      if (existing) {
        // 同一端点的候选集合会随协议收紧或放宽，取峰值反映最模糊时的状态。
        existing.candidateCardCount = snapshot.candidateCardCount
        existing.maxCandidateCardCount = Math.max(
          existing.maxCandidateCardCount,
          snapshot.candidateCardCount
        )
        return
      }

      const belief: CohortCardinalityBelief = {
        key,
        position: snapshot.position,
        declaredCount: snapshot.declaredCount,
        candidateCardCount: snapshot.candidateCardCount,
        startEventSeq: this.eventSeq,
        invalidatedAt: null,
        invalidationReason: null,
        maxCandidateCardCount: snapshot.candidateCardCount
      }
      this.openCohortBeliefs.set(key, belief)
      this.cohortBeliefs.push(belief)
    })

    this.maxConcurrentCohortBeliefCount = Math.max(
      this.maxConcurrentCohortBeliefCount,
      this.openCohortBeliefs.size
    )
    current.forEach((snapshot) => {
      this.maxCohortCandidateCount = Math.max(
        this.maxCohortCandidateCount,
        snapshot.candidateCardCount
      )
    })
  }

  invalidate(reason: ObserverInvalidationReason): void {
    this.openEpochs.forEach((epoch) => {
      if (epoch.invalidatedAt !== null) return
      epoch.invalidatedAt = this.eventSeq
      epoch.invalidationReason = reason
    })
    // 批次基数断言共用同一套失效语义：匿名消费同样让「有 K 张在该端点」失去可证伪性。
    this.openCohortBeliefs.forEach((belief) => {
      if (belief.invalidatedAt !== null) return
      belief.invalidatedAt = this.eventSeq
      belief.invalidationReason = reason
    })
    this.generationEpochs.invalidate(reason, this.eventSeq)
    this.cohortEpochs.invalidate(reason, this.eventSeq)
  }

  confirmFromPile(cardIDs: readonly CardID[]): void {
    cardIDs.forEach((cardID) => {
      const epoch = this.openEpochs.get(cardID)
      if (epoch && epoch.confirmedAt === null) epoch.confirmedAt = this.eventSeq
    })
    this.generationEpochs.confirm(cardIDs, this.eventSeq)
    this.cohortEpochs.confirm(cardIDs, this.eventSeq)
  }

  contradictFromHand(cardIDs: readonly CardID[]): void {
    cardIDs.forEach((cardID) => {
      const epoch = this.openEpochs.get(cardID)
      if (!epoch || epoch.contradictedAt !== null) return

      epoch.contradictedAt = this.eventSeq
      // §8.3：失效之后的矛盾存在合法解释，只能记为 explained。
      if (epoch.invalidatedAt === null) this.confirmedContradictionCount += 1
      else this.explainedContradictionCount += 1
    })
    this.generationEpochs.contradict(cardIDs, this.eventSeq)
    this.cohortEpochs.contradict(cardIDs, this.eventSeq)
  }

  getMetrics(): ObserverMetrics {
    const unresolvedRiskSetSize = Array.from(this.openEpochs.values()).filter(
      (epoch) => epoch.invalidatedAt !== null && epoch.contradictedAt === null
    ).length

    return {
      confirmedContradictionCount: this.confirmedContradictionCount,
      explainedContradictionCount: this.explainedContradictionCount,
      unresolvedRiskSetSize,
      riskExposureEventCount: this.riskExposureEventCount,
      observedEventCount: this.eventSeq,
      maxDisplayedCandidateCount: this.maxDisplayedCandidateCount,
      totalEpochCount: this.epochs.length,
      maxKnownInPileCount: this.maxKnownInPileCount,
      riskExposurePerEvent:
        this.eventSeq === 0
          ? 0
          : Math.round((this.riskExposureEventCount / this.eventSeq) * 100) / 100,
      totalCohortBeliefCount: this.cohortBeliefs.length,
      maxConcurrentCohortBeliefCount: this.maxConcurrentCohortBeliefCount,
      maxCohortCandidateCount: this.maxCohortCandidateCount
    }
  }

  getEpochs(): ObserverBeliefEpoch[] {
    return this.epochs.map((epoch) => ({ ...epoch }))
  }

  applyProtocolMove(room: Room, event: BeliefEvidenceInput): void {
    const actions = classifyBeliefEvidence(event)

    // 1. 先记证据：协议描述的是事件发生**前**的位置事实。
    this.confirmFromPile(actions.confirmedFromPileIDs)
    this.contradictFromHand(actions.contradictedFromHandIDs)

    // 2. 再失效：此后在途断言不再可证伪。
    if (actions.invalidationReason) this.invalidate(actions.invalidationReason)

    // 3. 更新两个只读影子模型。所有输入都来自已完成的协议事件与 Room 只读快照。
    this.modelComparison.applyMove(
      {
        eventType: event.EventType ?? '',
        fromZone: event.FromZone == null ? null : Number(event.FromZone),
        toZone: event.ToZone == null ? null : Number(event.ToZone),
        cardIDs: [...(event.CardIDs ?? [])],
        cardCount: Number(event.CardCount) || (event.CardIDs ?? []).length,
        fromPosition: event.FromPosition,
        toPosition: event.ToPosition,
        moveType: event.MoveType,
        spellID: event.SpellID,
        pileCountAfter: room.getPublicZone('pile')?.cards.length ?? 0
      },
      collectDisplayedCandidateIDs(room),
      room.getPublicZone('discard')?.cards.length ?? 0
    )

    // 4. 最后重新快照断言集合。
    this.observe(room)
  }

  applyReveal(room: Room, event: BeliefRevealInput): void {
    const cardIDs = event.CardIDs.filter((cardID) => cardID > 0)
    if (event.Location === 'pile') this.confirmFromPile(cardIDs)
    else this.contradictFromHand(cardIDs)

    this.modelComparison.applyReveal(
      {
        cardIDs,
        location: event.Location,
        pileCountAfter: room.getPublicZone('pile')?.cards.length ?? 0
      },
      collectDisplayedCandidateIDs(room),
      room.getPublicZone('discard')?.cards.length ?? 0
    )
    this.observe(room)
  }

  getPileIdentityCohortSnapshot(): PileIdentityComparisonReport['snapshot']['cohort'] {
    return this.modelComparison.getCohortSnapshot()
  }

  getReport(): BeliefEpochReport {
    const contradictions = this.epochs
      .filter((epoch) => epoch.contradictedAt !== null)
      .map((epoch) => ({
        cardID: epoch.cardID,
        startEventSeq: epoch.startEventSeq,
        contradictedAt: epoch.contradictedAt as number,
        invalidationReason: epoch.invalidationReason
      }))
      .sort((left, right) => left.contradictedAt - right.contradictedAt)

    const unresolvedRiskCardIDs = Array.from(this.openEpochs.values())
      .filter((epoch) => epoch.invalidatedAt !== null && epoch.contradictedAt === null)
      .map((epoch) => epoch.cardID)
      .sort((left, right) => left - right)

    const metrics = this.getMetrics()
    const modelMetrics: Record<PileIdentityComparisonModel, ModelBeliefMetrics> = {
      baseline: {
        confirmedContradictionCount: metrics.confirmedContradictionCount,
        explainedContradictionCount: metrics.explainedContradictionCount,
        unresolvedRiskSetSize: metrics.unresolvedRiskSetSize,
        riskExposureEventCount: metrics.riskExposureEventCount,
        riskExposurePerEvent: metrics.riskExposurePerEvent,
        totalEpochCount: metrics.totalEpochCount,
        maxBelievedInPileCount: metrics.maxKnownInPileCount
      },
      generation: this.generationEpochs.getMetrics(this.eventSeq),
      cohort: this.cohortEpochs.getMetrics(this.eventSeq)
    }
    const modelEpochs = [...this.generationEpochs.getEpochs(), ...this.cohortEpochs.getEpochs()]
    const hasEvidence =
      contradictions.length > 0 ||
      this.epochs.some((epoch) => epoch.confirmedAt !== null) ||
      modelEpochs.some((epoch) => epoch.confirmedAt !== null || epoch.contradictedAt !== null)
    // 批次基数断言不指认具体身份，因此单张揭示无法证实或证伪它；它只能提供暴露量。
    // 但它的存在足以说明「本局有断言可分析」，不应再判为 no-belief-made。
    const hasAnyBelief =
      metrics.totalEpochCount > 0 || metrics.totalCohortBeliefCount > 0 || modelEpochs.length > 0
    const verdict: BeliefEpochReport['verdict'] = !hasAnyBelief
      ? 'no-belief-made'
      : hasEvidence
        ? 'has-evidence'
        : 'all-invalidated'

    return {
      metrics,
      modelComparison: this.modelComparison.getReport(),
      modelMetrics,
      modelEpochs,
      contradictions,
      unresolvedRiskCardIDs,
      cohortBeliefs: this.cohortBeliefs.map((belief) => ({ ...belief })),
      verdict,
      note: REPORT_NOTES[verdict]
    }
  }
}

/**
 * 把一次归一化移动事件翻译成 observer 应采取的动作。
 *
 * 这是协议与 §8.3 证据语义之间唯一的映射点，独立导出以便回归。接线方按返回值调用
 * `invalidate` / `confirmFromPile` / `contradictFromHand`，然后调用 `observe`。
 */
export interface BeliefEvidenceActions {
  invalidationReason: ObserverInvalidationReason | null
  /** 协议证明此刻来自牌堆的身份。 */
  confirmedFromPileIDs: CardID[]
  /** 协议证明此刻来自玩家暗区的身份。 */
  contradictedFromHandIDs: CardID[]
}

/** 协议区号：1=牌堆，2=弃牌堆，5=手牌，9=洗牌区。 */
const PROTOCOL_ZONE_PILE = 1
const PROTOCOL_ZONE_DISCARD = 2
const PROTOCOL_ZONE_HAND = 5
const PROTOCOL_ZONE_SHUFFLE = 9

/** 分类器只依赖协议原始字段的一个最小子集，便于接线方与测试直接构造。 */
export interface BeliefEvidenceInput {
  FromZone?: number | string
  ToZone?: number | string
  CardIDs?: readonly CardID[]
  CardCount?: number | string
  FromPosition?: PublicPosition
  ToPosition?: PublicPosition
  MoveType?: number | string
  SpellID?: number | string | null
  /** `NormalizedMoveEvent.type`，用于区分展示、洗牌与真实移动。 */
  EventType?: string
}

export interface BeliefRevealInput {
  CardIDs: readonly CardID[]
  Location: 'pile' | 'outside'
}

export function classifyBeliefEvidence(event: BeliefEvidenceInput): BeliefEvidenceActions {
  const fromZone = Number(event.FromZone)
  const toZone = Number(event.ToZone)
  const knownIDs = (event.CardIDs ?? []).filter((cardID) => cardID > 0)

  // 弃牌洗回：牌堆整体重建，旧断言的位置依据消失。
  if (fromZone === PROTOCOL_ZONE_DISCARD && toZone === PROTOCOL_ZONE_SHUFFLE) {
    return {
      invalidationReason: 'pile-shuffle',
      confirmedFromPileIDs: [],
      contradictedFromHandIDs: []
    }
  }

  if (fromZone === PROTOCOL_ZONE_PILE) {
    // 协议给出 CardID → 证实这些身份此刻在牌堆。
    // 没给 CardID → 匿名消费，在途断言失去可证伪性（§8.3）。
    return {
      invalidationReason: knownIDs.length > 0 ? null : 'anonymous-pile-draw',
      confirmedFromPileIDs: knownIDs,
      contradictedFromHandIDs: []
    }
  }

  // 手牌来源且牌面可见 → 证明该身份此刻在玩家区，可证伪牌堆断言。
  if (fromZone === PROTOCOL_ZONE_HAND && knownIDs.length > 0) {
    return {
      invalidationReason: null,
      confirmedFromPileIDs: [],
      contradictedFromHandIDs: knownIDs
    }
  }

  return { invalidationReason: null, confirmedFromPileIDs: [], contradictedFromHandIDs: [] }
}

/**
 * 创建只读 observer。生产构建返回 `null`，调用方必须处理这一分支。
 *
 * 这样 observer 的全部实现都在 `import.meta.env.DEV` 之后，不会进入发布产物。
 */
export function createBeliefEpochObserver(): BeliefEpochObserver | null {
  if (!import.meta.env.DEV) return null
  return new ReadOnlyBeliefEpochObserver()
}
