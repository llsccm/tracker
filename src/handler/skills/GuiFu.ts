import { tracker } from '@/tracker/runtime/browser'
import type { CardID, SeatID } from '@/tracker/types'
import type { RoleDataMessage } from './types'

export { GUI_FU_ROLE_DATA_ID as ROLE_DATA_3709 } from '@/tracker/protocol/protocolRules'

/**
 * 诡伏角色数据格式：首项为当前持有数量，随后为新增在前、仍持有旧牌在后的 CardID。
 */
export function parseGuiFuCardIDs(datas: unknown): CardID[] {
  if (!Array.isArray(datas)) return []

  const count = datas[0]
  const cardIDs = datas.slice(1, count + 1)
  return cardIDs.length === count && cardIDs.every((cardID) => cardID > 0) ? cardIDs : []
}

/**
 * 非主视角用角色数据补齐相邻移动；主视角的移动已携带 ID，不重复提交。
 */
export function handleGuiFu(
  msg: RoleDataMessage = {},
  currentSeatID: SeatID | string | null
): CardID[] {
  if (msg.SeatID == null || currentSeatID == null) return []

  const seatID = Number(msg.SeatID)
  if (seatID === 255 || seatID === Number(currentSeatID)) return []

  const cardIDs = parseGuiFuCardIDs(msg.Datas)
  tracker.syncTrackerGuiFuRoleData(seatID, cardIDs)
  return cardIDs
}
