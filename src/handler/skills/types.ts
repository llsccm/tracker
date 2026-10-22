import type { GameState } from '@/tracker/Game'
import type { PatchedMoveCardFields, RawMoveCardEvent, SeatID } from '@/tracker/types'

// PubGsCMoveCard 入口统一数组和数值字段；响应器不再重复转换。
// 这里不是 Room 的领域 MoveContext。
export interface SkillMoveContext {
  readonly raw: Readonly<RawMoveCardEvent>
  readonly patched: PatchedMoveCardFields
  game: GameState
}

export interface RoleDataMessage {
  SeatID?: SeatID | string | null
  Datas?: unknown
  [key: string]: unknown
}
