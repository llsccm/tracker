import type { Room } from '../Room'
import { MOVE_TYPE } from '../MoveEventNormalizer'
import { GUI_FU_ROLE_DATA_ID } from '../runtime/protocolRules'
import type { CardID, RawMoveCardEvent, SeatID } from '../types'
import { trackerLogger } from '@/utils/logger'

/** 无 ID 的获得与角色数据相邻；只暂存一条原始移动，不提前改动任何牌实体。 */
interface GuiFuMove {
  raw: RawMoveCardEvent
  patched: RawMoveCardEvent
}

export function deferGuiFuMove(room: Room, raw: RawMoveCardEvent, move: RawMoveCardEvent): boolean {
  const previous = room.readSkillState<GuiFuMove>(GUI_FU_ROLE_DATA_ID)
  if (previous) {
    room.deleteSkillState(GUI_FU_ROLE_DATA_ID)
    trackerLogger.warn('诡伏移动未收到相邻角色数据，已丢弃待补全移动', {
      previous,
      next: move
    })
  }

  const fromZone = Number(move.FromZone)
  const cardIDs = Array.isArray(move.CardIDs) ? move.CardIDs : [move.CardIDs ?? 0]
  if (
    Number(move.SpellID) !== GUI_FU_ROLE_DATA_ID ||
    Number(move.MoveType) !== MOVE_TYPE.GAIN ||
    (fromZone !== 1 && fromZone !== 2) ||
    Number(move.ToZone) !== 5 ||
    move.ToID == null ||
    move.ToID === 255 ||
    Number(move.CardCount ?? 0) <= 0 ||
    cardIDs.some((cardID) => cardID > 0)
  ) {
    return false
  }

  // 保留原始协议与已有预处理结果；后续只给 patched 补身份，不把推断结果伪装成 raw。
  room.setSkillState<GuiFuMove>(GUI_FU_ROLE_DATA_ID, { raw, patched: move })
  return true
}

/** 当前持有列表把新增身份放在前面；前置移动的张数就是这次应消费的前缀长度。 */
export function completeGuiFuMove(
  room: Room,
  seatID: SeatID,
  cardIDs: readonly CardID[]
): GuiFuMove | null {
  const pending = room.readSkillState<GuiFuMove>(GUI_FU_ROLE_DATA_ID)
  if (!pending) return null

  // 一条角色数据只配对一次；失配也释放状态，不积压或尝试跨消息恢复。
  room.deleteSkillState(GUI_FU_ROLE_DATA_ID)
  const { raw, patched } = pending
  const count = Number(patched.CardCount)
  const gainedIDs = cardIDs.slice(0, count)
  if (
    patched.ToID !== seatID ||
    gainedIDs.length !== count ||
    new Set(gainedIDs).size !== count ||
    (Number(patched.FromZone) === 2 && !hasDiscardSourceCards(room, gainedIDs))
  ) {
    trackerLogger.warn('诡伏相邻角色数据与待补全移动不匹配，已取消移动', {
      pending,
      seatID,
      cardIDs
    })
    return null
  }

  return { raw, patched: { ...patched, CardIDs: gainedIDs } }
}

// 弃牌已公开，必须精确命中来源实体；牌堆沿用普通已知牌移动，不在技能层推断身份位置。
function hasDiscardSourceCards(room: Room, cardIDs: readonly CardID[]): boolean {
  const discard = room.zones.get('discard')
  return cardIDs.every((cardID) => {
    const card = room.cardIndex.get(cardID)
    return card?.location === 'discard' && card.isKnown && discard?.cards.includes(card) === true
  })
}
