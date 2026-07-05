import type { CardID, SeatID, SubZone } from '../types'

export interface HiddenMarkMoveContext {
  toZone: 'player' | string
  subZone: SubZone
  fromSubZone: SubZone
  knownIDs: readonly CardID[]
  unknownCount: number
  sourceHandSeat: SeatID | null
  targetSeats: readonly SeatID[]
}

export function isHiddenMarkMove(context: HiddenMarkMoveContext): boolean {
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
