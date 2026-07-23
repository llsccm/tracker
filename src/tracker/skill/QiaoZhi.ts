import { CARD_INSTANCE_STATUS } from '../CardCounter'
import { trackerLogger } from '@/utils/logger'
import type { Room } from '../Room'

type MoveEventDraft = any

const QIAO_ZHI_SPELL_ID = 3544
const QIAO_ZHI_SELECTION_STATE_KEY = 'qiaozhiSelection'

interface QiaoZhiSelectionState {
  displayedCardIDs: number[]
  selectedCount: number
  targetSeatID: number | null
  anonymousHandEntityIDsBefore: number[]
}

function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

function hasPositiveID(cardIDs: any[] = []): boolean {
  return cardIDs.some((id) => id > 0)
}

function getPositiveIDs(cardIDs: any[] = []): number[] {
  return Array.from(new Set(cardIDs.map((id) => Number(id) || 0).filter((id) => id > 0)))
}

function nextGroupID(room: Room, label: string): string {
  return `${label}_${QIAO_ZHI_SPELL_ID}_${++room.constraintGroupSeq}`
}

function getUnknownPlayerCards(
  room: Room,
  seatID: unknown,
  count: number,
  subZone = 'hand'
): any[] {
  const seat = Number(seatID)
  if (Number.isNaN(seat) || !(count > 0)) return []

  const playerCards: any[] = []
  const unknownCards = room.counter?.cardsByStatus?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? room.cards
  for (const card of unknownCards) {
    if (
      card.location === 'player' &&
      card.subZone === subZone &&
      card.seats.has(seat) &&
      card.isKnown !== true
    ) {
      playerCards.push(card)
      if (playerCards.length >= count) break
    }
  }

  return playerCards
}

function getAnonymousHandEntityIDs(room: Room, seatID: number): number[] {
  return getUnknownPlayerCards(room, seatID, room.cards.length)
    .filter((card) => Number(card.entityID) < 0)
    .map((card) => Number(card.entityID))
}

function recordDisplayedCards(event: MoveEventDraft, room: Room): void {
  const displayedCardIDs = getPositiveIDs(event.cardIDs)
  const cardCount = getCount(event)

  if (cardCount <= 0 || displayedCardIDs.length !== cardCount) {
    room.clearSkillState(QIAO_ZHI_SELECTION_STATE_KEY)
    trackerLogger.info('巧织暗取牌推断跳过', {
      stage: 'display',
      reason: '展示牌 ID 不完整',
      cardCount,
      displayedCardIDs
    })
    return
  }

  const state = room.getSkillState(
    QIAO_ZHI_SELECTION_STATE_KEY,
    (): QiaoZhiSelectionState => ({
      displayedCardIDs: [],
      selectedCount: 0,
      targetSeatID: null,
      anonymousHandEntityIDsBefore: []
    })
  ) as QiaoZhiSelectionState

  state.displayedCardIDs = displayedCardIDs
  state.selectedCount = 0
  state.targetSeatID = null
  state.anonymousHandEntityIDsBefore = []

  trackerLogger.info('巧织暗取牌候选记录', {
    cardCount,
    displayedCardIDs
  })
}

function recordHiddenGain(event: MoveEventDraft, room: Room, raw: any): void {
  const state = room.skillState.get(QIAO_ZHI_SELECTION_STATE_KEY) as
    | QiaoZhiSelectionState
    | undefined
  if (!state?.displayedCardIDs.length) return

  const selectedCount = getCount(event)
  const [targetSeatID] = room.normalizeSeats(Number(raw.ToID))
  if (
    hasPositiveID(event.cardIDs) ||
    !(selectedCount > 0) ||
    selectedCount >= state.displayedCardIDs.length ||
    targetSeatID === undefined
  ) {
    room.clearSkillState(QIAO_ZHI_SELECTION_STATE_KEY)
    trackerLogger.info('巧织暗取牌推断跳过', {
      stage: 'hiddenGain',
      reason: '暗取数量、座位或 CardIDs 不符合差集推断条件',
      displayedCardIDs: state.displayedCardIDs,
      selectedCount,
      targetSeatID: targetSeatID ?? null,
      cardIDs: event.cardIDs
    })
    return
  }

  state.selectedCount = selectedCount
  state.targetSeatID = targetSeatID
  state.anonymousHandEntityIDsBefore = getAnonymousHandEntityIDs(room, targetSeatID)

  trackerLogger.info('巧织暗取牌等待差集', {
    displayedCardIDs: state.displayedCardIDs,
    selectedCount,
    targetSeatID,
    anonymousHandEntityIDsBefore: state.anonymousHandEntityIDsBefore
  })
}

