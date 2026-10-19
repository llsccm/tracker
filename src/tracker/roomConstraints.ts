import { ConstraintGroup } from './ConstraintGroup'
import { collectHandSlotCardsBySeat, getHandSlotKindForSeat } from './candidate/handSlotCounts'
import { recordTraversal } from './traversalStats'
import { isAmbiguousKnownCard } from './AmbiguousKnownIndex'
import { createSubZoneCandidateKey } from './candidate/subZoneCandidate'
import {
  createLocationCandidateKey,
  parseLocationCandidateKey,
  toSubZoneCandidate
} from './candidate/locationCandidate'
import { trackerLogger } from '@/utils/logger'
import { isAnonymous, type Card } from './Card'
import type { Player } from './Player'
import type { Room } from './Room'
import type { RoomDiagnostics } from './room/diagnostics'
import type { LocationCandidate, MoveSourceEvent, SeatID, SpellID, SubZone } from './types'

const MAX_TRACKED_CANDIDATE_SEATS = 4

interface HandSlotCountSummary {
  knownCount: number
  candidateCount: number
  candidateCards: Card[]
}

// 约束组 dirty 标记只关心实际结构变化；集合等价时避免让高频移动回退全量 rebuild。
function areNumberSetsEqual(left: Set<number>, right: Set<number>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

// Map 中的期望槽位值如果没有变化，就不应触发 AmbiguousKnownIndex 全量重建。
function areNumberMapsEqual<Key>(left: Map<Key, number>, right: Map<Key, number>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function areSourceEventsEqual(
  left: MoveSourceEvent | string | null | undefined,
  right: MoveSourceEvent | string | null | undefined
): boolean {
  if (left === right) return true
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right
  }
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right
  }
  return left.type === right.type && left.label === right.label
}

interface ConstraintCardOptions {
  cards?: Card | Card[]
  cardIDs?: number[] | number
  candidateSeats?: SeatID[] | SeatID
  seatID?: SeatID | SeatID[]
  subZone?: SubZone
  spellID?: SpellID | null
  known?: boolean
  [key: string]: unknown
}

interface ConstraintGroupCreateOptions extends ConstraintCardOptions {
  id?: string | number
  combinationID?: string | number
  expectedSlotsBySeat?: Map<SeatID, number> | Record<string, number>
  expectedSlotsBySubZone?: Map<string, number> | Record<string, number>
  expectedSlotsByLocation?: Map<string, number> | Record<string, number>
  sourceEvent?: MoveSourceEvent | string | null
}

interface AmbiguousHiddenHandCoveragePackage {
  coverageBySeat: Map<SeatID, number>
  hiddenCards: Set<Card>
  hiddenCardsBySeat: Map<SeatID, Set<Card>>
}

function haveHiddenCardOverlap(
  left: AmbiguousHiddenHandCoveragePackage,
  right: AmbiguousHiddenHandCoveragePackage
): boolean {
  for (const card of left.hiddenCards) {
    if (right.hiddenCards.has(card)) return true
  }
  return false
}

function collectCoverageComponents(
  packages: AmbiguousHiddenHandCoveragePackage[]
): AmbiguousHiddenHandCoveragePackage[][] {
  const remaining = new Set(packages)
  const components: AmbiguousHiddenHandCoveragePackage[][] = []

  // 重叠关系具有传递性：A 与 B、B 与 C 共享实体时，三者必须在同一分量内统一分配。
  while (remaining.size > 0) {
    const first = remaining.values().next().value as AmbiguousHiddenHandCoveragePackage
    const component: AmbiguousHiddenHandCoveragePackage[] = []
    const queue = [first]
    remaining.delete(first)

    while (queue.length > 0) {
      const current = queue.pop()
      if (!current) continue
      component.push(current)

      for (const candidate of remaining) {
        if (!haveHiddenCardOverlap(current, candidate)) continue
        remaining.delete(candidate)
        queue.push(candidate)
      }
    }

    components.push(component)
  }

  return components
}

