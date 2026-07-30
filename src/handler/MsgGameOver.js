import { resetSeatUIs } from '@/dom'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { wait } from '@/utils'

let closeGameOverWindowsTimer = null

// 应该存在一个更好的方法
function scheduleCloseGameOverWindows() {
  if (closeGameOverWindowsTimer !== null) clearTimeout(closeGameOverWindowsTimer)
  closeGameOverWindowsTimer = null
  if (!globalConfig.blockMvpSettlementSwitch) return

  closeGameOverWindowsTimer = setTimeout(async () => {
    closeGameOverWindowsTimer = null

    const getWindow = (name) => {
      const win = laya.GetWindow(name)
      return win && !win.destroyed ? win : null
    }

    const resultWin = await wait(() => getWindow('GameResultWindow'))
    if (!resultWin) return

    // 此时关闭战绩会导致山河图结算窗口没有数据
    if (getWindow('RogueZhanJiWindow')) return

    const zhanJiWin = await wait(() => getWindow('RogueZhanJiWindow'), 4, 250)
    if (zhanJiWin) return

    if (!resultWin.destroyed) {
      resultWin.laterClose?.()
    }

    // mvp窗口在战绩后出现
    const mvpWin = await wait(() => getWindow('GameMvpWindow'))
    if (mvpWin && !mvpWin.destroyed) {
      mvpWin.laterClose?.()
    }
  }, 1000)
}

export function handleGameOver() {
  scheduleCloseGameOverWindows()
  cleanupGame()
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
