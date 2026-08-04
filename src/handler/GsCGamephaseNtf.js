import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { laya } from '@/runtime/gameAdapter'

export class SeatRoundState {
  static INIT = 0
  static START = 1
  static JUDGE = 2
  static DESKTOP_DEAL = 3
  static DEAL = 4
  static DISCARD = 5
  static OVER = 6
  static CLEARUP = 7
  static TURN_OVER = 8

  static GetRoundStateName(val) {
    switch (val) {
      case SeatRoundState.START:
        return '开始阶段'
      case SeatRoundState.JUDGE:
        return '判定阶段'
      case SeatRoundState.DESKTOP_DEAL:
        return '摸牌阶段'
      case SeatRoundState.DEAL:
        return '出牌阶段'
      case SeatRoundState.DISCARD:
        return '弃牌阶段'
      default:
        return ''
    }
  }
}

const ROUND_STATE_FALLBACK_NAMES = {
  [SeatRoundState.INIT]: '回合开始时',
  [SeatRoundState.OVER]: '结束阶段',
  [SeatRoundState.CLEARUP]: '回合结束时',
  [SeatRoundState.TURN_OVER]: '回合结束后'
}

export function handleGamePhase(msg) {
  const { Round, SeatID } = msg
  const previousSeatID = Game.currentID

  Game.enter(Round, SeatID)

  if (Round === SeatRoundState.INIT) {
    laya.resetRoundZhanFa(previousSeatID)
    clearRoundResult()
  }

  updateRoundStateLabel(Round)
  tracker.scheduleTrackerRender()
}

function clearRoundResult() {
  const suitEl = document.getElementById('suit')
  if (suitEl) suitEl.innerText = ''

  const resultEl = document.getElementById('result')
  if (resultEl) resultEl.innerHTML = ''
}

/**
 * 更新顶部阶段提示。
 * 同一 phase 可能收到多个阶段状态，需保留已有的 `A(1)>B(1)` 阶段链。
 */
function updateRoundStateLabel(round) {
  const roundStateName =
    SeatRoundState.GetRoundStateName(round) || ROUND_STATE_FALLBACK_NAMES[round]
  if (!roundStateName) return

  const nav = document.getElementById('phrase')
  if (!nav) return

  const last = getLastDisplayedPhase(nav.innerText)

  if (Game.phase === last) {
    nav.innerText = appendRoundState(nav.innerText, roundStateName, Game.phase)
    return
  }

  nav.innerText = `${roundStateName} (${Game.phase})`
}

/**
 * 从阶段提示末尾读取当前显示的 phase。
 * 阶段名称本身可变，因此只依赖最后一对括号中的数值。
 */
function getLastDisplayedPhase(text) {
  if (!text.endsWith(')')) return undefined

  const start = text.lastIndexOf('(')
  if (start < 0) return undefined

  const phaseText = text.slice(start + 1, -1)
  if (!phaseText) return undefined

  const phase = Number(phaseText)
  return Number.isInteger(phase) ? phase : undefined
}

/**
 * 在同一 phase 的已有阶段链末尾追加状态。
 * 旧阶段保留在链中，但编号只显示在最新状态上。
 */
function appendRoundState(text, roundStateName, phase) {
  const separator = text.lastIndexOf('>')
  const prefix = separator < 0 ? '' : text.slice(0, separator + 1)
  const lastState = separator < 0 ? text : text.slice(separator + 1)
  const phaseStart = lastState.lastIndexOf('(')
  const previousName = (phaseStart < 0 ? lastState : lastState.slice(0, phaseStart)).trim()
  const previousShortName = getShortRoundStateName(previousName)
  const currentShortName = getShortRoundStateName(roundStateName)

  if (!previousShortName) return `${roundStateName} (${phase})`
  return `${prefix}${previousShortName}>${currentShortName}(${phase})`
}

/**
 * 将完整阶段名称转换为阶段链中的短名称。
 */
function getShortRoundStateName(name) {
  let shortName = name
  if (shortName.startsWith('回合')) shortName = shortName.slice(2)
  if (shortName.endsWith('阶段')) shortName = shortName.slice(0, -2)
  return shortName
}
