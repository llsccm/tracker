import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { hideOrderContainer, hideSelfOrderContainer, resetOrderContainer } from '@/ui/seatOverlay'
import { laya } from '@/runtime/gameAdapter'

const TURN_ZHAN_FA_IDS = new Set([
  2033, 2034, 2035, 2036, 2037, 2038, 2048, 2049, 2050, 2196, 2197, 2300, 2301
])

export function handleGameTurn(msg) {
  const { TurnCnt } = msg
  if (typeof TurnCnt !== 'number' || !Number.isFinite(TurnCnt)) return

  if (TurnCnt === 1) {
    // 或许应该在其他地方重置
    resetOrderContainer()
    hideOrderContainer(Game.size)
    hideSelfOrderContainer(Game.room?.getMyDisplayID())
  }

  Game.setTurn(TurnCnt)

  if (TurnCnt > 0) {
    resetTurnZhanFa()
  }

  tracker.scheduleTrackerRender()
}

function resetTurnZhanFa() {
  laya.gamescene?.SelfSeatUi?.zhanFaItems?.forEach((ui) => {
    if (ui?.n !== undefined && TURN_ZHAN_FA_IDS.has(ui.PlotID)) {
      ui.Value = ui.n = 0
    }
  })
}
