import { tracker } from '@/tracker/runtime/browser'

export function handleQiaoZhi(msg = {}, currentSeatID) {
  const seatID =
    msg.SeatID === null || msg.SeatID === undefined ? Number.NaN : Number(msg.SeatID)
  const mySeatID =
    currentSeatID === null || currentSeatID === undefined
      ? Number.NaN
      : Number(currentSeatID)

  if (!Array.isArray(msg.Datas) || !Number.isInteger(seatID)) return
  if (Number.isInteger(mySeatID) && seatID === mySeatID) return

  // Datas: [CardID, 0]；巧织每次只获得一张牌，末项 0 是协议结束值。
  const cardID = Number(msg.Datas[0])
  if (!(cardID > 0)) return

  tracker.revealTrackerCards(
    {
      type: 'player',
      seatID,
      // PubGsCMoveCard 已经记录了暗取数量，这里只把通知携带的身份物化到现有暗槽。
      handMoveCount: 0,
      sourceEvent: {
        type: 'qiaozhi:update-role-data',
        label: 'GsCUpdateRoleDataExNtf:3544',
        raw: msg
      }
    },
    [cardID]
  )
}
