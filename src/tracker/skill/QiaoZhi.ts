import { trackerLogger } from '@/utils/logger'
import type { Room } from '../Room'
import { getCount, getPositiveIDs, getRaw, type MoveEventDraft } from './moveEventUtils'

const QIAO_ZHI_SPELL_ID = 3544
const QIAO_ZHI_SELECTION_STATE_KEY = 'qiaozhiSelection'

interface QiaoZhiSelectionState {
  displayedCardIDs: number[]
  selectedCount: number
  targetSeatID: number | null
}

function recordDisplayedCards(event: MoveEventDraft, room: Room): void {
  const displayedCardIDs = getPositiveIDs(event.cardIDs)
  const cardCount = getCount(event)

  if (cardCount <= 0 || displayedCardIDs.length !== cardCount) {
    room.clearSkillState(QIAO_ZHI_SELECTION_STATE_KEY)
    trackerLogger.debug('巧织暗取牌推断跳过', {
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
      targetSeatID: null
    })
  ) as QiaoZhiSelectionState

  state.displayedCardIDs = displayedCardIDs
  state.selectedCount = 0
  state.targetSeatID = null

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
  const visibleSelectedIDs = getPositiveIDs(event.cardIDs)

  // 主视角（或其它能看到选取结果的视角）：协议直接给出正 CardIDs。
  // 真实移动已由后续 moveCards 完成，差集推断既不需要也不应再跑。
  if (visibleSelectedIDs.length > 0) {
    room.clearSkillState(QIAO_ZHI_SELECTION_STATE_KEY)
    trackerLogger.debug('巧织暗取牌推断跳过', {
      stage: 'hiddenGain',
      reason: '协议已给出选取明牌，主视角可见，跳过差集推断',
      displayedCardIDs: state.displayedCardIDs,
      visibleSelectedIDs,
      selectedCount,
      targetSeatID: targetSeatID ?? null
    })
    return
  }

  if (
    !(selectedCount > 0) ||
    selectedCount >= state.displayedCardIDs.length ||
    targetSeatID === undefined
  ) {
    room.clearSkillState(QIAO_ZHI_SELECTION_STATE_KEY)
    trackerLogger.debug('巧织暗取牌推断跳过', {
      stage: 'hiddenGain',
      reason: '暗取数量或座位不符合差集推断条件',
      displayedCardIDs: state.displayedCardIDs,
      selectedCount,
      targetSeatID: targetSeatID ?? null,
      cardIDs: event.cardIDs
    })
    return
  }

  state.selectedCount = selectedCount
  state.targetSeatID = targetSeatID

  trackerLogger.info('巧织暗取牌等待差集', {
    displayedCardIDs: state.displayedCardIDs,
    selectedCount,
    targetSeatID
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
    trackerLogger.debug('巧织暗取牌推断跳过', {
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
    trackerLogger.debug('巧织暗取牌推断跳过', {
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

  // 差集确认的是「目标手牌里的物理身份」，不是巧织标记区牌。
  // spellID 必须为 null：若写成 3544，后续进木马/其它标记时描述仍会显示「标记(巧织)」。
  // 也不挂 combinationID：单座确定手牌不需要再留模糊组合，避免 AmbiguousKnown 残留 hand/巧织。
  if (cardsToMove.length > 0) {
    room.moveCards(
      cardsToMove.map((card) => card.id),
      'player',
      {
        seatID: state.targetSeatID,
        subZone: 'hand',
        spellID: null,
        fromZone: null,
        cardCount: cardsToMove.length,
        // 暗取阶段已 +1 手牌额度，此处只交换身份，不再增加 observedHandCount
        handMoveCount: 0,
        sourceEvent: {
          type: 'qiaozhi:inferred-hidden-gain',
          label: '巧织暗取牌差集确认',
          raw: getRaw(event)
        }
      }
    )
  }

  // 无论是否发生了实体移动，都把推断到手牌的牌收成「确定手牌」：
  // 清约束组 / 清位置候选 / spellID=null，避免后续暗置木马时仍显示 hand/(标记)巧织。
  inferredCards.forEach((card) => {
    room.removeCardsFromConstraintGroups([card])
    room.clearCardsFromPublicZones([card])
    card.bindTo(state.targetSeatID!, 'hand', null)
    card.combinationID = null
  })
  room.resolveConstraints()

  trackerLogger.info('巧织暗取牌差集确认', {
    displayedCardIDs: state.displayedCardIDs,
    discardedCardIDs,
    inferredHandCardIDs,
    targetSeatID: state.targetSeatID,
    selectedCount: state.selectedCount
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
