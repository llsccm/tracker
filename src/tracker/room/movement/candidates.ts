import { trackerLogger } from '@/utils/logger'
import { getPopupSpaceCards } from './popupSpaces'
import {
  createLocationCandidateKey,
  fromPublicCandidate
} from '@/tracker/candidate/locationCandidate'
import { createPublicCandidate, normalizePublicPosition } from '@/tracker/candidate/publicCandidate'
import type { Card } from '@/tracker/model'
import { getConstraintSlotState } from '@/tracker/constraint/constraintSlots'
import type {
  PlayerLocationCandidate,
  PublicLocationCandidate,
  SeatID,
  SpellID
} from '@/tracker/types'
import type { Room } from '@/tracker/Room'
import { getKnownHandCardsBySeat, getPlayerHandCardsBySeat } from './sourceQueries'
import {
  PAIDUI_POSITIONS,
  type StoredToHandCandidatesOptions,
  type MoveTargetZone,
  type PublicCandidatesToHandOptions,
  type RandomHandToPublicOptions,
  type RandomHandTransferCheckOptions,
  type RandomHandTransferOptions,
  type UnknownPileReturnOptions
} from './types'

/**
 * 维护随机移动的候选传播与局部数量约束；共用 Room 状态，不独立缓存推断结果。
 * 普通来源取牌由来源组件负责，整体收敛仍由 Room 在移动阶段结束后执行。
 */
export class RoomMovementCandidates {
  constructor(private readonly room: Room) {}

  /**
   * 判断玩家间随机手牌转移是否值得做完整实体候选传播。
   *
   * 仅在跨座位、有暗牌数量，且来源手牌至少存在一张明/候选明牌时返回 true。
   * 全暗来源没有可展示身份，N 选 K 只会制造无 UI 价值的双边暗候选，
   * 此时应回退默认暗牌移动。
   *
   * 有观测手牌快照时用 O(1) 比较 total/unknown，避免 getKnownHandCardsBySeat 全表扫描。
   */
  shouldPropagateRandomHandTransferCandidates({
    sourceSeat,
    targetSeat,
    count,
    unknownCount,
    sourceHandTotalObserved = false,
    sourceHandTotalBefore = 0,
    sourceHandUnknownCount = 0,
    sourceEvent
  }: RandomHandTransferCheckOptions): boolean {
    // 非跨座位、无转移张数，或席位缺失时，不构成随机手牌转移。
    if (!(count > 0) || sourceSeat === null || targetSeat === null || sourceSeat === targetSeat) {
      return false
    }

    // 纯展示事件不改物理归属，不需要候选传播。
    if (sourceEvent?.type === 'showCards') return false
    // 没有暗牌数量时，已知牌路径已足够，不必走随机转移建模。
    if (!(unknownCount > 0)) return false

    // 候选传播的核心价值是“来源明牌不能直接消失，而要扩展为来源/目标都可能持有”。
    // unknown = observed - known - candidateKnown；total > unknown 即至少有一张明/候选明。
    // 未观测时无法 O(1) 判定，放行给 mark 在单次手牌扫描里收口。
    if (sourceHandTotalObserved) {
      return sourceHandTotalBefore > sourceHandUnknownCount
    }

    return true
  }

