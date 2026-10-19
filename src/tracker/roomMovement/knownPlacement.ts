import { trackerLogger } from '@/utils/logger'
import { POSITION_TOP } from '../candidate/cardPositions'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { CardID, PublicZoneName, SeatID } from '../types'
import type { RoomMovementHiddenMarks } from './hiddenMarks'
import type { RoomMovementSources } from './sources'
import { getPlayerHandCardsBySeat } from './sourceQueries'
import {
  registerUnassignedMarkSpaceCards,
  removeUnassignedMarkSpaceCards
} from './unassignedMarkSpaces'
import type { RoomMoveContext } from './types'

interface KnownMovePlacement {
  swappedCardIDs: CardID[]
  handledSpellCardIDs: CardID[]
  resolvedSourceCardIDs: CardID[]
  playerSourceSwapAttempts: unknown[]
  playerSourceContext: RoomMoveContext
}

interface KnownPublicResidue {
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
}

/** 已知牌来源校正、逐牌落区与旧公共槽回补；批次信息只随本次流水线传递。 */
export class RoomMovementKnownPlacement {
  constructor(
    private readonly room: Room,
    private readonly sources: RoomMovementSources,
    private readonly hiddenMarks: RoomMovementHiddenMarks
  ) {}

  prepare(context: RoomMoveContext): KnownMovePlacement | null {
    const { knownCards, toZone } = context
    if (knownCards.length === 0) {
      // 装备容器全明快照可能因来源迁座暂未物化成功；仍按协议 CardIDs 收敛弱候选。
      if (toZone === 'player') {
        this.hiddenMarks.resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context)
      }
      return null
    }

    // 已知牌移动可能揭示无席位暗占位，先摘除空间账本旧引用，再定位有效来源座位。
    removeUnassignedMarkSpaceCards(this.room, knownCards)

