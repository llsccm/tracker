import type { CardID } from '@/tracker/types'

/**
 * Phase 0/0.5 纯模型：世代身份卡池、批次基数、历史正 ID 暗槽账本与真实牌序 oracle。
 *
 * 这里不引用任何生产代码，只用同一套事件序列驱动相互独立的模型。它们不属于已退役的
 * 运行时 observer，而是用于反证生产 `PileIdentityLedger` 语义的长期回归基线，应随新增事件
 * 一起维护：
 *
 * - `runGenerationPoolModel`：保留的全局世代对照模型。
 *   它采用「匿名牌堆 + 当前世代未揭示身份候选池」：暗摸不更新卡池；实际弃牌洗回时旧卡池
 *   整体过期为 suspended，洗回的已知身份组成下一世代卡池。
 * - `runBaselineLedgerModel`：Phase 0 时冻结的旧生产基线。`Card.reset()` 洗回时保留正 ID，
 *   牌堆里存在「正 ID 暗槽」；旧洗牌分类用这些 ID 排除仍有明确牌堆位置的身份。
 * - `runCohortPoolModel`：不绑定具体身份与物理槽，只保留每个洗回批次的候选身份集合和
 *   其中仍在牌堆的数量。它用于验证集合级基数约束能否保留世代模型主动丢弃的信息。
 * - `runOracle`：仅由测试夹具提供服务器真实隐藏牌序，用于判定上述模型是否作出错误陈述。
 *
 * 世代与基线模型都把 `candidateWidth`（= suspended 集合大小）作为对照指标：按设计契约，
 * 活动卡池不直接展示，UI 展示的是「未知位置候选」，也就是 suspended 集合。
 *
 * 基线模型有意保留「被挤身份退回未定位池」这条代价路径（见 `revealFromPile`），
 * 否则会低估当前模型的候选宽度、把对照结果偏向基线。
 *
 * **建模范围**：计划 §5.3.2 枚举的 B8–B11（潜伏、伊籍机捷、骋烈/天辩/宴戏、特殊装备牌）
 * 不由本模型覆盖，改由各自的特殊路径实现，因此这里没有对应事件类型。这也意味着本模型
 * 只需支持牌顶方向的批次消费（B9 牌底摸牌是唯一的反向来源）。
 */

export type PileGenerationEvent =
  /** 建立初始世代：等量匿名物理槽 + 全部身份进入活动卡池。 */
  | { type: 'initialize'; cardIDs: CardID[] }
  /** 暗摸：只消费牌堆物理槽，协议不提供真实身份。 */
  | { type: 'drawUnknown'; count: number }
  /**
   * 真实自动洗牌：一次摸牌需求超过当前牌堆剩余量。
   *
   * 按 §18.2，顺序是「先洗牌，再由该次摸牌消费洗牌前剩余牌顶槽 + 至少 1 张刚洗回的牌」。
   * 因此洗牌发生时旧牌顶槽仍在牌堆内，而洗牌完成后洗回批次必然已被不透明消费至少 1 张。
   */
  | { type: 'drawAcrossShuffle'; count: number }
  /** 从牌堆揭示身份（明摸）：slot-first，先消费物理槽再释放身份。 */
  | { type: 'revealFromPile'; cardIDs: CardID[] }
  /**
   * 搜牌类技能从牌堆**任意位置**获取指定牌（协议 `FromZone=pile` + `MoveType=18`，
   * 见 `MoveEventNormalizer.getProtocolMoveSpecialLabel()` 的「从牌堆获取牌」）。
   *
   * 与 `revealFromPile` 的区别只在语义标注：协议给出 CardID 本身就证明该身份此刻在
   * 牌堆，因此两者都不要求身份位于牌顶批次。单独建模是为了让固定 seed 属性序列分别
   * 覆盖「牌顶摸牌」与「任意位置搜牌」的边界。
   */
  | { type: 'gainFromPile'; cardIDs: CardID[] }
  /**
   * 从牌顶 `rangeSize` 张范围内获取 `count` 张，但**协议不给 CardID**。
   *
   * 实测样例（权变 `SpellID=7011`）：
   *
   * ```text
   * CardCount: 1, CardIDs: [], FromZone: 1, MoveType: 18, ToZone: 5
   * ```
   *
   * 主视角能看到牌顶 X 张，非主视角只知道「从牌顶 X 张里拿走了一张」。
   * 若范围完全落在牌顶批次内，可只扣该批次基数；跨批次时必须合并降级，
   * 否则会虚构「各批次分别丢了几张」。
   */
  | { type: 'gainUnknownFromPileTopRange'; count: number; rangeSize: number }
  /** 从玩家暗区揭示身份：复用玩家暗占位，不消费牌堆槽。 */
  | { type: 'revealFromHand'; cardIDs: CardID[] }
  /** 已定位明牌进入弃牌堆；此时尚不加入下一世代卡池。 */
  | { type: 'discardKnown'; cardIDs: CardID[] }
  /** 非自动补牌路径的弃牌洗回；弃牌堆为空时不产生新批次。 */
  | { type: 'shuffle'; cause?: 'explicit-recycle' | 'unknown' }
  /** 合法外部身份（12 区/技能生成）：身份全集只扩展一次。 */
  | { type: 'introduceExternal'; cardIDs: CardID[] }
  /**
   * 以随机位置向牌堆加入外部牌（B3 浑天仪 `SpellID=3694` / B4 回魂牌 `4400/4401`）。
   *
   * 真实插入位置未知，因此无法归属到任何批次。按 §5.3.4 规则合并全部批次：
   * 合并后只保留「这些身份中有 N 张仍在牌堆」这一条真信息。
   */
  | { type: 'insertExternalAtRandom'; cardIDs: CardID[] }

/** 两个模型共享的洗牌观测，用于并排对照候选宽度。 */
export interface ShuffleObservation {
  pileSlotCountBefore: number
  pileSlotCountAfter: number
  recycledIdentityIDs: CardID[]
  carriedSuspendedIDs: CardID[]
  newlySuspendedIDs: CardID[]
  suspendedIDs: CardID[]
  /** UI 需要展示的未知位置候选数量。 */
  candidateWidth: number
}

export interface GenerationShuffleObservation extends ShuffleObservation {
  generationBefore: number
  generationAfter: number
  expiredPoolIDs: CardID[]
  activePoolIDsAfter: CardID[]
}

export interface GenerationModelState {
  generation: number
  pileSlotCount: number
  playerAnonSlotCount: number
  playerKnownIDs: Set<CardID>
  discardKnownIDs: CardID[]
  discardAnonSlotCount: number
  activeIdentityIDs: Set<CardID>
  suspendedIdentityIDs: Set<CardID>
  locatedIdentityIDs: Set<CardID>
  identityUniverse: Set<CardID>
}

export interface PileIdentityCohort {
  generation: number
  candidateIdentityIDs: Set<CardID>
  /** 该候选集合中确定仍在物理牌堆的张数，不绑定具体 CardID。 */
  remainingPileCount: number
}

export interface CohortPoolModelState {
  generation: number
  pileSlotCount: number
  playerAnonSlotCount: number
  playerKnownIDs: Set<CardID>
  discardKnownIDs: CardID[]
  discardAnonSlotCount: number
  /** 下标 0 靠牌底，末尾靠牌顶；零牌堆张数批次仍保留未揭示身份。 */
  cohorts: PileIdentityCohort[]
  locatedIdentityIDs: Set<CardID>
  identityUniverse: Set<CardID>
  /** §8.2 的 batchBoundaryDegradationCount：批次边界降级次数。 */
  cohortDegradationCount: number
}

