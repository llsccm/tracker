import type { Room } from '../Room'
import type { SeatID } from '../types'
import { POSITION_RANDOM, POSITION_TOP } from '../candidate/cardPositions'
import { hasPositiveID, patchEvent, type MoveEventDraft } from './moveEventUtils'

export const YAN_XI_SPELL_ID = 7017

interface YanXiBatch {
  toSeatID: SeatID
  remainingPileCards: number
}

export default function decorateYanXi(event: MoveEventDraft, room: Room): MoveEventDraft {
  // 国战成功仍随机获得，不能套用牌顶取牌，也不能落入失败的匿名化分支。
  if (room.game.isGuoZhan) return event
  const move = event.protocol
  const batch = room.readSkillState<YanXiBatch>(YAN_XI_SPELL_ID)
  const isYanXiGain = move.MoveType === 8 && move.ToZone === 5 && event.cardCount === 1

  // 获得对方手牌是成功标志；该条转移仍交给通用手牌移动。
  if (isYanXiGain && move.FromZone === 5 && move.FromID !== move.ToID) {
    room.setSkillState<YanXiBatch>(YAN_XI_SPELL_ID, {
      toSeatID: move.ToID,
      remainingPileCards: 2
    })
    return event
  }

  if (batch?.toSeatID === move.ToID) {
    batch.remainingPileCards--
    if (batch.remainingPileCards === 0) room.deleteSkillState(YAN_XI_SPELL_ID)
    return decorateTopGain(event, room)
  }

  if (batch) room.deleteSkillState(YAN_XI_SPELL_ID)
  if (hasPositiveID(event.cardIDs) || move.FromPosition !== POSITION_RANDOM) return event

  // 失败且未公开身份时只放弃原前两槽的明牌定位，不向更深处寻找第二张明牌。
  const anonymizeCards = room
    .getPublicEndpointCards('pile', 2, POSITION_TOP)
    .filter((card) => card.id > 0 && card.isKnown)
  if (anonymizeCards.length === 0) return event

  return patchEvent(event, {
    options: { anonymizeCards, requireAnonymizeSuccess: true }
  })
}

function decorateTopGain(event: MoveEventDraft, room: Room): MoveEventDraft {
  if (hasPositiveID(event.cardIDs)) {
    return patchEvent(event, { options: { fromPosition: POSITION_TOP } })
  }

  const sourceCards = room.getPublicEndpointCards('pile', 1, POSITION_TOP)
  const cardIDs = sourceCards.filter((card) => card.id > 0 && card.isKnown).map((card) => card.id)
  // MoveType=8 的通用暗牌获得会跳过明牌；成功批次须显式移动牌顶实体并同步已知身份账本。
  return patchEvent(event, {
    cardIDs,
    options: {
      fromPosition: POSITION_TOP,
      sourceCards: cardIDs.length > 0 ? [] : sourceCards,
      pileIdentityCardIDs: cardIDs
    }
  })
}
