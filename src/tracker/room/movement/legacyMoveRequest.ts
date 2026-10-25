import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { MoveSource, MoveTarget, PlayerMoveArea, RoomMoveRequest } from '@/tracker/types'
import { playerMoveTarget } from '@/tracker/helper/moveEndpoint'
import type { MoveTargetZone, RoomMovementOptions } from './types'

/** 迁移期唯一旧入口；调用方全部切换后删除。 */
export function legacyMoveRequest(
  toZone: MoveTargetZone,
  opt: RoomMovementOptions
): RoomMoveRequest {
  const position = opt.position ?? POSITION_TOP
  const fromPosition = opt.fromPosition ?? position
  const area = (subZone: string, spellID: number | null | undefined): PlayerMoveArea =>
    subZone === 'mark'
      ? { subZone, markSpellID: spellID ?? null }
      : { subZone: subZone as 'hand' | 'equip' | 'judge' }
  const fromZone =
    opt.fromZone ?? (opt.fromSeatID != null ? null : opt.fromZone === null ? null : 'pile')
  const fromSeat = opt.fromSeatID ?? (typeof fromZone === 'number' ? fromZone : null)
  const from: MoveSource =
    fromZone === 'popup'
      ? { type: 'popup', spaceID: opt.fromPopupSpaceID! }
      : fromZone === 'outside'
        ? { type: 'outside' }
        : typeof fromZone === 'string'
          ? { type: 'public', zone: fromZone as 'pile', position: fromPosition }
          : fromSeat != null
            ? {
                type: 'player',
                seatID: fromSeat,
                ...area(
                  opt.fromSubZone ?? opt.subZone ?? 'hand',
                  opt.fromSpellID !== undefined ? opt.fromSpellID : opt.spellID
                )
              }
            : { type: 'unresolved' }
  const seats = Array.isArray(opt.toSeatID) ? opt.toSeatID : [opt.toSeatID!]
  const to: MoveTarget =
    toZone === 'player'
      ? playerMoveTarget(seats as [number, ...number[]], area(opt.subZone ?? 'hand', opt.spellID))
      : toZone === 'popup'
        ? { type: 'popup', spaceID: opt.toPopupSpaceID! }
        : toZone === 'outside'
          ? { type: 'outside' }
          : { type: 'public', zone: toZone as 'pile', position }
  return {
    from,
    to,
    triggerSpellID:
      opt.pileIdentityEvent?.protocol.SpellID ?? opt.sourceEvent?.spellID ?? opt.spellID,
    gainSpellID: opt.gainSpellID,
    pileIdentityCardIDs: opt.pileIdentityCardIDs,
    pileIdentityEvent: opt.pileIdentityEvent,
    combinationID: opt.combinationID,
    cardCount: opt.cardCount,
    handMoveCount: opt.handMoveCount,
    moveType: opt.moveType,
    expectedSlotsByLocation: opt.expectedSlotsByLocation,
    anonymizeCards: opt.anonymizeCards,
    requireAnonymizeSuccess: opt.requireAnonymizeSuccess,
    sourceCards: opt.sourceCards,
    publicCandidateSource: opt.publicCandidateSource,
    forceRandomHandTransferCandidates: opt.forceRandomHandTransferCandidates,
    postMovePublicCandidates: opt.postMovePublicCandidates,
    sourceEvent: opt.sourceEvent
  }
}
