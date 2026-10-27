import type { Card } from '@/tracker/model'
import type { ConstraintGroupOptions } from '@/tracker/constraint/ConstraintGroup'
import type {
  CardID,
  MoveRoute,
  MoveSourceEvent,
  NormalizedMoveEvent,
  PostMovePublicCandidate,
  PublicCandidateSource,
  PublicPosition,
  PublicZoneName,
  SeatID,
  SpellID,
  SubZone
} from '@/tracker/types'

/**
 * known 移动中补建正 ID 的语义来源。
 * external-source 表示协议从 outside/exile 带来新牌，known-fallback 表示原有实体无法物化后的兜底。
 */
export type KnownCardCreationReason = 'external-source' | 'known-fallback'

export interface RoomMoveContext extends MoveRoute {
  triggerSpellID?: SpellID | null
  pileIdentityCardIDs?: readonly CardID[]
  pileIdentityEvent?: Pick<NormalizedMoveEvent, 'type' | 'cardCount' | 'protocol'>
  cardIDs: readonly CardID[]
  combinationID?: string | number | null
  cardCount: number
  moveType?: number
  expectedSlotsByLocation?: ConstraintGroupOptions['expectedSlotsByLocation']
  anonymizeCards: Card[]
  requireAnonymizeSuccess: boolean
  sourceCards?: Card[]
  publicCandidateSource?: PublicCandidateSource
  forceRandomHandTransferCandidates: boolean
  postMovePublicCandidates?: PostMovePublicCandidate[]
  sourceEvent?: MoveSourceEvent
  handMoveCount: number
  sourceHandSeat: SeatID | null
  targetHandSeat: SeatID | null
  sourceHandTotalObserved: boolean
  sourceHandTotalBefore: number
  sourceHandUnknownCount: number
  knownIDs: CardID[]
  unknownCount: number
  knownCards: Card[]
  movedUnknownCards: Card[]
  publicMovedCards: Card[]
  skipUnknownMovement: boolean
}

export interface HiddenMarkRecord {
  readonly id: string
  readonly groupID: string
  sourceSeat: SeatID
  targetSeat: SeatID
  spellID: SpellID | null
  cards: Set<Card>
  placeholderCards: Set<Card>
  /** 累计暗置额度；不是随出牌递减的当前标记区容量。 */
  hiddenCount: number
  knownMarkMin: number
  knownMarkMax: number
  confirmedHandCards: Set<Card>
  confirmedMarkCards: Set<Card>
  sourceEvent: MoveSourceEvent | string | null
}

export interface HiddenMarkState {
  records: Map<string, HiddenMarkRecord>
  /** mark700 协议确认的空间座位，与装备本体的位置独立。 */
  muniuMarkSeat: SeatID | null
}

export interface PopupSpaceState {
  spaces: Map<SpellID, Card[]>
}

export interface TakeSpecificSourceFallback {
  fromZone?: PublicZoneName | null | undefined
  fromPosition?: PublicPosition
  anonymousFallback?: boolean
}

export interface TakeSourceCardsOptions extends MoveRoute {
  sourceCards?: Card[]
  sourceEvent?: MoveSourceEvent
  moveType?: number
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
  /** 全暗来源通常没有展示价值；技能身份账本可显式要求仍建立 N 选 K。 */
  force?: boolean
  sourceEvent?: MoveSourceEvent
}

export interface StoredToHandCandidatesOptions {
  fromPopupSpaceID?: number
  /** 玩家标记来源座位；弹窗来源使用 fromPopupSpaceID。 */
  fromSeat: SeatID | null
  /** 标记空间 ID；缺省时不接管，避免跨空间误合并候选。 */
  fromSpellID: SpellID | null
  /** 接收手牌座位；缺省时不接管。 */
  toSeat: SeatID | null
  count: number
  sourceEvent?: MoveSourceEvent
}

export interface RandomHandToPublicOptions {
  fromSeat: SeatID | null
  toZone: PublicZoneName
  position: PublicPosition
  unknownCount: number
  candidateSource?: PublicCandidateSource
}

export interface UnknownPileReturnOptions {
  toZone: PublicZoneName
  position: PublicPosition
  count: number
}

export interface PublicCandidatesToHandOptions {
  fromZone: PublicZoneName | null | undefined
  fromPosition: PublicPosition
  toZone: PublicZoneName
  targetSeat: SeatID | null
  subZone: SubZone | undefined
  count: number
  sourceEvent?: MoveSourceEvent
}

export const PAIDUI_POSITIONS = ['top', 'bottom']
// GameState tracker 命名空间中的通用账本 key：记录“手牌暗置到标记区”的明牌候选关系。
export const HIDDEN_MARK_STATE_KEY = 'hiddenMarkCandidates'
// 临时弹窗空间的实体与候选引用，随移动消耗，空桶在收敛尾部释放。
export const POPUP_SPACE_STATE_KEY = 'popupSpaces'
