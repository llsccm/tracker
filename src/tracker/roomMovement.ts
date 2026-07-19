import { trackerLogger } from '@/utils/logger'
import type { Card } from './Card'
import { POSITION_TOP } from './candidate/cardPositions'
import { normalizeSpellID } from './candidate/markSpellID'
import { summarizeMoveContext } from './helper/moveSummary'
import type { Room } from './Room'
import { RoomMovementCandidateMethods } from './roomMovement/candidates'
import type { MoveTargetZone, RoomMoveContext, RoomMovementOptions } from './roomMovement/types'
import type { CardID, PublicZoneName, SeatID } from './types'

/**
 * Room 的移动阶段实现模块。
 * 只保存 room 引用，不持有独立状态，避免移动推断状态在 Room 与子对象之间分裂。
 */
export class RoomMovement extends RoomMovementCandidateMethods {
  declare room: Room

  constructor(room: Room) {
    super()
    this.room = room
  }

  /**
   * 将原始 moveCards 参数规整为后续阶段共享的上下文。
   * 这里集中处理来源席位、目标席位、暗牌数量和协议位置，避免各阶段重复解析 options。
   */
  createMoveContext(
    cardIDs: CardID[] | CardID,
    toZone: MoveTargetZone,
    opt: RoomMovementOptions = {}
  ): RoomMoveContext {
    const normalizedCardIDs = Array.isArray(cardIDs) ? cardIDs : [cardIDs]
    const {
      seatID,
      subZone = 'hand',
      spellID,
      combinationID,
      fromZone = 'pile',
      fromSeatID,
      fromSpellID,
      cardCount = normalizedCardIDs.length,
      handMoveCount: requestedHandMoveCount,
      position = POSITION_TOP,
      fromPosition = position,
      expectedSlotsBySeat,
      resetKnownToUnknown = false,
      sourceCards,
      sourceEvent
    } = opt

    const normalizedSpellID = normalizeSpellID(spellID)
    const normalizedFromSpellID =
      fromSpellID === undefined ? undefined : normalizeSpellID(fromSpellID)
    const targetSeats = this.room.normalizeSeats(seatID ?? [])
    const fromZoneNumber = Number(fromZone)
    const fromSeat =
      fromSeatID !== undefined && fromSeatID !== null
        ? Number(fromSeatID)
        : fromZone !== null &&
            fromZone !== undefined &&
            fromZone !== '' &&
            Number.isFinite(fromZoneNumber)
          ? parseInt(String(fromZone))
          : null
    const fromSubZone = opt.fromSubZone ?? subZone ?? 'hand'
    // 候选身份可由逻辑账本迁移而不移动实体；此时手牌总数变化量与实体移动数不同。
    const handMoveCount = Math.max(
      0,
      Number(requestedHandMoveCount ?? cardCount ?? normalizedCardIDs.length)
    )
    const sourceHandSeat =
      fromSeat !== null && !Number.isNaN(fromSeat) && fromSubZone === 'hand' ? fromSeat : null
    const targetHandSeat =
      toZone === 'player' && subZone === 'hand' && targetSeats.length === 1 ? targetSeats[0] : null
    const knownIDs = normalizedCardIDs.filter((id) => id > 0)
    const sourcePlayer =
      fromSeat !== null && !Number.isNaN(fromSeat) ? this.room.getPlayer(fromSeat) : null

    const context: RoomMoveContext = {
      cardIDs: normalizedCardIDs,
      toZone,
      seatID,
      subZone,
      spellID: normalizedSpellID,
      combinationID,
      fromZone,
      fromSeat,
      fromSubZone,
      fromSpellID: normalizedFromSpellID,
      cardCount: Number(cardCount),
      position,
      fromPosition,
      expectedSlotsBySeat,
      resetKnownToUnknown,
      sourceCards,
      sourceEvent,
      targetSeats,
      handMoveCount,
      sourceHandSeat,
      targetHandSeat,
      sourceHandTotalObserved: sourcePlayer?.hasObservedHandCount === true,
      sourceHandTotalBefore: sourcePlayer?.observedHandCount ?? 0,
      sourceHandUnknownCount: sourcePlayer?.unknownCardCount ?? 0,
      knownIDs,
      sourceIsOutside: fromZone === 'outside',
      unknownCount: Math.max(0, Number(cardCount) || 0, normalizedCardIDs.length) - knownIDs.length,
      knownCards: [],
      movedUnknownCards: [],
      publicMovedCards: [],
      skipUnknownMovement: false,
      hiddenMarkRecord: null
    }

    trackerLogger.debug(
      '移动上下文创建',
      summarizeMoveContext(
        {
          ...context,
          seatID: targetSeats.length === 1 ? targetSeats[0] : null
        },
        { includeSourceCardIDs: true }
      )
    )

    return context
  }