function addCoverageComponent(
  component: AmbiguousHiddenHandCoveragePackage[],
  coverageBySeat: Map<SeatID, number>
): void {
  const requiredBySeat = new Map<SeatID, number>()
  const eligibleCardsBySeat = new Map<SeatID, Set<Card>>()

  component.forEach((coveragePackage) => {
    coveragePackage.coverageBySeat.forEach((count, seatID) => {
      // 同一席位的历史组可能重复描述同一事实，取最大需求可避免把重复约束相加。
      requiredBySeat.set(seatID, Math.max(requiredBySeat.get(seatID) ?? 0, count))
      const eligibleCards = eligibleCardsBySeat.get(seatID) ?? new Set<Card>()
      coveragePackage.hiddenCardsBySeat.get(seatID)?.forEach((card) => eligibleCards.add(card))
      eligibleCardsBySeat.set(seatID, eligibleCards)
    })
  })

  const slots = Array.from(requiredBySeat.entries())
    .flatMap(([seatID, count]) =>
      Array.from({ length: count }, () => ({
        seatID,
        eligibleCards: eligibleCardsBySeat.get(seatID) ?? new Set<Card>()
      }))
    )
    .sort((left, right) => left.eligibleCards.size - right.eligibleCards.size)
  const matchedSlotByCard = new Map<Card, number>()

  // 用增广路径为席位槽寻找不同实体；重新安置旧匹配可避免共享实体造成贪心误判。
  const matchSlot = (slotIndex: number, visitedCards: Set<Card>): boolean => {
    for (const card of slots[slotIndex].eligibleCards) {
      if (visitedCards.has(card)) continue
      visitedCards.add(card)

      const previousSlotIndex = matchedSlotByCard.get(card)
      if (previousSlotIndex === undefined || matchSlot(previousSlotIndex, visitedCards)) {
        matchedSlotByCard.set(card, slotIndex)
        return true
      }
    }
    return false
  }

  slots.forEach((_, slotIndex) => {
    matchSlot(slotIndex, new Set<Card>())
  })

  matchedSlotByCard.forEach((slotIndex) => {
    const seatID = slots[slotIndex].seatID
    coverageBySeat.set(seatID, (coverageBySeat.get(seatID) ?? 0) + 1)
  })
}

/**
 * Room 的约束求解与稳定态同步模块。
 * 集中实现不动点循环、E1/E2 座位懒缓存、匿名手牌对账、约束组维护与暂停追踪。
 * 权威状态仍由 Room 持有，手牌槽缓存只在单次收敛调用内存活。
 */
export class RoomConstraints {
  declare room: Room

  constructor(room: Room) {
    this.room = room
  }

