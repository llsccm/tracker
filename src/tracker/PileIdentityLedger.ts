import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from './candidate/cardPositions'
import type { CardID, PublicPosition } from './types'

export type PileIdentityCohortKind = 'all-in-pile' | 'none-in-pile' | 'partial'

/**
 * cohort 只表达集合级基数事实，不把某个 CardID 绑定到某个匿名物理槽。
 * 例如候选集合有 5 张、remainingPileCount 为 4，只能断言其中恰有 4 张仍在牌堆。
 */
export interface PileIdentityCohort {
  /** 弃牌洗回时递增；同一 generation 的身份来自同一次牌堆世代。 */
  generation: number
  /** 尚未被协议定位、仍参与该集合陈述的真实身份。 */
  candidateIdentityIDs: Set<CardID>
  /** 候选集合中仍在牌堆暗槽里的身份数量。 */
  remainingPileCount: number
}

export interface PileIdentityCohortProjectionGroup {
  generation: number
  kind: PileIdentityCohortKind
  cardIDs: CardID[]
  remainingPileCount: number
}

export interface PileIdentityCohortSnapshot {
  generation: number
  groups: PileIdentityCohortProjectionGroup[]
  definitelyInPileIDs: CardID[]
  definitelyOutsidePileIDs: CardID[]
  flatCandidateWidth: number
}

/** 供 Room、测试与诊断逻辑消费的只读投影。 */
export interface PileIdentityLedgerSnapshot {
  revision: number
  identityUniverseIDs: CardID[]
  locatedIdentityIDs: CardID[]
  knownPileIdentityIDs: CardID[]
  knownDiscardIdentityIDs: CardID[]
  hiddenPileSlotCount: number
  accountedPileCount: number
  cohort: PileIdentityCohortSnapshot
}

export interface PileIdentityLedgerMove {
  eventType: string
  fromZone: number | null
  toZone: number | null
  cardIDs: readonly CardID[]
  cardCount: number
  pileCountBefore?: number
  anonymousPileConsumptionCount?: number
  knownPileIdentityIDsConsumed?: readonly CardID[]
  visiblePileIdentityIDsAfter?: readonly CardID[]
  fromPosition?: PublicPosition
  toPosition?: PublicPosition
  moveType?: number | string | null
  spellID?: number | string | null
  /** 洗牌事务开始前的物理弃牌张数；未提供时兼容读取上一条账本观测。 */
  discardCountBefore?: number
  /** 洗牌前弃牌区可确认的身份；用于直接 Room 调用补齐尚未双写的测试事实。 */
  knownDiscardIdentityIDsBefore?: readonly CardID[]
  /** 弃牌堆中只知道集合与洗回数量的局部模糊组。 */
  ambiguousDiscardRecycleGroups?: readonly AmbiguousDiscardRecycleGroup[]
  pileCountAfter: number
  discardCountAfter: number
}

export interface AmbiguousDiscardRecycleGroup {
  candidateIdentityIDs: readonly CardID[]
  recycledCount: number
}

/** 账本完成洗牌事件后交给 Room 的世代过渡事实。 */
export interface PileIdentityShuffleTransition {
  closesGeneration: boolean
  discardCountBefore: number
  expiringIdentityIDs: CardID[]
  recycledIdentityIDs: CardID[]
  ambiguousDiscardRecycleGroups: AmbiguousDiscardRecycleGroup[]
}

export interface PileIdentityLedgerMoveResult {
  committed: boolean
  shuffleTransition?: PileIdentityShuffleTransition
}

/**
 * 明牌同步完成后，身份相对于牌堆账本的确定位置。
 *
 * `discard` 必须与 `outside` 分开：两者都不再属于牌堆 cohort，但只有前者会在下一次
 * 弃牌洗回时参与已知身份统计；`outside` 仅表示已有实体证明确实离开了牌堆和弃牌堆。
 */
export type PileIdentityRevealLocation = 'pile' | 'discard' | 'outside'

export interface PileIdentityLedgerReveal {
  cardIDs: readonly CardID[]
  location: PileIdentityRevealLocation
  pileCountAfter: number
  discardCountAfter: number
}

export interface PileIdentityConsistencyIssue {
  context: string
  reason: string
  expected?: number
  actual?: number
  cardID?: CardID
}

/**
 * Room 身份分区的只读切片，用于验证 cohort 身份仍由未定位池或 suspended 展示实体承载。
 *
 * ledger 只维护身份集合与牌堆基数，不持有 Card；因此跨越“身份账本 / 物理实体”边界的
 * 目标态断言必须由 Room 在一次协议事务完成后显式传入，而不能在 ledger 内部猜测。
 */
export interface PileIdentityRoomPartition {
  deckIdentityIDs: ReadonlySet<CardID>
  unlocatedIdentityIDs: ReadonlySet<CardID>
  suspendedIdentityIDs: ReadonlySet<CardID>
}

export type PileIdentityLedgerWarningHandler = (
  message: string,
  detail: Record<string, unknown>
) => void

export interface PileIdentityLedgerOptions {
  onWarning?: PileIdentityLedgerWarningHandler
}