  /**
   * 解析本次移动中的已知物理牌，并恢复此前因候选过广而暂停追踪的明牌。
   * 来源为 outside 时允许补建外部新出现的物理牌。
   */
  resolveKnownMoveCards(context: RoomMoveContext): void {
    const { knownIDs, sourceIsOutside } = context
    let missingIDs: CardID[] = []
    let createdCards: Card[] = []
    // 12 区会暂存未进入初始牌池的技能生成牌，获得时需要按协议正 ID 补建实体。
    const canCreateMissingCards = sourceIsOutside || context.fromZone === 'exile'

    if (canCreateMissingCards) {
      const existingCards = this.room.findCardsByIDs(knownIDs)
      const existingIDs = new Set(existingCards.map((card) => card.id))
      missingIDs = knownIDs.filter((id) => !existingIDs.has(id))
      createdCards =
        missingIDs.length > 0 ? this.room.createExternalCards(missingIDs, missingIDs.length) : []
      const cardMap = new Map<CardID, Card>()
      existingCards.forEach((card) => cardMap.set(card.id, card))
      createdCards.forEach((card) => cardMap.set(card.id, card))
      context.knownCards = knownIDs.map((id) => cardMap.get(id)).filter(Boolean)
    } else {
      context.knownCards = this.room.findCardsByIDs(knownIDs)
    }

    const resumedCardIDs: CardID[] = []
    context.knownCards.forEach((card) => {
      const wasSuspended = card.suspended === true || this.room.suspendedKnownCards.has(card)
      this.room.resumeSuspendedKnownCard(card)
      if (wasSuspended) resumedCardIDs.push(card.id)
    })
    trackerLogger.debug('已知牌解析完成', {
      knownIDs,
      resolvedCardIDs: context.knownCards.map((card) => card.id),
      missingIDs,
      createdCardIDs: createdCards.map((card) => card.id),
      resumedCardIDs,
      canCreateMissingCards,
      sourceIsOutside
    })
  }

  /**
   * 在真正搬牌前传播候选信息。
   * 处理玩家间随机获得手牌、手牌回牌堆、牌堆候选进入手牌三类不确定性语义。
   */
  applyMoveCandidatePropagation(context: RoomMoveContext): void {
    const {
      fromZone,
      fromPosition,
      handMoveCount,
      position,
      sourceEvent,
      sourceHandSeat,
      subZone,
      targetHandSeat,
      toZone,
      unknownCount
    } = context

    // 暗置标记区候选会接管默认暗牌移动，避免明牌身份被未知占位吞掉。
    if (this.handleHiddenMarkMove(context)) return

    if (
      this.shouldPropagateRandomHandTransferCandidates({
        sourceSeat: sourceHandSeat,
        targetSeat: targetHandSeat,
        count: handMoveCount,
        unknownCount,
        sourceEvent
      })
    ) {
      // 随机获得来源手牌时，来源明牌不能直接消失，而是扩展为“来源/目标都可能持有”。
      const propagatedCards = this.markRandomHandTransferCandidates({
        fromSeat: sourceHandSeat,
        targetSeat: targetHandSeat,
        count: handMoveCount,
        sourceTotalBefore: context.sourceHandTotalObserved
          ? context.sourceHandTotalBefore
          : undefined,
        sourceEvent
      })
      // 完整候选覆盖已经表达了这次 K 张转移；此时不能再确定性挑选暗实体搬到目标。
      // 返回空数组表示候选建模失败，仍允许默认未知移动路径执行保守回退。
      context.skipUnknownMovement = propagatedCards.length > 0
    }

    if (
      this.shouldMarkRandomHandToPublicCandidates(
        sourceHandSeat,
        targetHandSeat,
        toZone,
        unknownCount
      )
    ) {
      // 身份未知的手牌回到公共区时，保留牌堆顶/底候选，后续被摸走时还能继续传播。
      this.markRandomHandToPublicCandidates({
        fromSeat: sourceHandSeat,
        toZone,
        position,
        unknownCount
      })
    }

    // 若来源公共区已有候选牌，摸入手牌时把公共候选转化为目标玩家手牌候选。
    this.propagatePublicCandidatesToHand({
      fromZone,
      fromPosition,
      toZone,
      targetSeat: targetHandSeat,
      subZone,
      count: handMoveCount,
      sourceEvent
    })
  }