  /** 执行不动点收敛，并按原顺序同步索引、玩家视图组与计数器；诊断由 Room 在 DEV 时传入。 */
  resolveConstraints(diagnostics?: RoomDiagnostics): void {
    const room = this.room
    let changed = true
    let limit = 100 // 限制循环上限防死锁
    let overbroadKnownCards: Card[] = []
    // E1：收敛循环内复用未触碰 seat 的手牌槽统计；触碰 seat 会按需刷新。
    const handSlotCountsCache = new Map<SeatID, HandSlotCountSummary>()
    // A2：入口读取增量维护的 player 快照（消费上次收敛以来的 dirtyCardEvents）。
    // 非 player 牌不存在陈旧 owner，对约束一/三是严格 no-op；轮内 location 漂移必把
    // changed 置真，由轮末增量刷新兜底。游标断档时 refreshPlayerSnapshot 内部回退全量。
    let playerCards = room.refreshPlayerSnapshot()
    // E2：上一轮触碰座位集；null 表示首轮，约束三无条件处理全部玩家。
    let previousTouchedSeats: Set<SeatID> | null = null
    // 收敛轮数：喂给非终止回归看门狗（正常 ≤2 轮）。
    let rounds = 0

    try {
      while (changed && limit-- > 0) {
        changed = false
        overbroadKnownCards = []
        const touchedSeats = new Set<SeatID>()
        room.resolveTouchedSeats = touchedSeats
        rounds += 1

        // === 约束一：候选席位变化后同步确定拥有者 ===
        recordTraversal('resolveConstraints:constraint1', playerCards.length)
        for (const card of playerCards) {
          changed = card.syncOwnerFromSeats('room:resolveOwner') || changed
          // 判断是否过渡发散 停止追踪
          if (this.isOverbroadKnownCard(card)) {
            overbroadKnownCards.push(card)
          }
        }

        // === 约束二：局部 ConstraintGroup 收敛 ===
        for (const group of room.constraintGroups.values()) {
          changed = group.resolve() || changed
        }

        // === 约束三：暗牌额度降为 0 时的排他排除 ===
        // E1：首轮只批量计算有观测手牌数的座位；后续轮次按触碰座位懒重算，
        // 未触碰座位复用上一轮缓存，并由 E2 直接跳过。
        const observedSeatIDs = Array.from(room.players.entries())
          .filter(([, player]) => player.hasObservedHandCount)
          .map(([seatID]) => seatID)
        const getHandSlotCounts = this.createHandSlotCountResolver(
          playerCards,
          observedSeatIDs,
          previousTouchedSeats,
          handSlotCountsCache
        )

        for (const [seatID, player] of room.players.entries()) {
          // 座位的 knownCount/candidateCount/排他目标只随触碰它的卡牌变化；
          // 上一轮和本轮至今都未触碰时，重算与排他必是幂等 no-op，直接跳过。
          if (
            previousTouchedSeats &&
            !previousTouchedSeats.has(seatID) &&
            !touchedSeats.has(seatID)
          ) {
            continue
          }

          if (!player.hasObservedHandCount) {
            continue
          }

          const handSlotCounts = getHandSlotCounts(seatID)
          changed = player.refreshUnknownCardCount(handSlotCounts) || changed

          const lockedKnownCount = handSlotCounts?.knownCount ?? 0

          // 只有确定明牌已经占满手牌总数时，才排除该玩家的候选明牌。
          if (player.hasObservedHandCount && player.observedHandCount - lockedKnownCount <= 0) {
            recordTraversal('resolveConstraints:constraint3:exclusion', playerCards.length)
            for (const card of playerCards) {
              if (
                card.location === 'player' &&
                card.hasLocationCandidates?.() &&
                getHandSlotKindForSeat(card, seatID) === 'candidate'
              ) {
                const handLocationCandidates = card.locationCandidates.filter(
                  (candidate) =>
                    candidate.type === 'player' &&
                    candidate.seatID === seatID &&
                    candidate.subZone === 'hand'
                )

                handLocationCandidates.forEach((candidate) => {
                  changed =
                    card.removeLocationCandidate(candidate, 'room:unknownQuotaExclusion') || changed
                })

                continue
              }

              if (
                card.location === 'player' &&
                card.subZone === 'hand' &&
                // 完整位置候选由 expectedSlotsBySubZone 处理，不参与旧 seats 排除。
                !card.hasSubZoneCandidates?.() &&
                card.seats.size > 1 &&
                card.seats.has(seatID)
              ) {
                changed = card.deleteSeat(seatID, 'room:unknownQuotaExclusion') || changed
              }
            }
          }
        }

        // 匿名实体增减会改变玩家区快照，必须纳入本轮 changed 并重新执行全部约束。
        const anonymousHandChanges = this.reconcileAnonymousHandCards(handSlotCountsCache)
        if (anonymousHandChanges.created.length > 0 || anonymousHandChanges.released.length > 0) {
          changed = true
        }

        previousTouchedSeats = touchedSeats

        // A2：轮内发生变化时增量刷新快照，兜住全部 location 漂移（含轮内新进入 player 的牌）。
        if (changed) {
          playerCards = room.refreshPlayerSnapshot()
        }
      }
    } finally {
      room.resolveTouchedSeats = null
    }

    room.lastResolveRounds = rounds
    if (rounds > room.maxResolveRounds) room.maxResolveRounds = rounds
    if (import.meta.env.DEV) diagnostics?.assertConvergenceRounds(rounds)

    room.assertPlayerSnapshotConsistency(playerCards)

    // changed=true 说明本轮可能新增过渡发散明牌，需全量扫描；稳定时只检查本轮收集的集合。
    if (changed) {
      this.suspendOverbroadKnownCards()
    } else {
      this.suspendOverbroadKnownCards(overbroadKnownCards)
    }

    // 增量维护区域投影索引；游标断档时 applyDirtyCardEvents 内部回退全量 rebuild。
    // 纯公共区之间的暗牌移动不发脏牌事件，靠 Zone 变更累积的 dirtyPublicZones 补齐。
    room.locationIndex.applyDirtyCardEvents(room, { dirtyPublicZones: room.dirtyPublicZones })
    room.dirtyPublicZones.clear()
    const shouldAssertShadowIndexes =
      import.meta.env.DEV && diagnostics?.shouldAssertShadowIndexConsistency()
    if (shouldAssertShadowIndexes) room.assertLocationIndexConsistency()

    // 约束收敛完毕后同步视图物理组排序
    this.syncViewGroups()

    // 增量维护已知明牌的模糊反查索引；约束组结构变化会影响 source label / membership，
    // 单牌 dirty 事件无法覆盖这些跨牌描述变化，因此只在结构 dirty 时全量回退。
    const constraintGroups = Array.from(room.constraintGroups.values())
    if (room.constraintGroupsDirty) {
      room.ambiguousKnownIndex.rebuild(constraintGroups)
      room.constraintGroupsDirty = false
    } else {
      room.ambiguousKnownIndex.applyDirtyCardEvents(constraintGroups)
    }

    if (shouldAssertShadowIndexes) room.assertAmbiguousKnownIndexConsistency()

    // 触发计数器与视图订阅更新
    room.counter.update()

    room.assertConservation('resolveConstraints')
  }

