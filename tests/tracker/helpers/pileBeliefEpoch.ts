import type { CardID } from '@/tracker/types'
import type { CohortPoolModelState, PileGenerationEvent } from './pileGenerationPoolModel'
import {
  getBaselineBelievedInPile,
  getCohortDefinitelyInPileIDs,
  runBaselineLedgerModel,
  runCohortPoolModel,
  runGenerationPoolModel,
  sortIDs
} from './pileGenerationPoolModel'

/**
 * Phase 1 观测契约的 belief epoch 与只读采集 schema（计划 §8.1 / §8.2、§10 第 5 项）。
 *
 * 真实回放没有服务器隐藏牌序，因此**不能**直接计算假阴性率。这里定义的是回放侧唯一
 * 可采集的东西：模型对「某身份仍在牌堆」的每一次断言，以及后续协议对该断言的证实、
 * 失效或证伪。
 *
 * ## 为什么需要 epoch
 *
 * `revealFromHand X` 证明 X 此刻在玩家暗区。但 X 必然是某次**暗摸**进去的，而暗摸正是
 * §8.1 所说的「可能合法改变暗区归属的事件」——它可以合法地带走牌堆里的任意一张。
 * 因此一旦断言与证据之间隔着暗摸，就无法证明模型当时错了：模型只是不知道被带走的
 * 是哪张，而这本来就是协议不提供的信息。
 *
 * 直接后果是：**严格确认矛盾在多数序列里恒为 0**。这不是采集失败，而是「下界」一词的
 * 真实含义。为了让采集仍有信息量，本模块把证据分成两层：
 *
 * - `confirmedContradiction`：epoch 仍有效时被证伪 —— 模型确实错了，无合法解释。
 * - `explainedContradiction`：epoch 已失效后被证伪 —— 模型可能错了，但存在合法解释。
 *
 * 只有前者可以写进 §8.2 的 `confirmedContradictionCount`。后者是风险暴露量，
 * 禁止改名为错误率（§8.2 末句）。
 *
 * ## 与 oracle 的关系
 *
 * 纯模型夹具可以用 `runOracle()` 拿到真实牌序，从而知道**完整**假阴性。回放采集拿不到。
 * 两者的差值正是「回放能看到多少」的度量，见 `tests/tracker/pileBeliefEpoch.test.ts`。
 */

export type BeliefModelName = 'baseline' | 'generation' | 'cohort'

/**
 * 断言类型。
 *
 * - `in-pile`：对**具体身份**断言「它仍在牌堆」，可被 `revealFromHand` 证伪。
 * - `cohort-cardinality`：对**集合**断言「其中 K 张仍在牌堆」，不指认具体身份，
 *   因此单张揭示无法证伪它，只有集合级矛盾才能。
 */
export type BeliefType = 'in-pile' | 'cohort-cardinality'

export type BeliefSourceEvidence =
  /** 开局建堆，协议直接给出牌堆张数。 */
  | 'initial-deck'
  /** 弃牌洗回牌堆，协议明确了这批身份进入牌堆。 */
  | 'recycled-to-pile'
  /** 外部牌以明确端点进入牌堆。 */
  | 'inserted-to-pile'
  /** 没有正面证据，只是从未观测到它离开牌堆。 */
  | 'residual-never-observed'

export type BeliefInvalidationReason =
  /** 暗摸：可以合法带走牌堆里的任意一张。 */
  | 'anonymous-pile-draw'
  /** 超量摸牌触发洗牌，同样是匿名消费。 */
  | 'draw-across-shuffle'
  /** 牌顶范围取牌且协议不给 CardID。 */
  | 'anonymous-top-range-gain'
  /** 批次边界降级，分组结论不再可推导。 */
  | 'cohort-degradation'