  /**
   * 移动暗牌占位。
   * 暗牌进入玩家区时绑定候选席位并创建局部分组；进入公共区时维护 Zone 顺序和公共候选。
   */
  moveUnknownCardsForContext(context: RoomMoveContext): void {
    const {
      combinationID,
      expectedSlotsBySeat,
      fromSeat,
      fromSubZone,
      fromSpellID,
      fromPosition,
      fromZone,
      position,
      sourceCards,
      sourceEvent,
      sourceIsOutside,
      spellID,
      subZone,
      targetSeats,
      toZone,
      unknownCount
    } = context

    if (unknownCount <= 0) return

    if (context.skipUnknownMovement) {
      trackerLogger.debug('未知牌移动已由特殊候选逻辑接管', {
        requestedCount: unknownCount,
        fromSeat,
        fromSubZone,
        targetSeats,
        subZone,
        spellID
      })
      return
    }

    if (toZone === 'player') {
      const movedUnknownCards = this.takeSourceCards(unknownCount, {
        sourceIsOutside,
        fromSeat,
        fromSubZone,
        subZone,
        spellID,
        fromSpellID,
        fromZone,
        fromPosition,
        sourceCards,
        sourceEvent
      })

      context.movedUnknownCards = movedUnknownCards
      movedUnknownCards.forEach((card) => {
        this.resolveSourcePlayerCandidate(card, context)
      })
      this.room.removeCardsFromConstraintGroups(movedUnknownCards)

      movedUnknownCards.forEach((card) => {
        card.bindCandidates(targetSeats, subZone, spellID, { known: false })
      })

      // seatID=255 会被 normalizeSeats 过滤为空；这代表无席位技能空间而非某个玩家。
      // 这里按 spellID 建账本，后续从弹窗 mark 回牌堆时直接取这个空间里的占位。
      if (subZone === 'mark' && targetSeats.length === 0) {
        this.registerUnassignedMarkSpaceCards(spellID, movedUnknownCards)
      }

      if (movedUnknownCards.length > 0 && targetSeats.length > 0) {
        this.room.createConstraintGroup({
          id: combinationID,
          cards: movedUnknownCards,
          candidateSeats: targetSeats,
          expectedSlotsBySeat,
          known: false,
          sourceEvent: sourceEvent ?? { type: 'moveCards:unknown' }
        })
      }

      trackerLogger.debug('未知牌进入玩家区', {
        requestedCount: unknownCount,
        movedCardIDs: movedUnknownCards.map((card) => card.id),
        fromSeat,
        fromSubZone,
        fromZone,
        targetSeats,
        subZone,
        spellID,
        knownSourceCardIDs: movedUnknownCards
          .filter((card) => card.isKnown === true)
          .map((card) => card.id),
        constraintCreated: movedUnknownCards.length > 0 && targetSeats.length > 0
      })

      return
    }

    const movedUnknownCards = this.takeSourceCards(unknownCount, {
      sourceIsOutside,
      fromSeat,
      fromSubZone,
      subZone,
      spellID,
      fromSpellID,
      fromZone,
      fromPosition,
      sourceCards,
      sourceEvent
    })

    const takenCount = movedUnknownCards.length
    if (takenCount < unknownCount) {
      const fallbackCount = unknownCount - takenCount
      const fallbackCards = this.room.createExternalCards([], fallbackCount)
      if (fallbackCards.length > 0) {
        trackerLogger.warn('来源实体不足，创建匿名暗占位补足公共区移动', {
          reason: 'moveUnknownCardsForContext:publicFallback',
          requestedCount: unknownCount,
          takenCount,
          createdPlaceholderCount: fallbackCards.length,
          placeholderCardIDs: fallbackCards.map((card) => card.id),
          fromSeat,
          fromSubZone,
          fromZone,
          fromPosition,
          toZone,
          position,
          spellID,
          sourceEvent
        })
      }
      movedUnknownCards.push(...fallbackCards)
    }

    context.movedUnknownCards = movedUnknownCards
    movedUnknownCards.forEach((card) => {
      this.resolveSourcePlayerCandidate(card, context)
    })
    this.room.removeCardsFromConstraintGroups(movedUnknownCards)

    const targetZone = this.room.zones.get(toZone)

    if (targetZone) {
      targetZone.add(movedUnknownCards, position)
    } else {
      movedUnknownCards.forEach((card) => card.moveToPublicZone(toZone))
    }

    context.publicMovedCards.push(...movedUnknownCards)

    this.updatePublicCandidatesAfterUnknownPileReturn({
      toZone,
      position,
      count: unknownCount
    })

    trackerLogger.debug('未知牌进入公共区', {
      requestedCount: unknownCount,
      takenCount,
      createdFallbackCount: Math.max(0, unknownCount - takenCount),
      movedCardIDs: movedUnknownCards.map((card) => card.id),
      fromSeat,
      fromSubZone,
      fromZone,
      toZone,
      position,
      knownSourceCardIDs: movedUnknownCards
        .filter((card) => card.isKnown === true)
        .map((card) => card.id),
      targetZoneExists: Boolean(targetZone)
    })
  }

