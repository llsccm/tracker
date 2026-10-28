import type { Card } from './model'
import type { GameState } from './Game'
import type { Room } from './Room'
import type { ConstraintGroupOptions } from './constraint/ConstraintGroup'

export type CardID = number
export type TrackingMode = 'full' | 'degraded'
/** 玩家物理座位为 0–7；协议公共端点 FromID/ToID 另按区域解释。 */
export type SeatID = number
/** 协议技能 ID 为数字，0 表示与技能无关；内部状态的 null 由各字段单独声明。 */
export type SpellID = number
export type ZoneID = number
/** 玩家子区域 */
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

export type PlayerMoveArea =
  | { readonly subZone: 'hand' | 'equip' | 'judge' }
  | { readonly subZone: 'mark'; readonly markSpellID: SpellID | null }

export type PlayerMoveEndpoint = Readonly<{
  type: 'player'
  seatID: SeatID
}> &
  PlayerMoveArea

export interface PublicMoveEndpoint {
  readonly type: 'public'
  readonly zone: 'pile' | 'discard' | 'process' | 'exchange' | 'exile'
  readonly position: PublicPosition
}

export interface PopupMoveEndpoint {
  readonly type: 'popup'
  readonly spaceID: number
}

export interface OutsideMoveEndpoint {
  readonly type: 'outside'
}

export type MoveEndpoint =
  | PlayerMoveEndpoint
  | PublicMoveEndpoint
  | PopupMoveEndpoint
  | OutsideMoveEndpoint

/** 来源未定位不授予游戏外创建身份的语义。 */
export interface UnresolvedMoveSource {
  readonly type: 'unresolved'
  /** 未知协议区域仍保留原取牌位置，供既有暗牌降级路径使用。 */
  readonly position: PublicPosition
}

/** 多座位是同一批牌的可能归属，不是向每个座位分别发牌。 */
export type PlayerCandidateTarget = Readonly<{
  type: 'playerCandidates'
  seatIDs: readonly [SeatID, SeatID, ...SeatID[]]
}> &
  PlayerMoveArea

export type MoveSource = MoveEndpoint | UnresolvedMoveSource
export type MoveTarget = MoveEndpoint | PlayerCandidateTarget

export interface MoveRoute {
  readonly from: MoveSource
  readonly to: MoveTarget
}

/** 移动执行选项不携带来源或目标的镜像。 */
export interface MoveExecutionOptions {
  triggerSpellID?: SpellID | null
  combinationID?: number | string | null
  cardCount?: number
  handMoveCount?: number
  moveType?: number
  expectedSlotsByLocation?: ConstraintGroupOptions['expectedSlotsByLocation']
  anonymizeCards?: Card[]
  requireAnonymizeSuccess?: boolean
  pileIdentityCardIDs?: readonly CardID[]
  pileIdentityEvent?: Pick<NormalizedMoveEvent, 'type' | 'cardCount' | 'protocol'>
  sourceCards?: Card[]
  publicCandidateSource?: PublicCandidateSource
  forceRandomHandTransferCandidates?: boolean
  publicCandidateReveal?: PublicCandidateReveal
  postMovePublicCandidates?: PostMovePublicCandidate[]
  duoQiRandomHandGroupSequence?: number
  duoQiRandomHandCandidateIDs?: readonly CardID[]
  sourceEvent?: MoveSourceEvent
}

export interface RoomMoveRequest extends MoveRoute, MoveExecutionOptions {}

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

/** 区域 8 的临时弹窗位置；空间标识不是玩家座位。 */
export interface PopupLocationCandidate {
  type: 'popup'
  spaceID: number
}

export type LocationCandidate =
  | PlayerLocationCandidate
  | PublicLocationCandidate
  | ContainerLocationCandidate
  | OutsideLocationCandidate
  | PopupLocationCandidate

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

export interface ReconnectSeatInfo {
  SeatID: SeatID
  HandCardCount: number
  EquipCardCount: number
  EquipCards: readonly { CardId: CardID; SubType?: number }[]
  JudgeCardCount: number
  JudgeCards: readonly { CardId: CardID; SpellId: SpellID }[]
  CharacterID?: number
  Figure?: number
}

/** 旧录制可以只有重连标记；实际重连消息还携带当前局面的数量和玩家区快照。 */
export interface ReconnectGameSnapshot {
  CardPileCount?: number
  SeatInfos?: readonly ReconnectSeatInfo[]
}

/** 重连主视角的当前手牌；0 表示牌面未知，Count 是完整手牌总数。 */
export interface ReconnectGameHandSnapshot {
  SeatIndex: SeatID
  Count: number
  CardIDs: readonly CardID[]
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
  /** 触发本事件的协议技能，与目标标记空间 ID 分开。 */
  spellID?: SpellID
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

export type MoveOptions = Omit<MoveExecutionOptions, 'triggerSpellID' | 'pileIdentityEvent'>

export interface NormalizedMoveEvent extends MoveRoute {
  /** 直接引用最终 patched，后续只读；raw 仅用于原始数据追溯。 */
  readonly protocol: NormalizedMoveCardFields
  type: RawMoveEventType
  cardIDs: readonly CardID[]
  cardCount: number
  moveType?: number
  options: MoveOptions
  raw?: RawMoveCardEvent | Record<string, unknown>
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