  /**
   * 玩家间随机获得手牌时，让来源手牌的全部实体共同参与来源/目标位置约束。
   * 返回参与建模的实体；空数组表示未建立候选模型，调用方仍可执行默认暗牌移动。
   */
  markRandomHandTransferCandidates({
    fromSeat,
    targetSeat,
    count,
    sourceTotalBefore,
    sourceHandTotalObserved = false,
    sourceUnknownCount,
    sourceEvent,
    force = false
  }: RandomHandTransferOptions): Card[] {
    if (!(count > 0) || fromSeat === null || targetSeat === null || fromSeat === targetSeat) {
      return []
    }

    const sourcePlayer = this.room.getPlayer(fromSeat)
    // 有观测快照时先 O(1) 拒绝全暗来源，避免无意义的手牌扫描与 N 选 K。
    const observedSourceTotal =
      sourceTotalBefore ??
      (sourcePlayer?.hasObservedHandCount ? sourcePlayer.observedHandCount : undefined)
    const observedUnknownCount =
      sourceUnknownCount ??
      (sourcePlayer?.hasObservedHandCount ? sourcePlayer.unknownCardCount : undefined)
    if (
      !force &&
      (sourceHandTotalObserved || sourcePlayer?.hasObservedHandCount) &&
      typeof observedSourceTotal === 'number' &&
      typeof observedUnknownCount === 'number' &&
      observedSourceTotal <= observedUnknownCount
    ) {
      return []
    }

    const existingSourceCards = getPlayerHandCardsBySeat(this.room, fromSeat)
    // 未观测路径：借这次必要扫描顺带确认是否存在可展示明牌。
    if (
      !force &&
      !(sourceHandTotalObserved || sourcePlayer?.hasObservedHandCount) &&
      !existingSourceCards.some((card) => card.isKnown === true)
    ) {
      return []
    }

    // 唯一归属实体才按 1 实体 = 1 手牌槽计；多座位候选只表示“可能在该手牌”。
    const exclusiveSourceCards = existingSourceCards.filter((card) => card.seats.size === 1)
    const ambiguousSourceCards = existingSourceCards.filter((card) => card.seats.size > 1)
    // 手牌数 delta 在候选传播前已经应用，因此优先使用 createMoveContext 保存的移动前快照。
    // 直接读取 sourcePlayer.observedHandCount 会把“转移后的 6 张”误当成候选全集大小。
    const sourceTotal =
      sourceTotalBefore ??
      (sourcePlayer?.hasObservedHandCount
        ? sourcePlayer.observedHandCount
        : exclusiveSourceCards.length > 0
          ? exclusiveSourceCards.length
          : existingSourceCards.length)

    // 只有唯一归属实体能完整覆盖转移前手牌时，才能建立 N 选 K 约束。
    // 多座位候选可多于观测手牌数（例如上一次随机转移后仍保留双边候选），不能据此判 overflow。
    if (sourceTotal < count || sourceTotal <= 0) {
      trackerLogger.warn('随机手牌转移无法建立完整实体候选覆盖', {
        fromSeat,
        targetSeat,
        count,
        sourceTotal,
        existingEntityCount: existingSourceCards.length,
        exclusiveEntityCount: exclusiveSourceCards.length,
        ambiguousEntityCount: ambiguousSourceCards.length,
        reason: 'insufficientSource'
      })

      return []
    }

    if (exclusiveSourceCards.length > sourceTotal) {
      trackerLogger.warn('随机手牌转移无法建立完整实体候选覆盖', {
        fromSeat,
        targetSeat,
        count,
        sourceTotal,
        existingEntityCount: existingSourceCards.length,
        exclusiveEntityCount: exclusiveSourceCards.length,
        ambiguousEntityCount: ambiguousSourceCards.length,
        reason: 'entityOverflow'
      })

      return []
    }

    // 唯一归属实体已完整覆盖手牌时，优先只用它们建模，避免把上一次随机转移的
    // 跨座位残留候选再次并入本次 N 选 K，造成 existingEntityCount > sourceTotal。
    const seedSourceCards =
      exclusiveSourceCards.length === sourceTotal ? exclusiveSourceCards : existingSourceCards

    // 协议确认了手牌总数，却没有足够的真实实体时，用匿名实体补齐“确定存在”的槽位。
    // 这里不从牌堆猜测物理 ID，避免错误身份进一步污染牌堆顺序和后续明牌收敛。
    const missingEntityCount = Math.max(0, sourceTotal - seedSourceCards.length)
    const fallbackCards =
      missingEntityCount > 0 ? this.room.createExternalCards([], missingEntityCount) : []
    fallbackCards.forEach((card) => {
      card.bindCandidates([fromSeat], 'hand', null, { known: false })
    })

    const sourceCandidateCards = seedSourceCards.concat(fallbackCards)
    // 唯一归属完整覆盖时要求 N === sourceTotal；否则至少覆盖 sourceTotal。
    if (
      exclusiveSourceCards.length === sourceTotal
        ? sourceCandidateCards.length !== sourceTotal
        : sourceCandidateCards.length < sourceTotal
    ) {
      return []
    }

    // 保留实体原有的其他席位候选，再加入本次目标席位，避免覆盖前序不确定性。
    const candidateSeats = Array.from(
      new Set(sourceCandidateCards.flatMap((card) => Array.from(card.seats)).concat(targetSeat))
    )

    // addSeat 会在已有完整位置候选时真正追加目标手牌候选，不再只过滤旧候选。
    sourceCandidateCards.forEach((card) => {
      card.addSeat(targetSeat, 'randomHandTransferCandidates')
    })

    // 后续随机转移会重新分配来源/目标手牌槽位；旧批次对这两个位置的
    // 期望数量只适用于上一事件，必须先失效，否则旧组的 `target=0`
    // 会在收敛时删除本次新加入的目标候选。
    this.invalidateHandTransferConstraintsForCards(sourceCandidateCards, fromSeat, targetSeat)
    // 完整 hand 位置名额负责明暗实体的同一套数量约束。
    const fromHandKey = createLocationCandidateKey({
      type: 'player',
      seatID: fromSeat,
      subZone: 'hand',
      spellID: null
    })

    const targetHandKey = createLocationCandidateKey({
      type: 'player',
      seatID: targetSeat,
      subZone: 'hand',
      spellID: null
    })

    // 全部 N 个实体共同竞争两个手牌位置：来源剩余 N-K 个，目标获得 K 个。
    // 暗实体也参与槽位守恒，但不会因此公开其物理身份。
    this.room.createConstraintGroup({
      cards: sourceCandidateCards,
      candidateSeats,
      expectedSlotsByLocation: new Map([
        [fromHandKey, sourceTotal - count],
        [targetHandKey, count]
      ]),
      // 混合组只约束位置；身份公开状态由每张牌自己的 isKnown 保持。
      known: false,
      sourceEvent: sourceEvent ?? { type: 'randomHandTransferCandidates' }
    })

    trackerLogger.info('手牌候选传播', {
      fromSeat,
      targetSeat,
      count,
      sourceTotal,
      expectedSourceSlots: sourceTotal - count,
      expectedTargetSlots: count,
      createdAnonymousCount: fallbackCards.length,
      // 日志只展开已公开身份；暗实体仅输出数量，避免调试信息泄露其真实 ID。
      cards: sourceCandidateCards
        .filter((card) => card.isKnown === true)
        .map((card) => ({
          id: card.id,
          name: card.name,
          seats: Array.from(card.seats)
        })),
      hiddenEntityCount: sourceCandidateCards.filter((card) => card.isKnown !== true).length
    })

    return sourceCandidateCards
  }

