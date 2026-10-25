import {
  getMoveSeat,
  getMoveSubZone,
  getMovePosition,
  getMoveZone,
  getMoveCallbackSpellID,
  getMoveTargetSeats,
  getPopupSpaceID
} from '@/tracker/helper/moveEndpoint'
import { trackerLogger } from '@/utils/logger'
import type { Room } from '@/tracker/Room'
import type { RoomMovementCandidates } from './candidates'
import type { RoomMovementSources } from './sources'
import { registerPopupSpaceCards } from './popupSpaces'
import type { RoomMoveContext } from './types'

/** Unknown-identity movement stage; source taking and target-specific gap rules stay distinct. */
export class RoomMovementUnknownPlacement {
  constructor(
    private readonly room: Room,
    private readonly sources: RoomMovementSources,
    private readonly candidates: RoomMovementCandidates
  ) {}

  move(context: RoomMoveContext): void {
    const { combinationID, expectedSlotsByLocation, sourceEvent, unknownCount } = context
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    const fromPosition = getMovePosition(context.from)
    const fromZone = getMoveZone(context.from)
    const position = getMovePosition(context.to)
    const spellID = getMoveCallbackSpellID(context, context.triggerSpellID)
    const subZone = getMoveSubZone(context.to)
    const targetSeats = getMoveTargetSeats(context.to)
    const toZone = getMoveZone(context.to)

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
      const movedUnknownCards = this.sources.takeSourceCards(unknownCount, context)

      context.movedUnknownCards = movedUnknownCards

      movedUnknownCards.forEach((card) => {
        this.sources.resolveStoredSourceCandidate(card, context)
      })
      this.room.removeCardsFromConstraintGroups(movedUnknownCards)

      movedUnknownCards.forEach((card) => {
        card.bindCandidates(
          targetSeats,
          subZone,
          subZone === 'hand' && fromSubZone === 'mark' ? null : spellID,
          { known: card.isKnown }
        )
        if (context.targetHandSeat !== null && context.gainSpellID !== undefined) {
          card.recordHandGain(context.targetHandSeat, context.gainSpellID)
        }
      })

      if (movedUnknownCards.length > 0 && targetSeats.length > 0) {
        this.room.createConstraintGroup({
          id: combinationID ?? undefined,
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

    const movedUnknownCards = this.sources.takeSourceCards(unknownCount, context)

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
      this.sources.resolveStoredSourceCandidate(card, context)
    })
    this.room.removeCardsFromConstraintGroups(movedUnknownCards)

    const targetZone = this.room.zones.get(toZone)

    if (toZone === 'popup') {
      movedUnknownCards.forEach((card) =>
        card.resolveLocationCandidate({ type: 'popup', spaceID: getPopupSpaceID(context.to) })
      )
      registerPopupSpaceCards(this.room, getPopupSpaceID(context.to), movedUnknownCards)
      return
    }

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