/** §8.1 的 epoch 记录。一条记录 = 模型的一次牌堆归属断言及其结局。 */
export interface BeliefEpoch {
  model: BeliefModelName
  /** `in-pile` 断言的身份；`cohort-cardinality` 时为空。 */
  cardID: CardID | null
  /** `cohort-cardinality` 断言的批次世代号；`in-pile` 时为空。 */
  cohortGeneration: number | null
  startEventSeq: number
  beliefType: BeliefType
  sourceEvidence: BeliefSourceEvidence
  invalidatedAt: number | null
  invalidationReason: BeliefInvalidationReason | null
  /** 后续协议证明该身份**确实**来自牌堆的事件序号。 */
  confirmedAt: number | null
  /** 后续协议证明该身份来自非牌堆来源的事件序号。 */
  contradictedAt: number | null
}

/** §8.2 指标。命名严格遵守「下界」语义，禁止改称错误率。 */
export interface BeliefEpochMetrics {
  confirmedContradictionCount: number
  confirmedProjectionOmissionCount: number
  unresolvedRiskSetSize: number
  riskExposureEventCount: number
  cohortCount: number
  cohortCandidateWidth: number
  cohortCardinalitySummaries: { generation: number; candidateCount: number; inPileCount: number }[]
  batchBoundaryDegradationCount: number
  maxDisplayedCandidateCount: number
  /**
   * 已失效 epoch 上出现的矛盾数。存在合法解释，**不得**计入
   * `confirmedContradictionCount`，只作为风险暴露量。
   */
  explainedContradictionCount: number
}

export interface BeliefEpochCollection {
  epochs: BeliefEpoch[]
  metrics: BeliefEpochMetrics
}

/** 会匿名消费牌堆的事件 → 它们让所有在途的牌堆断言失去可证伪性。 */
const INVALIDATION_REASONS: Partial<Record<PileGenerationEvent['type'], BeliefInvalidationReason>> =
  {
    drawUnknown: 'anonymous-pile-draw',
    drawAcrossShuffle: 'draw-across-shuffle',
    gainUnknownFromPileTopRange: 'anonymous-top-range-gain'
  }

/** 协议明确「该身份此刻在牌堆」的事件 → 证实断言。 */
function getPileSourcedIDs(event: PileGenerationEvent): CardID[] {
  if (event.type === 'revealFromPile' || event.type === 'gainFromPile') return event.cardIDs
  return []
}

/** 协议明确「该身份此刻在玩家暗区」的事件 → 可证伪牌堆断言。 */
function getHandSourcedIDs(event: PileGenerationEvent): CardID[] {
  return event.type === 'revealFromHand' ? event.cardIDs : []
}

function inferSourceEvidence(event: PileGenerationEvent | null): BeliefSourceEvidence {
  if (!event) return 'residual-never-observed'
  if (event.type === 'initialize') return 'initial-deck'
  if (event.type === 'shuffle' || event.type === 'drawAcrossShuffle') return 'recycled-to-pile'
  if (event.type === 'insertExternalAtRandom') return 'inserted-to-pile'
  return 'residual-never-observed'
}

function getBelievedInPile(model: BeliefModelName, events: PileGenerationEvent[]): Set<CardID> {
  if (model === 'baseline') return getBaselineBelievedInPile(runBaselineLedgerModel(events).state)
  if (model === 'cohort') return getCohortDefinitelyInPileIDs(runCohortPoolModel(events))

  // 世代模型断言「当前世代卡池仍在牌堆」——§20.3 证明这与基线同源，
  // 因此必须双向采集，不能只测基线（§20.5）。
  return new Set(runGenerationPoolModel(events).state.activeIdentityIDs)
}

function summarizeCohorts(
  state: CohortPoolModelState
): BeliefEpochMetrics['cohortCardinalitySummaries'] {
  return state.cohorts.map((cohort) => ({
    generation: cohort.generation,
    candidateCount: cohort.candidateIdentityIDs.size,
    inPileCount: cohort.remainingPileCount
  }))
}

/**
 * 按事件流采集一个模型的 belief epoch 账本。
 *
 * 只读：不改动任何模型状态，只在每个事件后重放前缀并比对断言集合。
 */
