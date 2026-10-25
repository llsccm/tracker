import { trackerLogger } from '@/utils/logger'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { summarizeMoveContext } from '@/tracker/helper/moveSummary'
import type { Room } from '@/tracker/Room'
import type { CardID } from '@/tracker/types'
import type { MoveTargetZone, RoomMoveContext, RoomMovementOptions } from './types'

/** Capture protocol inputs and pre-move Room facts without retaining state between moves. */
export function createMoveContext(
  room: Room,
  cardIDs: readonly CardID[],
  toZone: MoveTargetZone,
  opt: RoomMovementOptions = {}
): RoomMoveContext {
  const {
    toSeatID,
    subZone = 'hand',
    spellID,
    combinationID,
    fromZone: requestedFromZone,
    fromSeatID,
    fromSpellID,
    cardCount = cardIDs.length,
    handMoveCount: requestedHandMoveCount,
    moveType,
    position = POSITION_TOP,
    fromPosition = position,
    expectedSlotsByLocation,
    anonymizeCards = [],
    requireAnonymizeSuccess = false,
    sourceCards,
    publicCandidateSource,
    forceRandomHandTransferCandidates = false,
    postMovePublicCandidates,
    sourceEvent
  } = opt

  const targetSeats = room.normalizeSeats(toSeatID ?? [])
  // 显式 fromSeatID 表示玩家区来源（与 MoveEventNormalizer 一致 fromZone=null）；
  // 不能默认 pile，否则会抢先走公共区 known 解析，跳过手牌/mark 匿名物化。
  const hasExplicitFromSeat = fromSeatID !== undefined && fromSeatID !== null
  const fromZone =
    requestedFromZone !== undefined ? requestedFromZone : hasExplicitFromSeat ? null : 'pile'
  const fromZoneNumber = Number(fromZone)
  const fromSeat = hasExplicitFromSeat
    ? fromSeatID
    : fromZone !== null &&
        fromZone !== undefined &&
        fromZone !== '' &&
        Number.isFinite(fromZoneNumber)
      ? parseInt(String(fromZone))
      : null
  const fromSubZone = opt.fromSubZone ?? subZone ?? 'hand'
  // 候选身份可由逻辑账本迁移而不移动实体；此时手牌总数变化量与实体移动数不同。
  const handMoveCount = Math.max(0, Number(requestedHandMoveCount ?? cardCount ?? cardIDs.length))
  const sourceHandSeat =
    fromSeat !== null && !Number.isNaN(fromSeat) && fromSubZone === 'hand' ? fromSeat : null
  const targetHandSeat =
    toZone === 'player' && subZone === 'hand' && targetSeats.length === 1 ? targetSeats[0] : null
  const knownIDs = cardIDs.filter((id) => id > 0)
  const sourcePlayer =
    fromSeat !== null && !Number.isNaN(fromSeat) ? room.getPlayer(fromSeat) : null

  const context: RoomMoveContext = {
    fromPopupSpaceID: opt.fromPopupSpaceID,
    toPopupSpaceID: opt.toPopupSpaceID,
    gainSpellID:
      opt.gainSpellID !== undefined
        ? opt.gainSpellID
        : targetHandSeat !== null && targetHandSeat !== sourceHandSeat
          ? (opt.pileIdentityEvent?.protocol.SpellID ?? sourceEvent?.spellID ?? spellID ?? null)
          : undefined,
    pileIdentityCardIDs: opt.pileIdentityCardIDs,
    pileIdentityEvent: opt.pileIdentityEvent,
    cardIDs,
    toZone,
    toSeatID,
    subZone,
    spellID: spellID,
    combinationID,
    fromZone,
    fromSeat,
    fromSubZone,
    fromSpellID: fromSpellID,
    cardCount: Number(cardCount),
    moveType,
    position,
    fromPosition,
    expectedSlotsByLocation,
    anonymizeCards: Array.from(new Set(anonymizeCards)).filter(Boolean),
    requireAnonymizeSuccess,
    sourceCards,
    publicCandidateSource,
    forceRandomHandTransferCandidates,
    postMovePublicCandidates,
    sourceEvent,
    targetSeats,
    handMoveCount,
    sourceHandSeat,
    targetHandSeat,
    sourceHandTotalObserved: sourcePlayer?.hasObservedHandCount === true,
    sourceHandTotalBefore: sourcePlayer?.observedHandCount ?? 0,
    sourceHandUnknownCount: sourcePlayer?.unknownCardCount ?? 0,
    knownIDs,
    sourceIsOutside: fromZone === 'outside',
    unknownCount: Math.max(0, Number(cardCount) || 0, cardIDs.length) - knownIDs.length,
    knownCards: [],
    movedUnknownCards: [],
    publicMovedCards: [],
    skipUnknownMovement: false
  }

  trackerLogger.debug(
    '移动上下文创建',
    summarizeMoveContext(
      {
        ...context,
        toSeatID: targetSeats.length === 1 ? targetSeats[0] : null
      },
      { includeSourceCardIDs: true }
    )
  )

  return context
}
