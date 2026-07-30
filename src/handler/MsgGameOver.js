import { resetSeatUIs } from '@/dom'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { wait } from '@/utils'

let closeGameOverWindowsTimer = null

function scheduleCloseGameOverWindows() {
  if (closeGameOverWindowsTimer !== null) clearTimeout(closeGameOverWindowsTimer)
  closeGameOverWindowsTimer = null
  if (!globalConfig.blockMvpSettlementSwitch) return

  closeGameOverWindowsTimer = setTimeout(() => {
    closeGameOverWindowsTimer = null
    wait(() => laya.GetWindow('GameResultWindow')).then((win) => {
      win.laterClose?.()
      wait(() => laya.GetWindow('GameMvpWindow')).then((win) => {
        win.laterClose?.()
      })
    })
  }, 500)
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
