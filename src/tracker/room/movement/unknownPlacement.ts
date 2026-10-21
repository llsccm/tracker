import { trackerLogger } from '@/utils/logger'
import type { Room } from '@/tracker/Room'
import type { RoomMovementCandidates } from './candidates'
import type { RoomMovementSources } from './sources'
import { registerUnassignedMarkSpaceCards } from './unassignedMarkSpaces'
import type { RoomMoveContext } from './types'

/** Unknown-identity movement stage; source taking and target-specific gap rules stay distinct. */
export class RoomMovementUnknownPlacement {
  constructor(
    private readonly room: Room,
    private readonly sources: RoomMovementSources,
    private readonly candidates: RoomMovementCandidates
  ) {}

  move(context: RoomMoveContext): void {
    const {
      combinationID,
      expectedSlotsByLocation,
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
      const movedUnknownCards = this.sources.takeSourceCards(unknownCount, {
        toZone,
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
        this.sources.resolveSourcePlayerCandidate(card, context)
      })
      this.room.removeCardsFromConstraintGroups(movedUnknownCards)

      movedUnknownCards.forEach((card) => {
        card.bindCandidates(targetSeats, subZone, spellID, { known: false })
      })

      // toSeatID=255 会被 normalizeSeats 过滤为空；这代表无席位技能空间而非某个玩家。
      // 这里按 spellID 建账本，后续从弹窗 mark 回牌堆时直接取这个空间里的占位。
      if (subZone === 'mark' && targetSeats.length === 0) {
        registerUnassignedMarkSpaceCards(this.room, spellID, movedUnknownCards)
      }

      if (movedUnknownCards.length > 0 && targetSeats.length > 0) {
        this.room.createConstraintGroup({
          id: combinationID,
          cards: movedUnknownCards,
          candidateSeats: targetSeats,
          expectedSlotsByLocation,
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

    const movedUnknownCards = this.sources.takeSourceCards(unknownCount, {
      toZone,
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
      this.sources.resolveSourcePlayerCandidate(card, context)
    })
    this.room.removeCardsFromConstraintGroups(movedUnknownCards)

    const targetZone = this.room.zones.get(toZone)

    if (targetZone) {
      targetZone.add(movedUnknownCards, position)
    } else {
      movedUnknownCards.forEach((card) => card.moveToPublicZone(toZone))
    }

    context.publicMovedCards.push(...movedUnknownCards)

    this.candidates.updatePublicCandidatesAfterUnknownPileReturn({
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
}
