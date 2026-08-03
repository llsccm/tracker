import { resetSeatUIs } from '@/dom'
import { laya } from '@/runtime/gameAdapter'
import { Game, globalConfig } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { wait } from '@/utils'

let gameOverCount = 0
let gameOverFallbackTimer = null

// 应该存在一个更好的方法
async function scheduleCloseGameOverWindows() {
  if (gameOverFallbackTimer !== null) {
    clearTimeout(gameOverFallbackTimer)
    gameOverFallbackTimer = null
  }

  if (!globalConfig.blockMvpSettlementSwitch) {
    cleanupGame()
    return
  }

  const getWindow = (name) => {
    const win = laya.GetWindow(name)
    return win && win.visible ? win : null
  }

  // 此时关闭战绩 山河图结算数据还不存在导致窗口空白
  const resultWin = await wait(() => getWindow('GameResultWindow'))
  if (!resultWin) {
    cleanupGame()
    return
  }

  // 等山河图结算窗口初始化
  if (Game.isShanHeTu) await wait(() => getWindow('RogueZhanJiWindow'))
  // 但是这样会关闭山河图结算
  resultWin.laterClose?.()

  // 山河图没有mvp窗口
  // mvp窗口在战绩后出现
  if (!Game.isShanHeTu) {
    const mvpWin = await wait(() => getWindow('GameMvpWindow'))
    if (mvpWin) {
      mvpWin.laterClose?.()
    }
  }

  cleanupGame()
}

export function handleGameOver() {
  gameOverCount++

  if (gameOverCount >= 2) {
    scheduleCloseGameOverWindows()
    return
  }

  gameOverFallbackTimer = setTimeout(() => {
    scheduleCloseGameOverWindows()
  }, 4000)
}

export function handleLeaveTable() {
  cleanupGame()
}

function cleanupGame() {
  gameOverCount = 0

  if (gameOverFallbackTimer !== null) {
    clearTimeout(gameOverFallbackTimer)
    gameOverFallbackTimer = null
  }

  document.querySelectorAll('.mizhu').forEach((e) => (e.style.display = 'none'))
  Game.isPassed = null
  Game.end()
  destroyPeiXiuMapWindow()
  // 重置 UI
  resetSeatUIs()
  tracker.destroyTrackerRoom()
}
