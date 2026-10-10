import type { GameState } from '@/tracker/Game'
import type { CardID, RawMoveCardEvent, SeatID, SpellID } from '@/tracker/types'

// PubGsCMoveCard 预处理后，CardIDs 已统一为数组；这里不是 Room 的领域 MoveContext。
export interface SkillMoveContext extends RawMoveCardEvent {
  game: GameState
  CardIDs: CardID[]
  SpellID: SpellID
}

export interface RoleDataMessage {
  SeatID?: SeatID | string | null
  Datas?: unknown
  [key: string]: unknown
}
