import { getSeatUIs } from '@/dom'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

export function handleGameOver() {
  document.querySelectorAll('.mizhu').forEach((e) => (e.style.display = 'none'))
  Game.isPassed = null
  Game.end()
  // 重置 UI
  getSeatUIs({ reset: true })
  tracker.destroyTrackerRoom()
}
