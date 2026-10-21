import type { Card } from './model/Card'
import type { GameState } from './Game'
import type { Room } from './Room'

export type CardID = number
export type SeatID = number
export type SpellID = number
export type ZoneID = number
export type SubZone = 'hand' | 'equip' | 'judge' | 'mark' | string

export type PublicZoneName =
  | 'outside'
  | 'pile'
  | 'discard'
  | 'process'
  | 'exchange'
  | 'exile'
  | string

export type PublicPosition = number | 'top' | 'bottom' | 'random' | 'any' | string

export interface SubZoneCandidate {
  seatID: SeatID
  subZone: SubZone
  spellID: SpellID | null
}

export interface PublicCandidate {
  zone: PublicZoneName
  position: PublicPosition | null
  count: number | null
  label: string | null
}

/** 只公开公共区端点范围、不足以绑定具体卡牌槽位的展示事实。 */
export interface PublicCandidateReveal {
  zone: PublicZoneName
  position: PublicPosition
  count: number
}

/** 实体完成公共区移动后再附加的范围候选，避免物理代表槽被解释为精确位置。 */
export interface PostMovePublicCandidate {
  card: Card
  candidate: PublicCandidate
}

export interface PlayerLocationCandidate extends SubZoneCandidate {
  type: 'player'
}

export interface PublicLocationCandidate extends PublicCandidate {
  type: 'public'
}

export interface ContainerLocationCandidate {
  type: 'container'
  containerType: 'equipment' | string
  cardID: CardID
  spellID: SpellID | null
}

export interface OutsideLocationCandidate {
  type: 'outside'
  zone: PublicZoneName
  /** exchange 暂存候选的批次令牌；缺省时仍表示普通游戏外位置。 */
  batchID?: string
}

export type LocationCandidate =
  | PlayerLocationCandidate
  | PublicLocationCandidate
  | ContainerLocationCandidate
  | OutsideLocationCandidate

export type RawMoveEventType =
  | 'noop'
  | 'showCards'
  | 'shuffleDiscardIntoPile'
  | 'drawKnown'
  | 'drawUnknown'
  | 'discardKnown'
  | 'returnToPile'
  | 'moveToMark'
  | 'moveToEquip'
  | 'moveToJudge'
  | 'moveKnown'
  | 'moveUnknown'
  | string

/** PubGsCMoveCard 的 12 个核心字段固定存在；0 表示无技能，255 等端点 ID 按区域解释。 */
export interface RawMoveCardEvent {
  CardIDs: readonly CardID[]
  readonly CardCount: number
  /** 公共区可使用 255，标记区也可能使用技能 ID；不能无条件当作座位。 */
  FromID: number
  FromPosition: number
  FromZone: ZoneID
  FromZoneParam: SpellID
  ToID: number
  ToPosition: number
  ToZone: ZoneID
  ToZoneParam: SpellID
  MoveType: number
  SpellID: SpellID
  SrcSeatID?: SeatID
  Label?: string
  isSend?: boolean
}

/** 最终完整协议的只读视图；不复制对象，也不放宽必填字段。 */
export type NormalizedMoveCardFields = Readonly<RawMoveCardEvent>

/** 协议修正只允许改牌 ID 与端点位置，其余字段仍以原始协议为准。 */
export type PatchedMoveCardFields = Omit<
  NormalizedMoveCardFields,
  'CardIDs' | 'FromPosition' | 'ToPosition'
> & {
  CardIDs: CardID[]
  FromPosition: number
  ToPosition: number
}

export interface MoveSourceEvent {
  type?: RawMoveEventType
  label?: string
  moveType?: number
  raw?: RawMoveCardEvent | Record<string, unknown>
  [key: string]: unknown
}

/** 原样转移时的候选来源；只筛选公共候选，不指定物理来源或真实身份。 */
export interface PublicCandidateSource {
  fromSeat: SeatID
  cards: Card[]
}

export interface MoveOptions {
  toSeatID?: SeatID
  subZone?: SubZone
  /** 按端点映射的技能 ID；纯公共区移动保留协议 SpellID。 */
  spellID?: SpellID
  combinationID?: number | string | null
  fromZone?: PublicZoneName | number | null
  fromSeatID?: SeatID
  fromSubZone?: SubZone
  fromSpellID?: SpellID
  cardCount?: number
  /** 协议手牌总数变化量；候选身份不移动实体时可与 cardCount 不同。 */
  handMoveCount?: number
  duoQiRandomHandGroupSequence?: number
  moveType?: number
  position?: PublicPosition
  fromPosition?: PublicPosition
  /** 在来源选择前把这些已知身份降级为匿名物理代表。 */
  anonymizeCards?: Card[]
  /** 匿名化失败时取消本次移动，避免技能候选与身份账本失配。 */
  requireAnonymizeSuccess?: boolean
  /** 协议未公开 CardIDs，但技能已可靠确定的身份账本移动。 */
  pileIdentityCardIDs?: readonly CardID[]
  /** 协议事件的身份事实；直调 Room 时由移动上下文推导。 */
  pileIdentityEvent?: Pick<NormalizedMoveEvent, 'type' | 'cardCount' | 'protocol'>
  sourceCards?: Card[]
  /** 空集合表示不传播已知牌候选；省略时沿用当前来源手牌集合。 */
  publicCandidateSource?: PublicCandidateSource
  publicCandidateReveal?: PublicCandidateReveal
  postMovePublicCandidates?: PostMovePublicCandidate[]
  sourceEvent?: MoveSourceEvent
  [key: string]: unknown
}

export interface NormalizedMoveEvent {
  /** 直接引用最终 patched，后续只读；raw 仅用于原始数据追溯。 */
  readonly protocol: NormalizedMoveCardFields
  type: RawMoveEventType
  cardIDs: readonly CardID[]
  cardCount: number
  moveType?: number
  toZone: PublicZoneName | 'player'
  options: MoveOptions
  raw?: RawMoveCardEvent | Record<string, unknown>
}

export interface MoveContext extends MoveOptions {
  cardIDs: CardID[]
  toZone: PublicZoneName | 'player'
  toSeatID: SeatID | null
  spellID: SpellID | null
  fromSeat?: SeatID | null
  targetSeats?: SeatID[]
  handMoveCount?: number
  sourceHandSeat?: SeatID | null
  targetHandSeat?: SeatID | null
  knownIDs?: CardID[]
  knownCards?: Card[]
  unknownCount?: number
  sourceCards?: Card[]
  sourceIsOutside?: boolean
}

export interface TrackerView {
  mount(room: Room): void
  scheduleRender(): void
  unmount(): void
}

export interface TrackerLogger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
}

export interface TrackerControllerOptions {
  view?: Partial<TrackerView>
  /** 默认使用全局 Game 单例；测试可注入独立实例隔离状态。 */
  gameState?: GameState
  getSeatUIs?(): unknown
  logger?: Partial<TrackerLogger>
  registerMoveEventHandlers?(room: Room): void
}

export interface SeatInfo {
  SeatID?: number
  seat_id?: number
  user_temp_id?: number
  ClientID?: number
  [key: string]: unknown
}
