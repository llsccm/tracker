import { trackerLogger } from '@/utils/logger'
import { createLocationCandidateKey, fromPublicCandidate } from '../candidate/locationCandidate'
import {
  createPublicCandidate,
  normalizePublicPosition,
  type PublicCandidatePosition
} from '../candidate/publicCandidate'
import type { Card } from '../Card'
import type {
  PlayerLocationCandidate,
  PublicCandidate,
  PublicLocationCandidate,
  PublicPosition,
  PublicZoneName,
  SeatID
} from '../types'
import { RoomMovementSourceMethods } from './sources'
import {
  PAIDUI_POSITIONS,
  type MoveTargetZone,
  type PublicCandidatesToHandOptions,
  type RandomHandToPublicOptions,
  type RandomHandTransferCheckOptions,
  type RandomHandTransferOptions,
  type UnknownPileReturnOptions
} from './types'

export class RoomMovementCandidateMethods extends RoomMovementSourceMethods {
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
   */
  markRandomHandTransferCandidates({
    fromSeat,
    targetSeat,
    count,
    sourceTotalBefore,
    sourceHandTotalObserved = false,
    sourceUnknownCount,
    sourceEvent
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
      (sourceHandTotalObserved || sourcePlayer?.hasObservedHandCount) &&
      typeof observedSourceTotal === 'number' &&
      typeof observedUnknownCount === 'number' &&
      observedSourceTotal <= observedUnknownCount
    ) {
      return []
    }

    const existingSourceCards = this.getPlayerHandCardsBySeat(fromSeat)
    // 未观测路径：借这次必要扫描顺带确认是否存在可展示明牌。
    if (
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

    sourceCandidateCards.forEach((card) => {
      card.addSeat(targetSeat, 'randomHandTransferCandidates')
    })

    this.expandConstraintGroupsForCards(sourceCandidateCards, targetSeat)

    // 暗牌候选会被提升为 hand 完整位置候选（locationCandidates + subZoneCandidates）。
    // 此时 expectedSlotsBySeat 的座位层消除会刻意跳过带 subZoneCandidates 的牌、交由位置层处理，
    // 但本组过去只声明了座位层约束，位置层为空——于是目标槽位清零后，暗实体仍留着不可能的
    // 座位候选（如 seat3 满员后 130/131 仍是 {2,3}）。这里镜像一份 hand 位置约束补上该缺口。
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
      expectedSlotsBySeat: new Map([
        [fromSeat, sourceTotal - count],
        [targetSeat, count]
      ]),
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
    unknownCount
  }: RandomHandToPublicOptions): Card[] {
    if (fromSeat === null) return []

    const sourceCandidateCards = this.getKnownHandCardsBySeat(fromSeat)
    if (sourceCandidateCards.length === 0) return []

    const candidate = this.createPublicCandidate(toZone, position, unknownCount)
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

    const candidate = this.createPublicCandidate(toZone, position, count)
    this.room.cards
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
   * 创建公共区候选位置对象。
   */
  createPublicCandidate(
    zone: PublicZoneName,
    position: PublicPosition,
    count: number
  ): PublicCandidate {
    return createPublicCandidate(zone, position, count)
  }

  /**
   * 牌堆顶/底候选被摸走时，把命中的明牌候选传播到摸牌玩家手牌。
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
    const position = this.normalizePublicPosition(fromPosition)
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

    const affectedCards = this.room.cards.filter((card) =>
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

        return [this.createPublicCandidate(candidate.zone, fromPosition, candidateCount - count)]
      })

      const nextPublicLocationCandidates = nextPublicCandidates
        .map((candidate) => fromPublicCandidate(candidate))
        .filter((candidate): candidate is PublicLocationCandidate => Boolean(candidate))
      // 同一身份可同时有牌顶与牌底分支；只消费本次命中的端点，其他公共分支必须保留。
      const retainedLocationCandidates = card
        .getLocationCandidates()
        .filter(
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

    this.expandConstraintGroupsForCards(affectedCards, targetSeat)

    this.room.createConstraintGroup({
      cards: affectedCards,
      candidateSeats: Array.from(new Set(affectedCards.flatMap((card) => Array.from(card.seats)))),
      expectedSlotsBySeat: new Map([[Number(targetSeat), Math.min(count, affectedCards.length)]]),
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
   * 将协议位置常量转换成公共候选位置名。
   */
  normalizePublicPosition(position: PublicPosition): PublicCandidatePosition {
    return normalizePublicPosition(position)
  }

  /**
   * 扩展包含指定卡牌的既有约束组候选席位，避免新传播座位被旧组裁掉。
   */
  expandConstraintGroupsForCards(cards: Card[], seatID: SeatID): void {
    const cardSet = new Set(cards)

    this.room.constraintGroups.forEach((group) => {
      if (group.candidateSeats.size === 0) return

      const hasCard = Array.from(group.cards as Set<Card>).some((card) => cardSet.has(card))
      if (hasCard) {
        group.candidateSeats.add(Number(seatID))
      }
    })
  }

  /**
   * 按移动包的手牌进出数量调整来源和目标玩家总手牌数。
   */
  applyHandTotalDelta(sourceSeat: SeatID | null, targetSeat: SeatID | null, count: number): void {
    if (!(count > 0) || sourceSeat === targetSeat) return

    this.adjustPlayerHandTotal(sourceSeat, -count)
    this.adjustPlayerHandTotal(targetSeat, count)
  }
}
