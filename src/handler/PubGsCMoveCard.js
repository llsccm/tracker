import { Game } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
import {
  hasMixedTrackerMoveVisibility,
  normalizeTrackerMovePosition,
  shouldIgnoreTrackerMove
} from '../tracker/protocol/protocolRules'
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

  Object.assign(patched, normalizeTrackerMovePosition(patched))

  // 响应器直接使用协议字段；端点与事件类型统一留到最终提交时解析。
  const afterMoveCallbacks = []
  const context = {
    raw,
    patched,
    game: Game,
    afterMove(callback) {
      if (typeof callback === 'function') afterMoveCallbacks.push(callback)
    },
    finishMove() {
      syncMoveToTracker(context)
      afterMoveCallbacks.splice(0).forEach((callback) => callback())
    }
  }

  if (handleSpecialZones(context).handled) return
  // 初始发牌 摸牌计数
  handleGameFlowState(context)
  // 对部分技能特殊处理
  applySpellEffect(context)
  context.finishMove()
}

function syncMoveToTracker({ raw, patched }) {
  // 检查牌列表；异常仍按原有策略降级成暗牌。
  if (hasMixedTrackerMoveVisibility(patched)) {
    console.error('PubGsCMoveCard error: 明暗牌混合：[' + patched.CardIDs + ']')
    console.error(raw)
    patched.CardIDs = []
  }

  // Controller 在这里接收最终补丁，只生成一次 Room 标准事件。
  tracker.syncTrackerMove(patched, raw)
}
