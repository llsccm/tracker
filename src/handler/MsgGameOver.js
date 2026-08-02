import { resetSeatUIs } from '@/dom'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { wait } from '@/utils'

let closeGameOverWindowsTimer = null
let isPveRoguelike = false

// 应该存在一个更好的方法
function scheduleCloseGameOverWindows() {
  if (closeGameOverWindowsTimer !== null) clearTimeout(closeGameOverWindowsTimer)
  closeGameOverWindowsTimer = null
  if (!globalConfig.blockMvpSettlementSwitch) {
    cleanupGame()
    return
  }

  closeGameOverWindowsTimer = setTimeout(async () => {
    closeGameOverWindowsTimer = null

    const getWindow = (name) => {
      const win = laya.GetWindow(name)
      return win && win.visible ? win : null
    }

    // 此时关闭战绩 山河图结算数据还不存在导致窗口空白
    const resultWin = await wait(() => getWindow('GameResultWindow'))
    if (!resultWin) return
    // 等山河图结算窗口初始化
    if (isPveRoguelike) await wait(() => getWindow('RogueZhanJiWindow'))
    // if (zhanJiWin) return
    resultWin.laterClose?.()

    // 山河图没有mvp窗口
    // mvp窗口在战绩后出现
    if (!isPveRoguelike) {
      const mvpWin = await wait(() => getWindow('GameMvpWindow'))
      if (mvpWin) {
        mvpWin.laterClose?.()
      }
    }

    cleanupGame()
  }, 500)
}

export function handleGameOver() {
  isPveRoguelike = Game.isShanHeTu
  scheduleCloseGameOverWindows()
}

export function handleLeaveTable() {
  cleanupGame()
}

function cleanupGame() {
  document.querySelectorAll('.mizhu').forEach((e) => (e.style.display = 'none'))
  Game.isPassed = null
  Game.end()
  destroyPeiXiuMapWindow()
  // 重置 UI
  resetSeatUIs()
  tracker.destroyTrackerRoom()
}
