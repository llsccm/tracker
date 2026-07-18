import { CardConfig } from '../config'
// import { laya } from '../runtime/gameAdapter'
import { Game } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '../tracker/candidate/cardPositions'
import { handleGameFlowState } from './gameFlowState'
import { handleSpecialZones } from './specialZones'
import { applySpellEffect } from './spellEffects'

function syncMoveToTracker(msg, { CardIDs, FromPosition, ToPosition }) {
  tracker.syncTrackerMove(msg, {
    CardIDs: Array.isArray(CardIDs) ? CardIDs.slice() : CardIDs,
    FromPosition,
    ToPosition
  })
}

/**
 * 预处理低风险移动牌 ID
 */
function prepareMoveCardIDs({ arg, CardIDs, CardCount, MoveType, ToZone, SpellID }) {
  CardIDs = CardIDs.slice() // 不修改原数据

  if (CardCount === 0 || MoveType === 0 || ToZone === 11 || arg.isSend) {
    return { CardIDs, shouldReturn: true }
  }

  // 界反间 bug修复
  if (SpellID == 713 && MoveType == 21 && CardCount == CardIDs.length - 2) {
    const i = CardIDs.splice(0, 1)[0]
    CardIDs.splice(i, 1)
  }

  if (
    CardIDs.filter((id) => id > 0).length != CardCount &&
    CardIDs.filter((id) => id > 0).length != 0
  ) {
    console.error('PubGsCMoveCard error: 明暗牌混合：[' + CardIDs + ']')
    console.error(arg)
    CardIDs = []
  }

  return { CardIDs, shouldReturn: false }
}

/**
 * 位置归一化处理
 */
function normalizeMovePosition({
  CardIDs,
  CardCount,
  FromID,
  FromZone,
  FromPosition,
  ToID,
  ToZone,
  ToPosition,
  MoveType,
  SpellID,
  room
}) {
  if (
    FromID == 255 &&
    FromZone == 1 &&
    ToID == 255 &&
    ToZone == 1 &&
    MoveType == 21 &&
    SpellID == 7011
  ) {
    // 权变查看牌堆顶不会移动卡牌；统一端点后由同区展示分支跳过实体重排。
    FromPosition = POSITION_TOP
    ToPosition = POSITION_TOP
  }

  if (
    FromZone == 1 &&
    FromPosition == POSITION_RANDOM &&
    [3208, 7011, 987, 988, 3903].includes(SpellID)
  ) {
    FromPosition = POSITION_TOP //骋烈 权变 观虚 天候
  }

  if (FromZone == 1 && FromPosition == POSITION_RANDOM && MoveType == 13 && CardCount == 1) {
    FromPosition = POSITION_TOP //秦宓 天辩 13拼点
  }

  if (
    FromZone == 1 &&
    FromPosition == POSITION_RANDOM &&
    ToZone == 4 &&
    MoveType == 8 &&
    SpellID == 795 &&
    CardCount == 1
  ) {
    FromPosition = POSITION_TOP //蔡邕 辟撰
  }

  if (
    FromZone == 1 &&
    FromPosition == POSITION_RANDOM &&
    ToZone == 5 &&
    SpellID == 3101 &&
    CardCount == 1
  ) {
    FromPosition = POSITION_BOTTOM //伊籍 机捷
  }

  if (
    FromZone == 1 &&
    FromPosition == POSITION_RANDOM &&
    ToZone == 5 &&
    !room.isGuoZhan &&
    [7016, 7017].includes(SpellID) &&
    CardCount == 1
  ) {
    FromPosition = POSITION_TOP //王元姬 宴戏 拿牌
  }

  if (
    FromZone == 1 &&
    FromPosition == POSITION_TOP + 1 &&
    ToZone == 5 &&
    SpellID == 0 &&
    MoveType == 1 &&
    CardCount == 4 &&
    CardIDs.every((id) => CardConfig.GetInstance().getCard(id)?.type == 8)
  ) {
    FromPosition = POSITION_RANDOM // 游戏开始后特殊装备牌
  }

  if (
    ToZone == 1 &&
    ToID == 255 &&
    ToPosition == POSITION_TOP &&
    CardIDs.some((id) => id == 4400 || id == 4401)
  ) {
    ToPosition = POSITION_RANDOM // 回魂牌随机加入牌堆
  }

  //手牌中 不处理回魂
  if (ToZone == 1 && ToID == 255 && ToPosition == POSITION_TOP) {
    CardIDs = CardIDs.filter((id) => id != 4400 && id != 4401)
  }

  return { CardIDs, FromPosition, ToPosition }
}

/**
 * 主卡牌移动处理逻辑
 */
export function handleMoveCard(msg) {
  let { CardIDs, FromPosition, ToPosition } = msg
  const { CardCount, FromID, FromZone, ToID, ToZone, MoveType, SpellID, SrcSeatID } = msg

  // 1. 预处理与过滤
  const preparedMove = prepareMoveCardIDs({
    arg: msg,
    CardIDs,
    CardCount,
    MoveType,
    ToZone,
    SpellID
  })

  CardIDs = preparedMove.CardIDs

  if (preparedMove.shouldReturn) return

  // 2. 位置归一化
  const normalizedMove = normalizeMovePosition({
    CardIDs,
    CardCount,
    FromID,
    FromZone,
    FromPosition,
    ToID,
    ToZone,
    ToPosition,
    MoveType,
    SpellID,
    room: Game
  })

  CardIDs = normalizedMove.CardIDs
  FromPosition = normalizedMove.FromPosition
  ToPosition = normalizedMove.ToPosition

  const context = {
    msg,
    game: Game,
    CardIDs,
    CardCount,
    FromID,
    FromZone,
    FromPosition,
    ToID,
    ToZone,
    ToPosition,
    MoveType,
    SpellID,
    SrcSeatID,
    finishMove() {
      syncMoveToTracker(msg, {
        CardIDs: context.CardIDs,
        FromPosition: context.FromPosition,
        ToPosition: context.ToPosition
      })
    }
  }

  if (handleSpecialZones(context).handled) return

  handleGameFlowState(context)

  applySpellEffect(context)

  context.finishMove()
}
