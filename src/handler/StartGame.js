import { resetSeatUIs } from '@/dom'
import { user } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { addTooltip } from '@/utils/notification'
import { hideOrderContainer, resetOrderContainer } from '@/ui/seatOverlay'

function registerGamePlayers(infos) {
  resetSeatUIs()
  tracker.initTrackerRoom()
  tracker.registerTrackerPlayers(infos, user.userID)
  resetOrderContainer()
  hideOrderContainer(infos.length)
}

/** 旧录像可能没有该消息 GsCModifyUserseatNtf */
export function handleStartGame(msg) {
  // 房间中座位信息 需等先手位置更新后再设置牌局座位
  if (msg.IsGameStart) {
    // 这里如果要识别机器人 则要遍历损失性能
    const { Infos } = msg
    registerGamePlayers(Infos)
  }
}

/** 通用座位信息 */
export function handleRecordStartGame(msg) {
  if (!user.userID) addTooltip('没有识别到uuid, 主视角数据可能会出错', 'acTooltip', 1000)
  const { seatinfo } = msg.data.protoObj

  // 看录像时不一定有当前用户
  // 当前用户不一定是主视角
  // for (const info of seatinfo) {
  //   if (info.user_id == user.userID) {
  //     Game.isRecord = false
  //     const mySeatID = info.seat_id ?? 0
  //     break
  //   }
  // }

  registerGamePlayers(seatinfo)
}
