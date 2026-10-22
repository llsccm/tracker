import type { CardID, RawMoveCardEvent, SeatID, SpellID } from '../types'

export interface SkillUseSpellMessage {
  SpellID: SpellID
  SeatID?: SeatID
  SrcSeatID?: SeatID
  SkillOwerSeatID?: SeatID
  EffectIndex?: number
  CardIDs?: CardID[]
  card_count?: number
  DestSeatIDs?: SeatID[]
  dest_Count?: number
}

export interface SkillTargetNotice {
  SpellID: SpellID
  Type?: number
  Param?: number
  Params?: CardID[]
  targetSeatID?: SeatID
}

export interface SkillChoiceMessage {
  SpellID?: SpellID
  Type?: number
  SeatID?: SeatID
  Datas?: number[]
  data_count?: number
}

export interface SkillRoleDataMessage {
  DataID: number
  SeatID?: SeatID
  Datas?: number[]
}

/** 只表达技能推断需要的协议事实；不承载 UI、宿主对象或回调。 */
export type SkillProtocolEvent =
  | { type: 'useSpell'; message: SkillUseSpellMessage }
  | { type: 'targetNotice'; message: SkillTargetNotice }
  | { type: 'choice'; message: SkillChoiceMessage }
  | { type: 'roleData'; message: SkillRoleDataMessage }

export interface PendingSkillMove {
  readonly raw: Readonly<RawMoveCardEvent>
  readonly patched: Readonly<RawMoveCardEvent>
}
