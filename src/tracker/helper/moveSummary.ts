import type { Card } from '../Card'
import type { RoomMoveContext } from '../roomMovement/types'
import type { CardID, MoveOptions, NormalizedMoveEvent } from '../types'

interface MoveSummaryOptions {
  normalizeCardIDs?: boolean
  includeEventCardCount?: boolean
  includeSourceCards?: boolean
  includeKnownCardIDs?: boolean
  includeSourceCardIDs?: boolean
}

type SummarizableMoveEvent = Partial<NormalizedMoveEvent> & {
  options?: Partial<MoveOptions> & {
    sourceCards?: Card[]
  }
}

type SummarizableMoveContext = Partial<RoomMoveContext> & {
  sourceCards?: Card[]
  knownCards?: Card[]
}

function normalizeIDs(cardIDs: CardID[] | CardID = []): CardID[] {
  return (Array.isArray(cardIDs) ? cardIDs : [cardIDs]).map((id) => Number(id) || 0)
}

export function summarizeMoveEvent(
  event: SummarizableMoveEvent = {},
  options: MoveSummaryOptions = {}
) {
  const eventOptions = event.options ?? {}
  const moveType = event.moveType ?? eventOptions.moveType
  const label = eventOptions.sourceEvent?.label

  return {
    type: event.type,
    cardIDs: options.normalizeCardIDs ? normalizeIDs(event.cardIDs) : event.cardIDs,
    ...(moveType !== undefined ? { moveType } : {}),
    ...(label ? { label } : {}),
    toZone: event.toZone,
    ...(options.includeEventCardCount ? { cardCount: event.cardCount } : {}),
    options: {
      seatID: eventOptions.seatID,
      subZone: eventOptions.subZone,
      spellID: eventOptions.spellID,
      combinationID: eventOptions.combinationID,
      fromZone: eventOptions.fromZone,
      fromSeatID: eventOptions.fromSeatID,
      fromSubZone: eventOptions.fromSubZone,
      fromSpellID: eventOptions.fromSpellID,
      cardCount: eventOptions.cardCount,
      moveType: eventOptions.moveType,
      position: eventOptions.position,
      fromPosition: eventOptions.fromPosition,
      resetKnownToUnknown: eventOptions.resetKnownToUnknown,
      ...(options.includeSourceCards
        ? { sourceCards: eventOptions.sourceCards?.map((card) => card.id) }
        : {})
    }
  }
}

export function summarizeMoveContext(
  context: SummarizableMoveContext = {},
  options: MoveSummaryOptions = {}
) {
  return {
    cardIDs: context.cardIDs,
    toZone: context.toZone,
    seatID: context.seatID,
    subZone: context.subZone,
    spellID: context.spellID,
    combinationID: context.combinationID,
    fromZone: context.fromZone,
    fromSeat: context.fromSeat,
    fromSubZone: context.fromSubZone,
    fromSpellID: context.fromSpellID,
    cardCount: context.cardCount,
    position: context.position,
    fromPosition: context.fromPosition,
    resetKnownToUnknown: context.resetKnownToUnknown,
    targetSeats: context.targetSeats,
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
      : {}),
    sourceIsOutside: context.sourceIsOutside
  }
}