export interface BaselineModelState {
  /** 下标 0 是牌堆底，末尾是牌堆顶；`null` 表示匿名槽，正数表示正 ID 暗槽。 */
  pileSlots: (CardID | null)[]
  playerAnonSlotCount: number
  /** 玩家暗区里的正 ID 暗占位（洗牌后被暗摸带走的 `reset()` 槽）。 */
  playerHiddenPositiveIDs: Set<CardID>
  playerKnownIDs: Set<CardID>
  discardKnownIDs: CardID[]
  discardAnonSlotCount: number
  suspendedIdentityIDs: Set<CardID>
  locatedIdentityIDs: Set<CardID>
  everRevealedIDs: Set<CardID>
  identityUniverse: Set<CardID>
}

function normalizeIdentityIDs(cardIDs: Iterable<CardID>): CardID[] {
  return Array.from(new Set(Array.from(cardIDs).filter((cardID) => cardID > 0)))
}

function assertSameIdentitySet(actual: CardID[], expected: CardID[], label: string): void {
  const normalizedActual = normalizeIdentityIDs(actual)
  const normalizedExpected = normalizeIdentityIDs(expected)
  const hasInvalidOrDuplicateActual = normalizedActual.length !== actual.length

  if (
    hasInvalidOrDuplicateActual ||
    normalizedActual.length !== normalizedExpected.length ||
    sortIDs(normalizedActual).join(',') !== sortIDs(normalizedExpected).join(',')
  ) {
    throw new Error(
      `${label}：${sortIDs(actual).join(',')} 不是 ${sortIDs(normalizedExpected).join(',')} 的完整排列`
    )
  }
}

export function sortIDs(ids: Iterable<CardID>): CardID[] {
  return Array.from(ids).sort((left, right) => left - right)
}

/** 身份基础分区中的「未定位」子集：身份全集减去已绑定实体的身份。 */
function collectUnlocated(universe: Set<CardID>, located: Set<CardID>): Set<CardID> {
  const unlocated = new Set<CardID>()
  universe.forEach((cardID) => {
    if (!located.has(cardID)) unlocated.add(cardID)
  })
  return unlocated
}

// ---------------------------------------------------------------------------
// 世代身份卡池模型
// ---------------------------------------------------------------------------

function createGenerationState(): GenerationModelState {
  return {
    generation: 0,
    pileSlotCount: 0,
    playerAnonSlotCount: 0,
    playerKnownIDs: new Set(),
    discardKnownIDs: [],
    discardAnonSlotCount: 0,
    activeIdentityIDs: new Set(),
    suspendedIdentityIDs: new Set(),
    locatedIdentityIDs: new Set(),
    identityUniverse: new Set()
  }
}

/**
 * 计划 §5.3 的统一预处理：任意身份被协议明确揭示时，先从活动卡池或 suspended
 * 释放，再物化。同一身份不得在揭示后残留于多个状态集合。
 */
function releaseGenerationIdentity(state: GenerationModelState, cardID: CardID): void {
  state.activeIdentityIDs.delete(cardID)
  state.suspendedIdentityIDs.delete(cardID)
  state.locatedIdentityIDs.add(cardID)
}

function rotateGeneration(state: GenerationModelState): GenerationShuffleObservation | null {
  const recycledSlotCount = state.discardKnownIDs.length + state.discardAnonSlotCount
  // §5.5：空弃牌堆调用不得滚动世代。
  if (recycledSlotCount === 0) return null

  const generationBefore = state.generation
  const pileSlotCountBefore = state.pileSlotCount
  const carriedSuspendedIDs = sortIDs(state.suspendedIdentityIDs)
  const expiredPoolIDs = sortIDs(state.activeIdentityIDs)
  const recycledIdentityIDs = [...state.discardKnownIDs]

  // 步骤 A：关闭旧世代。旧卡池剩余身份失去活动世代归因，建立正 ID 实体并挂 suspended。
  expiredPoolIDs.forEach((cardID) => {
    state.activeIdentityIDs.delete(cardID)
    state.suspendedIdentityIDs.add(cardID)
    state.locatedIdentityIDs.add(cardID)
  })

  // 步骤 B：匿名化洗回实体，身份回到未定位并组成新活动卡池。
  recycledIdentityIDs.forEach((cardID) => {
    state.locatedIdentityIDs.delete(cardID)
    state.activeIdentityIDs.add(cardID)
  })

  // 步骤 C/D：重建物理牌堆并提交新世代。
  state.pileSlotCount += recycledSlotCount
  state.discardKnownIDs = []
  state.discardAnonSlotCount = 0
  state.generation += 1

  return {
    generationBefore,
    generationAfter: state.generation,
    pileSlotCountBefore,
    pileSlotCountAfter: state.pileSlotCount,
    recycledIdentityIDs,
    carriedSuspendedIDs,
    newlySuspendedIDs: expiredPoolIDs,
    suspendedIDs: sortIDs(state.suspendedIdentityIDs),
    candidateWidth: state.suspendedIdentityIDs.size,
    expiredPoolIDs,
    activePoolIDsAfter: sortIDs(state.activeIdentityIDs)
  }
}