/** commit() 的回滚快照；所有可变集合必须深拷贝。 */
interface PileIdentityLedgerState {
  revision: number
  generation: number
  identityUniverse: Set<CardID>
  locatedIdentityIDs: Set<CardID>
  knownPileIdentityIDs: Set<CardID>
  knownDiscardIdentityIDs: Set<CardID>
  previousDiscardCount: number
  cohorts: PileIdentityCohort[]
}

function normalizeIDs(cardIDs: readonly CardID[]): CardID[] {
  return Array.from(new Set(cardIDs.map(Number).filter((cardID) => cardID > 0))).sort(
    (left, right) => left - right
  )
}

function normalizeCount(count: number): number {
  const normalized = Math.floor(Number(count))
  return Number.isFinite(normalized) ? Math.max(0, normalized) : 0
}

/**
 * 判断一次 2 -> 9 洗牌通知是否只是开局牌堆初始化。
 *
 * 实测协议存在两种等价形态：本地弃牌堆为空，或整副牌先暂存在弃牌堆。后者必须与普通
 * 弃牌洗回区分，否则初始卡池会在开局即被错误关闭世代并投影为 suspended 身份。
 */
export function isInitialPileShuffle(discardCount: number, deckCardCount: number): boolean {
  const normalizedDiscardCount = normalizeCount(discardCount)
  const normalizedDeckCardCount = normalizeCount(deckCardCount)
  return (
    normalizedDiscardCount === 0 ||
    (normalizedDeckCardCount > 0 && normalizedDiscardCount === normalizedDeckCardCount)
  )
}

function cloneCohort(cohort: PileIdentityCohort): PileIdentityCohort {
  return {
    generation: cohort.generation,
    candidateIdentityIDs: new Set(cohort.candidateIdentityIDs),
    remainingPileCount: cohort.remainingPileCount
  }
}

/**
 * 牌堆身份账本维护“哪些真实身份仍未决”以及“每组中有几张仍在牌堆”。
 *
 * Room/Zone 负责匿名实体的数量、顺序和移动；本类不持有 Card 实体，也不尝试建立
 * CardID 与匿名槽的一一映射。协议无法证明批次边界时，账本宁可合并 cohort，也不沿用
 * 本地代表顺序制造精确信息。
 */
export class PileIdentityLedger {
  private revision = 0
  // 每次弃牌洗回递增，用于保留仍可证明的牌底到牌顶批次顺序。
  private generation = 0
  // 本局见过的全部合法真实身份；降级时从这里补回仍未定位的候选。
  private identityUniverse = new Set<CardID>()
  // 已被协议定位到具体实体/区域的身份，knownPileIdentityIDs 也属于这一集合。
  private locatedIdentityIDs = new Set<CardID>()
  // 协议明确仍在牌堆且身份可见的牌，例如已知牌顶或牌底。
  private knownPileIdentityIDs = new Set<CardID>()
  // 弃牌区内身份明确的牌，洗牌时会形成新 generation 的牌底 cohort。
  private knownDiscardIdentityIDs = new Set<CardID>()
  // 用于识别弃牌堆中无法枚举 CardID 的匿名槽；只保存最近一次协议计数。
  private previousDiscardCount = 0
  // 数组顺序为牌底到牌顶；只有边界仍可证明时该顺序才有消费意义。
  private cohorts: PileIdentityCohort[] = []
  private readonly onWarning: PileIdentityLedgerWarningHandler

  constructor({ onWarning = () => undefined }: PileIdentityLedgerOptions = {}) {
    this.onWarning = onWarning
  }

  initialize(cardIDs: readonly CardID[]): void {
    const identities = normalizeIDs(cardIDs)
    this.revision += 1
    this.generation = 0
    this.identityUniverse = new Set(identities)
    this.locatedIdentityIDs.clear()
    this.knownPileIdentityIDs.clear()
    this.knownDiscardIdentityIDs.clear()
    this.previousDiscardCount = 0
    this.cohorts =
      identities.length === 0
        ? []
        : [
            {
              generation: 0,
              candidateIdentityIDs: new Set(identities),
              remainingPileCount: identities.length
            }
          ]

    this.warnForIssues(this.collectConsistencyIssues(identities.length, 'initialize'))
  }

  registerAmbiguousOutsideGroup(cardIDs: readonly CardID[]): void {
    const identities = normalizeIDs(cardIDs)
    if (identities.length === 0) return

    this.commit('register:ambiguousOutsideGroup', () => {
      identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
      this.cohorts.push({
        generation: this.generation,
        candidateIdentityIDs: new Set(identities),
        remainingPileCount: 0
      })
    })
  }