    const swappedCardIDs: CardID[] = []
    const handledSpellCardIDs: CardID[] = []
    const resolvedSourceCardIDs: CardID[] = []
    const playerSourceSwapAttempts: unknown[] = []
    const observedEquipmentMarkSnapshot = this.hiddenMarks.getObservedEquipmentMarkSnapshot(context)
    const playerSourceContext = observedEquipmentMarkSnapshot
      ? { ...context, fromSeat: observedEquipmentMarkSnapshot.observedSeat }
      : context
    return {
      swappedCardIDs,
      handledSpellCardIDs,
      resolvedSourceCardIDs,
      playerSourceSwapAttempts,
      playerSourceContext
    }
  }

  /** 每张牌按原顺序完成来源置换、候选结算、旧约束移除、技能回调和玩家目标绑定。 */
  moveEachCard(context: RoomMoveContext, placement: KnownMovePlacement): void {
    const {
      fromSubZone,
      knownCards,
      sourceEvent,
      spellID,
      subZone,
      targetSeats,
      toZone,
      toSeatID
    } = context
    const { swappedCardIDs, handledSpellCardIDs, resolvedSourceCardIDs, playerSourceContext } =
      placement
    const effectiveFromSeat = playerSourceContext.fromSeat
    knownCards.forEach((card) => {
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
        card.locationCandidates.length > 1 &&
        Boolean(this.sources.findExactUnknownPlayerSourcePlaceholder(playerSourceContext, card))

      if (
        isFromPlayerSource &&
        (!this.sources.isCardInPlayerSource(card, playerSourceContext) ||
          shouldSwapSpeculativePlayerIdentity)
      ) {
        this.swapPlayerSourceCard(card, context, placement)
      }

      // 已知牌来自公共区但实体不在公共 Zone 时，优先按占位语义置换，避免偷走玩家暗牌。
      const isFromPublicSource =
        !isFromPlayerSource &&
        typeof context.fromZone === 'string' &&
        this.room.zones.has(context.fromZone)
      if (isFromPublicSource && !this.sources.isCardInPublicSource(card, context)) {
        const placeholder = this.sources.swapKnownCardWithPublicSourcePlaceholder(card, context)
        if (placeholder) {
          swappedCardIDs.push(card.id)
          this.registerUnassignedReplacement(placeholder)
        }
      }

      this.hiddenMarks.resolveHiddenMarkCandidateFromMove(card, context)
      if (this.sources.resolveSourcePlayerCandidate(card, context)) {
        resolvedSourceCardIDs.push(card.id)
      }

      // 2. Remove from constraint groups
      this.room.removeCardsFromConstraintGroups([card])

      if (spellID && this.room.skillHandlers.has(spellID)) {
        const handler = this.room.skillHandlers.get(spellID)
        handler?.(card, {
          toZone,
          toSeatID,
          subZone,
          sourceEvent
        })
        handledSpellCardIDs.push(card.id)
      }

      if (toZone === 'player') {
        this.room.clearCardsFromPublicZones([card])
        card.bindCandidates(targetSeats, subZone, spellID, { known: true })
      }
    })
  }

  private swapPlayerSourceCard(
    card: Card,
    context: RoomMoveContext,
    placement: KnownMovePlacement
  ): void {
    const { fromSeat, fromSubZone, knownCards, sourceEvent, toZone } = context
    const { swappedCardIDs, playerSourceSwapAttempts, playerSourceContext } = placement
    const locationBeforeSwap = card.location
    const placeholder = this.sources.swapKnownCardWithPlayerSourcePlaceholder(
      card,
      playerSourceContext
    )
    let fallbackPlaceholder: Card | null = null
    if (!placeholder && fromSubZone === 'hand') {
      fallbackPlaceholder = this.sources.swapCardWithUnknown(card, playerSourceContext, knownCards)
      const canDeferToKnownSourcePlaceholder =
        context.sourceHandTotalObserved && context.sourceHandTotalBefore <= context.handMoveCount
      const createdSourcePlaceholder =
        !fallbackPlaceholder && !canDeferToKnownSourcePlaceholder
          ? this.sources.createPlayerSourcePlaceholderForKnownCard(card, playerSourceContext)
          : null
      if (!fallbackPlaceholder && createdSourcePlaceholder) {
        fallbackPlaceholder = this.sources.swapCardWithUnknown(
          card,
          playerSourceContext,
          knownCards
        )
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
          sourceHandCards: getPlayerHandCardsBySeat(this.room, fromSeat).map((sourceCard) => ({
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
    this.registerUnassignedReplacement(placeholder)
    this.registerUnassignedReplacement(fallbackPlaceholder)
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

  private registerUnassignedReplacement(placeholder: Card | null | undefined): void {
    // 置换回补可能把暗占位放回旧的无席位 mark 位置，必须重新入账供后续回牌堆复用。
    if (placeholder) registerUnassignedMarkSpaceCards(this.room, placeholder.spellID, [placeholder])
  }

  finishMove(context: RoomMoveContext, placement: KnownMovePlacement): void {
    const {
      combinationID,
      expectedSlotsBySeat,
      knownCards,
      position,
      sourceEvent,
      spellID,
      subZone,
      targetSeats,
      toZone
    } = context
    const { swappedCardIDs, handledSpellCardIDs, resolvedSourceCardIDs } = placement
    if (toZone === 'player') {
      this.hiddenMarks.resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context)

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

    this.repairPublicResidues(context, placement)

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
      resolvedSourceCardIDs,
      targetZoneExists: Boolean(targetZone)
    })
  }

  private collectPublicResidues(knownCards: Card[]): KnownPublicResidue[] {
    return knownCards.flatMap((card) => {
      const residues: KnownPublicResidue[] = []

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
  }

  private repairPublicResidues(context: RoomMoveContext, placement: KnownMovePlacement): void {
    const { fromSeat, fromSubZone, knownCards, position, sourceEvent, toZone } = context
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat)) return
    const { playerSourceSwapAttempts } = placement
    const knownCardSet = new Set(knownCards)

    const sourceHandCards =
      fromSubZone === 'hand'
        ? getPlayerHandCardsBySeat(this.room, fromSeat).filter(
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

    const publicResidues = this.collectPublicResidues(knownCards)

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
        const keepPreviousPosition = this.sources.hasPublicCandidateAt(card, residue.zoneID)
        if (keepPreviousPosition) {
          placeholder.moveToPublicZone(residue.zoneID)
          zone.replaceCard(card, placeholder)
        } else if (residue.zoneID === 'pile') {
          zone.removeCard(card)
          this.sources.insertUnknownPlaceholderIntoPile(zone, placeholder)
        } else {
          zone.removeCard(card)
          zone.add(placeholder, POSITION_TOP)
        }
        this.hiddenMarks.removeHiddenMarkPlaceholder(placeholder)
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
}