function settleHiddenGain(event: MoveEventDraft, room: Room): void {
  const state = room.skillState.get(QIAO_ZHI_SELECTION_STATE_KEY) as
    | QiaoZhiSelectionState
    | undefined
  room.clearSkillState(QIAO_ZHI_SELECTION_STATE_KEY)

  if (!state || state.targetSeatID === null || !(state.selectedCount > 0)) return

  const discardedCardIDs = getPositiveIDs(event.cardIDs)
  const expectedDiscardCount = state.displayedCardIDs.length - state.selectedCount
  const displayedCardIDSet = new Set(state.displayedCardIDs)
  const discardedCardIDSet = new Set(discardedCardIDs)
  const inferredHandCardIDs = state.displayedCardIDs.filter(
    (cardID) => !discardedCardIDSet.has(cardID)
  )
  const hasExactDifference =
    discardedCardIDs.length === expectedDiscardCount &&
    discardedCardIDs.every((cardID) => displayedCardIDSet.has(cardID)) &&
    inferredHandCardIDs.length === state.selectedCount

  if (!hasExactDifference) {
    trackerLogger.info('巧织暗取牌推断跳过', {
      stage: 'discard',
      reason: '明弃牌不能与展示牌形成完整差集',
      displayedCardIDs: state.displayedCardIDs,
      discardedCardIDs,
      expectedDiscardCount,
      selectedCount: state.selectedCount,
      targetSeatID: state.targetSeatID
    })
    return
  }

  const inferredCards = inferredHandCardIDs
    .map((cardID) => room.cardIndex.get(cardID))
    .filter(Boolean)
  const invalidCards = inferredCards.filter(
    (card) =>
      !(
        card.location === 'player' &&
        ((card.subZone === 'mark' && card.spellID === QIAO_ZHI_SPELL_ID && card.seats.size === 0) ||
          (card.subZone === 'hand' && card.seats.has(state.targetSeatID!)))
      )
  )

  if (inferredCards.length !== inferredHandCardIDs.length || invalidCards.length > 0) {
    trackerLogger.info('巧织暗取牌推断跳过', {
      stage: 'confirm',
      reason: '差集牌已不在巧织选择区或目标手牌',
      inferredHandCardIDs,
      invalidCardIDs: invalidCards.map((card) => card.id),
      targetSeatID: state.targetSeatID
    })
    return
  }

  const cardsToMove = inferredCards.filter(
    (card) => card.subZone !== 'hand' || !card.seats.has(state.targetSeatID!)
  )
  const anonymousHandEntityIDsBeforeConfirmation = getAnonymousHandEntityIDs(
    room,
    state.targetSeatID
  )

  if (cardsToMove.length > 0) {
    room.moveCards(
      cardsToMove.map((card) => card.id),
      'player',
      {
        seatID: state.targetSeatID,
        subZone: 'hand',
        spellID: QIAO_ZHI_SPELL_ID,
        combinationID: nextGroupID(room, 'qiaozhi_inferred_hand'),
        fromZone: null,
        cardCount: cardsToMove.length,
        handMoveCount: 0,
        sourceEvent: {
          type: 'qiaozhi:inferred-hidden-gain',
          label: '巧织暗取牌差集确认',
          raw: getRaw(event)
        }
      }
    )
  }

  trackerLogger.info('巧织暗取牌差集确认', {
    displayedCardIDs: state.displayedCardIDs,
    discardedCardIDs,
    inferredHandCardIDs,
    targetSeatID: state.targetSeatID,
    selectedCount: state.selectedCount,
    anonymousHandEntityIDsBeforeSelection: state.anonymousHandEntityIDsBefore,
    anonymousHandEntityIDsBeforeConfirmation,
    anonymousHandEntityIDsAfterConfirmation: getAnonymousHandEntityIDs(room, state.targetSeatID)
  })
}

export default function decorateQiaoZhi(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)
  const moveType = Number(raw.MoveType)

  if (fromZone === 1 && toZone === 8 && moveType === 6) {
    recordDisplayedCards(event, room)
    return event
  }

  if (
    fromZone === 8 &&
    toZone === 5 &&
    moveType === 18 &&
    Number(raw.FromID) === QIAO_ZHI_SPELL_ID
  ) {
    recordHiddenGain(event, room, raw)
    return event
  }

  if (
    fromZone === 8 &&
    toZone === 2 &&
    moveType === 4 &&
    Number(raw.FromID) === QIAO_ZHI_SPELL_ID
  ) {
    settleHiddenGain(event, room)
  }

  return event
}
