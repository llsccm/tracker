import { trackerLogger } from '@/utils/logger'
import { isAnonymous, type Card } from './Card'
import { POSITION_TOP } from './candidate/cardPositions'
import { normalizeSpellID } from './candidate/markSpellID'
import { summarizeMoveContext } from './helper/moveSummary'
import type { Room } from './Room'
import { RoomMovementCandidateMethods } from './roomMovement/candidates'
import type {
  KnownCardCreationReason,
  MoveTargetZone,
  RoomMoveContext,
  RoomMovementOptions
} from './roomMovement/types'
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
      fromZone: requestedFromZone,
      fromSeatID,
      fromSpellID,
      cardCount = normalizedCardIDs.length,
      handMoveCount: requestedHandMoveCount,
      moveType,
      position = POSITION_TOP,
      fromPosition = position,
      expectedSlotsBySeat,
      resetKnownToUnknown = false,
      sourceCards,
      postMovePublicCandidates,
      sourceEvent
    } = opt

    const normalizedSpellID = normalizeSpellID(spellID)
    const normalizedFromSpellID =
      fromSpellID === undefined ? undefined : normalizeSpellID(fromSpellID)
    const targetSeats = this.room.normalizeSeats(seatID ?? [])
    // 显式 fromSeatID 表示玩家区来源（与 MoveEventNormalizer 一致 fromZone=null）；
    // 不能默认 pile，否则会抢先走公共区 known 解析，跳过手牌/mark 匿名物化。
    const hasExplicitFromSeat = fromSeatID !== undefined && fromSeatID !== null
    const fromZone =
      requestedFromZone !== undefined ? requestedFromZone : hasExplicitFromSeat ? null : 'pile'
    const fromZoneNumber = Number(fromZone)
    const fromSeat = hasExplicitFromSeat
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
      moveType,
      position,
      fromPosition,
      expectedSlotsBySeat,
      resetKnownToUnknown,
      sourceCards,
      postMovePublicCandidates,
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
    const {
      fromPosition,
      fromSeat,
      fromSubZone,
      fromZone,
      knownIDs,
      sourceCards,
      sourceIsOutside
    } = context
    let missingIDs: CardID[]
    let createdCards: Card[] = []
    // 12 区会暂存未进入初始牌池的技能生成牌；它和普通 known 缺口都要建实体，
    // 但前者是协议事实，后者是解析失败后的兜底，诊断语义不同。
    const isExternalSource = sourceIsOutside || context.fromZone === 'exile'
    let knownCardCreationReason: KnownCardCreationReason | null = null

    if (isExternalSource) {
      knownCardCreationReason = 'external-source'
      const existingCards = this.room.findCardsByIDs(knownIDs)
      const existingIDs = new Set(existingCards.map((card) => card.id))
      missingIDs = knownIDs.filter((id) => !existingIDs.has(id))
      if (missingIDs.length > 0) {
        createdCards = this.room.createExternalCards(missingIDs, missingIDs.length)
      }
      const cardMap = new Map<CardID, Card>()
      existingCards.forEach((card) => cardMap.set(card.id, card))
      createdCards.forEach((card) => cardMap.set(card.id, card))
      context.knownCards = knownIDs.map((id) => cardMap.get(id)).filter(Boolean)
    } else if (typeof fromZone === 'string' && this.room.zones.has(fromZone)) {
      // 公共区来源按协议端点顺序物化，避免从别处搬运被提前占用的真实实体。
      const sourceZone = this.room.zones.get(fromZone)
      const endpointCount = Math.max(
        knownIDs.length,
        Math.max(0, Math.floor(Number(context.cardCount) || 0))
      )
      // 只检查本次协议移动覆盖的物理范围，不能为了寻找匿名槽扫描整副牌堆。
      // B13 等指定身份获取仍由 existingInSource 精确命中来源区中的同 ID 实体；只有身份尚未
      // 定位时，才需要在这段协议端点范围内分配匿名物理槽。
      const endpointCards = this.room.getPublicEndpointCards(fromZone, endpointCount, fromPosition)
      // Phase 5 后公共 known 端点只有两种合法物理来源：端点中已经存在的同 ID 实体，
      // 或没有真实身份的匿名槽。其它正 ID 即使 isKnown=false，也不能被本批身份覆盖。
      // endpointCards 已按协议范围截取，因此不能跳过一个正 ID 暗端点去消费更深处匿名槽。
      const availableTargets = endpointCards.filter(isAnonymous)
      const anonymousTargetCountBefore = availableTargets.length
      const resolveAttempts: Record<string, unknown>[] = []

      context.knownCards = knownIDs
        .map((cardID) => {
          const existing = this.room.cardIndex.get(cardID)
          const existingInSource = Boolean(existing && sourceZone?.cards.includes(existing))
          const hadAnonymousTarget = !existingInSource && availableTargets.length > 0
          const target = existingInSource ? existing : availableTargets.shift()
          const ledgerBefore = {
            inCardIndex: this.room.cardIndex.has(cardID),
            inUnlocated: this.room.unlocatedIdentities.has(cardID),
            inDeckIdentities: this.room.deckIdentities.has(cardID),
            existingLocation: existing?.location ?? null,
            existingIsKnown: existing?.isKnown === true,
            existingInSource,
            tookAnonymousTarget: Boolean(target && target !== existing && isAnonymous(target)),
            targetEntityID: target?.entityID ?? null,
            remainingAnonymousTargets: availableTargets.length
          }
          const materialized = this.room.materialize(cardID, target ?? null)
          // 匿名端点按协议顺序一经分配就不回塞。正常情况下 materialize 必然成功；若身份
          // 分区异常导致失败，保留该名额可避免后续 CardID 错占前一张牌的物理端点。
          const resolved = materialized ?? existing
          resolveAttempts.push({
            cardID,
            ...ledgerBefore,
            hadAnonymousTarget,
            materializeOk: Boolean(resolved),
            afterInCardIndex: this.room.cardIndex.has(cardID)
          })
          return resolved
        })
        .filter((card): card is Card => Boolean(card))
      missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id))

      // 端点无匿名槽可物化时，与 outside/exile 一致：按协议正 ID 补建外部实体，避免 knownCards 静默短少。
      if (missingIDs.length > 0) {
        trackerLogger.info('known 路径实体缺口，将 createExternal', {
          knownIDs,
          missingIDs,
          fromZone,
          fromPosition,
          anonymousTargetCountBefore,
          anonymousTargetCountAfter: availableTargets.length,
          sourceZoneCards: (sourceZone?.cards ?? []).map((card) => ({
            id: card.id,
            entityID: card.entityID,
            isKnown: card.isKnown === true,
            isAnonymous: isAnonymous(card)
          })),
          endpointCards: endpointCards.map((card) => ({
            id: card.id,
            entityID: card.entityID,
            isKnown: card.isKnown === true,
            isAnonymous: isAnonymous(card)
          })),
          resolveAttempts,
          knownIDLedgers: knownIDs.map((cardID) => ({
            cardID,
            inCardIndex: this.room.cardIndex.has(cardID),
            inUnlocated: this.room.unlocatedIdentities.has(cardID),
            inDeckIdentities: this.room.deckIdentities.has(cardID)
          }))
        })
        knownCardCreationReason = 'known-fallback'
        createdCards = this.room.createExternalCards(missingIDs, missingIDs.length)
        const cardMap = new Map(context.knownCards.map((card) => [card.id, card]))
        createdCards.forEach((card) => cardMap.set(card.id, card))
        context.knownCards = knownIDs
          .map((id) => cardMap.get(id))
          .filter((card): card is Card => Boolean(card))
        missingIDs = knownIDs.filter((id) => !cardMap.has(id))
      }
    } else if (fromSeat !== null && !Number.isNaN(fromSeat) && fromSubZone) {
      // 玩家/mark 通用模型允许本机已知身份暂时保持暗状态，两类实体统一由 materialize 收口。
      // 手牌 known 禁止消费 mark:700 等占位；木马身份只在 mark 收敛/快照路径 materialize。
      const markSpellID = context.fromSpellID ?? context.spellID

      const explicitTargets = sourceCards?.filter(isAnonymous) ?? []
      let sourceTargets =
        explicitTargets.length > 0
          ? explicitTargets
          : this.getUnknownPlayerSourceCards(fromSeat, fromSubZone, markSpellID)
              .filter(isAnonymous)
              .slice(0, knownIDs.length)

      // 手牌路径只保留 hand 匿名，绝不纳入 mark 占位。
      if (fromSubZone === 'hand') {
        sourceTargets = sourceTargets.filter((card) => card.subZone === 'hand')
      }

      const availableTargets = [...sourceTargets]
      const sourceAnonymousCountBefore = availableTargets.length

      // 木马等装备容器迁座后，协议 FromID 仍可能是旧座位，而暗占位已投影到目标座位。
      // 全明快照物化时需追加目标座位 mark 匿名槽，避免 knownCards 静默短少、弱候选无法收敛。
      const isFullKnownMarkSnapshot =
        fromSubZone === 'mark' &&
        context.subZone === 'mark' &&
        context.toZone === 'player' &&
        context.unknownCount === 0 &&
        knownIDs.length === context.cardCount &&
        knownIDs.length > 0
      if (isFullKnownMarkSnapshot && availableTargets.length < knownIDs.length) {
        const usedTargets = new Set(availableTargets)
        context.targetSeats.forEach((targetSeat) => {
          if (Number(targetSeat) === Number(fromSeat)) return
          this.getUnknownPlayerSourceCards(targetSeat, fromSubZone, markSpellID)
            .filter(isAnonymous)
            .forEach((card) => {
              if (usedTargets.has(card) || availableTargets.length >= knownIDs.length) return
              usedTargets.add(card)
              availableTargets.push(card)
            })
        })
      }

      const resolveAttempts: Record<string, unknown>[] = []
      context.knownCards = knownIDs
        .map((cardID) => {
          const existing = this.room.cardIndex.get(cardID)
          const existingInSource = Boolean(existing && this.isCardInPlayerSource(existing, context))
          const target = existingInSource ? existing : availableTargets.shift()
          const ledgerBefore = {
            inCardIndex: this.room.cardIndex.has(cardID),
            inUnlocated: this.room.unlocatedIdentities.has(cardID),
            inDeckIdentities: this.room.deckIdentities.has(cardID),
            existingLocation: existing?.location ?? null,
            existingSubZone: existing?.subZone ?? null,
            existingIsKnown: existing?.isKnown === true,
            existingInSource,
            tookAnonymousTarget: Boolean(target && isAnonymous(target)),
            targetSubZone: target?.subZone ?? null,
            remainingAnonymousTargets: availableTargets.length
          }
          const resolved = this.room.materialize(cardID, target ?? null) ?? existing
          resolveAttempts.push({
            cardID,
            ...ledgerBefore,
            materializeOk: Boolean(resolved),
            afterInCardIndex: this.room.cardIndex.has(cardID)
          })
          return resolved
        })
        .filter((card): card is Card => Boolean(card))
      missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id))

      // 协议 known 声明的正 ID 必须落地实体：座位存在时也不能再静默丢牌。
      // 手牌缺口只 createExternal，绝不消费木马/标记匿名占位。
      if (missingIDs.length > 0) {
        trackerLogger.warn('玩家来源 known 路径实体缺口，将 createExternal', {
          knownIDs,
          missingIDs,
          fromSeat,
          fromSubZone,
          markSpellID,
          sourceAnonymousCountBefore,
          remainingAnonymousTargets: availableTargets.length,
          resolveAttempts,
          knownIDLedgers: knownIDs.map((cardID) => ({
            cardID,
            inCardIndex: this.room.cardIndex.has(cardID),
            inUnlocated: this.room.unlocatedIdentities.has(cardID),
            inDeckIdentities: this.room.deckIdentities.has(cardID)
          }))
        })
        knownCardCreationReason = 'known-fallback'
        createdCards = this.room.createExternalCards(missingIDs, missingIDs.length)
        const cardMap = new Map(context.knownCards.map((card) => [card.id, card]))
        createdCards.forEach((card) => cardMap.set(card.id, card))
        context.knownCards = knownIDs
          .map((id) => cardMap.get(id))
          .filter((card): card is Card => Boolean(card))
        missingIDs = knownIDs.filter((id) => !cardMap.has(id))
      }
    } else {
      context.knownCards = this.room.findCardsByIDs(knownIDs)
      missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id))
    }

    const createdCardSet = new Set(createdCards)
    const resumedCardIDs: CardID[] = []
    const confirmedFromUnknownIDs: CardID[] = []
    context.knownCards.forEach((card) => {
      const wasSuspended = card.suspended === true || this.room.suspendedKnownCards.has(card)
      this.room.resumeSuspendedKnownCard(card)
      if (wasSuspended) resumedCardIDs.push(card.id)

      // knownIDs 路径的语义是“协议声明这些正 ID 已公开”。
      // 只有协议明确来自 outside/exile 时，补建正 ID 的暗态才是正常过渡；
      // known-fallback 即使调用同一个工厂，也必须保留缺失实体诊断。
      const isExpectedExternalCreation =
        knownCardCreationReason === 'external-source' && createdCardSet.has(card)
      if (card.id > 0 && card.isKnown !== true && !isExpectedExternalCreation) {
        confirmedFromUnknownIDs.push(card.id)
      }
      if (card.id > 0) card.confirmKnown()
    })

    if (confirmedFromUnknownIDs.length > 0) {
      trackerLogger.info('已知牌解析后补确认明牌', {
        knownIDs,
        confirmedFromUnknownIDs,
        createdCardIDs: createdCards.map((card) => card.id),
        missingIDs,
        fromZone,
        fromSeat,
        sourceIsOutside,
        isExternalSource,
        knownCardCreationReason
      })
    }

    trackerLogger.debug('已知牌解析完成', {
      knownIDs,
      resolvedCardIDs: context.knownCards.map((card) => card.id),
      knownCardStates: context.knownCards.map((card) => ({
        id: card.id,
        entityID: card.entityID,
        isKnown: card.isKnown === true,
        location: card.location
      })),
      missingIDs,
      createdCardIDs: createdCards.map((card) => card.id),
      resumedCardIDs,
      confirmedFromUnknownIDs,
      sourceIsOutside,
      isExternalSource,
      knownCardCreationReason
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
        sourceHandTotalObserved: context.sourceHandTotalObserved,
        sourceHandTotalBefore: context.sourceHandTotalBefore,
        sourceHandUnknownCount: context.sourceHandUnknownCount,
        sourceEvent
      })
    ) {
      // 随机获得来源手牌时：若来源仍有明牌，扩展为“来源/目标都可能持有”；
      // 来源全暗则走下方默认暗牌移动，不必做无展示价值的 N 选 K。
      const propagatedCards = this.markRandomHandTransferCandidates({
        fromSeat: sourceHandSeat,
        targetSeat: targetHandSeat,
        count: handMoveCount,
        sourceTotalBefore: context.sourceHandTotalObserved
          ? context.sourceHandTotalBefore
          : undefined,
        sourceHandTotalObserved: context.sourceHandTotalObserved,
        sourceUnknownCount: context.sourceHandTotalObserved
          ? context.sourceHandUnknownCount
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
      unknownCount,
      moveType
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
        sourceEvent,
        moveType
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
      sourceEvent,
      moveType
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
    if (knownCards.length === 0) {
      // 装备容器全明快照可能因来源迁座暂未物化成功；仍按协议 CardIDs 收敛弱候选。
      if (toZone === 'player') {
        this.resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context)
      }
      return
    }

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

    // 手气卡把明牌洗回牌堆后，必须真正匿名化槽位：
    // 只 isKnown=false 会留下正 ID 未知牌，后续暗摸会原样绑成正 ID 独占暗手。
    if (resetKnownToUnknown === true && toZone === 'pile') {
      knownCards.forEach((card) => {
        const previousCardID = this.room.anonymizeLocatedIdentity(
          card,
          'moveKnownCardsForContext:resetKnownToUnknown'
        )
        if (previousCardID === null) {
          trackerLogger.warn('已知牌匿名化失败：card/index 不一致，继续重置槽位', {
            reason: 'moveKnownCardsForContext:resetKnownToUnknown',
            cardID: card.id,
            entityID: card.entityID,
            isKnown: card.isKnown
          })
        }
        card.reset()
        if (previousCardID !== null) {
          resetKnownCardIDs.push(previousCardID)
        } else if (card.id > 0) {
          resetKnownCardIDs.push(card.id)
        }
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
          // 与 swap 路径一致：确定明牌槽不能被占位污染；公共候选槽可继续承载。
          const keepPreviousPosition = this.hasPublicCandidateAt(card, residue.zoneID)
          if (keepPreviousPosition) {
            placeholder.moveToPublicZone(residue.zoneID)
            zone.replaceCard(card, placeholder)
          } else if (residue.zoneID === 'pile') {
            zone.removeCard(card)
            this.insertUnknownPlaceholderIntoPile(zone, placeholder)
          } else {
            zone.removeCard(card)
            zone.add(placeholder, POSITION_TOP)
          }
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
