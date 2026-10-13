import type { GameState } from '@/tracker/Game'
import type { NormalizedMoveCardFields, SeatID, SubZone } from '@/tracker/types'

// PubGsCMoveCard 入口统一数组和数值字段；响应器不再重复转换。
// 这里不是 Room 的领域 MoveContext。
export interface SkillMoveContext extends NormalizedMoveCardFields {
  game: GameState
  fromSeatID?: SeatID | null
  toSeatID?: SeatID | null
  fromSubZone?: SubZone | null
  toSubZone?: SubZone | null
  afterMove?: (callback: () => void) => void
}

export interface RoleDataMessage {
  SeatID?: SeatID | string | null
  Datas?: unknown
  [key: string]: unknown
}
