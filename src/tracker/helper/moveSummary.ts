import type { RoomMoveContext } from '../room/index'
import type { NormalizedMoveEvent } from '../types'

interface MoveSummaryOptions {
  normalizeCardIDs?: boolean
  includeEventCardCount?: boolean
  includeSourceCards?: boolean
  includeKnownCardIDs?: boolean
  includeSourceCardIDs?: boolean
}

export function summarizeMoveEvent(event: NormalizedMoveEvent, options: MoveSummaryOptions = {}) {
  const eventOptions = event.options
  const moveType = event.moveType ?? eventOptions.moveType
  const label = eventOptions.sourceEvent?.label

  return {
    type: event.type,
    cardIDs: options.normalizeCardIDs ? [...event.cardIDs] : event.cardIDs,
    ...(moveType !== undefined ? { moveType } : {}),
    ...(label ? { label } : {}),
    toZone: event.toZone,
    ...(options.includeEventCardCount ? { cardCount: event.cardCount } : {}),
    options: {
      fromPopupSpaceID: eventOptions.fromPopupSpaceID,
      toPopupSpaceID: eventOptions.toPopupSpaceID,
      toSeatID: eventOptions.toSeatID,
      subZone: eventOptions.subZone,
      spellID: eventOptions.spellID,
      gainSpellID: eventOptions.gainSpellID ?? eventOptions.sourceEvent?.spellID,
      combinationID: eventOptions.combinationID,
      fromZone: eventOptions.fromZone,
      fromSeatID: eventOptions.fromSeatID,
      fromSubZone: eventOptions.fromSubZone,
      fromSpellID: eventOptions.fromSpellID,
      cardCount: eventOptions.cardCount,
      moveType: eventOptions.moveType,
      position: eventOptions.position,
      fromPosition: eventOptions.fromPosition,
      ...(options.includeSourceCards
        ? { sourceCards: eventOptions.sourceCards?.map((card) => card.id) }
        : {})
    }
  }
}

export function summarizeMoveContext(context: RoomMoveContext, options: MoveSummaryOptions = {}) {
  return {
    from: context.from,
    to: context.to,
    triggerSpellID: context.triggerSpellID,
    cardIDs: context.cardIDs,
    gainSpellID: context.gainSpellID,
    combinationID: context.combinationID,
    cardCount: context.cardCount,
    handMoveCount: context.handMoveCount,
    sourceHandSeat: context.sourceHandSeat,
    targetHandSeat: context.targetHandSeat,
    knownIDs: context.knownIDs,
    ...(options.includeKnownCardIDs
      ? { knownCardIDs: context.knownCards?.map((card) => card.id) }
      : {}),
    unknownCount: context.unknownCount,
    ...(options.includeSourceCardIDs
      ? { sourceCardIDs: context.sourceCards?.map((card) => card.id) }
      : {})
  }
}
