import { tracker } from '@/tracker/runtime/browser'

export { GUI_FU_ROLE_DATA_ID as ROLE_DATA_3709 } from '@/tracker/runtime/protocolRules'

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
  const canSettlePending = typeof tracker.settleTrackerPendingDiscardGain === 'function'
  const canDiffSnapshot = typeof tracker.getTrackerGuiFuRevealDelta === 'function'
  const canRevealCards = typeof tracker.revealTrackerCards === 'function'

  // 新版结算会在返回前接受 3709 快照，因此必须直接使用它随结果返回的 newCardIDs。
  // 只有结算入口缺失的旧运行时才先调用只读差量接口，避免快照推进后丢失回退身份。
  const settlement = canSettlePending
    ? tracker.settleTrackerPendingDiscardGain(seatID, cardIDs, sourceEvent)
    : {
        result: 'missing',
        newCardIDs: canDiffSnapshot ? tracker.getTrackerGuiFuRevealDelta(seatID, cardIDs) : cardIDs
      }
  const revealCardIDs = Array.isArray(settlement?.newCardIDs) ? settlement.newCardIDs : []

  // missing 同时覆盖“没有弃牌 pending”和“牌堆来源与 pending 交错”；两者都只补充新增身份，
  // 不重复增加前置移动已经记入的手牌数量。方法缺失时静默降级，避免影响协议主处理链。
  if (settlement?.result === 'missing' && revealCardIDs.length > 0 && canRevealCards) {
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
