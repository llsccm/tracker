import { POSITION_BOTTOM } from '../candidate/cardPositions'
import type { Room } from '../Room'
import { trackerLogger } from '@/utils/logger'
import {
  getRaw,
  getCount,
  hasPositiveID,
  nextGroupID,
  patchEvent,
  type MoveEventDraft,
  getPositiveIDs
} from '../skill/moveEventUtils'
import { CARD_INSTANCE_STATUS } from '../CardCounter'

// 马承【骋烈】：记录亮出集合，并在标记牌最终明置进弃牌堆时做前后集合差分。
export function decorateChengLie(event: MoveEventDraft, room: Room): MoveEventDraft {
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

function observeChengLieFinalDiscard(
  event: MoveEventDraft,
  room: Room,
  ids: number[],
  meta: Record<string, unknown> = {}
): void {
  const state = getPendingChengLieState(room)
  if (!state) return

  state.finalDiscardIDs = Array.from(new Set([...state.finalDiscardIDs, ...ids]))
  logChengLie('观察到标记区明置进弃牌堆', {
    currentDiscardIDs: state.finalDiscardIDs,
    expectedCount: state.revealedIDs.length,
    ...meta
  })

  if (state.finalDiscardIDs.length >= state.revealedIDs.length) {
    settleChengLieInference(event, room, state)
  }
}

export function observePendingChengLieFinalDiscard(event: MoveEventDraft, room: Room): void {
  const state = getPendingChengLieState(room)
  if (!state) return

  const raw = getRaw(event)
  const ids = getPositiveIDs(event.cardIDs ?? [])
  if (!isChengLieFinalDiscard(raw, ids, state)) return

  observeChengLieFinalDiscard(event, room, ids, {
    source: getChengLieDiscardHint(raw) ? 'zone-hint' : 'pending-state',
    spellID: raw.SpellID,
    fromZoneParam: raw.FromZoneParam,
    toZoneParam: raw.ToZoneParam
  })
}

function settleChengLieInference(event: MoveEventDraft, room: Room, state: any): void {
  const revealedSet = new Set(state.revealedIDs)
  const discardSet = new Set(state.finalDiscardIDs)
  const takenToHandIDs = state.revealedIDs.filter((id) => !discardSet.has(id))
  const givenFromHandIDs = state.finalDiscardIDs.filter((id) => !revealedSet.has(id))
  const canResolveStrongly =
    !state.hadAmbiguousKnownBeforeReveal &&
    takenToHandIDs.length <= 1 &&
    givenFromHandIDs.length <= 1

  logChengLie('结算差分', {
    revealedIDs: state.revealedIDs,
    finalDiscardIDs: state.finalDiscardIDs,
    takenToHandIDs,
    givenFromHandIDs,
    canResolveStrongly
  })

  if (canResolveStrongly && takenToHandIDs.length === 1) {
    const [cardID] = takenToHandIDs
    const card = room.cardIndex.get(cardID)

    if (card && state.casterSeatID !== null) {
      room.removeCardsFromConstraintGroups([card])
      room.clearCardsFromPublicZones([card])
      card.bindTo(state.casterSeatID, 'hand', 3208)

      room.createConstraintGroup({
        id: nextGroupID(room, 3208, 'chenglie_inferred_hand'),
        cards: [card],
        candidateSeats: [state.casterSeatID],
        known: true,
        sourceEvent: event.options?.sourceEvent
      })

      logChengLie('确认亮出牌进入手牌', { cardID, casterSeatID: state.casterSeatID })
    } else {
      trackerLogger.warn('[骋烈] 无法确认亮出牌进入手牌', {
        cardID,
        casterSeatID: state.casterSeatID,
        hasCard: Boolean(card)
      })
    }
  } else if (canResolveStrongly && takenToHandIDs.length === 0) {
    logChengLie('未发生交换或没有亮出牌留在手牌')
  } else {
    trackerLogger.info('[骋烈] 存在前置不确定明牌或异常差分，跳过强确认', {
      hadAmbiguousKnownBeforeReveal: state.hadAmbiguousKnownBeforeReveal,
      takenToHandIDs,
      givenFromHandIDs
    })
  }

  room.clearSkillState(3208)
}

function isChengLieFinalDiscard(raw: any, ids: number[], state: any): boolean {
  if (Number(raw.FromZone) !== 4 || Number(raw.ToZone) !== 2 || ids.length === 0) {
    return false
  }

  return getChengLieDiscardHint(raw) || state.finalDiscardIDs.length < state.revealedIDs.length
}

function getChengLieDiscardHint(raw: any): boolean {
  return [raw.SpellID, raw.FromZoneParam, raw.ToZoneParam]
    .map((value) => Number(value))
    .some((value) => value === 3208)
}

function getPendingChengLieState(room: Room): any {
  const state = room.skillState.get(3208)
  return state?.revealedIDs?.length > 0 ? state : null
}

function recordChengLieReveal(event: MoveEventDraft, room: Room, raw: any, ids: number[]): void {
  const state = getChengLieState(room)
  const ambiguousCards = getAmbiguousKnownHandCards(room)

  if (state.revealedIDs.length > 0 && state.finalDiscardIDs.length < state.revealedIDs.length) {
    logChengLie('新的亮牌覆盖未完成状态', {
      previousRevealedIDs: state.revealedIDs,
      previousFinalDiscardIDs: state.finalDiscardIDs
    })
  }

  state.revealedIDs = ids
  state.finalDiscardIDs = []
  state.casterSeatID = getChengLieCasterSeat(raw, state)
  state.hadAmbiguousKnownBeforeReveal = ambiguousCards.length > 0
  state.sourceEvent = event.options?.sourceEvent

  logChengLie('记录亮牌', {
    revealedIDs: state.revealedIDs,
    casterSeatID: state.casterSeatID,
    hadAmbiguousKnownBeforeReveal: state.hadAmbiguousKnownBeforeReveal,
    ambiguousKnownIDs: ambiguousCards.map((card) => card.id).filter((id) => id > 0)
  })
}

function getAmbiguousKnownHandCards(room: Room): any[] {
  const appearedCards = room.counter?.cardsByStatus?.[CARD_INSTANCE_STATUS.APPEARED]
  const sourceCards = appearedCards ? Array.from(appearedCards) : room.cards
  return sourceCards.filter(
    (card) =>
      card.location === 'player' &&
      card.subZone === 'hand' &&
      card.isKnown === true &&
      card.seats.size > 1
  )
}

function getChengLieState(room: Room): any {
  const state = room.getSkillState(3208, () => ({
    revealedIDs: [],
    finalDiscardIDs: [],
    casterSeatID: null,
    hadAmbiguousKnownBeforeReveal: false
  }))

  return state
}

function getChengLieCasterSeat(raw: any, state: any): number | null {
  return (
    getSeatID(raw.SrcSeatID) ?? getSeatID(raw.ToID) ?? getSeatID(raw.FromID) ?? state.casterSeatID
  )
}

function getSeatID(value: unknown): number | null {
  const seatID = Number(value)
  return Number.isNaN(seatID) || seatID === 255 ? null : seatID
}

function logChengLie(stage: string, payload: Record<string, unknown> = {}): void {
  trackerLogger.info(`[骋烈] ${stage}`, payload)
}

function isChengLieReveal(raw: any, ids: number[]): boolean {
  return (
    Number(raw.FromZone) === 1 && Number(raw.ToZone) === 10 && ids.length >= 2 && ids.length <= 3
  )
}
