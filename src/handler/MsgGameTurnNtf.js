import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { hideOrderContainer, hideSelfOrderContainer, resetOrderContainer } from '@/ui/seatOverlay'

export function handleGameTurn(msg) {
  if (msg.TurnCnt == 1) {
    // 或许应该在其他地方重置
    resetOrderContainer()
    hideOrderContainer(Game.size)
    hideSelfOrderContainer(Game.room?.getMyDisplayID())
  }

  Game.setTurn(msg.TurnCnt)
  tracker.scheduleTrackerRender()
}
