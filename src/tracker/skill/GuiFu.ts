import type { Room } from '../Room'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import { GUI_FU_ROLE_DATA_ID } from '../protocol/protocolRules'
import type { CardID, NormalizedMoveCardFields, RawMoveCardEvent, SeatID } from '../types'
import type { RoomSkillPlugin } from '../room/moveEvents'
import { trackerLogger } from '@/utils/logger'

/** 无 ID 的获得与角色数据相邻；只暂存一条原始移动，不提前改动任何牌实体。 */
interface GuiFuMove {
  readonly raw: Readonly<RawMoveCardEvent>
  readonly patched: NormalizedMoveCardFields
}

export function deferGuiFuMove(
  room: Room,
  raw: Readonly<RawMoveCardEvent>,
  move: NormalizedMoveCardFields
): boolean {
  const previous = room.readSkillState<GuiFuMove>(GUI_FU_ROLE_DATA_ID)
  if (previous) {
    room.deleteSkillState(GUI_FU_ROLE_DATA_ID)
    trackerLogger.warn('诡伏移动未收到相邻角色数据，已丢弃待补全移动', {
      previous,
      next: move
    })
  }

  const fromZone = move.FromZone
  const cardIDs = move.CardIDs
  if (
    move.SpellID !== GUI_FU_ROLE_DATA_ID ||
    move.MoveType !== MOVE_TYPE.GAIN ||
    (fromZone !== 1 && fromZone !== 2) ||
    move.ToZone !== 5 ||
    move.ToID == null ||
    move.ToID === 255 ||
    move.CardCount <= 0 ||
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
  const count = patched.CardCount
  const gainedIDs = cardIDs.slice(0, count)
  if (
    patched.ToID !== seatID ||
    gainedIDs.length !== count ||
    new Set(gainedIDs).size !== count ||
    (patched.FromZone === 2 && !hasDiscardSourceCards(room, gainedIDs))
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
  const discard = room.getZone('discard')
  return cardIDs.every((cardID) => {
    const card = room.cardIndex.get(cardID)
    return card?.location === 'discard' && card.isKnown && discard.cards.includes(card)
  })
}

/** 角色数据首项为数量，后续身份按新增在前排列；尾部补零不属于持有牌。 */
export function parseGuiFuCardIDs(datas: unknown): CardID[] {
  if (!Array.isArray(datas)) return []
  const count = datas[0]
  const cardIDs = datas.slice(1, count + 1)
  return cardIDs.length === count && cardIDs.every((cardID) => cardID > 0) ? cardIDs : []
}

export const guiFuPlugin: RoomSkillPlugin = {
  id: 'guiFu',
  // 后续任意移动都会使未配对记录失效，不能仅订阅 3709。
  beforeNormalizeMove(patched, raw, room) {
    if (deferGuiFuMove(room, raw, patched)) return 'defer'
  },
  onProtocolEvent(event, room) {
    if (event.type !== 'roleData' || event.message.DataID !== GUI_FU_ROLE_DATA_ID) return
    const { SeatID, Datas } = event.message
    if (SeatID == null || SeatID === 255 || room.mySeatID == null || SeatID === room.mySeatID)
      return
    return completeGuiFuMove(room, SeatID, parseGuiFuCardIDs(Datas)) ?? undefined
  },
  onDeckInitialized: (room) => room.deleteSkillState(GUI_FU_ROLE_DATA_ID)
}