  /**
   * 标记区可见牌多于协议暗牌张数时，建立“标记区 / 目标手牌”双边候选。
   *
   * 典型场景：标记区 2 张明牌，其中 1 张被暗置交给其他玩家手牌。协议只给张数，
   * 无法确定是哪一张，用第一张明牌冒充被交出的牌会把随机猜测固化成身份互换。
   * 参与牌保留原物理投影，完整位置候选表达不确定性，数量约束负责后续收敛。
   * @returns 是否已接管本次暗牌移动。
   */
  markStoredToHandCandidates({
    fromPopupSpaceID,
    gainSpellID,
    fromSeat,
    fromSpellID,
    toSeat,
    count,
    sourceEvent
  }: StoredToHandCandidatesOptions): boolean {
    if (!(count > 0) || toSeat === null) return false
    if (fromPopupSpaceID === undefined && (fromSeat === null || fromSpellID == null)) return false

    const isPopup = fromPopupSpaceID !== undefined
    const spaceCards = isPopup ? getPopupSpaceCards(this.room, fromPopupSpaceID) : []
    // 混合明暗不能把可见身份数冒充空间总数。
    if (isPopup && spaceCards.some((card) => !card.isKnown)) return false
    const markCards = isPopup
      ? spaceCards
      : getVisibleMarkSpaceCards(this.room, fromSeat, fromSpellID)
    // 只有可见牌多于协议张数时才是“多选一”；唯一解仍由来源取牌直接搬走。
    if (!isPopup && markCards.length <= count) return false

    const markCandidate = isPopup
      ? { type: 'popup' as const, spaceID: fromPopupSpaceID }
      : {
          type: 'player' as const,
          seatID: fromSeat,
          subZone: 'mark',
          spellID: fromSpellID
        }
    const handCandidate: PlayerLocationCandidate = {
      type: 'player',
      seatID: toSeat,
      subZone: 'hand',
      spellID: null
    }
    const markKey = createLocationCandidateKey(markCandidate)
    const handKey = createLocationCandidateKey(handCandidate)
    const hasStoredCandidates = markCards.some((card) => card.hasLocationCandidates())
    // 连续暗取复用覆盖整个空间的精确名额，不能将候选身份数量当作剩余物理张数。
    // 玩家标记区和弹窗空间都可能在同一批次内连续收到多条暗交协议。
    const previousGroup = hasStoredCandidates
      ? Array.from(this.room.constraintGroups.values()).find((group) => {
          const slots = group.expectedSlotsByLocation.get(markKey)
          return (
            slots !== undefined &&
            slots.min === slots.max &&
            markCards.every((card) => group.cards.has(card))
          )
        })
      : undefined
    if (hasStoredCandidates && !previousGroup) return false
    const sourceCount = previousGroup?.expectedSlotsByLocation.get(markKey)?.min ?? markCards.length
    if (previousGroup ? sourceCount < count : sourceCount <= count) return false

    const slots = new Map(previousGroup?.expectedSlotsByLocation)
    const handState = previousGroup
      ? getConstraintSlotState(previousGroup.cards, handCandidate, { min: 0, max: 0 })
      : null
    const previousHandSlots = slots.get(handKey) ?? {
      min: handState?.exactCards.length ?? 0,
      max: handState ? handState.exactCards.length + handState.candidateCards.length : 0
    }
    slots.set(markKey, { min: sourceCount - count, max: sourceCount - count })
    slots.set(handKey, {
      min: previousHandSlots.min + count,
      max: previousHandSlots.max + count
    })

    // 先按移动前的确定位置扣减旧组名额，再扩展候选；扩展后已无法辨认原来的槽位。
    // 连续暗取仍保留旧目标手牌名额与成员，只更新本次两个端点。
    if (!previousGroup) this.room.removeCardsFromConstraintGroups(markCards)

    markCards.forEach((card) => {
      const otherCandidates = card.locationCandidates.filter((candidate) => {
        const key = createLocationCandidateKey(candidate)
        return key !== markKey && key !== handKey
      })
      card.setLocationCandidates(
        [...otherCandidates, markCandidate, handCandidate],
        'markStoredToHandCandidates'
      )
      if (gainSpellID !== undefined) card.recordHandGain(toSeat, gainSpellID)
    })

    // 全部参与牌共同竞争空间与历次目标手牌名额。
    // 候选数一开始大于名额，不会触发强锁；某张牌离场、名额恰好等于剩余候选数时才收敛。
    this.room.createConstraintGroup({
      id: previousGroup?.id,
      cards: markCards,
      candidateSeats: isPopup ? [toSeat] : Array.from(new Set([fromSeat, toSeat])),
      expectedSlotsByLocation: slots,
      known: previousGroup?.known ?? true,
      sourceEvent: sourceEvent ?? { type: 'markStoredToHandCandidates' }
    })

    trackerLogger.info('标记区可见牌多于暗牌张数，建立标记/手牌双边候选', {
      fromSeat,
      fromSpellID,
      toSeat,
      count,
      cardIDs: markCards.map((card) => card.id),
      markSlots: sourceCount - count,
      handSlots: slots.get(handKey),
      locationCandidates: markCards.map((card) =>
        card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate))
      )
    })

    return true
  }

  /**
   * 判断是否需要把来源手牌候选传播到公共牌堆候选。
   */
  shouldMarkRandomHandToPublicCandidates(
    sourceSeat: SeatID | null,
    targetSeat: SeatID | null,
    toZone: MoveTargetZone,
    unknownCount: number
  ): boolean {
    return sourceSeat !== null && targetSeat === null && toZone === 'pile' && unknownCount > 0
  }

  /**
   * 玩家暗牌回到牌堆时，把该玩家可能持有的明牌追加为牌堆顶/底候选。
   */
  markRandomHandToPublicCandidates({
    fromSeat,
    toZone,
    position,
    unknownCount,
    candidateSource
  }: RandomHandToPublicOptions): Card[] {
    if (fromSeat === null) return []

    const sourceCandidateCards = candidateSource
      ? candidateSource.cards.filter(
          (card) =>
            card.isKnown === true &&
            card.location === 'player' &&
            card.subZone === 'hand' &&
            card.seats.has(fromSeat)
        )
      : getKnownHandCardsBySeat(this.room, fromSeat)

    if (candidateSource) {
      // 原转移的 A/B 名额不再适用于回堆后的代表实体，保守失效而不新建精确公共区约束。
      // 用原始集合查找受影响的旧组，避免候选已收敛后遗漏仍残留的数量条件。
      this.invalidateHandTransferConstraintsForCards(
        candidateSource.cards,
        candidateSource.fromSeat,
        fromSeat
      )
    }
    if (sourceCandidateCards.length === 0) return []

    const candidate = createPublicCandidate(toZone, position, unknownCount)
    sourceCandidateCards.forEach((card) => card.addPublicCandidate(candidate))

    trackerLogger.info('手牌候选进入公共区', {
      fromSeat,
      toZone,
      position,
      unknownCount,
      cards: sourceCandidateCards.map((card) => ({
        id: card.id,
        name: card.name,
        seats: Array.from(card.seats),
        publicCandidates: card.publicCandidates
      }))
    })

    return sourceCandidateCards
  }

  /**
   * 当牌堆未知牌重新摆放顶/底时，同步更新已有公共候选的位置描述。
   */
  updatePublicCandidatesAfterUnknownPileReturn({
    toZone,
    position,
    count
  }: UnknownPileReturnOptions): void {
    if (toZone !== 'pile' || !(count > 0)) return

    const candidate = createPublicCandidate(toZone, position, count)
    this.room.trackedCards
      .filter((card) =>
        card.publicCandidates?.some((item) => item.zone === 'pile' && item.position === 'top')
      )
      .forEach((card) => {
        if (candidate.position === 'top') {
          card.removePublicCandidates((item) => item.zone === 'pile' && item.position === 'top')
        }
        card.addPublicCandidate(candidate)
      })
  }

  /**
   * 牌堆顶/底候选被摸走时，把命中的明牌候选传播到摸牌玩家手牌。
   * 返回受影响的实体；只表达位置可能性，不直接认定某张候选身份就是实际被摸走的牌。
   */
  propagatePublicCandidatesToHand({
    fromZone,
    fromPosition,
    toZone,
    targetSeat,
    subZone,
    count,
    sourceEvent
  }: PublicCandidatesToHandOptions): Card[] {
    const position = normalizePublicPosition(fromPosition)
    // 非顶部底部
    if (
      fromZone !== 'pile' ||
      toZone !== 'player' ||
      subZone !== 'hand' ||
      targetSeat === null ||
      !(count > 0) ||
      !PAIDUI_POSITIONS.includes(position)
    ) {
      return []
    }

    const affectedCards = this.room.trackedCards.filter((card) =>
      card.publicCandidates?.some(
        (candidate) => candidate.zone === fromZone && candidate.position === position
      )
    )

    if (affectedCards.length === 0) return []

    const targetHandCandidate: PlayerLocationCandidate = {
      type: 'player',
      seatID: Number(targetSeat),
      subZone: 'hand',
      spellID: null
    }

    affectedCards.forEach((card) => {
      const nextPublicCandidates = card.publicCandidates.flatMap((candidate) => {
        if (candidate.zone !== fromZone || candidate.position !== position) return [candidate]
        const candidateCount = candidate.count
        if (typeof candidateCount !== 'number') return [candidate]
        if (count >= candidateCount) return []

        return [createPublicCandidate(candidate.zone, fromPosition, candidateCount - count)]
      })

      const nextPublicLocationCandidates = nextPublicCandidates
        .map((candidate) => fromPublicCandidate(candidate))
        .filter((candidate): candidate is PublicLocationCandidate => Boolean(candidate))
      // 同一身份可同时有牌顶与牌底分支；只消费本次命中的端点，其他公共分支必须保留。
      const retainedLocationCandidates = card.locationCandidates.filter(
        (candidate) =>
          candidate.type !== 'public' ||
          candidate.zone !== fromZone ||
          candidate.position !== position
      )
      card.setLocationCandidates(
        [...retainedLocationCandidates, ...nextPublicLocationCandidates, targetHandCandidate],
        'publicCandidatesToHand'
      )
    })

    this.room.createConstraintGroup({
      cards: affectedCards,
      candidateSeats: Array.from(new Set(affectedCards.flatMap((card) => Array.from(card.seats)))),
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(targetHandCandidate), Math.min(count, affectedCards.length)]
      ]),
      known: true,
      sourceEvent: sourceEvent ?? { type: 'publicCandidatesToHand' }
    })

    trackerLogger.info('公共候选进入手牌', {
      fromZone,
      position,
      targetSeat,
      count,
      cards: affectedCards.map((card) => ({
        id: card.id,
        name: card.name,
        seats: Array.from(card.seats),
        publicCandidates: card.publicCandidates
      }))
    })

    return affectedCards
  }

  /**
   * 使参与后续随机手牌转移的旧约束批次失效。
   *
   * 旧组仍可保留第三方位置（例如同一批牌还可能属于另一名玩家），但来源和
   * 目标手牌的精确槽位已经被新的随机转移重新分配，继续保留会把新目标候选
   * 错误地裁成旧批次的零名额。
   */
  private invalidateHandTransferConstraintsForCards(
    cards: Card[],
    fromSeat: SeatID,
    targetSeat: SeatID
  ): void {
    const cardSet = new Set(cards)
    const affectedSeats = new Set([Number(fromSeat), Number(targetSeat)])
    let changed = false

    this.room.constraintGroups.forEach((group, groupID) => {
      let hasMatchingCard = false
      for (const card of group.cards) {
        if (!cardSet.has(card)) continue
        hasMatchingCard = true
        break
      }
      if (!hasMatchingCard) return

      let groupChanged = false

      affectedSeats.forEach((seatID) => {
        const handLocationKey = createLocationCandidateKey({
          type: 'player',
          seatID,
          subZone: 'hand',
          spellID: null
        })
        const handLocationKeyParts = handLocationKey.split(':')
        const locationPrefix = `${handLocationKeyParts.slice(0, -1).join(':')}:`
        const locationKeys = Array.from(group.expectedSlotsByLocation.keys()).filter((key) =>
          key.startsWith(locationPrefix)
        )

        locationKeys.forEach((key) => {
          if (group.expectedSlotsByLocation.delete(key)) groupChanged = true
        })
      })

      if (!groupChanged) return

      if (group.expectedSlotsByLocation.size === 0) {
        this.room.deleteConstraintGroup(groupID)
      }
      changed = true
    })

    if (changed) {
      this.room.markConstraintGroupsDirty('invalidateHandTransferConstraintsForCards')
    }
  }
}

/** 收集某标记空间内仍可能位于该空间、可展示身份且未交给账本管理的牌。 */
function getVisibleMarkSpaceCards(room: Room, seatID: SeatID, spellID: SpellID): Card[] {
  const markCandidate = {
    type: 'player' as const,
    seatID,
    subZone: 'mark' as const,
    spellID
  }
  const markKey = createLocationCandidateKey(markCandidate)

  return room
    .refreshPlayerSnapshot()
    .filter(
      (card) =>
        card.location === 'player' &&
        card.isKnown === true &&
        card.suspended !== true &&
        card
          .getPossibleLocations()
          .some((candidate) => createLocationCandidateKey(candidate) === markKey)
    )
}
