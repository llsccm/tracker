import { Game, UI } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { laya } from '@/runtime/gameAdapter'
import { hideSelfOrderContainer, showOrderContainers } from '@/ui/seatOverlay'

const TURN_ZHAN_FA_IDS = new Set([
  2033, 2034, 2035, 2036, 2037, 2038, 2048, 2049, 2050, 2196, 2197, 2300, 2301
])

export function handleGameTurn(msg) {
  const { TurnCnt } = msg
  if (typeof TurnCnt !== 'number' || !Number.isFinite(TurnCnt)) return

  if (TurnCnt === 1) {
    // 此时已具备座位信息
    hideSelfOrderContainer(Game.room?.getMyDisplayID())
    if (UI.firstUpdateSeatUI) showOrderContainers()
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