export function collectBeliefEpochs(
  events: PileGenerationEvent[],
  model: BeliefModelName
): BeliefEpochCollection {
  const epochs: BeliefEpoch[] = []
  /** 身份 → 当前尚未结束的 epoch。 */
  const openEpochs = new Map<CardID, BeliefEpoch>()
  let previousBelieved = new Set<CardID>()
  let explainedContradictionCount = 0
  let confirmedContradictionCount = 0
  let riskExposureEventCount = 0

  events.forEach((event, eventSeq) => {
    // 1. 先按事件语义处理证实/证伪，再更新断言集合：
    //    协议证据描述的是**事件发生前**的位置事实。
    getPileSourcedIDs(event).forEach((cardID) => {
      const epoch = openEpochs.get(cardID)
      if (epoch && epoch.confirmedAt === null) epoch.confirmedAt = eventSeq
    })

    getHandSourcedIDs(event).forEach((cardID) => {
      const epoch = openEpochs.get(cardID)
      if (!epoch) return

      epoch.contradictedAt = eventSeq
      if (epoch.invalidatedAt === null) confirmedContradictionCount += 1
      else explainedContradictionCount += 1
    })

    // 2. 失效：匿名消费之后，在途断言不再可证伪。
    const reason = INVALIDATION_REASONS[event.type]
    if (reason) {
      openEpochs.forEach((epoch) => {
        if (epoch.invalidatedAt !== null) return
        epoch.invalidatedAt = eventSeq
        epoch.invalidationReason = reason
      })
    }

    // 3. 重放前缀，比对断言集合的进出。
    const prefix = events.slice(0, eventSeq + 1)
    const believed = getBelievedInPile(model, prefix)

    previousBelieved.forEach((cardID) => {
      if (believed.has(cardID)) return
      openEpochs.delete(cardID)
    })

    believed.forEach((cardID) => {
      if (openEpochs.has(cardID)) return
      const epoch: BeliefEpoch = {
        model,
        cardID,
        cohortGeneration: null,
        startEventSeq: eventSeq,
        beliefType: 'in-pile',
        sourceEvidence: inferSourceEvidence(event),
        invalidatedAt: null,
        invalidationReason: null,
        confirmedAt: null,
        contradictedAt: null
      }
      openEpochs.set(cardID, epoch)
      epochs.push(epoch)
    })

    // 4. 风险暴露：已失效但仍未被后续协议解决的断言，每经过一个事件累计一次。
    openEpochs.forEach((epoch) => {
      if (epoch.invalidatedAt !== null && epoch.contradictedAt === null) {
        riskExposureEventCount += 1
      }
    })

    previousBelieved = believed
  })

  const cohortState = runCohortPoolModel(events)
  const unresolvedRiskSetSize = Array.from(openEpochs.values()).filter(
    (epoch) => epoch.invalidatedAt !== null && epoch.contradictedAt === null
  ).length

  return {
    epochs,
    metrics: {
      confirmedContradictionCount,
      // 投影遗漏需要模型承认位置未决、UI 却未展示。当前三种投影都不做这种裁剪，
      // 因此恒为 0；保留字段是为了 Phase 1 接入真实 UI 投影时能直接采集。
      confirmedProjectionOmissionCount: 0,
      unresolvedRiskSetSize,
      riskExposureEventCount,
      cohortCount: cohortState.cohorts.length,
      cohortCandidateWidth: cohortState.cohorts.reduce(
        (sum, cohort) => sum + cohort.candidateIdentityIDs.size,
        0
      ),
      cohortCardinalitySummaries: summarizeCohorts(cohortState),
      batchBoundaryDegradationCount: cohortState.cohortDegradationCount,
      maxDisplayedCandidateCount: sortIDs(getCohortDefinitelyInPileIDs(cohortState)).length,
      explainedContradictionCount
    }
  }
}

/**
 * §20.5 要求的双向采集：同一事件流下并排采集三个模型，禁止只测基线。
 */
export function collectAllModelBeliefEpochs(
  events: PileGenerationEvent[]
): Record<BeliefModelName, BeliefEpochCollection> {
  return {
    baseline: collectBeliefEpochs(events, 'baseline'),
    generation: collectBeliefEpochs(events, 'generation'),
    cohort: collectBeliefEpochs(events, 'cohort')
  }
}
