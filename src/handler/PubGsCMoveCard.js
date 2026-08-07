import { CardConfig } from '../config'
// import { laya } from '../runtime/gameAdapter'
import { Game } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
import {
  normalizeTrackerMovePosition,
  prepareTrackerMoveCardIDs
} from '../tracker/runtime/protocolRules'
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
 * 主卡牌移动处理逻辑
 */
export function handleMoveCard(msg) {
  let { CardIDs, FromPosition, ToPosition } = msg
  const { CardCount, FromID, FromZone, ToID, ToZone, MoveType, SpellID, SrcSeatID } = msg

  // 1. 预处理与过滤
  const preparedMove = prepareTrackerMoveCardIDs({
    CardIDs,
    CardCount,
    MoveType,
    ToZone,
    SpellID,
    isSend: msg.isSend
  })

  CardIDs = preparedMove.CardIDs

  if (preparedMove.shouldReturn) return

  if (preparedMove.mixedVisibility) {
    console.error('PubGsCMoveCard error: 明暗牌混合：[' + msg.CardIDs + ']')
    console.error(msg)
  }

  // 2. 位置归一化
  const normalizedMove = normalizeTrackerMovePosition({
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
    isGuoZhan: Game.isGuoZhan,
    specialEquipmentCards: CardIDs.every((id) => CardConfig.GetInstance().getCard(id)?.type == 8)
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

  // 3. 对部分技能特殊处理
  applySpellEffect(context)

  context.finishMove()
}