function applyGenerationEvent(
  state: GenerationModelState,
  event: PileGenerationEvent,
  shuffles: GenerationShuffleObservation[]
): void {
  switch (event.type) {
    case 'initialize': {
      const cardIDs = normalizeIdentityIDs(event.cardIDs)
      state.generation = 0
      state.pileSlotCount = cardIDs.length
      state.identityUniverse = new Set(cardIDs)
      state.activeIdentityIDs = new Set(cardIDs)
      state.suspendedIdentityIDs = new Set()
      state.locatedIdentityIDs = new Set()
      return
    }
    case 'drawUnknown': {
      if (event.count > state.pileSlotCount) {
        throw new Error(`暗摸张数超过牌堆物理槽：${event.count} > ${state.pileSlotCount}`)
      }
      // §5.2：暗摸只消费物理槽，活动卡池/suspended 完全不变。
      state.pileSlotCount -= event.count
      state.playerAnonSlotCount += event.count
      return
    }
    case 'insertExternalAtRandom': {
      // 外部牌暗置进入牌堆：身份未揭示，属于当前世代候选（§5.8 规则 4）。
      const cardIDs = normalizeIdentityIDs(event.cardIDs)
      cardIDs.forEach((cardID) => {
        state.identityUniverse.add(cardID)
        state.locatedIdentityIDs.delete(cardID)
        state.activeIdentityIDs.add(cardID)
        state.suspendedIdentityIDs.delete(cardID)
      })
      state.pileSlotCount += cardIDs.length
      return
    }
    case 'drawAcrossShuffle': {
      // §18.2：摸牌需求必须真的超过当前牌堆剩余量，否则协议不会洗牌。
      if (event.count <= state.pileSlotCount) {
        throw new Error(
          `摸牌未超过牌堆剩余量，不会触发洗牌：${event.count} <= ${state.pileSlotCount}`
        )
      }

      const carriedOverSlotCount = state.pileSlotCount
      const observation = rotateGeneration(state)
      if (observation) shuffles.push(observation)

      // 该次摸牌先消费洗牌前剩余牌顶，再消费至少 1 张刚洗回的牌。
      state.pileSlotCount -= event.count
      state.playerAnonSlotCount += event.count
      if (state.pileSlotCount < 0) throw new Error('摸牌张数超过洗牌后牌堆物理槽')

      const consumedFromRecycledCount = event.count - carriedOverSlotCount
      if (consumedFromRecycledCount < 1) {
        throw new Error('洗牌后摸牌未消费任何洗回牌，触发条件不成立')
      }
      return
    }
    case 'revealFromPile': {
      event.cardIDs.forEach((cardID) => {
        // §5.3.1：先按张数消费匿名物理槽，身份解析不得改变已消费数量。
        if (state.pileSlotCount <= 0) throw new Error(`牌堆无槽可消费：揭示 ${cardID}`)
        state.pileSlotCount -= 1
        releaseGenerationIdentity(state, cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
    case 'gainFromPile': {
      // 全局世代模型不区分牌堆位置，搜牌与明摸的账本影响完全相同。
      event.cardIDs.forEach((cardID) => {
        if (state.pileSlotCount <= 0) throw new Error(`牌堆无槽可消费：搜牌 ${cardID}`)
        state.pileSlotCount -= 1
        releaseGenerationIdentity(state, cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
    case 'gainUnknownFromPileTopRange': {
      // 协议没给 CardID，等同暗摸：只消费物理槽，卡池不变。
      if (event.count > state.pileSlotCount) {
        throw new Error(`牌顶范围取牌超过牌堆物理槽：${event.count} > ${state.pileSlotCount}`)
      }
      state.pileSlotCount -= event.count
      state.playerAnonSlotCount += event.count
      return
    }
    case 'revealFromHand': {
      event.cardIDs.forEach((cardID) => {
        if (state.playerAnonSlotCount <= 0) throw new Error(`玩家无暗占位可复用：揭示 ${cardID}`)
        state.playerAnonSlotCount -= 1
        releaseGenerationIdentity(state, cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
    case 'discardKnown': {
      event.cardIDs.forEach((cardID) => {
        if (!state.playerKnownIDs.delete(cardID)) {
          throw new Error(`弃置的明牌不在玩家已知手牌中：${cardID}`)
        }
        // §5.4：进入弃牌堆时尚不加入下一世代卡池，只有实际洗回才加入。
        state.discardKnownIDs.push(cardID)
      })
      return
    }
    case 'shuffle': {
      const observation = rotateGeneration(state)
      if (observation) shuffles.push(observation)
      return
    }
    case 'introduceExternal': {
      // §5.8：首次合法外部身份加入身份全集，且只扩展一次。
      event.cardIDs.forEach((cardID) => {
        if (state.identityUniverse.has(cardID)) return
        state.identityUniverse.add(cardID)
        state.locatedIdentityIDs.add(cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
  }
}

export function runGenerationPoolModel(events: PileGenerationEvent[]): {
  state: GenerationModelState
  shuffles: GenerationShuffleObservation[]
} {
  const state = createGenerationState()
  const shuffles: GenerationShuffleObservation[] = []
  events.forEach((event) => applyGenerationEvent(state, event, shuffles))
  return { state, shuffles }
}

/** 世代模型的物理槽总数：应恒等于身份全集大小（§4.1）。 */
export function countGenerationSlots(state: GenerationModelState): number {
  return (
    state.pileSlotCount +
    state.playerAnonSlotCount +
    state.playerKnownIDs.size +
    state.discardKnownIDs.length +
    state.discardAnonSlotCount
  )
}

export function getGenerationUnlocated(state: GenerationModelState): Set<CardID> {
  return collectUnlocated(state.identityUniverse, state.locatedIdentityIDs)
}

// ---------------------------------------------------------------------------
// 批次集合 + 在牌堆数量模型
// ---------------------------------------------------------------------------

function createCohortPoolState(): CohortPoolModelState {
  return {
    generation: 0,
    pileSlotCount: 0,
    playerAnonSlotCount: 0,
    playerKnownIDs: new Set(),
    discardKnownIDs: [],
    discardAnonSlotCount: 0,
    cohorts: [],
    locatedIdentityIDs: new Set(),
    identityUniverse: new Set(),
    cohortDegradationCount: 0
  }
}

function findIdentityCohort(
  state: CohortPoolModelState,
  cardID: CardID
): PileIdentityCohort | undefined {
  return state.cohorts.find((cohort) => cohort.candidateIdentityIDs.has(cardID))
}

function findTopPileCohort(state: CohortPoolModelState): PileIdentityCohort | undefined {
  for (let index = state.cohorts.length - 1; index >= 0; index -= 1) {
    const cohort = state.cohorts[index]
    if (cohort.remainingPileCount > 0) return cohort
  }
  return undefined
}

function removeEmptyCohorts(state: CohortPoolModelState): void {
  state.cohorts = state.cohorts.filter(
    (cohort) => cohort.candidateIdentityIDs.size > 0 || cohort.remainingPileCount > 0
  )
}

/**
 * §5.3.4 的「合并批次」降级：把全部批次并成一个。
 *
 * 当有牌以未知位置进入或离开牌堆时，批次之间的边界不再可推导，但
 * 「这些候选身份中共有 N 张仍在牌堆」这条集合级真信息仍然成立。合并保留它，
 * 同时诚实地丢弃更细的分组。
 */
function mergeAllCohorts(state: CohortPoolModelState): void {
  if (state.cohorts.length <= 1) return

  const merged: PileIdentityCohort = {
    // 合并后沿用最新世代号，表示这是一个降级形成的批次。
    generation: state.generation,
    candidateIdentityIDs: new Set(),
    remainingPileCount: 0
  }
  state.cohorts.forEach((cohort) => {
    cohort.candidateIdentityIDs.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
    merged.remainingPileCount += cohort.remainingPileCount
  })
  state.cohorts = [merged]
}

/**
 * 从牌顶消费物理槽。批次数组末尾是最新批次（牌顶侧），因此倒序遍历。
 */
function consumeCohortPileSlots(state: CohortPoolModelState, count: number): void {
  if (count > state.pileSlotCount) {
    throw new Error(`暗摸张数超过批次模型牌堆物理槽：${count} > ${state.pileSlotCount}`)
  }

  let remaining = count
  for (let index = state.cohorts.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const cohort = state.cohorts[index]
    const consumed = Math.min(cohort.remainingPileCount, remaining)
    cohort.remainingPileCount -= consumed
    remaining -= consumed
  }

  if (remaining !== 0) throw new Error('批次模型无法用身份批次解释牌堆物理槽')
  state.pileSlotCount -= count
}

function revealCohortIdentity(
  state: CohortPoolModelState,
  cardID: CardID,
  source: 'pile' | 'hand'
): void {
  const cohort = findIdentityCohort(state, cardID)
  if (!cohort) throw new Error(`批次模型找不到待揭示身份：${cardID}`)

  if (source === 'pile') {
    // 搜牌类技能可以从牌堆**任意位置**取牌，不限于牌顶：协议给出 CardID 本身就证明
    // 该身份此刻在牌堆。因此这里不校验批次顺序，只要求所属批次仍有在牌堆的名额。
    //
    // 生产侧 `Zone.remove()` 没有 RANDOM 分支（`POSITION_RANDOM` 落入牌顶弹出），
    // 即把「任意位置取牌」按牌顶取牌处理——这是当前实现的已知近似。
    if (cohort.remainingPileCount <= 0) {
      throw new Error(`批次模型：身份 ${cardID} 所属批次已无在牌堆名额`)
    }
    cohort.remainingPileCount -= 1
    state.pileSlotCount -= 1
  } else if (cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
    throw new Error(`批次模型：身份 ${cardID} 所属批次没有已离开牌堆的名额`)
  }

  cohort.candidateIdentityIDs.delete(cardID)
  state.locatedIdentityIDs.add(cardID)
  state.playerKnownIDs.add(cardID)
  removeEmptyCohorts(state)
}

function recycleDiscardToCohort(state: CohortPoolModelState): boolean {
  const recycledIdentityIDs = [...state.discardKnownIDs]
  const recycledSlotCount = recycledIdentityIDs.length + state.discardAnonSlotCount
  if (recycledSlotCount === 0) return false
  if (state.discardAnonSlotCount > 0) {
    throw new Error('批次模型暂不支持没有身份集合的匿名弃牌槽')
  }

  state.generation += 1
  recycledIdentityIDs.forEach((cardID) => state.locatedIdentityIDs.delete(cardID))
  state.cohorts.unshift({
    generation: state.generation,
    candidateIdentityIDs: new Set(recycledIdentityIDs),
    remainingPileCount: recycledIdentityIDs.length
  })
  state.pileSlotCount += recycledIdentityIDs.length
  state.discardKnownIDs = []
  state.discardAnonSlotCount = 0
  return true
}

function assertCohortState(state: CohortPoolModelState): void {
  const candidateIDs = new Set<CardID>()
  let explainedPileSlotCount = 0

  state.cohorts.forEach((cohort) => {
    if (
      cohort.remainingPileCount < 0 ||
      cohort.remainingPileCount > cohort.candidateIdentityIDs.size
    ) {
      throw new Error(`批次 ${cohort.generation} 的牌堆基数超出候选集合`)
    }
    explainedPileSlotCount += cohort.remainingPileCount
    cohort.candidateIdentityIDs.forEach((cardID) => {
      if (candidateIDs.has(cardID)) throw new Error(`身份 ${cardID} 同时属于多个批次`)
      if (state.locatedIdentityIDs.has(cardID))
        throw new Error(`身份 ${cardID} 同时已定位并属于批次`)
      candidateIDs.add(cardID)
    })
  })

  if (explainedPileSlotCount !== state.pileSlotCount) {
    throw new Error(
      `批次牌堆基数与物理槽不一致：${explainedPileSlotCount} !== ${state.pileSlotCount}`
    )
  }

  const unlocated = collectUnlocated(state.identityUniverse, state.locatedIdentityIDs)
  if (sortIDs(candidateIDs).join(',') !== sortIDs(unlocated).join(',')) {
    throw new Error('批次候选集合未完整覆盖未定位身份')
  }
}

function applyCohortEvent(state: CohortPoolModelState, event: PileGenerationEvent): void {
  switch (event.type) {
    case 'initialize': {
      const cardIDs = normalizeIdentityIDs(event.cardIDs)
      state.generation = 0
      state.pileSlotCount = cardIDs.length
      state.playerAnonSlotCount = 0
      state.playerKnownIDs = new Set()
      state.discardKnownIDs = []
      state.discardAnonSlotCount = 0
      state.identityUniverse = new Set(cardIDs)
      state.locatedIdentityIDs = new Set()
      state.cohorts = [
        {
          generation: 0,
          candidateIdentityIDs: new Set(cardIDs),
          remainingPileCount: cardIDs.length
        }
      ]
      break
    }
    case 'drawUnknown': {
      consumeCohortPileSlots(state, event.count)
      state.playerAnonSlotCount += event.count
      break
    }
    case 'insertExternalAtRandom': {
      // B3/B4：位置未知 → 合并全部批次，再把新身份并入合并批次。
      const cardIDs = normalizeIdentityIDs(event.cardIDs)
      // 只有真的存在多个批次时，随机插入才会丢失批次边界。
      const mergedBoundaries = state.cohorts.length > 1
      mergeAllCohorts(state)
      cardIDs.forEach((cardID) => state.identityUniverse.add(cardID))

      const [cohort] = state.cohorts
      if (cohort) {
        cardIDs.forEach((cardID) => cohort.candidateIdentityIDs.add(cardID))
        cohort.remainingPileCount += cardIDs.length
      } else {
        state.cohorts = [
          {
            generation: state.generation,
            candidateIdentityIDs: new Set(cardIDs),
            remainingPileCount: cardIDs.length
          }
        ]
      }
      state.pileSlotCount += cardIDs.length
      if (mergedBoundaries) state.cohortDegradationCount += 1
      break
    }
    case 'drawAcrossShuffle': {
      const carriedOverSlotCount = state.pileSlotCount
      if (event.count <= carriedOverSlotCount) {
        throw new Error(
          `摸牌未超过牌堆剩余量，不会触发洗牌：${event.count} <= ${carriedOverSlotCount}`
        )
      }
      if (!recycleDiscardToCohort(state)) throw new Error('弃牌堆为空，无法触发自动补牌洗牌')
      consumeCohortPileSlots(state, event.count)
      state.playerAnonSlotCount += event.count
      break
    }
    case 'revealFromPile': {
      event.cardIDs.forEach((cardID) => revealCohortIdentity(state, cardID, 'pile'))
      break
    }
    case 'gainFromPile': {
      // 搜牌给出了 CardID，直接按身份从所属批次扣减，不要求位于牌顶批次。
      event.cardIDs.forEach((cardID) => revealCohortIdentity(state, cardID, 'pile'))
      break
    }
    case 'gainUnknownFromPileTopRange': {
      // 权变（SpellID=7011）类：从牌顶 rangeSize 张里拿走 count 张，非主视角不知道是哪张。
      //
      // 若该范围完全落在牌顶批次内，可以安全地只扣该批次基数；
      // 一旦跨越批次边界，就无法确定各批次各丢了几张 —— 必须合并降级。
      if (event.count > state.pileSlotCount) {
        throw new Error(`牌顶范围取牌超过牌堆物理槽：${event.count} > ${state.pileSlotCount}`)
      }
      if (event.rangeSize < event.count) {
        throw new Error(`牌顶范围小于取牌数：${event.rangeSize} < ${event.count}`)
      }

      const topCohort = findTopPileCohort(state)
      if (topCohort && event.rangeSize > topCohort.remainingPileCount) {
        mergeAllCohorts(state)
        state.cohortDegradationCount += 1
      }

      consumeCohortPileSlots(state, event.count)
      state.playerAnonSlotCount += event.count
      break
    }
    case 'revealFromHand': {
      event.cardIDs.forEach((cardID) => {
        if (state.playerAnonSlotCount <= 0) throw new Error(`玩家无暗占位可复用：揭示 ${cardID}`)
        state.playerAnonSlotCount -= 1
        revealCohortIdentity(state, cardID, 'hand')
      })
      break
    }
    case 'discardKnown': {
      event.cardIDs.forEach((cardID) => {
        if (!state.playerKnownIDs.delete(cardID)) {
          throw new Error(`弃置的明牌不在玩家已知手牌中：${cardID}`)
        }
        state.discardKnownIDs.push(cardID)
      })
      break
    }
    case 'shuffle': {
      recycleDiscardToCohort(state)
      break
    }
    case 'introduceExternal': {
      event.cardIDs.forEach((cardID) => {
        if (state.identityUniverse.has(cardID)) return
        state.identityUniverse.add(cardID)
        state.locatedIdentityIDs.add(cardID)
        state.playerKnownIDs.add(cardID)
      })
      break
    }
  }

  assertCohortState(state)
}

export function runCohortPoolModel(events: PileGenerationEvent[]): CohortPoolModelState {
  const state = createCohortPoolState()
  events.forEach((event) => applyCohortEvent(state, event))
  return state
}

export function getCohortUnknownLocationCandidateIDs(state: CohortPoolModelState): Set<CardID> {
  const candidateIDs = new Set<CardID>()
  state.cohorts.forEach((cohort) => {
    if (cohort.remainingPileCount >= cohort.candidateIdentityIDs.size) return
    cohort.candidateIdentityIDs.forEach((cardID) => candidateIDs.add(cardID))
  })
  return candidateIDs
}

export function getCohortDefinitelyInPileIDs(state: CohortPoolModelState): Set<CardID> {
  const definitelyInPileIDs = new Set<CardID>()
  state.cohorts.forEach((cohort) => {
    if (cohort.remainingPileCount !== cohort.candidateIdentityIDs.size) return
    cohort.candidateIdentityIDs.forEach((cardID) => definitelyInPileIDs.add(cardID))
  })
  return definitelyInPileIDs
}

export function countCohortSlots(state: CohortPoolModelState): number {
  return (
    state.pileSlotCount +
    state.playerAnonSlotCount +
    state.playerKnownIDs.size +
    state.discardKnownIDs.length +
    state.discardAnonSlotCount
  )
}

// ---------------------------------------------------------------------------
// 分组投影原型（计划 §10 第 4 项）
// ---------------------------------------------------------------------------

/**
 * 一个批次对用户的可读结论。三种取值来自 `remainingPileCount` 与候选集合大小的关系：
 *
 * - `all-in-pile`：`remainingPileCount === size`，整组都还在牌堆。
 * - `none-in-pile`：`remainingPileCount === 0`，整组都已离开牌堆。
 * - `partial`：`0 < remainingPileCount < size`，只知道「其中 K 张仍在牌堆」。
 */
export type CohortProjectionKind = 'all-in-pile' | 'none-in-pile' | 'partial'

export interface CohortProjectionGroup {
  generation: number
  kind: CohortProjectionKind
  cardIDs: CardID[]
  /** 该组中仍在牌堆的张数；`partial` 组无法指认具体是哪几张。 */
  remainingPileCount: number
  /** 面向用户的一行说明，用于验证可读性。 */
  label: string
}

export interface CohortProjection {
  groups: CohortProjectionGroup[]
  /** 需要展示的分组数量：这是分组投影真正的界面成本。 */
  groupCount: number
  /**
   * 逐卡扁平候选宽度（现有 UI 的按钮数量），用于与 `groupCount` 对照。
   * 注意 `none-in-pile` 组不计入：它们已被证明不在牌堆，不该继续占用候选位。
   */
  flatCandidateWidth: number
  /** 确定仍在牌堆的具体身份。 */
  definitelyInPileIDs: CardID[]
  /** 确定已离开牌堆的具体身份：现有扁平投影无法表达这一类。 */
  definitelyOutsidePileIDs: CardID[]
}

/**
 * 把批次状态投影成可读分组（计划 §10 第 4 项、Phase 0.5 最后一项）。
 *
 * 核心结论：批次模型的收益不在于减少候选按钮，而在于它能表达两件扁平投影说不出的事——
 * 「这一组整组都还在牌堆」与「这一组整组都已离开牌堆」。后者尤其重要：`remainingPileCount`
 * 为 0 的批次在扁平投影里仍会被列为候选，而分组投影可以直接把它们移出候选区。
 */
export function projectCohorts(state: CohortPoolModelState): CohortProjection {
  const groups: CohortProjectionGroup[] = []

  state.cohorts.forEach((cohort) => {
    const cardIDs = sortIDs(cohort.candidateIdentityIDs)
    if (cardIDs.length === 0) return

    const { remainingPileCount } = cohort
    const kind: CohortProjectionKind =
      remainingPileCount === 0
        ? 'none-in-pile'
        : remainingPileCount === cardIDs.length
          ? 'all-in-pile'
          : 'partial'

    const label =
      kind === 'all-in-pile'
        ? `这 ${cardIDs.length} 张都在牌堆`
        : kind === 'none-in-pile'
          ? `这 ${cardIDs.length} 张都不在牌堆`
          : `这 ${cardIDs.length} 张里有 ${remainingPileCount} 张在牌堆`

    groups.push({ generation: cohort.generation, kind, cardIDs, remainingPileCount, label })
  })

  const definitelyInPileIDs: CardID[] = []
  const definitelyOutsidePileIDs: CardID[] = []
  let flatCandidateWidth = 0

  groups.forEach((group) => {
    if (group.kind === 'all-in-pile') definitelyInPileIDs.push(...group.cardIDs)
    else if (group.kind === 'none-in-pile') definitelyOutsidePileIDs.push(...group.cardIDs)
    else flatCandidateWidth += group.cardIDs.length
  })

  return {
    groups,
    groupCount: groups.length,
    flatCandidateWidth,
    definitelyInPileIDs: sortIDs(definitelyInPileIDs),
    definitelyOutsidePileIDs: sortIDs(definitelyOutsidePileIDs)
  }
}

// ---------------------------------------------------------------------------
// 当前生产语义基线模型
// ---------------------------------------------------------------------------

function createBaselineState(): BaselineModelState {
  return {
    pileSlots: [],
    playerAnonSlotCount: 0,
    playerHiddenPositiveIDs: new Set(),
    playerKnownIDs: new Set(),
    discardKnownIDs: [],
    discardAnonSlotCount: 0,
    suspendedIdentityIDs: new Set(),
    locatedIdentityIDs: new Set(),
    everRevealedIDs: new Set(),
    identityUniverse: new Set()
  }
}

/**
 * 复用一个玩家暗占位来承载被揭示的身份。
 * 优先用该身份自己的正 ID 暗占位，其次匿名占位；只有都没有时才挤占别的正 ID 暗占位，
 * 此时被挤身份退回未定位池。
 */
function consumeBaselineHiddenHandSlot(state: BaselineModelState, cardID: CardID): void {
  if (state.playerHiddenPositiveIDs.delete(cardID)) return
  if (state.playerAnonSlotCount > 0) {
    state.playerAnonSlotCount -= 1
    return
  }

  const [displaced] = state.playerHiddenPositiveIDs
  if (displaced === undefined) throw new Error(`玩家无暗占位可复用：揭示 ${cardID}`)
  state.playerHiddenPositiveIDs.delete(displaced)
  state.locatedIdentityIDs.delete(displaced)
}

/**
 * 基线模型仍允许正 ID 暗槽物理存在；从牌顶暗摸时必须把弹出的槽位按匿名/正 ID 分类，
 * 否则玩家暗区槽数与身份位置归因会在不同事件分支间漂移。
 */
function moveBaselinePileTopSlotToHiddenHand(state: BaselineModelState): void {
  if (state.pileSlots.length === 0) throw new Error('牌堆物理槽为空，无法从牌顶暗摸')
  const slot = state.pileSlots.pop() ?? null
  if (slot === null) {
    state.playerAnonSlotCount += 1
    return
  }
  state.playerHiddenPositiveIDs.add(slot)
}

function shuffleBaseline(state: BaselineModelState): ShuffleObservation | null {
  const recycledSlotCount = state.discardKnownIDs.length + state.discardAnonSlotCount
  if (recycledSlotCount === 0) return null

  const pileSlotCountBefore = state.pileSlots.length
  const carriedSuspendedIDs = sortIDs(state.suspendedIdentityIDs)

  // 对应 Phase 0 冻结的旧 Room 基线：用剩余牌堆正 ID 排除仍有明确位置的身份。
  const remainingPileIdentityIDs = new Set(
    state.pileSlots.filter((slot): slot is CardID => slot !== null)
  )
  const unlocated = collectUnlocated(state.identityUniverse, state.locatedIdentityIDs)
  const candidateIdentityIDs = new Set<CardID>(unlocated)
  state.identityUniverse.forEach((cardID) => {
    if (!state.everRevealedIDs.has(cardID)) candidateIdentityIDs.add(cardID)
  })

  const neverAppearedIDs = sortIDs(candidateIdentityIDs).filter(
    (cardID) => !remainingPileIdentityIDs.has(cardID) && !state.suspendedIdentityIDs.has(cardID)
  )

  // 对应 Phase 0 冻结基线的 appearedHiddenIdentityCards 分支：被暗摸带进玩家暗区的
  // 正 ID 暗槽（`reset()` 保留了 id，牌面未明示）不在协议牌堆内，同样要暂停追踪，
  // 并由 preserveUnknownPlaceholderForShuffle() 复制匿名占位继续承担手牌数量。
  const appearedHiddenIdentityIDs = sortIDs(state.playerHiddenPositiveIDs).filter(
    (cardID) => !remainingPileIdentityIDs.has(cardID) && !state.suspendedIdentityIDs.has(cardID)
  )

  const newlySuspendedIDs = sortIDs([...neverAppearedIDs, ...appearedHiddenIdentityIDs])
  neverAppearedIDs.forEach((cardID) => {
    state.suspendedIdentityIDs.add(cardID)
    state.locatedIdentityIDs.add(cardID)
  })
  appearedHiddenIdentityIDs.forEach((cardID) => {
    state.playerHiddenPositiveIDs.delete(cardID)
    // 匿名占位接管该手牌槽，物理槽总数不变。
    state.playerAnonSlotCount += 1
    state.suspendedIdentityIDs.add(cardID)
    state.locatedIdentityIDs.add(cardID)
  })

  // `reset()` 只隐藏牌面、保留正 ID，因此洗回的身份仍然「已定位」，
  // 下一次洗牌会被 remainingPileIdentityIDs 排除。这正是基线的收敛机制。
  const recycledIdentityIDs = [...state.discardKnownIDs]
  const recycledSlots: (CardID | null)[] = [
    ...recycledIdentityIDs,
    ...Array.from({ length: state.discardAnonSlotCount }, () => null)
  ]
  state.pileSlots = [...recycledSlots, ...state.pileSlots]
  state.discardKnownIDs = []
  state.discardAnonSlotCount = 0

  return {
    pileSlotCountBefore,
    pileSlotCountAfter: state.pileSlots.length,
    recycledIdentityIDs,
    carriedSuspendedIDs,
    newlySuspendedIDs,
    suspendedIDs: sortIDs(state.suspendedIdentityIDs),
    candidateWidth: state.suspendedIdentityIDs.size
  }
}

function applyBaselineEvent(
  state: BaselineModelState,
  event: PileGenerationEvent,
  shuffles: ShuffleObservation[]
): void {
  switch (event.type) {
    case 'initialize': {
      const cardIDs = normalizeIdentityIDs(event.cardIDs)
      state.pileSlots = cardIDs.map(() => null)
      state.identityUniverse = new Set(cardIDs)
      state.suspendedIdentityIDs = new Set()
      state.locatedIdentityIDs = new Set()
      state.everRevealedIDs = new Set()
      return
    }
    case 'drawUnknown': {
      if (event.count > state.pileSlots.length) {
        throw new Error(`暗摸张数超过牌堆物理槽：${event.count} > ${state.pileSlots.length}`)
      }
      for (let index = 0; index < event.count; index += 1) {
        moveBaselinePileTopSlotToHiddenHand(state)
      }
      return
    }
    case 'insertExternalAtRandom': {
      // 位置未知：基线只能按本地顺序追加到牌顶，这正是它的代表绑定近似来源。
      const cardIDs = normalizeIdentityIDs(event.cardIDs)
      cardIDs.forEach((cardID) => {
        state.identityUniverse.add(cardID)
        state.pileSlots.push(cardID)
        state.locatedIdentityIDs.add(cardID)
      })
      return
    }
    case 'drawAcrossShuffle': {
      if (event.count <= state.pileSlots.length) {
        throw new Error(
          `摸牌未超过牌堆剩余量，不会触发洗牌：${event.count} <= ${state.pileSlots.length}`
        )
      }

      const carriedOverSlotCount = state.pileSlots.length
      const observation = shuffleBaseline(state)
      if (observation) shuffles.push(observation)

      if (event.count > state.pileSlots.length) {
        throw new Error(`摸牌张数超过洗牌后牌堆物理槽：${event.count} > ${state.pileSlots.length}`)
      }

      for (let index = 0; index < event.count; index += 1) {
        moveBaselinePileTopSlotToHiddenHand(state)
      }

      const consumedFromRecycledCount = event.count - carriedOverSlotCount
      if (consumedFromRecycledCount < 1) {
        throw new Error('洗牌后摸牌未消费任何洗回牌，触发条件不成立')
      }
      return
    }
    case 'revealFromPile': {
      event.cardIDs.forEach((cardID) => {
        if (state.pileSlots.length <= 0) throw new Error(`牌堆无槽可消费：揭示 ${cardID}`)
        const popped = state.pileSlots.pop() ?? null

        // 协议揭示的身份与本地牌序假设不一致：物理离开的是被弹出的槽，
        // 被挤身份失去位置归因，退回未定位池。
        if (popped !== null && popped !== cardID) state.locatedIdentityIDs.delete(popped)

        // 该身份原先若在牌堆里占着一个正 ID 暗槽，那个槽现在失去身份归因。
        const previousIndex = state.pileSlots.indexOf(cardID)
        if (previousIndex >= 0) state.pileSlots[previousIndex] = null

        state.suspendedIdentityIDs.delete(cardID)
        state.locatedIdentityIDs.add(cardID)
        state.everRevealedIDs.add(cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
    case 'gainFromPile': {
      // 基线按本地牌序建模：搜牌从数组里按身份移除，找不到就按牌顶弹出近似。
      event.cardIDs.forEach((cardID) => {
        const index = state.pileSlots.indexOf(cardID)
        if (index >= 0) state.pileSlots.splice(index, 1)
        else if (state.pileSlots.length > 0) state.pileSlots.pop()
        else throw new Error(`牌堆无槽可消费：搜牌 ${cardID}`)

        state.suspendedIdentityIDs.delete(cardID)
        state.locatedIdentityIDs.add(cardID)
        state.everRevealedIDs.add(cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
    case 'gainUnknownFromPileTopRange': {
      if (event.count > state.pileSlots.length) {
        throw new Error(`牌顶范围取牌超过牌堆物理槽：${event.count} > ${state.pileSlots.length}`)
      }
      // 无 CardID：与暗摸一致，按本地牌序从牌顶消费。
      for (let index = 0; index < event.count; index += 1) {
        moveBaselinePileTopSlotToHiddenHand(state)
      }
      return
    }
    case 'revealFromHand': {
      event.cardIDs.forEach((cardID) => {
        consumeBaselineHiddenHandSlot(state, cardID)
        state.suspendedIdentityIDs.delete(cardID)
        state.locatedIdentityIDs.add(cardID)
        state.everRevealedIDs.add(cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
    case 'discardKnown': {
      event.cardIDs.forEach((cardID) => {
        if (!state.playerKnownIDs.delete(cardID)) {
          throw new Error(`弃置的明牌不在玩家已知手牌中：${cardID}`)
        }
        state.discardKnownIDs.push(cardID)
      })
      return
    }
    case 'shuffle': {
      const observation = shuffleBaseline(state)
      if (observation) shuffles.push(observation)
      return
    }
    case 'introduceExternal': {
      event.cardIDs.forEach((cardID) => {
        if (state.identityUniverse.has(cardID)) return
        state.identityUniverse.add(cardID)
        state.locatedIdentityIDs.add(cardID)
        state.everRevealedIDs.add(cardID)
        state.playerKnownIDs.add(cardID)
      })
      return
    }
  }
}

export function runBaselineLedgerModel(events: PileGenerationEvent[]): {
  state: BaselineModelState
  shuffles: ShuffleObservation[]
} {
  const state = createBaselineState()
  const shuffles: ShuffleObservation[] = []
  events.forEach((event) => applyBaselineEvent(state, event, shuffles))
  return { state, shuffles }
}

/** 基线模型的物理槽总数：应恒等于身份全集大小（§4.1）。 */
export function countBaselineSlots(state: BaselineModelState): number {
  return (
    state.pileSlots.length +
    state.playerAnonSlotCount +
    state.playerHiddenPositiveIDs.size +
    state.playerKnownIDs.size +
    state.discardKnownIDs.length +
    state.discardAnonSlotCount
  )
}

// ---------------------------------------------------------------------------
// 真实隐藏牌序 oracle（§18.6-3）
// ---------------------------------------------------------------------------

/**
 * oracle 持有服务器视角的真实牌序，两个追踪模型都看不到它。
 *
 * 它的作用是把「候选宽度」这个单一指标拆成两类可判定的错误：
 *
 * - **假阳性**：追踪器显示为未知位置候选，但该身份真实仍在牌堆。属于保守代价，
 *   只是候选更宽，不会让用户排除掉真实可能性。
 * - **假阴性**：追踪器相信该身份仍在牌堆，但它真实已经不透明地进入暗区。这是
 *   危险错误——追踪器在断言一件假事，用户不会把它列入可能性。
 *
 * 只比较候选宽度无法区分两者，这正是 §18.4 指出 §17 论证不充分的原因。
 */
export interface OracleOptions {
  /** 初始牌堆真实顺序，下标 0 是牌底，末尾是牌顶。 */
  deckOrder: CardID[]
  /**
   * 每次洗牌时弃牌堆洗回牌堆的真实顺序（下标 0 靠牌底侧）。按洗牌发生次序取用；
   * 缺省时沿用弃牌堆原顺序。必须是该次弃牌堆的一个排列。
   *
   * 真实洗牌是随机的，而追踪模型只能按本地顺序假设；显式给出该顺序既保证测试
   * 确定性，也能构造「本地代表绑定与真实牌序不一致」的场景。
   */
  recycledOrders?: CardID[][]
  /**
   * `insertExternalAtRandom` 的真实插入下标（0 = 牌底），按事件内卡牌顺序依次取用。
   * 缺省为 0（插入牌底），与「本地按牌顶追加」形成可观测差异。
   */
  randomInsertPositions?: number[]
  /**
   * `gainUnknownFromPileTopRange` 每次真实拿走的身份，按事件顺序取用。
   * 缺省取最靠牌顶的 count 张。用于构造「主视角不知道拿的是范围内哪几张」的场景。
   */
  topRangePicks?: CardID[][]
}

export interface OracleState {
  /** 下标 0 是牌底，末尾是牌顶。 */
  truePile: CardID[]
  /** 真实已进入玩家暗区、牌面未明示的身份。 */
  trueHiddenHand: Set<CardID>
  trueKnownHand: Set<CardID>
  trueDiscard: CardID[]
}

export interface OracleVerdict {
  candidateWidth: number
  /** 显示为未知位置候选，但真实仍在牌堆。 */
  falsePositiveIDs: CardID[]
  /** 相信仍在牌堆，但真实已离开牌堆进入暗区。 */
  falseNegativeIDs: CardID[]
}

export interface UnknownLocationProjectionVerdict {
  candidateWidth: number
  /** 已显示为未知位置候选，但 oracle 证明它此刻仍在牌堆。 */
  displayedStillInPileIDs: CardID[]
  /** 模型承认位置未决、UI 却未显示，且 oracle 证明它已经离开牌堆。 */
  omittedOutsidePileIDs: CardID[]
}

function drawTrueCards(state: OracleState, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const cardID = state.truePile.pop()
    if (cardID === undefined) throw new Error('oracle：真实牌堆已空，无法继续摸牌')
    state.trueHiddenHand.add(cardID)
  }
}

function recycleTrueDiscard(state: OracleState, recycledOrder: CardID[] | undefined): boolean {
  if (state.trueDiscard.length === 0) return false

  const order = recycledOrder ?? [...state.trueDiscard]
  const expected = sortIDs(state.trueDiscard)
  if (sortIDs(order).join(',') !== expected.join(',')) {
    throw new Error(
      `oracle：洗回顺序不是当前弃牌堆的排列：${sortIDs(order).join(',')} vs ${expected.join(',')}`
    )
  }

  // 与 `Room.shufflePile()` 一致：洗回批次进入牌底侧，原剩余牌堆保持在牌顶侧。
  state.truePile = [...order, ...state.truePile]
  state.trueDiscard = []
  return true
}

export function runOracle(events: PileGenerationEvent[], options: OracleOptions): OracleState {
  const state: OracleState = {
    truePile: [],
    trueHiddenHand: new Set(),
    trueKnownHand: new Set(),
    trueDiscard: []
  }
  const recycledOrders = options.recycledOrders ?? []
  let shuffleIndex = 0
  let randomInsertIndex = 0
  let topRangePickIndex = 0

  events.forEach((event) => {
    switch (event.type) {
      case 'initialize': {
        assertSameIdentitySet(options.deckOrder, event.cardIDs, 'oracle：初始牌序')
        state.truePile = [...options.deckOrder]
        return
      }
      case 'drawUnknown': {
        drawTrueCards(state, event.count)
        return
      }
      case 'insertExternalAtRandom': {
        // 真实插入位置由夹具的 randomInsertPositions 指定；缺省时插入牌底侧，
        // 以便与「本地按牌顶追加」形成可观测差异。
        const positions = options.randomInsertPositions ?? []
        event.cardIDs.forEach((cardID) => {
          const position = positions[randomInsertIndex] ?? 0
          randomInsertIndex += 1
          if (position < 0 || position > state.truePile.length) {
            throw new Error(`oracle：随机插入位置越界：${position}`)
          }
          state.truePile.splice(position, 0, cardID)
        })
        return
      }
      case 'gainFromPile': {
        // 搜牌可以从任意位置取，只要求身份确实在真实牌堆里。
        event.cardIDs.forEach((cardID) => {
          const index = state.truePile.indexOf(cardID)
          if (index < 0) throw new Error(`oracle：身份 ${cardID} 不在真实牌堆，无法搜牌获取`)
          state.truePile.splice(index, 1)
          state.trueKnownHand.add(cardID)
        })
        return
      }
      case 'gainUnknownFromPileTopRange': {
        // 真实拿走的是牌顶 rangeSize 张里的某几张；夹具用 topRangePicks 指定，
        // 缺省取最靠牌顶的 count 张。
        const picks = options.topRangePicks?.[topRangePickIndex]
        topRangePickIndex += 1

        if (picks) {
          if (picks.length !== event.count) {
            throw new Error(`oracle：牌顶范围取牌数不符：${picks.length} != ${event.count}`)
          }
          const rangeStart = Math.max(0, state.truePile.length - event.rangeSize)
          picks.forEach((cardID) => {
            const index = state.truePile.indexOf(cardID)
            if (index < rangeStart) {
              throw new Error(`oracle：身份 ${cardID} 不在牌顶 ${event.rangeSize} 张范围内`)
            }
            state.truePile.splice(index, 1)
            state.trueHiddenHand.add(cardID)
          })
          return
        }

        for (let index = 0; index < event.count; index += 1) {
          const cardID = state.truePile.pop()
          if (cardID === undefined) throw new Error('oracle：真实牌堆已空，无法从牌顶范围取牌')
          state.trueHiddenHand.add(cardID)
        }
        return
      }
      case 'drawAcrossShuffle': {
        const carriedOverSlotCount = state.truePile.length
        if (event.count <= carriedOverSlotCount) {
          throw new Error(
            `oracle：摸牌未超过牌堆剩余量，不会触发洗牌：${event.count} <= ${carriedOverSlotCount}`
          )
        }
        if (state.trueDiscard.length === 0) {
          throw new Error('oracle：弃牌堆为空，无法触发自动补牌洗牌')
        }
        recycleTrueDiscard(state, recycledOrders[shuffleIndex])
        shuffleIndex += 1
        drawTrueCards(state, event.count)
        return
      }
      case 'revealFromPile': {
        // 协议宣告这些身份来自牌堆顶；夹具必须与真实牌序一致，否则不可实现。
        const popped: CardID[] = []
        event.cardIDs.forEach(() => {
          const cardID = state.truePile.pop()
          if (cardID === undefined) throw new Error('oracle：真实牌堆已空，无法从牌堆揭示')
          popped.push(cardID)
        })

        if (sortIDs(popped).join(',') !== sortIDs(event.cardIDs).join(',')) {
          throw new Error(
            `oracle：牌堆揭示与真实牌序不符，实际弹出 ${sortIDs(popped).join(',')}，` +
              `协议宣告 ${sortIDs(event.cardIDs).join(',')}`
          )
        }
        popped.forEach((cardID) => state.trueKnownHand.add(cardID))
        return
      }
      case 'revealFromHand': {
        event.cardIDs.forEach((cardID) => {
          if (!state.trueHiddenHand.delete(cardID)) {
            throw new Error(`oracle：身份 ${cardID} 并不在真实暗区，无法从手牌揭示`)
          }
          state.trueKnownHand.add(cardID)
        })
        return
      }
      case 'discardKnown': {
        event.cardIDs.forEach((cardID) => {
          if (!state.trueKnownHand.delete(cardID)) {
            throw new Error(`oracle：身份 ${cardID} 并不在真实明牌手牌，无法弃置`)
          }
          state.trueDiscard.push(cardID)
        })
        return
      }
      case 'shuffle': {
        // 空弃牌堆 shuffle 不消费夹具提供的洗回顺序；下一次真实洗回仍使用当前索引。
        if (recycleTrueDiscard(state, recycledOrders[shuffleIndex])) shuffleIndex += 1
        return
      }
      case 'introduceExternal': {
        event.cardIDs.forEach((cardID) => state.trueKnownHand.add(cardID))
        return
      }
    }
  })

  return state
}

export function getGenerationUnresolvedIDs(state: GenerationModelState): Set<CardID> {
  return new Set([...state.activeIdentityIDs, ...state.suspendedIdentityIDs])
}

export function getBaselineBelievedInPile(state: BaselineModelState): Set<CardID> {
  const believed = new Set<CardID>(state.pileSlots.filter((slot): slot is CardID => slot !== null))
  collectUnlocated(state.identityUniverse, state.locatedIdentityIDs).forEach((cardID) => {
    if (!state.suspendedIdentityIDs.has(cardID)) believed.add(cardID)
  })
  return believed
}

export function evaluateAgainstOracle(
  displayedIDs: Iterable<CardID>,
  believedInPileIDs: Iterable<CardID>,
  oracle: OracleState
): OracleVerdict {
  const trulyInPile = new Set(oracle.truePile)
  const displayed = sortIDs(displayedIDs)

  return {
    candidateWidth: displayed.length,
    falsePositiveIDs: displayed.filter((cardID) => trulyInPile.has(cardID)),
    falseNegativeIDs: sortIDs(believedInPileIDs).filter((cardID) => !trulyInPile.has(cardID))
  }
}

export function evaluateUnknownLocationProjection(
  displayedIDs: Iterable<CardID>,
  unresolvedIDs: Iterable<CardID>,
  oracle: OracleState
): UnknownLocationProjectionVerdict {
  const trulyInPile = new Set(oracle.truePile)
  const displayed = new Set(displayedIDs)

  return {
    candidateWidth: displayed.size,
    displayedStillInPileIDs: sortIDs(displayed).filter((cardID) => trulyInPile.has(cardID)),
    omittedOutsidePileIDs: sortIDs(unresolvedIDs).filter(
      (cardID) => !displayed.has(cardID) && !trulyInPile.has(cardID)
    )
  }
}

export interface CohortProjectionVerdict {
  /** 断言「整组都在牌堆」却有身份已离开牌堆：分组投影的假阴性。 */
  brokenAllInPileIDs: CardID[]
  /** 断言「整组都不在牌堆」却有身份仍在牌堆：分组投影的假阳性。 */
  brokenNoneInPileIDs: CardID[]
  /** `partial` 组声明的在堆张数与真实不符。 */
  brokenPartialCounts: { generation: number; declared: number; actual: number }[]
}

/**
 * 用 oracle 校验分组投影的每一条结论。
 *
 * 这是分组投影能否上产品的判据：`all-in-pile` 与 `none-in-pile` 都是对用户的**确定**
 * 陈述，一旦为假就是记牌器在说谎，比候选偏宽严重得多。
 */
export function evaluateCohortProjection(
  projection: CohortProjection,
  oracle: OracleState
): CohortProjectionVerdict {
  const trulyInPile = new Set(oracle.truePile)
  const brokenAllInPileIDs: CardID[] = []
  const brokenNoneInPileIDs: CardID[] = []
  const brokenPartialCounts: { generation: number; declared: number; actual: number }[] = []

  projection.groups.forEach((group) => {
    const actual = group.cardIDs.filter((cardID) => trulyInPile.has(cardID)).length

    if (group.kind === 'all-in-pile') {
      brokenAllInPileIDs.push(...group.cardIDs.filter((cardID) => !trulyInPile.has(cardID)))
    } else if (group.kind === 'none-in-pile') {
      brokenNoneInPileIDs.push(...group.cardIDs.filter((cardID) => trulyInPile.has(cardID)))
    }

    if (actual !== group.remainingPileCount) {
      brokenPartialCounts.push({
        generation: group.generation,
        declared: group.remainingPileCount,
        actual
      })
    }
  })

  return {
    brokenAllInPileIDs: sortIDs(brokenAllInPileIDs),
    brokenNoneInPileIDs: sortIDs(brokenNoneInPileIDs),
    brokenPartialCounts
  }
}
