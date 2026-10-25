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
    triggerSpellID: event.protocol.SpellID,
    cardIDs: options.normalizeCardIDs ? [...event.cardIDs] : event.cardIDs,
    ...(moveType !== undefined ? { moveType } : {}),
    ...(label ? { label } : {}),
    from: event.from,
    to: event.to,
    ...(options.includeEventCardCount ? { cardCount: event.cardCount } : {}),
    options: {
      gainSpellID: eventOptions.gainSpellID ?? eventOptions.sourceEvent?.spellID,
      combinationID: eventOptions.combinationID,
      cardCount: eventOptions.cardCount,
      moveType: eventOptions.moveType,
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
