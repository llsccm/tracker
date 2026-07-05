import { Game, user } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

/** 旧录像可能没有该消息 GsCModifyUserseatNtf */
export function handleStartGame(msg) {
  // 房间中座位信息 需等先手位置更新后再设置牌局座位
  if (msg.IsGameStart) {
    tracker.initTrackerRoom()
    Game.init()
    // 这里如果要识别机器人 则要遍历损失性能
    const { Infos } = msg
    Game.size = Infos.length
    // 录像中不一定有使用者的uuid 或者使用者并非主视角 贸然使用uuid匹配会导致视角错误
    const mySeatID = Infos[0].SeatID ?? 0
    const uuid = Infos[0].ClientID ?? user.userID
    Game.setMyID(mySeatID)

    tracker.registerTrackerPlayers(Infos, uuid)
  }
}

/** 通用座位信息 */
export function handleRecordStartGame(msg) {
  tracker.initTrackerRoom()
  Game.init()
  const { seatinfo } = msg.data.protoObj
  Game.size = seatinfo.length
  const mySeatID = seatinfo[0].seat_id ?? 0
  const uuid = seatinfo[0].user_temp_id ?? undefined
  Game.setMyID(mySeatID)

  tracker.registerTrackerPlayers(seatinfo, uuid)
}
