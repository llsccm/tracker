import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

export function handleGamePhase(msg) {
  const { Round, SeatID } = msg
  Game.enter(Round, SeatID)
  tracker.scheduleTrackerRender()

  if (Round == 0) {
    const suitEl = document.getElementById('suit')
    if (suitEl) suitEl.innerText = ''
    const resultEl = document.getElementById('result')
    if (resultEl) resultEl.innerHTML = ''
    // resetHpColorTurn()
  }
}
