import type { Card } from '../Card'
import type { SpellIDInput } from '../candidate/markSpellID'
import type {
  CardID,
  LocationCandidate,
  MoveSourceEvent,
  PublicPosition,
  PublicZoneName,
  SeatID,
  SpellID,
  SubZone
} from '../types'

export type CountMapInput<Key extends string | number | object> =
  | Map<Key, number | string>
  | Record<string, number | string>
export type ExpectedSlotsBySeatInput = CountMapInput<SeatID>
export type SeatInput = SeatID | SeatID[]
export type SourceZoneInput = PublicZoneName | number | null | undefined
export type MoveTargetZone = PublicZoneName | 'player'

export interface RoomMovementOptions {
  seatID?: SeatInput
  subZone?: SubZone
  spellID?: SpellIDInput
  combinationID?: string | number | null
  fromZone?: SourceZoneInput
  fromSeatID?: SeatID
  fromSubZone?: SubZone
  fromSpellID?: SpellIDInput
  cardCount?: number
  /** 协议手牌总数变化量；省略时沿用实际移动实体数 cardCount。 */
  handMoveCount?: number
  position?: PublicPosition
  fromPosition?: PublicPosition
  expectedSlotsBySeat?: ExpectedSlotsBySeatInput
  resetKnownToUnknown?: boolean
  sourceCards?: Card[]
  sourceEvent?: MoveSourceEvent
  [key: string]: unknown
}

export interface RoomMoveContext {
  cardIDs: CardID[]
  toZone: MoveTargetZone
  seatID?: SeatInput
  subZone: SubZone
  spellID: SpellID | null
  combinationID?: string | number | null
  fromZone: SourceZoneInput
  fromSeat: SeatID | null
  fromSubZone: SubZone
  fromSpellID?: SpellID | null
  cardCount: number
  position: PublicPosition
  fromPosition: PublicPosition
  expectedSlotsBySeat?: ExpectedSlotsBySeatInput
  resetKnownToUnknown: boolean
  sourceCards?: Card[]
  sourceEvent?: MoveSourceEvent
  targetSeats: SeatID[]
  handMoveCount: number
  sourceHandSeat: SeatID | null
  targetHandSeat: SeatID | null
  sourceHandTotalObserved: boolean
  sourceHandTotalBefore: number
  sourceHandUnknownCount: number
  knownIDs: CardID[]
  sourceIsOutside: boolean
  unknownCount: number
  knownCards: Card[]
  movedUnknownCards: Card[]
  publicMovedCards: Card[]
  skipUnknownMovement: boolean
  hiddenMarkRecord: HiddenMarkRecord | null
}

export interface HiddenMarkRecord {
  id: string
  groupID: string
  sourceSeat: SeatID
  targetSeat: SeatID
  spellID: SpellID | null
  targetLocationCandidate: LocationCandidate
  cards: Set<Card>
  placeholderCards: Set<Card>
  hiddenCount: number
  knownMarkMin: number
  knownMarkMax: number
  confirmedHandCards: Set<Card>
  confirmedMarkCards: Set<Card>
  sourceEvent: MoveSourceEvent | string | null
}

export interface HiddenMarkState {
  records: Map<string, HiddenMarkRecord>
}

export interface UnassignedMarkSpaceState {
  spaces: Map<SpellID | string, Card[]>
}

export interface TakeSpecificSourceFallback {
  fromZone?: SourceZoneInput
  fromPosition?: PublicPosition
}

export interface TakeSourceCardsOptions {
  sourceIsOutside?: boolean
  fromSeat?: SeatID | null
  fromSubZone?: SubZone
  subZone?: SubZone
  spellID?: SpellID | null
  fromZone?: SourceZoneInput
  fromPosition?: PublicPosition
  fromSpellID?: SpellID | null
  sourceCards?: Card[]
  sourceEvent?: MoveSourceEvent
}

export interface RandomHandTransferCheckOptions {
  sourceSeat: SeatID | null
  targetSeat: SeatID | null
  count: number
  unknownCount: number
  /** 移动前是否已观测到来源手牌总数。 */
  sourceHandTotalObserved?: boolean
  /** 候选传播前保存的来源手牌总数。 */
  sourceHandTotalBefore?: number
  /** 候选传播前保存的来源未知手牌额度。 */
  sourceHandUnknownCount?: number
  sourceEvent?: MoveSourceEvent
}

export interface RandomHandTransferOptions {
  fromSeat: SeatID | null
  targetSeat: SeatID | null
  count: number
  /** 候选传播前保存的来源手牌总数，避免被已应用的移动 delta 覆盖。 */
  sourceTotalBefore?: number
  /** 移动前是否已观测到来源手牌总数；与 sourceTotalBefore/sourceUnknownCount 一起做 O(1) 门槛。 */
  sourceHandTotalObserved?: boolean
  /** 候选传播前保存的来源未知手牌额度。 */
  sourceUnknownCount?: number
  sourceEvent?: MoveSourceEvent
}

export interface RandomHandToPublicOptions {
  fromSeat: SeatID | null
  toZone: PublicZoneName
  position: PublicPosition
  unknownCount: number
}

export interface UnknownPileReturnOptions {
  toZone: PublicZoneName
  position: PublicPosition
  count: number
}

export interface PublicCandidatesToHandOptions {
  fromZone: SourceZoneInput
  fromPosition: PublicPosition
  toZone: MoveTargetZone
  targetSeat: SeatID | null
  subZone: SubZone
  count: number
  sourceEvent?: MoveSourceEvent
}

export const PAIDUI_POSITIONS = ['top', 'bottom']
// Room.skillState 中的通用账本 key：记录“手牌暗置到标记区”的明牌候选关系。
export const HIDDEN_MARK_STATE_KEY = 'hiddenMarkCandidates'
// Room.skillState 中的通用账本 key：记录 seatID=255 等无席位标记空间里的暗占位实体。
export const UNASSIGNED_MARK_SPACE_STATE_KEY = 'unassignedMarkSpaces'
