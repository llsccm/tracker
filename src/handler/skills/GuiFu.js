import { tracker } from '@/tracker/runtime/browser'

export const ROLE_DATA_3709 = 3709

/**
 * 诡伏角色数据格式：首项为获得数量，后面紧跟对应数量的 CardID。
 */
export function parseGuiFuCardIDs(datas) {
  if (!Array.isArray(datas)) return []

  const count = Number(datas[0])
  if (!Number.isInteger(count) || count <= 0) return []

  const cardIDs = datas.slice(1, count + 1).map(Number)
  if (
    cardIDs.length !== count ||
    !cardIDs.every((cardID) => Number.isInteger(cardID) && cardID > 0)
  ) {
    return []
  }

  return cardIDs
}

/**
 * 移动消息先登记匿名弃牌获得；角色数据是当前快照，只结算相对上次快照新增的牌。
 * 没有待结算记录时保留普通明牌同步，兼容牌堆获得与回放缺失前置移动的场景。
 */
export function handleGuiFu(msg = {}, currentSeatID) {
  if (msg.SeatID === null || msg.SeatID === undefined) return []
  if (currentSeatID === null || currentSeatID === undefined) return []

  const seatID = Number(msg.SeatID)
  const mySeatID = Number(currentSeatID)
  if (!Number.isInteger(seatID) || seatID === 255) return []
  if (Number.isInteger(mySeatID) && seatID === mySeatID) return []

  const cardIDs = parseGuiFuCardIDs(msg.Datas)
  if (cardIDs.length === 0) return []

  const sourceEvent = {
    type: 'role-data-3709',
    label: 'GsCUpdateRoleDataExNtf:3709',
    raw: msg
  }
  // settle 可能在 missing 分支推进快照，因此必须在结算前取得回退所需的新增牌。
  const revealCardIDs =
    typeof tracker.getTrackerGuiFuRevealDelta === 'function'
      ? tracker.getTrackerGuiFuRevealDelta(seatID, cardIDs)
      : cardIDs
  const settlement = tracker.settleTrackerPendingDiscardGain(seatID, cardIDs, sourceEvent)

  if (settlement === 'missing' && revealCardIDs.length > 0) {
    tracker.revealTrackerCards(
      {
        type: 'player',
        seatID,
        fromSeatID: seatID,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        handMoveCount: 0,
        sourceEvent
      },
      revealCardIDs
    )
  }

  return cardIDs
}
