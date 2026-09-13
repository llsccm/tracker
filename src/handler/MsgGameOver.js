import { resetSeatUIs } from '@/dom'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { wait } from '@/utils'

let closeGameOverWindowsTimer = null
let gameOverTask = null

export function cancelGameOverTask() {
  if (closeGameOverWindowsTimer !== null) {
    clearTimeout(closeGameOverWindowsTimer)
    closeGameOverWindowsTimer = null
  }
  gameOverTask = null
}

function isCurrentGameOverTask(task) {
  if (gameOverTask !== task) return false
  const room = tracker.getTrackerRoom()
  return room === null || room === task.room
}

function scheduleCloseGameOverWindows(task) {
  if (!globalConfig.blockMvpSettlementSwitch) {
    cleanupGame(task.room)
    return
  }

  closeGameOverWindowsTimer = setTimeout(async () => {
    closeGameOverWindowsTimer = null
    if (!isCurrentGameOverTask(task)) return

    const getWindow = (name) => {
      const win = laya.GetWindow(name)
      return win && win.visible ? win : null
    }

    for (const windowName of task.windowNames) {
      const win = await wait(() => !isCurrentGameOverTask(task) || getWindow(windowName))
      if (!isCurrentGameOverTask(task)) return
      if (!win) break

      win.laterClose?.()
    }

    if (isCurrentGameOverTask(task)) cleanupGame(task.room)
  }, 500)
}

export function handleGameOver() {
  cancelGameOverTask()
  gameOverTask = {
    room: tracker.getTrackerRoom(),
    windowNames: Game.isShanHeTu ? ['GameResultWindow'] : ['GameResultWindow', 'GameMvpWindow']
  }
  scheduleCloseGameOverWindows(gameOverTask)
}

export function handleLeaveTable() {
  cleanupGame()
}

function cleanupGame(room = tracker.getTrackerRoom()) {
  if (tracker.getTrackerRoom() !== room) return
  // document.querySelectorAll('.mizhu').forEach((e) => (e.style.display = 'none'))
  Game.isPassed = null
  laya.zhanfaMap.clear()
  Game.end()
  destroyPeiXiuMapWindow()
  // 重置 UI
  resetSeatUIs()
  tracker.destroyTrackerRoom()
}