  /**
   * 移动已知物理牌。
   * 已知牌会先脱离旧约束组，再根据目标区域绑定玩家候选或插入公共 Zone。
   */
  moveKnownCardsForContext(context: RoomMoveContext): void {
    const {
      combinationID,
      expectedSlotsBySeat,
      fromSeat,
      fromSubZone,
      knownCards,
      position,
      resetKnownToUnknown,
      seatID,
      sourceEvent,
      spellID,
      subZone,
      targetSeats,
      toZone
    } = context
    if (knownCards.length === 0) return

    // 已知牌移动可能把原先的无席位暗占位揭示出来，先从空间账本摘除旧引用。
    this.removeUnassignedMarkSpaceCards(knownCards)

    const swappedCardIDs: CardID[] = []
    const handledSpellCardIDs: CardID[] = []
    const resetKnownCardIDs: CardID[] = []
    const resolvedSourceCardIDs: CardID[] = []
    const playerSourceSwapAttempts: unknown[] = []
    const registerUnassignedReplacement = (placeholder: Card | null | undefined) => {
      // 置换回补可能把暗占位放回旧的无席位 mark 位置，必须重新入账供后续回牌堆复用。
      if (placeholder) this.registerUnassignedMarkSpaceCards(placeholder.spellID, [placeholder])
    }
    const observedEquipmentMarkSnapshot = this.getObservedEquipmentMarkSnapshot(context)
    const playerSourceContext = observedEquipmentMarkSnapshot
      ? { ...context, fromSeat: observedEquipmentMarkSnapshot.observedSeat }
      : context
    const effectiveFromSeat = playerSourceContext.fromSeat

    knownCards.forEach((card) => {
      const previousSpellID = card.spellID

      // 如果协议声明该明牌来自玩家区，而本地认为它在别处，用未知占位交换来修正物理身份。
      // 木牛流马完整快照通常只给目标座位；此时把目标座位视为 mark:700 来源座位，
      // 让明牌与木马里的实体暗占位交换，而不是额外残留一张占位牌。
      const isFromPlayerSource =
        effectiveFromSeat !== null &&
        effectiveFromSeat !== undefined &&
        !Number.isNaN(effectiveFromSeat) &&
        Boolean(fromSubZone)

      const shouldSwapSpeculativePlayerIdentity =
        isFromPlayerSource &&
        card.isKnown !== true &&
        card.getLocationCandidates().length > 1 &&
        Boolean(this.findExactUnknownPlayerSourcePlaceholder(playerSourceContext, card))

      if (
        isFromPlayerSource &&
        (!this.isCardInPlayerSource(card, playerSourceContext) ||
          shouldSwapSpeculativePlayerIdentity)
      ) {
        const locationBeforeSwap = card.location
        const placeholder = this.swapKnownCardWithPlayerSourcePlaceholder(card, playerSourceContext)
        let fallbackPlaceholder: Card | null = null
        if (!placeholder && fromSubZone === 'hand') {
          fallbackPlaceholder = this.swapCardWithUnknown(card, playerSourceContext, knownCards)
          const canDeferToKnownSourcePlaceholder =
            context.sourceHandTotalObserved &&
            context.sourceHandTotalBefore <= context.handMoveCount
          const createdSourcePlaceholder =
            !fallbackPlaceholder && !canDeferToKnownSourcePlaceholder
              ? this.createPlayerSourcePlaceholderForKnownCard(card, playerSourceContext)
              : null
          if (!fallbackPlaceholder && createdSourcePlaceholder) {
            fallbackPlaceholder = this.swapCardWithUnknown(card, playerSourceContext, knownCards)
          }
          if (!fallbackPlaceholder && createdSourcePlaceholder) {
            trackerLogger.warn('已创建来源瞬时匿名占位但仍未完成置换', {
              knownCardID: card.id,
              placeholderCardID: createdSourcePlaceholder.id,
              placeholderEntityID: createdSourcePlaceholder.entityID,
              fromSeat,
              fromSubZone,
              toZone,
              sourceEvent
            })
          }
          if (!fallbackPlaceholder) {
            trackerLogger.warn('玩家来源明牌未找到可立即置换的手牌占位', {
              knownCardID: card.id,
              fromSeat,
              fromSubZone,
              toZone,
              sourceHandCards: this.room.cards
                .filter(
                  (sourceCard) =>
                    sourceCard.location === 'player' &&
                    sourceCard.subZone === 'hand' &&
                    sourceCard.seats.has(fromSeat)
                )
                .map((sourceCard) => ({
                  cardID: sourceCard.id,
                  isKnown: sourceCard.isKnown,
                  suspended: sourceCard.suspended,
                  seats: Array.from(sourceCard.seats, Number),
                  hasLocationCandidates: sourceCard.hasLocationCandidates?.() ?? false,
                  hasSubZoneCandidates: sourceCard.hasSubZoneCandidates?.() ?? false
                })),
              sourceEvent
            })
          }
        }
        registerUnassignedReplacement(placeholder)
        registerUnassignedReplacement(fallbackPlaceholder)
        playerSourceSwapAttempts.push({
          knownCardID: card.id,
          locationBeforeSwap,
          locationAfterSwap: card.location,
          primaryPlaceholderID: placeholder?.id ?? null,
          fallbackPlaceholderID: fallbackPlaceholder?.id ?? null,
          stillInPublicZones: Array.from(this.room.zones.entries())
            .filter(([, zone]) => zone.cards.includes(card))
            .map(([zoneID, zone]) => ({
              zoneID,
              index: zone.cards.indexOf(card),
              zoneCardCount: zone.cards.length
            }))
        })
        swappedCardIDs.push(card.id)
      }

      // 已知牌来自公共区但实体不在公共 Zone 时，优先按占位语义置换，避免偷走玩家暗牌。
      const isFromPublicSource =
        !isFromPlayerSource &&
        typeof context.fromZone === 'string' &&
        this.room.zones.has(context.fromZone)
      if (isFromPublicSource && !this.isCardInPublicSource(card, context)) {
        const placeholder = this.swapKnownCardWithPublicSourcePlaceholder(card, context)
        if (placeholder) {
          swappedCardIDs.push(card.id)
          registerUnassignedReplacement(placeholder)
        }
      }

      this.resolveHiddenMarkCandidateFromMove(card, context)
      if (this.resolveSourcePlayerCandidate(card, context)) {
        resolvedSourceCardIDs.push(card.id)
      }

      // 2. Remove from constraint groups
      this.room.removeCardsFromConstraintGroups([card])

      if (spellID && this.room.skillHandlers.has(spellID)) {
        const handler = this.room.skillHandlers.get(spellID)
        handler?.(card, {
          toZone,
          seatID,
          subZone,
          sourceEvent
        })
        handledSpellCardIDs.push(card.id)
      }

      if (toZone === 'player') {
        this.room.clearCardsFromPublicZones([card])
        card.bindCandidates(targetSeats, subZone, spellID, { known: true })
        this.retargetEquipmentMarkContainer(card, context, previousSpellID)
      }
    })

    if (toZone === 'player') {
      this.resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context)

      this.room.createConstraintGroup({
        id: combinationID,
        cards: knownCards,
        candidateSeats: targetSeats,
        expectedSlotsBySeat,
        known: true,
        sourceEvent: sourceEvent ?? { type: 'moveCards' }
      })

      trackerLogger.debug('已知牌进入玩家区', {
        cardIDs: knownCards.map((card) => card.id),
        targetSeats,
        subZone,
        spellID,
        combinationID,
        swappedCardIDs,
        handledSpellCardIDs,
        resolvedSourceCardIDs
      })

      return
    }

