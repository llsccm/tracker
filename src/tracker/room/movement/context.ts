import { trackerLogger } from '@/utils/logger'
import { getMoveSeat, getMoveSubZone, playerMoveTarget } from '@/tracker/helper/moveEndpoint'
import { summarizeMoveContext } from '@/tracker/helper/moveSummary'
import type { Room } from '@/tracker/Room'
import type { CardID, RoomMoveRequest } from '@/tracker/types'
import type { RoomMoveContext } from './types'

/** Capture protocol inputs and pre-move Room facts without retaining state between moves. */
export function createMoveContext(
  room: Room,
  cardIDs: readonly CardID[],
  opt: RoomMoveRequest
): RoomMoveContext {
  const {
    from,
    to: requestedTo,
    triggerSpellID,
    combinationID,
    cardCount = cardIDs.length,
    handMoveCount: requestedHandMoveCount,
    moveType,
    expectedSlotsByLocation,
    anonymizeCards = [],
    requireAnonymizeSuccess = false,
    sourceCards,
    publicCandidateSource,
    forceRandomHandTransferCandidates = false,
    postMovePublicCandidates,
    sourceEvent
  } = opt

  const to =
    requestedTo.type === 'playerCandidates'
      ? playerMoveTarget(requestedTo.seatIDs, requestedTo)
      : requestedTo

  // 候选身份可由逻辑账本迁移而不移动实体；此时手牌总数变化量与实体移动数不同。
  const handMoveCount = Math.max(0, Number(requestedHandMoveCount ?? cardCount ?? cardIDs.length))
  const sourceHandSeat = getMoveSubZone(from) === 'hand' ? getMoveSeat(from) : null
  const targetHandSeat = getMoveSubZone(to) === 'hand' ? getMoveSeat(to) : null
  const knownIDs = cardIDs.filter((id) => id > 0)
  const sourcePlayer = from.type === 'player' ? room.getPlayer(from.seatID) : null

  const context: RoomMoveContext = {
    from,
    to,
    triggerSpellID,
    gainSpellID:
      opt.gainSpellID !== undefined
        ? opt.gainSpellID
        : targetHandSeat !== null && targetHandSeat !== sourceHandSeat
          ? (opt.pileIdentityEvent?.protocol.SpellID ??
            sourceEvent?.spellID ??
            triggerSpellID ??
            null)
          : undefined,
    pileIdentityCardIDs: opt.pileIdentityCardIDs,
    pileIdentityEvent: opt.pileIdentityEvent,
    cardIDs,
    combinationID,
    cardCount: Number(cardCount),
    moveType,
    expectedSlotsByLocation,
    anonymizeCards: Array.from(new Set(anonymizeCards)).filter(Boolean),
    requireAnonymizeSuccess,
    sourceCards,
    publicCandidateSource,
    forceRandomHandTransferCandidates,
    postMovePublicCandidates,
    sourceEvent,
    handMoveCount,
    sourceHandSeat,
    targetHandSeat,
    sourceHandTotalObserved: sourcePlayer?.hasObservedHandCount === true,
    sourceHandTotalBefore: sourcePlayer?.observedHandCount ?? 0,
    sourceHandUnknownCount: sourcePlayer?.unknownCardCount ?? 0,
    knownIDs,
    unknownCount: Math.max(0, Number(cardCount) || 0, cardIDs.length) - knownIDs.length,
    knownCards: [],
    movedUnknownCards: [],
    publicMovedCards: [],
    skipUnknownMovement: false
  }

  trackerLogger.debug(
    '移动上下文创建',
    summarizeMoveContext(context, { includeSourceCardIDs: true })
  )

  return context
}