  private collectPlayerHandSlotCounts(
    cards: Card[] = this.room.cards,
    seatIDs: Iterable<SeatID> = this.room.players.keys()
  ): Map<SeatID, HandSlotCountSummary> {
    const room = this.room
    const countsBySeat = new Map<SeatID, HandSlotCountSummary>()
    // E1：调用方可只传需要重算的 seat，避免每轮为所有玩家重复分类同一批 playerCards。
    const targetSeatIDs = Array.from(seatIDs, Number).filter((seatID) => room.players.has(seatID))
    const handSlotCardsBySeat = collectHandSlotCardsBySeat(cards, targetSeatIDs)

    targetSeatIDs.forEach((seatID) => {
      const player = room.players.get(seatID)
      if (!player) return

      const slotCards = handSlotCardsBySeat.get(seatID)
      countsBySeat.set(seatID, {
        knownCount: slotCards?.knownCards.length ?? 0,
        candidateCount: player.getCandidateHandSlotCount(slotCards?.candidateCards ?? []),
        candidateCards: slotCards?.candidateCards ?? []
      })
    })

    return countsBySeat
  }

  private createHandSlotCountResolver(
    playerCards: Card[],
    observedSeatIDs: SeatID[],
    previousTouchedSeats: Set<SeatID> | null,
    handSlotCountsCache: Map<SeatID, HandSlotCountSummary>
  ): (seatID: SeatID) => HandSlotCountSummary | undefined {
    const handSlotCountsBySeat =
      previousTouchedSeats === null
        ? this.collectPlayerHandSlotCounts(playerCards, observedSeatIDs)
        : new Map<SeatID, HandSlotCountSummary>()

    if (previousTouchedSeats === null) {
      handSlotCountsBySeat.forEach((summary, seatID) => {
        handSlotCountsCache.set(seatID, summary)
      })
    }

    return (seatID: SeatID): HandSlotCountSummary | undefined => {
      if (handSlotCountsBySeat.has(seatID)) {
        return handSlotCountsBySeat.get(seatID)
      }

      if (previousTouchedSeats === null) {
        return handSlotCountsCache.get(seatID)
      }

      // 后续轮次只会走到 E2 判定为受影响的 seat，这里按单 seat 懒重算。
      const summary = this.collectPlayerHandSlotCounts(playerCards, [seatID]).get(seatID)
      if (summary) {
        handSlotCountsBySeat.set(seatID, summary)
        handSlotCountsCache.set(seatID, summary)
      }

      return summary ?? handSlotCountsCache.get(seatID)
    }
  }

  private reconcileAnonymousHandCards(slotCountsBySeat: Map<SeatID, HandSlotCountSummary>): {
    created: Card[]
    released: Card[]
  } {
    const room = this.room
    const created: Card[] = []
    const released: Card[] = []

    // 没有任何已观测玩家时直接返回：与旧“逐玩家 early-return”等价，避免无谓的归组扫描。
    let hasObservedPlayer = false
    for (const player of room.players.values()) {
      if (player.hasObservedHandCount) {
        hasObservedPlayer = true
        break
      }
    }
    if (!hasObservedPlayer) return { created, released }

    // 一次性按归属座位归组“单一归属的暗手牌”，取代过去对每个已观测玩家各扫一遍 Room.cards。
    // 复用 resolveConstraints 增量维护的 player 快照（成员严格等于 card.location==='player'），
    // 把每条移动尾部的 O(玩家数 × 全牌数) 降为 O(玩家区牌数)。
    const playerCards = room.playerCardsSnapshot
    recordTraversal('reconcileAnonymousHandCards:group', playerCards.length)
    const hiddenHandCardsBySeat = new Map<SeatID, Card[]>()
    for (const card of playerCards) {
      if (card.subZone !== 'hand' || card.isKnown === true || card.suspended === true) {
        continue
      }
      const ownerSeatID = card.resolvedSeat
      if (ownerSeatID === null) continue
      const existing = hiddenHandCardsBySeat.get(ownerSeatID)
      if (existing) existing.push(card)
      else hiddenHandCardsBySeat.set(ownerSeatID, [card])
    }
    const ambiguousHiddenCoverageBySeat = this.collectAmbiguousHiddenHandCoverage()

    room.players.forEach((player, seatID) => {
      if (!player.hasObservedHandCount) return
      const slotCounts = slotCountsBySeat.get(seatID)
      if ((slotCounts?.candidateCards.length ?? 0) > 0 && slotCounts?.candidateCount === 0) {
        return
      }

      const unknownHandCards = hiddenHandCardsBySeat.get(seatID) ?? []
      const ambiguousHiddenCoverage = ambiguousHiddenCoverageBySeat.get(seatID) ?? 0
      const coveredUnknownCount = unknownHandCards.length + ambiguousHiddenCoverage
      const missingCount = Math.max(0, player.unknownCardCount - coveredUnknownCount)

      if (missingCount > 0) {
        const placeholders = room.createExternalCards([], missingCount)
        placeholders.forEach((card) => {
          card.bindCandidates([seatID], 'hand', null, { known: false })
        })
        created.push(...placeholders)
      }

      let excessCount = Math.max(0, coveredUnknownCount - player.unknownCardCount)
      if (excessCount <= 0) return

      for (const card of unknownHandCards) {
        if (excessCount <= 0) break
        if (!isAnonymous(card)) continue

        room.removeCardsFromConstraintGroups([card])
        card.moveToPublicZone('outside')
        released.push(card)
        excessCount -= 1
      }
    })

    if (created.length > 0 || released.length > 0) {
      trackerLogger.info('匿名手牌实体对账', {
        created: created.map((card) => ({
          entityID: card.entityID,
          seatID: card.resolvedSeat
        })),
        released: released.map((card) => ({
          entityID: card.entityID
        }))
      })
    }

    return { created, released }
  }

