import { Game } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
import { shouldIgnoreTrackerMove } from '../tracker/protocol/protocolRules'
import { handleGameFlowState } from './gameFlowState'
import { handleSpecialZones } from './specialZones'
import { applySpellEffect } from './spellEffects'

/**
 * 主卡牌移动处理逻辑
 * @param {import('../tracker/types').RawMoveCardEvent} msg
 */
export function handleMoveCard(msg) {
  // 独立冻结原始快照；所有后续修正只写 patched，不污染宿主消息。
  const raw = Object.freeze({
    CardCount: msg.CardCount,
    CardIDs: Object.freeze([...msg.CardIDs]),
    FromID: msg.FromID,
    FromZone: msg.FromZone,
    FromZoneParam: msg.FromZoneParam,
    FromPosition: msg.FromPosition,
    ToID: msg.ToID,
    ToZone: msg.ToZone,
    ToZoneParam: msg.ToZoneParam,
    ToPosition: msg.ToPosition,
    MoveType: msg.MoveType,
    SpellID: msg.SpellID,
    SrcSeatID: msg.SrcSeatID,
    Label: msg.Label,
    isSend: msg.isSend
  })
  /** @type {import('../tracker/types').PatchedMoveCardFields} */
  const patched = { ...raw, CardIDs: raw.CardIDs.slice() }

  // 入口过滤不解释技能编码的 CardIDs。
  if (shouldIgnoreTrackerMove(raw)) return

  // 响应器直接使用协议字段；端点与事件类型统一留到最终提交时解析。
  const context = { raw, patched, game: Game }

  if (!handleSpecialZones(context).handled) {
    // 初始发牌 摸牌计数
    handleGameFlowState(context)
    // 称象只采集 UI 所需展示牌，推断补牌由 Room 技能插件负责。
    applySpellEffect(context)
  }

  tracker.syncTrackerMove(patched, raw)
}
