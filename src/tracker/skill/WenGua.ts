import { getMovePosition } from '@/tracker/helper/moveEndpoint'
import { POSITION_BOTTOM, POSITION_TOP } from '../candidate/cardPositions'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import type { Room } from '../Room'
import type { CardID, SeatID } from '../types'
import { hasPositiveID, patchEvent, type MoveEventDraft } from './moveEventUtils'

const WEN_GUA_SPELL_ID = 780

interface WenGuaCandidateState {
  fromSeat: SeatID
  toSeat: SeatID
  cardIDs: CardID[]
}

/** 只记录交牌前的已知候选集合，防止回堆时扩散接收者原有明牌。 */
export function decorateWenGuaCandidateSource(event: MoveEventDraft, room: Room): MoveEventDraft {
  const pending = room.readSkillState<WenGuaCandidateState>(WEN_GUA_SPELL_ID)
  // 已确认交牌/回堆消息相邻；每条问卦移动消费旧记录，新交牌再建立自己的来源名单。
  if (pending) room.deleteSkillState(WEN_GUA_SPELL_ID)

  const move = event.protocol
  if (
    move.SpellID !== WEN_GUA_SPELL_ID ||
    move.FromZone !== 5 ||
    event.cardCount !== 1 ||
    hasPositiveID(event.cardIDs)
  )
    return event

  if (move.MoveType === MOVE_TYPE.GIVE && move.ToZone === 5 && move.FromID !== move.ToID) {
    room.setSkillState<WenGuaCandidateState>(WEN_GUA_SPELL_ID, {
      fromSeat: move.FromID,
      toSeat: move.ToID,
      cardIDs: room.getPlayerHandCardIDs(move.FromID, { includeCandidates: true })
    })
    return event
  }

  if (
    !pending ||
    move.MoveType !== MOVE_TYPE.MOVE ||
    move.ToZone !== 1 ||
    move.FromID !== pending.toSeat ||
    (getMovePosition(event.to) !== POSITION_TOP && getMovePosition(event.to) !== POSITION_BOTTOM)
  )
    return event

  return patchEvent(event, {
    options: {
      // 空集合也必须传递，表示 A 全暗时禁止把 B 原有明牌扩散到牌堆。
      publicCandidateSource: {
        fromSeat: pending.fromSeat,
        cards: room.findCardsByIDs(pending.cardIDs)
      }
    }
  })
}