  /**
   * 约束组移除实体牌时，尽量解析唯一完整位置；container 候选也保持为 location。
   */
  getResolvedExpectedLocationCandidate(card: Card): LocationCandidate | null {
    if (card.hasLocationCandidates()) {
      const locationCandidates = card.locationCandidates
      // owner 已确定也不能裁掉公共区、容器或同座位的其它子区候选。
      return locationCandidates.length === 1 ? locationCandidates[0] : null
    }

    if (card.location !== 'player' || card.owner === null || card.subZone === null) return null

    return {
      type: 'player',
      seatID: card.owner,
      subZone: card.subZone,
      spellID: card.spellID
    }
  }

  /**
   * 收集精确手牌位置约束中必然由跨位置暗实体占用的槽位。
   *
   * 这些实体没有唯一 resolvedSeat，不能当作某个玩家的确定暗手牌；但约束已经保证其中
   * 至少若干张会落到对应手牌位置，因此匿名对账不能为同一批槽位再次补建实体。
   */
  collectAmbiguousHiddenHandCoverage(): Map<SeatID, number> {
    const packages: AmbiguousHiddenHandCoveragePackage[] = []

    this.room.constraintGroups.forEach((group) => {
      const coverageBySeat = new Map<SeatID, number>()
      const hiddenCards = new Set<Card>()
      const hiddenCardsBySeat = new Map<SeatID, Set<Card>>()
      const groupCards = Array.from(group.cards)

      group.expectedSlotsByLocation.forEach((expectedCount, key) => {
        const locationCandidate = parseLocationCandidateKey(key)
        const handCandidate = toSubZoneCandidate(locationCandidate)
        if (!handCandidate || handCandidate.subZone !== 'hand' || expectedCount <= 0) return

        const subZoneKey = createSubZoneCandidateKey(handCandidate)
        const exactCards = groupCards.filter(
          (card) =>
            card.location === 'player' &&
            !card.hasLocationCandidates?.() &&
            !card.hasSubZoneCandidates?.() &&
            card.seats.size === 1 &&
            card.seats.has(handCandidate.seatID) &&
            card.subZone === 'hand'
        )
        const candidateCards = groupCards.filter(
          (card) =>
            card.hasLocationCandidate?.(key) ||
            (subZoneKey && card.hasSubZoneCandidate?.(subZoneKey))
        )
        const knownCandidateCount = candidateCards.filter(
          (card) => card.isKnown === true && card.suspended !== true
        ).length
        const ambiguousHiddenCards = candidateCards.filter(
          (card) => card.isKnown !== true && card.suspended !== true && card.resolvedSeat === null
        )
        const remainingExpected = Math.max(0, expectedCount - exactCards.length)
        const hiddenCoverage = Math.min(
          ambiguousHiddenCards.length,
          Math.max(0, remainingExpected - knownCandidateCount)
        )

        if (hiddenCoverage <= 0) return
        coverageBySeat.set(
          handCandidate.seatID,
          (coverageBySeat.get(handCandidate.seatID) ?? 0) + hiddenCoverage
        )
        // 同一席位可能由多个完整 hand key 贡献候选，实体集合必须与覆盖量同步累加。
        const seatHiddenCards = hiddenCardsBySeat.get(handCandidate.seatID) ?? new Set<Card>()
        ambiguousHiddenCards.forEach((card) => seatHiddenCards.add(card))
        hiddenCardsBySeat.set(handCandidate.seatID, seatHiddenCards)
        ambiguousHiddenCards.forEach((card) => hiddenCards.add(card))
      })

      if (coverageBySeat.size > 0) {
        packages.push({ coverageBySeat, hiddenCards, hiddenCardsBySeat })
      }
    })

    // 历史组与后续扩展组可能共享部分暗实体。按重叠连通分量合并需求，再通过匹配确保
    // 每个实体最多覆盖一个席位槽；同一席位的重复约束取最大值，互不相交的分量继续累加。
    const coverageBySeat = new Map<SeatID, number>()
    collectCoverageComponents(packages).forEach((component) => {
      addCoverageComponent(component, coverageBySeat)
    })

    return coverageBySeat
  }