  applyMove(move: PileIdentityLedgerMove): PileIdentityLedgerMoveResult {
    let shuffleTransition: PileIdentityShuffleTransition | undefined
    const committed = this.commit(`move:${move.eventType}`, () => {
      const cardIDs = normalizeIDs(move.cardIDs)
      const knownCount = cardIDs.length
      const protocolUnknownCount = Math.max(0, normalizeCount(move.cardCount) - knownCount)
      // 常规摸牌的 CardIDs 可能为空，但 Room 已精确移走可见牌顶；Controller 用该字段把
      // 已知边界身份从账本中同步消费，剩余数量才按匿名槽处理。
      const knownPileIdentityIDsConsumed =
        move.fromZone === 1 && cardIDs.length === 0
          ? normalizeIDs(move.knownPileIdentityIDsConsumed ?? [])
          : []
      const maxAnonymousPileConsumptionCount = Math.max(
        0,
        protocolUnknownCount - knownPileIdentityIDsConsumed.length
      )
      const anonymousPileConsumptionCount =
        move.fromZone === 1 && cardIDs.length === 0
          ? Math.min(
              maxAnonymousPileConsumptionCount,
              normalizeCount(move.anonymousPileConsumptionCount ?? maxAnonymousPileConsumptionCount)
            )
          : protocolUnknownCount

      if (move.eventType === 'noop') {
        this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
        this.previousDiscardCount = normalizeCount(move.discardCountAfter)
        return
      }

      if (move.eventType === 'shuffleDiscardIntoPile') {
        shuffleTransition = this.createShuffleTransition(move)
        this.applyShuffleInternal(move.pileCountAfter, shuffleTransition)
        this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
        this.reconcilePileCountInternal(move.pileCountAfter)
        this.previousDiscardCount = normalizeCount(move.discardCountAfter)
        return
      }

      const staysInPile = move.fromZone === 1 && move.toZone === 1
      if (staysInPile) {
        // 同区展示只把身份从未决 cohort 提升为已知牌堆身份，不消费物理牌堆数量。
        cardIDs.forEach((cardID) => this.revealIdentityInPileInternal(cardID))
        this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
        this.reconcilePileCountInternal(move.pileCountAfter)
        this.previousDiscardCount = normalizeCount(move.discardCountAfter)
        return
      }

      if (move.fromZone === 1) {
        cardIDs.forEach((cardID) => this.revealIdentityFromPileInternal(cardID))
        knownPileIdentityIDsConsumed.forEach((cardID) =>
          this.revealIdentityFromPileInternal(cardID)
        )
        if (anonymousPileConsumptionCount > 0) {
          const isTopRangeGain =
            Number(move.moveType) === 18 &&
            Number(move.spellID) === 7011 &&
            move.fromPosition !== POSITION_RANDOM
          if (isTopRangeGain) {
            this.consumeAnonymousTopRangeInternal(anonymousPileConsumptionCount)
          } else if (Number(move.moveType) === 18) {
            // 无 CardIDs 的“获得”只消费匿名物理槽。牌堆中已经公开的身份无论位于顶、底
            // 或中间都继续保持 knownPileIdentityIDs；若其中某张之后在牌堆外明确展示，
            // 再由那条携带 CardID 的协议移出已知牌堆集合并对账暗槽基数。
            this.consumeAnonymousInternal(anonymousPileConsumptionCount, POSITION_RANDOM)
          } else {
            this.consumeAnonymousInternal(anonymousPileConsumptionCount, move.fromPosition)
          }
        }
      } else if (move.toZone === 1) {
        if (cardIDs.length > 0) {
          // RANDOM 入堆会落入未知批次内部；即使本地 Zone 暂时追加到一端，也不能沿用该顺序。
          const randomInsertion =
            move.toPosition === POSITION_RANDOM ||
            (move.fromZone === 0 && Number(move.spellID) === 3694) ||
            cardIDs.some((cardID) => cardID === 4400 || cardID === 4401)

          this.insertKnownInternal(
            cardIDs,
            cardIDs.length,
            randomInsertion ? POSITION_RANDOM : move.toPosition
          )
        }

        if (protocolUnknownCount > 0) {
          // 匿名回堆只增加物理数量，无法证明具体身份或插入边界，统一退化为单 cohort。
          this.degradeToSingleCohortInternal(move.pileCountAfter)
        }
      } else {
        cardIDs.forEach((cardID) => this.revealIdentityOutsidePileInternal(cardID))
      }

      if (move.fromZone === 2) {
        cardIDs.forEach((cardID) => this.knownDiscardIdentityIDs.delete(cardID))
      }
      if (move.toZone === 2) {
        cardIDs.forEach((cardID) => this.knownDiscardIdentityIDs.add(cardID))
      }

      this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
      this.reconcilePileCountInternal(move.pileCountAfter)
      this.previousDiscardCount = normalizeCount(move.discardCountAfter)
    })

    this.warnForIssues(this.collectConsistencyIssues(move.pileCountAfter, `move:${move.eventType}`))
    return committed && shuffleTransition ? { committed, shuffleTransition } : { committed }
  }

