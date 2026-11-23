import { resetSeatOverlay } from '@/ui/seatOverlay'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { destroyPingJianWindow } from '@/ui/PingJianWindow'
import { wait } from '@/utils'

let gameOverFallbackTimer = null
let gameOverTask = null
// 对局清理与结算收尾可能由不同通知触发，分别保持单局幂等。
let gameOverHandled = false
let gameCleanedUp = false

export function cancelGameOverTask({ resetForNewGame = false } = {}) {
  if (gameOverFallbackTimer !== null) {
    clearTimeout(gameOverFallbackTimer)
    gameOverFallbackTimer = null
  }
  gameOverTask = null
  if (resetForNewGame) {
    gameOverHandled = false
    gameCleanedUp = false
  }
}

function isCurrentGameOverTask(task) {
  return gameOverTask === task
}

async function closeGameOverWindows(task) {
  if (!isCurrentGameOverTask(task)) return

  for (const windowName of task) {
    await waitAndCloseGameOverWindow(task, windowName)
  }

  if (isCurrentGameOverTask(task)) cancelGameOverTask()
}

async function waitAndCloseGameOverWindow(task, windowName) {
  const canClose = () => isCurrentGameOverTask(task) && globalConfig.blockMvpSettlementSwitch
  if (!canClose()) return

  try {
    const win = await wait(
      () => {
        // wait 以真值结束；取消后提前退出，并在关闭前再次检查。
        if (!canClose()) return true
        const win = laya.GetWindow(windowName)
        return win?.visible ? win : null
      },
      10,
      250,
      { immediate: true }
    )

    if (!canClose() || !win || win === true) return

    await wait(() => !canClose() || win.destroyed || !win.isShowWait, 5, 250, { immediate: true })
    if (win.destroyed) return
    if (!canClose() || win.isShowWait) return

    win.laterClose?.()
  } catch (e) {
    console.warn('[game-over] 关闭结算窗口失败', windowName, e)
  }
}

export function handleGameOver(data) {
  if (gameOverHandled || Game.isOtherGame(data.game_id)) return
  if (gameOverTask !== null) {
    finishGameOver(gameOverTask, data)
    return
  }

  // 首次通知只记录；第二次通知或超时兜底才进入收尾。
  const windowNames = Game.isShanHeTu ? ['GameResultWindow'] : ['GameResultWindow', 'GameMvpWindow']
  const task = new Set(windowNames)
  gameOverTask = task
  gameOverFallbackTimer = setTimeout(() => finishGameOver(task, data), 1200)
}

function finishGameOver(task, data) {
  if (!isCurrentGameOverTask(task) || gameOverHandled) return
  if (Game.isOtherGame(data.game_id)) {
    cancelGameOverTask()
    return
  }
  gameOverHandled = true
  if (gameOverFallbackTimer !== null) {
    clearTimeout(gameOverFallbackTimer)
    gameOverFallbackTimer = null
  }

  cleanupGame()
  if (!isCurrentGameOverTask(task)) return
  if (!globalConfig.blockMvpSettlementSwitch) {
    cancelGameOverTask()
    return
  }

  void closeGameOverWindows(task)
}

export function handleLeaveTable() {
  // 离桌可能夹在两次结束通知之间，保留任务供后续通知或超时收尾。
  cleanupGame()
}

function cleanupGame() {
  if (gameCleanedUp) return
  gameCleanedUp = true
  // document.querySelectorAll('.mizhu').forEach((e) => (e.style.display = 'none'))
  Game.isPassed = null
  laya.zhanfaMap.clear()
  Game.end()
  destroyPeiXiuMapWindow()
  destroyPingJianWindow()
  // 重置 UI
  resetSeatOverlay()
  tracker.destroyTrackerRoom()
}
