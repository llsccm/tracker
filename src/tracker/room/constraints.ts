import type { Card, Player } from '@/tracker/model'
import { trackerLogger } from '@/utils/logger'
import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from '../candidate/locationCandidate'
import {
  ConstraintGroup,
  type ConstraintGroupOptions,
  type SlotCountRange
} from '../constraint/ConstraintGroup'
import { getHandSlotKindForSeat } from '../constraint/handSlotCounts'
import { computeHandSlotAllocation, type HandSlotAllocation } from '../constraint/handSlotUsage'
import { isAmbiguousKnownCard } from '../projection/AmbiguousKnownIndex'
import type { Room } from '../Room'
import { recordTraversal } from '../traversalStats'
import type { LocationCandidate, MoveSourceEvent, SeatID } from '../types'
import type { RoomDiagnostics } from './diagnostics'

const MAX_TRACKED_CANDIDATE_SEATS = 4

// 约束组 dirty 标记只关心实际结构变化；集合等价时避免让高频移动回退全量 rebuild。
function areNumberSetsEqual(left: Set<number>, right: Set<number>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

// Map 中的期望槽位值如果没有变化，就不应触发 AmbiguousKnownIndex 全量重建。
function areSlotMapsEqual<Key>(
  left: Map<Key, SlotCountRange>,
  right: Map<Key, SlotCountRange>
): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    const other = right.get(key)
    if (!other || other.min !== value.min || other.max !== value.max) return false
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

/**
 * Room 的约束求解与稳定态同步模块。
 * 集中实现不动点循环、E1/E2 座位缓存、匿名手牌对账、约束组维护与暂停追踪。
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
    const handAllocations = new Map<SeatID, HandSlotAllocation>()
    // A2：入口读取增量维护的 player 快照（消费上次收敛以来的 dirtyCardEvents）。
    // 非 player 牌不存在陈旧 owner，对约束一/三是严格 no-op；轮内 location 漂移必把
    // changed 置真，由轮末增量刷新兜底。游标断档时 refreshPlayerSnapshot 内部回退全量。
    let playerCards = room.refreshPlayerSnapshot()
    let playerSnapshotSeq = room.dirtyCardSeq
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
        // E1：首轮只批量计算有观测手牌数的座位；后续轮次按触碰座位及共享组依赖重算，
        // 未触碰座位复用上一轮缓存，并由 E2 直接跳过。
        const observedSeatIDs = Array.from(room.players.entries())
          .filter(([, player]) => player.hasObservedHandCount)
          .map(([seatID]) => seatID)
        if (playerSnapshotSeq !== room.dirtyCardSeq) {
          playerCards = room.refreshPlayerSnapshot()
          playerSnapshotSeq = room.dirtyCardSeq
        }
        const affectedSeatIDs = this.collectAffectedHandAllocationSeats(
          observedSeatIDs,
          previousTouchedSeats,
          touchedSeats
        )
        computeHandSlotAllocation(room, affectedSeatIDs, playerCards).forEach(
          (allocation, seatID) => {
            handAllocations.set(seatID, allocation)
          }
        )
        const allocationSeq = room.dirtyCardSeq

        for (const [seatID, player] of room.players.entries()) {
          // 共享组可能让暗实体匹配影响间接关联座位，只跳过依赖闭包以外的玩家。
          if (!affectedSeatIDs.includes(seatID)) {
            continue
          }

          const allocation = handAllocations.get(seatID)!
          changed = player.refreshUnknownCardCount(allocation) || changed

          const lockedKnownCount = allocation.exactKnownCount

          // 只有确定明牌已经占满手牌总数时，才排除该玩家的候选明牌。
          if (player.hasObservedHandCount && player.observedHandCount - lockedKnownCount <= 0) {
            recordTraversal('resolveConstraints:constraint3:exclusion', playerCards.length)
            for (const card of playerCards) {
              if (
                card.location === 'player' &&
                card.hasLocationCandidates() &&
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
                // 完整位置候选由 expectedSlotsByLocation 处理，不参与座位级排除。
                !card.locationCandidates.some((candidate) => candidate.type === 'player') &&
                card.seats.size > 1 &&
                card.seats.has(seatID)
              ) {
                changed = card.deleteSeat(seatID, 'room:unknownQuotaExclusion') || changed
              }
            }
          }
        }

        // 匿名实体增减会改变玩家区快照，必须纳入本轮 changed 并重新执行全部约束。
        // 排他改变了候选时，分配快照已失效；下一轮重算后再补位，避免用旧额度先造再删。
        const anonymousHandChanges =
          room.dirtyCardSeq === allocationSeq
            ? this.reconcileAnonymousHandCards(handAllocations)
            : { created: [], released: [] }
        if (anonymousHandChanges.created.length > 0 || anonymousHandChanges.released.length > 0) {
          changed = true
        }

        previousTouchedSeats = touchedSeats

        // A2：轮内发生变化时增量刷新快照，兜住全部 location 漂移（含轮内新进入 player 的牌）。
        if (changed && playerSnapshotSeq !== room.dirtyCardSeq) {
          playerCards = room.refreshPlayerSnapshot()
          playerSnapshotSeq = room.dirtyCardSeq
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

  private collectAffectedHandAllocationSeats(
    observedSeatIDs: SeatID[],
    previousTouchedSeats: Set<SeatID> | null,
    touchedSeats: Set<SeatID>
  ): SeatID[] {
    if (previousTouchedSeats === null) return observedSeatIDs
    const affectedSeats = new Set([...previousTouchedSeats, ...touchedSeats])
    if (affectedSeats.size === 0) return []
    const pendingGroups = new Set(
      Array.from(this.room.constraintGroups.values(), (group) => {
        const seats = new Set(Array.from(group.cards).flatMap((card) => Array.from(card.seats)))
        group.expectedSlotsByLocation.forEach((_, key) => {
          const location = parseLocationCandidateKey(key)
          if (location?.type === 'player' && location.subZone === 'hand') seats.add(location.seatID)
        })
        return seats
      })
    )
    // 只沿局部组传播依赖，不扫描全牌池；多个组共享实体时传播具有传递性。
    let expanded = true
    while (expanded) {
      expanded = false
      for (const seats of pendingGroups) {
        if (!Array.from(seats).some((seatID) => affectedSeats.has(seatID))) continue
        pendingGroups.delete(seats)
        seats.forEach((seatID) => affectedSeats.add(seatID))
        expanded = true
      }
    }
    return observedSeatIDs.filter((seatID) => affectedSeats.has(seatID))
  }

  private reconcileAnonymousHandCards(allocations: Map<SeatID, HandSlotAllocation>): {
    created: Card[]
    released: Card[]
  } {
    const room = this.room
    const created: Card[] = []
    const released: Card[] = []

    room.players.forEach((player, seatID) => {
      if (!player.hasObservedHandCount) return
      const allocation = allocations.get(seatID)
      if (!allocation?.canReconcileAnonymous) return
      const materializationTargets = allocation.exactHiddenCards.filter((card) => card.isAnonymous)
      let materialized = false
      for (const identity of allocation.detachedKnownCards) {
        const target = materializationTargets.shift()
        if (!target) break
        room.materialize(identity.id, target)
        room.applyPileIdentityReveal([identity.id])
        created.push(target)
        materialized = true
      }
      // 身份接管改变了明暗分配；下一轮重新计算后再补位，不能消费旧分配结果。
      if (materialized) return
      const missingCount = allocation.anonymousMissingCount!

      if (missingCount > 0) {
        const placeholders = room.createExternalCards([], missingCount)
        placeholders.forEach((card) => {
          card.bindCandidates([seatID], 'hand', null, { known: false })
        })
        created.push(...placeholders)
      }

      let excessCount = allocation.anonymousExcessCount!
      for (const card of allocation.exactHiddenCards) {
        if (excessCount <= 0) break
        if (card.hasRealIdentity) continue

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
    const possibleLocations = card.getPossibleLocations()
    if (possibleLocations.length === 1 && possibleLocations[0].type === 'popup') {
      return possibleLocations[0]
    }
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

          // 玩家、公共区和 container 的已锁定位置统一扣减完整位置名额。
          const locationKey = createLocationCandidateKey(resolvedLocationCandidate)
          const currentExpected = group.expectedSlotsByLocation.get(locationKey)
          if (locationKey && currentExpected) {
            group.expectedSlotsByLocation.set(locationKey, {
              min: Math.max(0, currentExpected.min - 1),
              max: Math.max(0, currentExpected.max - 1)
            })
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
        : Array.from(seatIDs, (seatID) => this.room.getPlayer(seatID)).filter(
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
  createConstraintGroup(options: ConstraintGroupOptions = {}): ConstraintGroup {
    const groupID = options.id ?? `group_${++this.room.constraintGroupSeq}`
    const targetSeats = options.candidateSeats ?? []
    const cards = Array.from(new Set(options.cards ?? []))
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

      if (options.expectedSlotsByLocation !== undefined) {
        const nextExpectedSlotsByLocation = group.normalizeExpectedLocationSlots(
          options.expectedSlotsByLocation
        )
        if (!areSlotMapsEqual(group.expectedSlotsByLocation, nextExpectedSlotsByLocation)) {
          group.expectedSlotsByLocation = nextExpectedSlotsByLocation
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

  suspendOverbroadKnownCards(cards: Iterable<Card> = this.room.trackedCards): void {
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