  /**
   * 用另一个暗实体接管原实体参与的全部约束组，不改变任何期望槽位。
   * 用于未公开正 ID 仅作为身份占位、后续明牌协议需要交换身份但不能确认候选位置的场景。
   */
  replaceCardInConstraintGroups(previousCard: Card, nextCard: Card): boolean {
    if (previousCard === nextCard) return false

    let changed = false
    this.room.constraintGroups.forEach((group) => {
      if (!group.cards.has(previousCard)) return

      group.cards.delete(previousCard)
      group.cards.add(nextCard)
      nextCard.combinationID = group.id ?? previousCard.combinationID
      changed = true
    })

    if (changed) {
      this.room.markConstraintGroupsDirty('replaceCardInConstraintGroups')
    }
    return changed
  }

  /**
   * 将指定实体牌从所有局部约束组中摘除，并清理空约束组。
   */
  removeCardsFromConstraintGroups(cards: Card[] = []): boolean {
    const cardSet = new Set<Card>(cards)
    let changed = false
    let affectsAmbiguousKnownIndex = false

    // 只有确实从组内删牌或删空组时才算结构变化；无命中的高频调用保持增量路径。
    for (const [groupID, group] of this.room.constraintGroups.entries()) {
      cardSet.forEach((card) => {
        if (group.cards.has(card)) {
          affectsAmbiguousKnownIndex =
            affectsAmbiguousKnownIndex || this.affectsAmbiguousKnownIndex(card)
          const resolvedLocationCandidate = this.getResolvedExpectedLocationCandidate(card)
          const resolvedCandidate = toSubZoneCandidate(resolvedLocationCandidate)

          if (resolvedCandidate) {
            // 牌已锁定到单个手牌槽位时，同步扣减该席位在本组内的期望槽位。
            if (
              resolvedCandidate.subZone === 'hand' &&
              group.expectedSlotsBySeat.has(resolvedCandidate.seatID)
            ) {
              const currentExpected = group.expectedSlotsBySeat.get(resolvedCandidate.seatID)
              group.expectedSlotsBySeat.set(
                resolvedCandidate.seatID,
                Math.max(0, currentExpected - 1)
              )
            }

            // 确认移动离开约束组时，同步扣减该牌已锁定的完整位置名额。
            const subZoneKey = createSubZoneCandidateKey(resolvedCandidate)

            if (subZoneKey && group.expectedSlotsBySubZone.has(subZoneKey)) {
              const currentExpected = group.expectedSlotsBySubZone.get(subZoneKey)
              group.expectedSlotsBySubZone.set(subZoneKey, Math.max(0, currentExpected - 1))
            }
          }

          // container 候选没有 subZone 镜像，但仍应扣减 expectedSlotsByLocation 名额。
          const locationKey = createLocationCandidateKey(resolvedLocationCandidate)
          if (locationKey && group.expectedSlotsByLocation.has(locationKey)) {
            const currentExpected = group.expectedSlotsByLocation.get(locationKey)
            group.expectedSlotsByLocation.set(locationKey, Math.max(0, currentExpected - 1))
          }
          group.cards.delete(card)
          changed = true
        }
      })

      if (group.cards.size === 0) {
        this.room.deleteConstraintGroup(groupID)
        changed = true
      }
    }

    if (changed && affectsAmbiguousKnownIndex) {
      this.room.markConstraintGroupsDirty('removeCardsFromConstraintGroups')
    }
    return changed
  }

  /**
   * 将约束组参数中的实体牌和物理 ID 统一解析为 Card 实体，并按需绑定候选席位。
   */
  resolveConstraintCards(options: ConstraintCardOptions = {}, targetSeats: SeatID[] = []): Card[] {
    const optionCards = options.cards
      ? Array.isArray(options.cards)
        ? options.cards
        : [options.cards]
      : []
    const cardIDs = Array.isArray(options.cardIDs)
      ? options.cardIDs
      : options.cardIDs === undefined
        ? []
        : [options.cardIDs]
    const idCards = this.room.findCardsByIDs(cardIDs)
    const cards = Array.from(new Set([...optionCards, ...idCards])).filter(Boolean)

    if (options.cardIDs && targetSeats.length > 0) {
      cards.forEach((card) => {
        this.room.clearCardsFromPublicZones([card])

        if (card.location !== 'player' || card.seats.size === 0) {
          const bindOptions = { known: options.known === true }
          card.bindCandidates(
            targetSeats,
            options.subZone ?? 'hand',
            options.spellID ?? null,
            bindOptions
          )
        } else {
          card.setSeats(
            this.room.mergeCandidateSeats(card.seats, targetSeats),
            'resolveConstraintCards:mergeCandidateSeats'
          )

          const previousSubZone = card.subZone
          const previousSpellID = card.spellID

          if (options.subZone) {
            card.subZone = options.subZone
          }

          if (options.spellID !== undefined) {
            card.spellID = options.spellID
          }

          if (card.subZone !== previousSubZone || card.spellID !== previousSpellID) {
            this.room.notifyCardChanged(card, {
              type: 'card-player-zone-changed',
              reason: 'resolveConstraintCards:zoneChanged',
              previousSubZone,
              nextSubZone: card.subZone,
              previousSpellID,
              nextSpellID: card.spellID
            })
          }

          if (options.known === true) {
            card.confirmKnown()
          }
        }
      })
    }

    return cards
  }