  applyReveal(reveal: PileIdentityLedgerReveal): void {
    this.commit(`reveal:${reveal.location}`, () => {
      normalizeIDs(reveal.cardIDs).forEach((cardID) => {
        if (reveal.location === 'pile') {
          // 牌堆内揭示只把身份从匿名 cohort 提升为已知牌堆身份，不改变物理牌堆数量。
          this.revealIdentityInPileInternal(cardID)
          return
        }

        // discard / outside 都已离开牌堆候选集合；差别只在是否仍是可枚举的弃牌身份。
        this.revealIdentityOutsidePileInternal(cardID)
        if (reveal.location === 'discard') {
          this.knownDiscardIdentityIDs.add(cardID)
          return
        }

        // 只有实体位置明确落在 pile、discard 之外时，才有证据撤销已知弃牌身份。
        this.knownDiscardIdentityIDs.delete(cardID)
      })
      this.reconcilePileCountInternal(reveal.pileCountAfter)
      this.previousDiscardCount = normalizeCount(reveal.discardCountAfter)
    })

    this.warnForIssues(
      this.collectConsistencyIssues(reveal.pileCountAfter, `reveal:${reveal.location}`)
    )
  }

  consumeAnonymous(count: number, position: PublicPosition, reason: string): void {
    this.commit(reason, () => this.consumeAnonymousInternal(count, position))
  }

  revealIdentity(
    cardID: CardID,
    source: 'pile' | 'outside',
    reason: string,
    staysInPile = false
  ): void {
    this.commit(reason, () => {
      if (source === 'pile' && staysInPile) this.revealIdentityInPileInternal(cardID)
      else if (source === 'pile') this.revealIdentityFromPileInternal(cardID)
      else this.revealIdentityOutsidePileInternal(cardID)
    })
  }

  insertKnown(
    cardIDs: readonly CardID[],
    count: number,
    position: PublicPosition,
    reason: string
  ): void {
    this.commit(reason, () => this.insertKnownInternal(cardIDs, count, position))
  }

  insertAnonymous(count: number, position: PublicPosition, reason: string): void {
    this.commit(reason, () => this.insertAnonymousInternal(count, position))
  }

  mergeAll(reason: string): void {
    this.commit(reason, () => {
      this.mergeAllCohortsInternal()
    })
  }

  rotateFromDiscard(cardIDs: readonly CardID[], reason: string): void {
    this.commit(reason, () => this.rotateFromDiscardInternal(cardIDs))
  }

  /**
   * 检查账本内部基数，并在 Room 提供身份分区时启用最终目标态断言。
   *
   * cohort 身份有两种合法的 Room 表达：未物化身份留在 `unlocatedIdentities`；旧世代失效
   * 后，为了继续向用户展示而创建的身份则进入 `suspendedKnownCards`。suspended 实体只有
   * 展示身份，没有物理位置，牌堆基数与集合归属仍以本 ledger 为权威。
   *
   * 该断言必须放在 Room 物理移动和 ledger 事件都完成之后运行，事务中途的短暂状态不参与
   * 判断。
   */
  assertConsistency(
    pileCount: number,
    context: string,
    roomPartition?: PileIdentityRoomPartition
  ): PileIdentityConsistencyIssue[] {
    const issues = this.collectConsistencyIssues(pileCount, context, roomPartition)
    this.warnForIssues(issues)
    return issues
  }

  getSnapshot(): PileIdentityLedgerSnapshot {
    const cohort = this.projectCohorts()
    return {
      revision: this.revision,
      identityUniverseIDs: normalizeIDs(Array.from(this.identityUniverse)),
      locatedIdentityIDs: normalizeIDs(Array.from(this.locatedIdentityIDs)),
      knownPileIdentityIDs: normalizeIDs(Array.from(this.knownPileIdentityIDs)),
      knownDiscardIdentityIDs: normalizeIDs(Array.from(this.knownDiscardIdentityIDs)),
      hiddenPileSlotCount: this.getHiddenPileSlotCount(),
      accountedPileCount: this.getAccountedPileCount(),
      cohort
    }
  }

  getUnresolvedIdentityIDs(): CardID[] {
    // remainingPileCount 为 0 的 cohort 仍然有价值：它表示这些身份确定不在牌堆，但尚未
    // 展示到具体区域。实际洗牌会用本快照关闭旧世代：暗实体先退回匿名物理槽，身份本身
    // 转入 suspended 展示，等待后续协议再次明确出现。
    const identityIDs = new Set<CardID>()
    this.cohorts.forEach((cohort) => {
      cohort.candidateIdentityIDs.forEach((cardID) => identityIDs.add(cardID))
    })
    return normalizeIDs(Array.from(identityIDs))
  }

  private createShuffleTransition(move: PileIdentityLedgerMove): PileIdentityShuffleTransition {
    const discardCountBefore = normalizeCount(move.discardCountBefore ?? this.previousDiscardCount)
    const recycledIdentityIDs = normalizeIDs([
      ...this.knownDiscardIdentityIDs,
      ...(move.knownDiscardIdentityIDsBefore ?? [])
    ])
    const closesGeneration = !isInitialPileShuffle(discardCountBefore, this.identityUniverse.size)
    const ambiguousDiscardRecycleGroups = (move.ambiguousDiscardRecycleGroups ?? [])
      .map((group) => ({
        candidateIdentityIDs: normalizeIDs(group.candidateIdentityIDs),
        recycledCount: Math.min(
          normalizeCount(group.recycledCount),
          normalizeIDs(group.candidateIdentityIDs).length
        )
      }))
      .filter(
        (group) => group.candidateIdentityIDs.length > 0 && group.recycledCount > 0
      )
    const ambiguousIdentityIDs = new Set(
      ambiguousDiscardRecycleGroups.flatMap((group) => group.candidateIdentityIDs)
    )

    return {
      closesGeneration,
      discardCountBefore,
      // 先冻结旧 cohort，再由同一事务滚动账本；Room 只能消费提交成功后的这份结果。
      expiringIdentityIDs: closesGeneration
        ? this.getUnresolvedIdentityIDs().filter((cardID) => !ambiguousIdentityIDs.has(cardID))
        : [],
      recycledIdentityIDs,
      ambiguousDiscardRecycleGroups
    }
  }

