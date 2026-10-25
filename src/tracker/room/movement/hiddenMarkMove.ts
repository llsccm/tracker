import type { CardID, SeatID, SubZone } from '@/tracker/types'

export interface HiddenMarkMoveContext {
  toZone: 'player' | string
  subZone: SubZone
  fromSubZone: SubZone
  knownIDs: readonly CardID[]
  unknownCount: number
  sourceHandSeat: SeatID | null
  targetSeats: readonly SeatID[]
}

/**
 * 判断是否为协议全暗、从手牌进入单一目标标记区的移动。
 * 此判定不代表来源实体全暗：来源可能含已知身份，调用方应按暗置候选规则处理。
 */
export function isHiddenMarkMove(
  context: HiddenMarkMoveContext
): context is HiddenMarkMoveContext & { sourceHandSeat: SeatID } {
  return (
    context.toZone === 'player' &&
    context.subZone === 'mark' &&
    context.fromSubZone === 'hand' &&
    context.knownIDs.length === 0 &&
    context.unknownCount > 0 &&
    context.sourceHandSeat !== null &&
    context.targetSeats.length === 1
  )
}
