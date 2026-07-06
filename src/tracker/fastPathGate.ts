import { isFastPathStatsEnabled, recordFastPathHit, recordFastPathRollback } from './fastPathStats'
import type { Card } from './Card'
import type { ConstraintGroup } from './ConstraintGroup'
import type { Room } from './Room'
import type { RoomMoveContext } from './roomMovement/types'

/**
 * 快路径 dry-run 数据 gate（plans/cards-incremental-index-and-fast-path-plan.md §七 / step 8）。
 *
 * 这里只做「本次移动本可走哪条快路径」的安全判定并埋点，**不真正绕过** resolveConstraints。
 * 判定条件对齐 §三 的充分条件；由于 dry-run 从不 apply，判定偏差只影响命中率统计精度、
 * 不影响正确性。等真实命中率与单条收益过阈值，再把对应 apply 版本连同 DEV 影子断言落地。
 */

/** 快路径安全判定结果：ok 表示「本可安全跳过完整收敛」；否则 reason 带回退原因分类。 */
export interface FastPathDecision {
  ok: boolean
  reason?: string
}

const OK: FastPathDecision = { ok: true }
function no(reason: string): FastPathDecision {
  return { ok: false, reason }
}

/**
 * 4A：确定明牌确定移动是否满足「绕收敛也安全」的充分条件（§三 与 §七 4A）。
 *
 * 在 moveCards 应用完 MoveContext、进入 resolveConstraints 之前调用：此时被移动明牌已落到
 * 目标位置，本次是否创建了约束组 / 隐藏标记也已反映在 room 上。确定明牌移出/移入使来源/目标
 * 玩家的 observedHandCount 与 knownCount 同增同减，不会新触发「暗牌额度归零排他」，故这是
 * 四条里最稳的一条。
 */
export function evaluateDeterministicMove(room: Room, context: RoomMoveContext): FastPathDecision {
  if (context.cardCount === 0) return no('emptyMove')
  // 全部正 ID 明牌，无暗牌数量、无暗占位实体参与。
  if (context.unknownCount !== 0) return no('unknownCount')
  if (context.movedUnknownCards.length !== 0) return no('movedUnknownCards')
  if (context.knownCards.length !== context.cardCount) return no('knownCountMismatch')
  // 未触及隐藏标记账本。
  if (context.hiddenMarkRecord !== null) return no('hiddenMarkRecord')
  // 本次移动未创建/修改任何约束组（createPublicMoveConstraintGroup 等都会 markConstraintGroupsDirty）。
  if (room.constraintGroupsDirty) return no('constraintGroupsDirty')

  // 每张被移动明牌都处于确定、无候选、无约束的位置。
  for (const card of context.knownCards) {
    const decision = evaluateDeterministicCard(room, card)
    if (!decision.ok) return decision
  }
  return OK
}

function evaluateDeterministicCard(room: Room, card: Card): FastPathDecision {
  if (card.isKnown !== true) return no('cardNotKnown')
  if (card.hasLocationCandidates()) return no('cardLocationCandidates')
  if (card.hasSubZoneCandidates()) return no('cardSubZoneCandidates')
  if (card.publicCandidates.length > 0) return no('cardPublicCandidates')
  // 落到玩家区时拥有者必须唯一；落到公共区无 seats，天然确定。
  if (card.location === 'player' && card.seats.size !== 1) return no('cardAmbiguousSeat')
  for (const group of room.getConstraintGroupsForCard(card)) {
    // 单候选席位、无额度约束的确定牌组对已确定牌不构成歧义，收敛对其是 no-op，故放行。
    // 把确定明牌移入手牌会顺带建这样一个平凡组（见 moveKnownCardsForContext）；不放行的话，
    // 计划明确列为 4A 命中的「确定弃牌回手牌」等场景会被误判回退。
    if (isTrivialDeterminedGroup(group)) continue
    return no('cardInConstraintGroup')
  }
  return OK
}

/** 单候选席位且无 location/subZone 额度约束的确定牌组，对已确定牌不构成歧义。 */
function isTrivialDeterminedGroup(group: ConstraintGroup): boolean {
  return (
    group.candidateSeats.size <= 1 &&
    group.expectedSlotsByLocation.size === 0 &&
    group.expectedSlotsBySubZone.size === 0
  )
}

/**
 * moveCards 收敛前对四条快路径做 dry-run 观测：只累计命中率与回退原因，不改变收敛。
 * 返回本次 4A 是否本可命中，供 moveCards 把随后 resolveConstraints() 的耗时归入对应桶。
 * 当前实现 4A；4B–4D 待手牌摘要（step 4）落地后接入。
 */
export function probeMoveFastPaths(
  room: Room,
  context: RoomMoveContext
): { deterministicHit: boolean } {
  if (!isFastPathStatsEnabled()) return { deterministicHit: false }

  const deterministic = evaluateDeterministicMove(room, context)
  if (deterministic.ok) {
    recordFastPathHit('deterministicMove')
    return { deterministicHit: true }
  }
  recordFastPathRollback('deterministicMove', deterministic.reason ?? 'unknown')
  return { deterministicHit: false }
}