    // 手气卡把明牌洗回牌堆后，这些实体重新成为未知牌，后续重摸才能按牌堆实体处理。
    if (resetKnownToUnknown === true && toZone === 'pile') {
      knownCards.forEach((card) => {
        card.reset()
        resetKnownCardIDs.push(card.id)
      })
    }

    if (fromSeat !== null && fromSeat !== undefined && !Number.isNaN(fromSeat)) {
      const knownCardSet = new Set(knownCards)

      const sourceHandCards =
        fromSubZone === 'hand'
          ? this.getPlayerHandCardsBySeat(fromSeat).filter(
              (sourceCard) => !knownCardSet.has(sourceCard) && !sourceCard.suspended
            )
          : []

      const usedPublicResiduePlaceholders = new Set<Card>()
      // 只有观测到来源手牌已被本次移动清空时，确定明牌才可作为旧公共区槽位的替身。
      // 未观测手牌总数时保持保守，优先用暗占位或新建匿名占位，避免偷走仍可能在手里的明牌。
      const canUseKnownSourcePlaceholder =
        context.sourceHandTotalObserved &&
        fromSubZone === 'hand' &&
        context.sourceHandTotalBefore <= context.handMoveCount

      const publicResidues = knownCards.flatMap((card) => {
        const residues: {
          card: Card
          cardID: CardID
          zoneID: PublicZoneName
          index: number
          zoneCardCount: number
          cardLocation: Card['location']
          cardSubZone: Card['subZone']
          cardSeats: SeatID[]
          hasLocationCandidates: boolean
          hasSubZoneCandidates: boolean
        }[] = []

        this.room.zones.forEach((zone, zoneID) => {
          const index = zone.cards.indexOf(card)
          if (index === -1) return

          residues.push({
            card,
            cardID: card.id,
            zoneID,
            index,
            zoneCardCount: zone.cards.length,
            cardLocation: card.location,
            cardSubZone: card.subZone,
            cardSeats: Array.from(card.seats, Number),
            hasLocationCandidates: card.hasLocationCandidates?.() ?? false,
            hasSubZoneCandidates: card.hasSubZoneCandidates?.() ?? false
          })
        })

        return residues
      })

      if (publicResidues.length > 0) {
        const repairedResidues: unknown[] = []
        const unrepairedResidues: unknown[] = []

        publicResidues.forEach(({ card, ...residue }) => {
          const zone = this.room.zones.get(residue.zoneID)

          if (fromSubZone !== 'hand' || !zone?.cards.includes(card)) {
            unrepairedResidues.push(residue)
            return
          }

          let placeholder =
            sourceHandCards.find((sourceCard) => {
              // 同批已知牌必须全部移入目标公共区，不能互相充当残留公共区的回补占位。
              if (sourceCard === card || usedPublicResiduePlaceholders.has(sourceCard)) {
                return false
              }

              if (sourceCard.isKnown !== true) return true

              return canUseKnownSourcePlaceholder
            }) ?? null
          const createdFallback = !placeholder

          if (!placeholder) {
            placeholder = this.room.createExternalCards([], 1)[0] ?? null
            if (placeholder) {
              trackerLogger.warn('公共区残留修复创建匿名回补占位', {
                reason: 'moveKnownCardsForContext:publicResidueFallback',
                knownCardID: card.id,
                placeholderCardID: placeholder.id,
                residue,
                fromSeat,
                fromSubZone,
                toZone,
                position,
                sourceHandTotalObserved: context.sourceHandTotalObserved,
                sourceHandTotalBefore: context.sourceHandTotalBefore,
                handMoveCount: context.handMoveCount,
                canUseKnownSourcePlaceholder,
                sourceEvent
              })
            }
          }

          if (!placeholder) {
            unrepairedResidues.push(residue)
            return
          }

          usedPublicResiduePlaceholders.add(placeholder)
          this.room.removeCardsFromConstraintGroups([placeholder])
          const placeholderWasKnown = placeholder.isKnown === true
          placeholder.moveToPublicZone(residue.zoneID)
          zone.replaceCard(card, placeholder)
          this.removeHiddenMarkPlaceholder(placeholder)
          repairedResidues.push({
            ...residue,
            placeholderCardID: placeholder.id,
            placeholderWasKnown,
            createdFallback,
            zoneCardCountAfter: zone.cards.length
          })
        })

        trackerLogger.warn('玩家来源明牌残留公共区，已尝试用来源占位回补旧公共区槽位', {
          fromSeat,
          fromSubZone,
          toZone,
          position,
          cardIDs: knownCards.map((card) => card.id),
          repairedResidues,
          unrepairedResidues,
          playerSourceSwapAttempts,
          sourceEvent
        })
      }
    }

    const targetZone = this.room.zones.get(toZone)
    if (targetZone) {
      targetZone.add(knownCards, position)
    } else {
      knownCards.forEach((card) => card.moveToPublicZone(toZone))
    }

    context.publicMovedCards.push(...knownCards)

    trackerLogger.debug('已知牌进入公共区', {
      cardIDs: knownCards.map((card) => card.id),
      toZone,
      position,
      spellID,
      swappedCardIDs,
      handledSpellCardIDs,
      resetKnownCardIDs,
      resolvedSourceCardIDs,
      targetZoneExists: Boolean(targetZone)
    })
  }

  /**
   * 为移入公共区的一组牌补充组合约束。
   * 公共区自身不表达 owner，这里只保留组合关系，供后续回到玩家区时继续收敛。
   */
  createPublicMoveConstraintGroup(context: RoomMoveContext): void {
    const { combinationID, publicMovedCards, sourceEvent, toZone } = context
    if (toZone === 'player' || !combinationID || publicMovedCards.length === 0) return

    this.room.createConstraintGroup({
      id: combinationID,
      cards: publicMovedCards,
      sourceEvent: sourceEvent ?? { type: 'moveCards:publicGroup' }
    })
  }
}
