import { resetSeatUIs } from '@/dom'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'

export function handleGameOver() {
  document.querySelectorAll('.mizhu').forEach((e) => (e.style.display = 'none'))
  Game.isPassed = null
  Game.end()
  destroyPeiXiuMapWindow()
  // 重置 UI
  resetSeatUIs()
  tracker.destroyTrackerRoom()
}