  /**
   * 稳定差量同步卡牌列表：保留已有项顺序，移除失效项，新项追加到尾部。
   */
  syncStableCardList(existingCards: Card[] = [], currentCards: Card[] = []): Card[] {
    const currentSet = new Set(currentCards)
    const existingSet = new Set(existingCards)
    const nextCards = existingCards.filter((card) => currentSet.has(card))

    currentCards.forEach((card) => {
      if (!existingSet.has(card)) {
        nextCards.push(card)
      }
    })

    return nextCards
  }

  /**
   * 响应式同步：约束收敛完毕后，将最新的卡牌分配状态同步至各个玩家的物理数组与标记区映射中，
   * 并使用稳定排序（维持原有顺序，新摸入/移入的追加到尾部），以便于视图渲染。
   * 传入 `seatIDs` 时只刷新指定玩家，供快路径/A2 只同步受影响座位（C1）。
   */
  syncViewGroups(seatIDs?: Iterable<SeatID>): void {
    const idx = this.room.locationIndex
    const targetPlayers =
      seatIDs === undefined
        ? Array.from(this.room.players.values())
        : Array.from(seatIDs, (seatID) => this.room.getPlayer(Number(seatID))).filter(
            (player): player is Player => Boolean(player)
          )

    targetPlayers.forEach((player) => {
      const seat = player.seatID
      const knownHand = idx.knownHandBySeat.get(seat) ?? []
      const candidateHand = idx.candidateHandBySeat.get(seat) ?? []
      const equip = idx.equipBySeat.get(seat) ?? []
      const judge = idx.judgeBySeat.get(seat) ?? []
      const mark = idx.markBySeatAndSpell.get(seat) ?? new Map()

      player.knownHandCards = this.syncStableCardList(player.knownHandCards, knownHand)
      player.candidateHandCards = this.syncStableCardList(player.candidateHandCards, candidateHand)
      player.equipCards = this.syncStableCardList(player.equipCards, equip)
      player.judgeCards = this.syncStableCardList(player.judgeCards, judge)

      for (const spellID of player.markCards.keys()) {
        if (!mark.has(spellID)) {
          player.markCards.delete(spellID)
        }
      }

      mark.forEach((spellCards, spellID) => {
        player.markCards.set(
          spellID,
          this.syncStableCardList(player.markCards.get(spellID) ?? [], spellCards)
        )
      })
    })
  }