  private applyShuffleInternal(
    pileCountAfter: number,
    transition: PileIdentityShuffleTransition
  ): void {
    const discardCountBefore = transition.discardCountBefore
    const recycledIdentityIDs = transition.recycledIdentityIDs
    const ambiguousDiscardRecycleGroups = transition.ambiguousDiscardRecycleGroups
    const ambiguousRecycledCount = ambiguousDiscardRecycleGroups.reduce(
      (total, group) => total + normalizeCount(group.recycledCount),
      0
    )
    // 协议只给弃牌总数；减去已知弃牌身份后，剩余部分是无法建立新精确 cohort 的匿名弃牌。
    const anonymousDiscardCount = Math.max(
      0,
      discardCountBefore - recycledIdentityIDs.length - ambiguousRecycledCount
    )

    if (!transition.closesGeneration) {
      if (discardCountBefore > 0) {
        // “整副牌暂存在弃牌堆”只是初始化载体差异，不代表 generation 0 已结束。已知弃牌
        // 身份先退回未决集合，匿名弃牌则由 reconcile 恢复完整牌堆基数；两者最终仍属于
        // 当前 generation，而不会建立新的牌底批次。
        recycledIdentityIDs.forEach((cardID) => this.prepareIdentityForPile(cardID))
        ambiguousDiscardRecycleGroups.forEach((group) => {
          const identities = normalizeIDs(group.candidateIdentityIDs)
          identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
          if (identities.length === 0) return
          this.cohorts.push({
            generation: this.generation,
            candidateIdentityIDs: new Set(identities),
            remainingPileCount: Math.min(normalizeCount(group.recycledCount), identities.length)
          })
        })
        this.knownDiscardIdentityIDs.clear()
      }
      this.reconcilePileCountInternal(pileCountAfter)
      return
    }

    this.rotateFromDiscardInternal(recycledIdentityIDs)
    ambiguousDiscardRecycleGroups.forEach((group) => {
      const identities = normalizeIDs(group.candidateIdentityIDs)
      identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
      if (identities.length === 0) return
      this.cohorts.unshift({
        generation: this.generation,
        candidateIdentityIDs: new Set(identities),
        remainingPileCount: Math.min(normalizeCount(group.recycledCount), identities.length)
      })
    })
    this.knownDiscardIdentityIDs.clear()

    if (anonymousDiscardCount > 0) {
      // 匿名弃牌洗回后无法区分新旧世代边界，只保留“总共有多少暗身份在牌堆”。
      // 这是协议信息不足造成的正常降级；后续仍由物理牌堆张数核对，不作为账本异常告警。
      this.degradeToSingleCohortInternal(pileCountAfter)
      return
    }

    this.reconcilePileCountInternal(pileCountAfter)
  }

  private consumeAnonymousInternal(count: number, position?: PublicPosition): void {
    const normalizedCount = normalizeCount(count)
    if (normalizedCount === 0) return

    if (position === POSITION_RANDOM) {
      // 任意位置消费无法确定命中了哪个连续批次，先合并再只扣总基数。
      this.degradeToSingleCohortInternal(
        Math.max(0, this.getAccountedPileCount() - normalizedCount)
      )
      return
    }

    let remaining = normalizedCount
    // cohort 按牌底到牌顶存储：底摸正序消费，默认牌顶摸倒序消费。
    const indexes =
      position === POSITION_BOTTOM
        ? Array.from({ length: this.cohorts.length }, (_, index) => index)
        : Array.from({ length: this.cohorts.length }, (_, index) => this.cohorts.length - 1 - index)

    for (const index of indexes) {
      if (remaining === 0) break
      const cohort = this.cohorts[index]
      const consumed = Math.min(cohort.remainingPileCount, remaining)
      cohort.remainingPileCount -= consumed
      remaining -= consumed
    }

    if (remaining > 0) {
      this.degradeToSingleCohortInternal(Math.max(0, this.getAccountedPileCount() - remaining))
      this.warn('unexplained-pile-consumption', {
        requestedCount: normalizedCount,
        unaccountedCount: remaining
      })
    }
  }

  private consumeAnonymousTopRangeInternal(count: number): void {
    const activeCohortCount = this.cohorts.filter((cohort) => cohort.remainingPileCount > 0).length
    if (activeCohortCount > 1) {
      // 协议只说明“牌顶范围内获得”，未提供范围宽度；多个活动批次时无法证明范围未跨界。
      this.degradeToSingleCohortInternal(this.getAccountedPileCount())
    }
    this.consumeAnonymousInternal(count, POSITION_TOP)
  }

