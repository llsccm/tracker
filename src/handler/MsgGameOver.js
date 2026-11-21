import { resetSeatOverlay } from '@/ui/seatOverlay'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { destroyPingJianWindow } from '@/ui/PingJianWindow'
import { wait } from '@/utils'

let closeGameOverWindowsTimer = null
let gameOverFallbackTimer = null
let gameOverTask = null
// 收尾完成后仍保留单局标记，不随弹窗任务结束而重置。
let gameOverHandled = false

export function cancelGameOverTask({ resetForNewGame = false } = {}) {
  if (closeGameOverWindowsTimer !== null) {
    clearTimeout(closeGameOverWindowsTimer)
    closeGameOverWindowsTimer = null
  }
  if (gameOverFallbackTimer !== null) {
    clearTimeout(gameOverFallbackTimer)
    gameOverFallbackTimer = null
  }
  gameOverTask = null
  if (resetForNewGame) gameOverHandled = false
}

function isCurrentGameOverTask(task) {
  return gameOverTask === task
}

function scheduleCloseGameOverWindows(task, delay = 200) {
  closeGameOverWindowsTimer = setTimeout(async () => {
    closeGameOverWindowsTimer = null
    if (!isCurrentGameOverTask(task)) return

    await Promise.all(
      Array.from(task.windowNames, (windowName) => waitAndCloseGameOverWindow(task, windowName))
    )

    if (isCurrentGameOverTask(task)) cancelGameOverTask()
  }, delay)
}

async function waitAndCloseGameOverWindow(task, windowName) {
  const canClose = () =>
    isCurrentGameOverTask(task) &&
    globalConfig.blockMvpSettlementSwitch &&
    performance.now() < task.deadline
  if (!canClose()) return

  try {
    const win = await wait(
      () => {
        // wait 以真值结束；取消或超时后提前退出，并在关闭前再次检查。
        if (!canClose()) return true
        const win = laya.GetWindow(windowName)
        return win?.visible ? win : null
      },
      Math.ceil((task.deadline - performance.now()) / 200) + 1,
      200,
      { immediate: true }
    )
    if (!canClose() || !win || win === true) return

    await wait(
      () => !canClose() || win.destroyed || !win.isShowWait,
      Math.ceil((task.deadline - performance.now()) / 200) + 1,
      200,
      { immediate: true }
    )
    if (win.destroyed) return
    if (!canClose() || win.isShowWait) return

    win.laterClose?.()
  } catch (e) {
    console.warn('[game-over] 关闭结算窗口失败', windowName, e)
  }
}

export function handleGameOver() {
  if (gameOverHandled) return
  if (gameOverTask !== null) {
    finishGameOver(gameOverTask)
    return
  }

  // 首次通知只记录；第二次通知或超时兜底才进入收尾。
  const windowNames = Game.isShanHeTu ? ['GameResultWindow'] : ['GameResultWindow', 'GameMvpWindow']
  const task = {
    windowNames: new Set(windowNames),
    deadline: null
  }
  gameOverTask = task
  gameOverFallbackTimer = setTimeout(() => finishGameOver(task), 5000)
}

function finishGameOver(task) {
  if (!isCurrentGameOverTask(task) || gameOverHandled) return
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

  task.deadline = performance.now() + 5000
  scheduleCloseGameOverWindows(task, 500)
}

export function handleLeaveTable() {
  cancelGameOverTask()
  cleanupGame()
}

function cleanupGame() {
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