  /**
   * 创建或合并局部约束组，并立即应用一次组内约束。
   * 该方法只维护组结构；是否进行全局收敛由 Room.resolveConstraints() 决定。
   */
  createConstraintGroup(options: ConstraintGroupCreateOptions = {}): ConstraintGroup {
    const groupID = options.id ?? options.combinationID ?? `group_${++this.room.constraintGroupSeq}`
    const targetSeats = this.room.normalizeSeats(options.candidateSeats ?? options.seatID)
    const cards = this.resolveConstraintCards(options, targetSeats)
    let group = this.room.constraintGroups.get(groupID)
    let structureChanged = false
    // 普通确定牌组不影响模糊明牌描述；只对相关明牌置 dirty，保留高频路径收益。
    let affectsAmbiguousKnownIndex = cards.some((card) => this.affectsAmbiguousKnownIndex(card))

    if (!group) {
      group = new ConstraintGroup({
        ...options,
        id: groupID,
        candidateSeats: targetSeats,
        cards
      })
      this.room.constraintGroups.set(groupID, group)
      structureChanged = true
    } else {
      affectsAmbiguousKnownIndex =
        affectsAmbiguousKnownIndex ||
        Array.from(group.cards).some((card) => this.affectsAmbiguousKnownIndex(card))
      const previousCardCount = group.cards.size
      group.addCards(cards)
      if (group.cards.size !== previousCardCount) structureChanged = true

      if (targetSeats.length > 0) {
        const nextCandidateSeats = this.room.mergeCandidateSeats(group.candidateSeats, targetSeats)
        if (!areNumberSetsEqual(group.candidateSeats, nextCandidateSeats)) {
          group.candidateSeats = nextCandidateSeats
          structureChanged = true
        }
      }

      if (options.expectedSlotsBySeat) {
        const nextExpectedSlotsBySeat = group.normalizeExpectedSlots(options.expectedSlotsBySeat)
        if (!areNumberMapsEqual(group.expectedSlotsBySeat, nextExpectedSlotsBySeat)) {
          group.expectedSlotsBySeat = nextExpectedSlotsBySeat
          structureChanged = true
        }
      }

      const hasExpectedSlotsBySubZone = Object.prototype.hasOwnProperty.call(
        options,
        'expectedSlotsBySubZone'
      )
      const hasExpectedSlotsByLocation = Object.prototype.hasOwnProperty.call(
        options,
        'expectedSlotsByLocation'
      )
      const previousExpectedSlotsBySubZone = new Map(group.expectedSlotsBySubZone)
      const previousExpectedSlotsByLocation = new Map(group.expectedSlotsByLocation)

      if (hasExpectedSlotsBySubZone) {
        // 同一分组可能先记录 seats 约束，后续再补充子区域约束。
        group.expectedSlotsBySubZone = group.normalizeExpectedSubZoneSlots(
          options.expectedSlotsBySubZone
        )
      }

      if (hasExpectedSlotsByLocation) {
        group.expectedSlotsByLocation = group.normalizeExpectedLocationSlots(
          options.expectedSlotsByLocation
        )
      }

      if (hasExpectedSlotsBySubZone || hasExpectedSlotsByLocation) {
        group.syncExpectedSlotCompatibility(hasExpectedSlotsByLocation ? 'location' : 'subZone')
        if (
          !areNumberMapsEqual(previousExpectedSlotsBySubZone, group.expectedSlotsBySubZone) ||
          !areNumberMapsEqual(previousExpectedSlotsByLocation, group.expectedSlotsByLocation)
        ) {
          structureChanged = true
        }
      }

      const nextKnown = group.known || options.known === true
      if (nextKnown !== group.known) {
        group.known = nextKnown
        structureChanged = true
      }

      if (options.sourceEvent !== null && options.sourceEvent !== undefined) {
        if (!areSourceEventsEqual(options.sourceEvent, group.sourceEvent)) structureChanged = true
        group.sourceEvent = options.sourceEvent
      }
    }

    group.apply()
    if (structureChanged && affectsAmbiguousKnownIndex) {
      this.room.markConstraintGroupsDirty('createConstraintGroup')
    }
    return group
  }

  /**
   * 判断约束组结构变化是否会影响 AmbiguousKnownIndex 的描述或 membership。
   * 已在索引中的牌也算相关，避免删除 group 后 source label 残留。
   */
  private affectsAmbiguousKnownIndex(card: Card): boolean {
    if (this.room.ambiguousKnownIndex.items.has(card.id)) return true
    return isAmbiguousKnownCard(card)
  }

  /**
   * 暂停追踪候选席位过度发散的明牌。
   * 当一张明牌可能在 4 个及以上玩家手里时，继续传播会污染后续推断，
   * 因此将它移入 suspendedKnownCards，直到协议再次明确出现该牌。
   */
  isOverbroadKnownCard(card: Card): boolean {
    return (
      card.isKnown === true &&
      card.suspended !== true &&
      card.location === 'player' &&
      card.seats.size >= MAX_TRACKED_CANDIDATE_SEATS
    )
  }

  suspendOverbroadKnownCards(cards: Iterable<Card> = this.room.cards): void {
    for (const card of cards) {
      if (this.isOverbroadKnownCard(card)) {
        this.suspendKnownCard(card, 'candidateSeats>=4')
      }
    }
  }

  /**
   * 将指定正 ID 身份从候选推断体系中摘除，放入房间级暂停追踪集合。
   * 洗牌路径会先 confirmKnown()，表示身份已经明确、只是具体位置暂停维护；
   * 后续协议再次携带该 ID 时再恢复普通追踪。
   */
  suspendKnownCard(card: Card, reason: string): void {
    if (!card || card.suspended) return

    this.removeCardsFromConstraintGroups([card])
    card.clearSeats(`suspendKnownCard:${reason}`)
    card.setLocationCandidates([], `suspendKnownCard:${reason}:candidates`)
    card.combinationID = null
    card.location = 'suspended'
    card.subZone = null
    card.suspended = true
    this.room.markCounterDirty(card)
    this.room.suspendedKnownCards.add(card)

    trackerLogger.info('卡牌身份位置发散，暂停追踪', {
      id: card.id,
      name: card.name,
      reason,
      suspendedCount: this.room.suspendedKnownCards.size
    })
  }

  /**
   * 当协议再次明确出现某张暂停追踪的正 ID 身份时，恢复该牌的普通追踪状态。
   */
  resumeSuspendedKnownCard(card: Card): void {
    if (!card || (card.suspended !== true && !this.room.suspendedKnownCards.has(card))) return

    card.suspended = false
    this.room.suspendedKnownCards.delete(card)
    trackerLogger.info('卡牌身份再次出现，恢复追踪', {
      id: card.id,
      name: card.name
    })
  }
}