  private revealIdentityFromPileInternal(cardID: CardID): void {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return

    this.identityUniverse.add(normalizedCardID)
    this.locatedIdentityIDs.add(normalizedCardID)

    if (this.knownPileIdentityIDs.delete(normalizedCardID)) return
    const cohort = this.findIdentityCohort(normalizedCardID)
    if (!cohort) {
      this.warn('revealed-pile-identity-without-cohort', { cardID: normalizedCardID })
      return
    }

    // 身份明确从牌堆离开：候选集合与“仍在牌堆数量”必须同时减少。
    if (cohort.remainingPileCount <= 0) {
      this.warn('revealed-pile-identity-from-empty-cohort', { cardID: normalizedCardID })
    } else {
      cohort.remainingPileCount -= 1
    }
    cohort.candidateIdentityIDs.delete(normalizedCardID)
    this.removeEmptyCohorts()
  }

  private revealIdentityOutsidePileInternal(cardID: CardID): void {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return

    this.identityUniverse.add(normalizedCardID)
    this.locatedIdentityIDs.add(normalizedCardID)

    if (this.knownPileIdentityIDs.delete(normalizedCardID)) return
    const cohort = this.findIdentityCohort(normalizedCardID)
    if (!cohort) return

    // partial cohort 中某个身份在牌堆外现身，只能删除该候选，不能断言在堆名额减少。
    // 只有 all-in-pile 陈述被证伪时，才同步修正 remainingPileCount 并发出诊断。
    if (cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
      cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1)
      this.warn('outside-reveal-from-all-in-cohort', { cardID: normalizedCardID })
    }
    cohort.candidateIdentityIDs.delete(normalizedCardID)
    this.removeEmptyCohorts()
  }

  private revealIdentityInPileInternal(cardID: CardID): void {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0) || this.knownPileIdentityIDs.has(normalizedCardID)) return

    this.identityUniverse.add(normalizedCardID)
    this.locatedIdentityIDs.add(normalizedCardID)

    const cohort = this.findIdentityCohort(normalizedCardID)
    if (cohort) {
      // 从集合级暗身份提升为精确牌堆身份，总牌堆计数不变：cohort 基数减一，known 加一。
      if (cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1
      else this.warn('pile-reveal-from-empty-cohort', { cardID: normalizedCardID })
      cohort.candidateIdentityIDs.delete(normalizedCardID)
      this.removeEmptyCohorts()
    }
    this.knownPileIdentityIDs.add(normalizedCardID)
  }

  private confirmVisiblePileIdentitiesInternal(cardIDs: readonly CardID[] | undefined): void {
    normalizeIDs(cardIDs ?? []).forEach((cardID) => this.revealIdentityInPileInternal(cardID))
  }

  private insertKnownInternal(
    cardIDs: readonly CardID[],
    count: number,
    position?: PublicPosition
  ): void {
    const identities = normalizeIDs(cardIDs)
    if (identities.length === 0) {
      this.insertAnonymousInternal(count, position)
      return
    }

    if (position === POSITION_RANDOM) {
      // 随机混入后只能确认身份属于牌堆，不能继续把本地实体位置当成协议事实。此类路径
      // （例如手气卡、回魂牌）由 Room 同步匿名化实体，因此身份仍进入未定位 cohort；同时
      // 随机落点会破坏所有既有暗槽批次边界。
      identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
      const merged = this.mergeAllCohortsInternal()
      identities.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
      merged.remainingPileCount += identities.length
    } else {
      identities.forEach((cardID) => this.prepareIdentityForPile(cardID))

      // 已知牌精确置于牌顶/牌底时继续由 Room 中的正 ID 实体承载；ledger 以
      // knownPileIdentityIDs 记录其牌堆归属。端点顺序由物理 Zone 保存，常规摸牌会按实际
      // 实体精确消费，无需创建与 Room 身份分区冲突的 singleton cohort。
      identities.forEach((cardID) => this.revealIdentityInPileInternal(cardID))
    }

    const anonymousCount = Math.max(0, normalizeCount(count) - identities.length)
    if (anonymousCount > 0) this.insertAnonymousInternal(anonymousCount, position)
  }

  private insertAnonymousInternal(count: number, _position?: PublicPosition): void {
    const normalizedCount = normalizeCount(count)
    if (normalizedCount === 0) return

    // 匿名插入无法指认回堆身份；合并边界后，从身份全集补齐所有仍未定位的可能身份。
    const merged = this.mergeAllCohortsInternal()
    this.addUnresolvedUniverseToCohort(merged)
    const targetCount = merged.remainingPileCount + normalizedCount
    merged.remainingPileCount = Math.min(targetCount, merged.candidateIdentityIDs.size)
    if (targetCount > merged.candidateIdentityIDs.size) {
      this.warn('anonymous-pile-insertion-capacity-shortage', {
        targetCount,
        candidateCount: merged.candidateIdentityIDs.size
      })
    }
  }

  private prepareIdentityForPile(cardID: CardID): void {
    this.identityUniverse.add(cardID)
    this.locatedIdentityIDs.delete(cardID)
    this.knownDiscardIdentityIDs.delete(cardID)
    this.knownPileIdentityIDs.delete(cardID)
    this.removeIdentityFromCohorts(cardID, false)
  }

  private rotateFromDiscardInternal(cardIDs: readonly CardID[]): void {
    const identities = normalizeIDs(cardIDs)
    identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
    this.generation += 1
    if (identities.length > 0) {
      // 洗回弃牌位于剩余牌堆下方，因此新 generation 插入数组牌底端。
      this.cohorts.unshift({
        generation: this.generation,
        candidateIdentityIDs: new Set(identities),
        remainingPileCount: identities.length
      })
    }
  }

  private reconcilePileCountInternal(pileCountAfter: number): void {
    const targetPileCount = normalizeCount(pileCountAfter)
    const targetHiddenCount = Math.max(0, targetPileCount - this.knownPileIdentityIDs.size)
    if (targetHiddenCount === this.getHiddenPileSlotCount()) return
    // 协议物理张数优先；出现差异时丢弃批次边界，但不丢弃身份全集。
    this.degradeToSingleCohortInternal(targetPileCount)
  }

  private degradeToSingleCohortInternal(pileCountAfter: number): void {
    const merged = this.mergeAllCohortsInternal()
    this.addUnresolvedUniverseToCohort(merged)

    const targetHiddenCount = Math.max(
      0,
      normalizeCount(pileCountAfter) - this.knownPileIdentityIDs.size
    )
    merged.remainingPileCount = Math.min(targetHiddenCount, merged.candidateIdentityIDs.size)
    if (targetHiddenCount > merged.candidateIdentityIDs.size) {
      this.warn('pile-identity-capacity-shortage', {
        targetHiddenCount,
        candidateCount: merged.candidateIdentityIDs.size
      })
    }
  }

  private addUnresolvedUniverseToCohort(cohort: PileIdentityCohort): void {
    // “未决”包含 remainingPileCount 为 0 的 cohort 成员；只排除已有具体位置或已知在堆身份。
    this.identityUniverse.forEach((cardID) => {
      if (this.locatedIdentityIDs.has(cardID) || this.knownPileIdentityIDs.has(cardID)) return
      cohort.candidateIdentityIDs.add(cardID)
    })
  }

  private mergeAllCohortsInternal(): PileIdentityCohort {
    // 合并只丢失批次边界，候选身份并集与在堆名额总和必须保持守恒。
    const merged: PileIdentityCohort = {
      generation: this.generation,
      candidateIdentityIDs: new Set(),
      remainingPileCount: 0
    }
    this.cohorts.forEach((cohort) => {
      cohort.candidateIdentityIDs.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
      merged.remainingPileCount += cohort.remainingPileCount
    })
    this.cohorts = [merged]
    return merged
  }

  private removeIdentityFromCohorts(cardID: CardID, wasInPile: boolean): void {
    const cohort = this.findIdentityCohort(cardID)
    if (!cohort) return
    // 精确从牌堆取走会减少名额；从牌堆外定位仅在原陈述为 all-in-pile 时修正名额。
    if (wasInPile && cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1
    if (!wasInPile && cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
      cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1)
    }
    cohort.candidateIdentityIDs.delete(cardID)
    this.removeEmptyCohorts()
  }

  private findIdentityCohort(cardID: CardID): PileIdentityCohort | undefined {
    return this.cohorts.find((cohort) => cohort.candidateIdentityIDs.has(cardID))
  }

  private removeEmptyCohorts(): void {
    this.cohorts = this.cohorts.filter((cohort) => cohort.candidateIdentityIDs.size > 0)
  }

  private getHiddenPileSlotCount(): number {
    return this.cohorts.reduce((sum, cohort) => sum + cohort.remainingPileCount, 0)
  }

  private getAccountedPileCount(): number {
    return this.knownPileIdentityIDs.size + this.getHiddenPileSlotCount()
  }

  private projectCohorts(): PileIdentityCohortSnapshot {
    const groups: PileIdentityCohortProjectionGroup[] = []
    const definitelyInPileIDs = new Set<CardID>(this.knownPileIdentityIDs)
    const definitelyOutsidePileIDs = new Set<CardID>()
    let flatCandidateWidth = 0

    this.cohorts.forEach((cohort) => {
      const cardIDs = normalizeIDs(Array.from(cohort.candidateIdentityIDs))
      if (cardIDs.length === 0) return

      const kind: PileIdentityCohortKind =
        cohort.remainingPileCount === 0
          ? 'none-in-pile'
          : cohort.remainingPileCount === cardIDs.length
            ? 'all-in-pile'
            : 'partial'
      groups.push({
        generation: cohort.generation,
        kind,
        cardIDs,
        remainingPileCount: cohort.remainingPileCount
      })

      if (kind === 'all-in-pile') {
        cardIDs.forEach((cardID) => definitelyInPileIDs.add(cardID))
        return
      }
      if (kind === 'none-in-pile') {
        cardIDs.forEach((cardID) => definitelyOutsidePileIDs.add(cardID))
        return
      }

      // 扁平候选宽度只统计 partial 组；确定在堆/堆外的组无需逐卡作为“可能”展示。
      flatCandidateWidth += cardIDs.length
    })

    return {
      generation: this.generation,
      groups,
      definitelyInPileIDs: normalizeIDs(Array.from(definitelyInPileIDs)),
      definitelyOutsidePileIDs: normalizeIDs(Array.from(definitelyOutsidePileIDs)),
      flatCandidateWidth
    }
  }

  private collectConsistencyIssues(
    pileCount: number,
    context: string,
    roomPartition?: PileIdentityRoomPartition
  ): PileIdentityConsistencyIssue[] {
    const issues: PileIdentityConsistencyIssue[] = []
    const seen = new Set<CardID>()

    // cohort 身份必须互斥，且不能同时出现在任何精确位置集合中。
    this.cohorts.forEach((cohort) => {
      if (
        cohort.remainingPileCount < 0 ||
        cohort.remainingPileCount > cohort.candidateIdentityIDs.size
      ) {
        issues.push({
          context,
          reason: 'cohort-cardinality-out-of-range',
          expected: cohort.candidateIdentityIDs.size,
          actual: cohort.remainingPileCount
        })
      }

      cohort.candidateIdentityIDs.forEach((cardID) => {
        if (seen.has(cardID)) issues.push({ context, reason: 'duplicate-cohort-identity', cardID })
        if (!this.identityUniverse.has(cardID)) {
          issues.push({ context, reason: 'cohort-identity-missing-from-universe', cardID })
        }
        if (this.locatedIdentityIDs.has(cardID)) {
          issues.push({ context, reason: 'located-identity-in-cohort', cardID })
        }
        if (this.knownPileIdentityIDs.has(cardID)) {
          issues.push({ context, reason: 'known-pile-identity-in-cohort', cardID })
        }
        if (roomPartition && !roomPartition.deckIdentityIDs.has(cardID)) {
          issues.push({ context, reason: 'cohort-identity-missing-from-room-universe', cardID })
        }
        if (roomPartition) {
          const isUnlocated = roomPartition.unlocatedIdentityIDs.has(cardID)
          const isSuspended = roomPartition.suspendedIdentityIDs.has(cardID)
          if (!isUnlocated && !isSuspended) {
            issues.push({
              context,
              reason: 'cohort-identity-missing-from-room-partition',
              cardID
            })
          }
          if (isUnlocated && isSuspended) {
            issues.push({
              context,
              reason: 'cohort-identity-duplicated-in-room-partition',
              cardID
            })
          }
        }
        seen.add(cardID)
      })
    })

    if (roomPartition) {
      this.locatedIdentityIDs.forEach((cardID) => {
        if (!roomPartition.unlocatedIdentityIDs.has(cardID)) return
        issues.push({ context, reason: 'located-identity-still-unlocated', cardID })
      })
    }

    const expectedPileCount = normalizeCount(pileCount)
    const actualPileCount = this.getAccountedPileCount()
    if (expectedPileCount !== actualPileCount) {
      issues.push({
        context,
        reason: 'pile-count-mismatch',
        expected: expectedPileCount,
        actual: actualPileCount
      })
    }

    return issues
  }

  private commit(reason: string, update: () => void): boolean {
    // 对外原子操作共享事务边界；规则实现抛错时恢复集合和基数，避免留下半更新状态。
    const previous = this.captureState()
    try {
      update()
      this.assertInternalState(reason)
      this.revision += 1
      return true
    } catch (error) {
      this.restoreState(previous)
      this.warn('transaction-rollback', { reason, error })
      return false
    }
  }

  private assertInternalState(context: string): void {
    const issues = this.collectConsistencyIssues(this.getAccountedPileCount(), context).filter(
      (issue) => issue.reason !== 'pile-count-mismatch'
    )
    if (issues.length > 0) throw new Error(JSON.stringify(issues))
  }

  private captureState(): PileIdentityLedgerState {
    return {
      revision: this.revision,
      generation: this.generation,
      identityUniverse: new Set(this.identityUniverse),
      locatedIdentityIDs: new Set(this.locatedIdentityIDs),
      knownPileIdentityIDs: new Set(this.knownPileIdentityIDs),
      knownDiscardIdentityIDs: new Set(this.knownDiscardIdentityIDs),
      previousDiscardCount: this.previousDiscardCount,
      cohorts: this.cohorts.map(cloneCohort)
    }
  }

  private restoreState(state: PileIdentityLedgerState): void {
    this.revision = state.revision
    this.generation = state.generation
    this.identityUniverse = state.identityUniverse
    this.locatedIdentityIDs = state.locatedIdentityIDs
    this.knownPileIdentityIDs = state.knownPileIdentityIDs
    this.knownDiscardIdentityIDs = state.knownDiscardIdentityIDs
    this.previousDiscardCount = state.previousDiscardCount
    this.cohorts = state.cohorts
  }

  private warnForIssues(issues: readonly PileIdentityConsistencyIssue[]): void {
    issues.forEach((issue) => this.warn(issue.reason, { ...issue }))
  }

  private warn(reason: string, detail: Record<string, unknown>): void {
    this.onWarning('牌堆身份账本异常', { reason, ...detail })
  }
}
