import { CardConfig } from '../config'
import { Game } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
import { normalizeMoveCardFields, normalizeMoveEvent } from '../tracker/MoveEventNormalizer'
import { POSITION_TOP } from '../tracker/candidate/cardPositions'
import {
  normalizeTrackerMovePosition,
  prepareTrackerMoveCardIDs
} from '../tracker/runtime/protocolRules'
import { handleGameFlowState } from './gameFlowState'
import { handleSpecialZones } from './specialZones'
import { applySpellEffect } from './spellEffects'

// 只同步协议字段，避免把 context 中的运行时对象和回调带入移动事件。
const TRACKER_MOVE_FIELDS = [
  'CardCount',
  'FromZone',
  'FromPosition',
  'ToZone',
  'ToPosition',
  'MoveType',
  'SpellID'
]

function syncMoveToTracker(context) {
  /** @type {import('../tracker/types').MoveCardPatch} */
  const move = { CardIDs: context.CardIDs.slice() }
  for (const field of TRACKER_MOVE_FIELDS) move[field] = context[field]
  tracker.syncTrackerMove(context.msg, move)
}

/**
 * 主卡牌移动处理逻辑
 * @param {import('../tracker/types').RawMoveCardEvent} msg
 */
export function handleMoveCard(msg) {
  const move = normalizeMoveCardFields(msg)
  let { CardIDs, FromPosition, ToPosition } = move
  const { CardCount, FromID, FromZone, ToID, ToZone, MoveType, SpellID, SrcSeatID } = move
  const afterMoveCallbacks = []

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

  const specialEquipmentCards =
    CardCount === 4 &&
    FromZone === 1 &&
    FromPosition === POSITION_TOP + 1 &&
    ToZone === 5 &&
    SpellID === 0 &&
    MoveType === 1 &&
    CardIDs.length === CardCount &&
    CardIDs.every((id) => CardConfig.GetInstance().getCard(id)?.type == 8)

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
    specialEquipmentCards
  })

  CardIDs = normalizedMove.CardIDs
  FromPosition = normalizedMove.FromPosition
  ToPosition = normalizedMove.ToPosition

  const normalizedEvent = normalizeMoveEvent({
    ...move,
    CardIDs,
    FromPosition,
    ToPosition
  })

  const context = {
    FromZoneParam: move.FromZoneParam,
    ToZoneParam: move.ToZoneParam,
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
    fromSeatID: normalizedEvent.options.fromSeatID,
    toSeatID: normalizedEvent.options.seatID,
    fromSubZone: normalizedEvent.options.fromSubZone,
    toSubZone: normalizedEvent.options.subZone,
    fromSpellID: normalizedEvent.options.fromSpellID,
    afterMove(callback) {
      if (typeof callback === 'function') afterMoveCallbacks.push(callback)
    },
    finishMove() {
      syncMoveToTracker(context)

      afterMoveCallbacks.splice(0).forEach((callback) => callback())
    }
  }

  if (handleSpecialZones(context).handled) return

  handleGameFlowState(context)

  // 3. 对部分技能特殊处理
  applySpellEffect(context)

  context.finishMove()
}
