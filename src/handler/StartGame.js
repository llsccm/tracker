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
    const uuid = Infos[0].ClientID ?? user.userID

    tracker.registerTrackerPlayers(Infos, uuid)
  }
}

/** 通用座位信息 */
export function handleRecordStartGame(msg) {
  tracker.initTrackerRoom()
  Game.init()
  const { seatinfo } = msg.data.protoObj
  Game.size = seatinfo.length

  // 看录像时并一定有当前用户
  // 当前用户不一定是主视角
  // for (const info of seatinfo) {
  //   if (info.user_id == user.userID) {
  //     Game.isRecord = false
  //     const mySeatID = info.seat_id ?? 0
  //     break
  //   }
  // }

  tracker.registerTrackerPlayers(seatinfo, user.userID)
}
