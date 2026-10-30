import type { SeatID } from '../types'

export type SeatInput = SeatID | Iterable<SeatID> | null | undefined

/** 统一已类型化的单座位和候选集合；座位 0 有效，空值表示没有候选。 */
export function toSeatSet(seats: SeatInput): Set<SeatID> {
  if (seats === null || seats === undefined) return new Set()
  return new Set(typeof seats === 'number' ? [seats] : seats)
}
