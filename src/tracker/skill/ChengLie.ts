import { POSITION_BOTTOM } from '../candidate/cardPositions'
import type { MoveEventDraft } from '../runtime/moveEventHandlers'
import {
  getChengLieCasterSeat,
  getChengLieState,
  getCount,
  getPositiveIDs,
  getRaw,
  hasPositiveID,
  isChengLieReveal,
  logChengLie,
  nextGroupID,
  patchEvent,
  recordChengLieReveal
} from '../runtime/moveEventHandlers'
import type { Room } from '../Room'

// 马承【骋烈】：记录亮出集合，并在标记牌最终明置进弃牌堆时做前后集合差分。
export default function decorateChengLie(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const cardIDs = event.cardIDs ?? []
  const ids = getPositiveIDs(cardIDs)
  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)

  if (isChengLieReveal(raw, ids)) {
    recordChengLieReveal(event, room, raw, ids)
    return event
  }

  if (fromZone === 10 && toZone === 4 && !hasPositiveID(cardIDs)) {
    const state = getChengLieState(room)
    if (state.revealedIDs.length > 0) {
      logChengLie('暗置进入标记区', {
        toSeatID: raw.ToID,
        cardCount: getCount(event),
        revealedIDs: state.revealedIDs
      })
    }
  }

  if (fromZone !== 10 || toZone !== 5 || hasPositiveID(cardIDs)) {
    return event
  }

  const state = getChengLieState(room)
  state.casterSeatID = getChengLieCasterSeat(raw, state)

  const exchangeCards = room.zones.get('exchange')?.cards ?? []
  const groupedCards = exchangeCards.slice(0, Math.max(0, exchangeCards.length - 1))

  if (groupedCards.length > 0) {
    room.createConstraintGroup({
      id: nextGroupID(room, 3208, 'chenglie_remain'),
      cards: groupedCards,
      sourceEvent: event.options?.sourceEvent
    })
  }

  logChengLie('暗中从处理区进入手牌', {
    casterSeatID: state.casterSeatID,
    cardCount: getCount(event),
    exchangeCardIDs: exchangeCards.map((card) => card.id).filter((id) => id > 0),
    groupedCardIDs: groupedCards.map((card) => card.id).filter((id) => id > 0)
  })

  return patchEvent(event, {
    options: {
      fromPosition: POSITION_BOTTOM,
      combinationID: nextGroupID(room, 3208, 'chenglie_move')
    }
  })
}
