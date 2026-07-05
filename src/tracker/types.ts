import type { Card } from './Card'
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

export interface RawMoveCardEvent {
  CardIDs?: CardID[] | CardID
  CardCount?: number | string
  FromZone?: ZoneID | string
  FromID?: SeatID
  FromZoneParam?: SpellID | string | null
  FromPosition?: PublicPosition
  ToZone?: ZoneID | string
  ToID?: SeatID
  ToZoneParam?: SpellID | string | null
  ToPosition?: PublicPosition
  MoveType?: number | string
  SpellID?: SpellID | string | null
  Label?: string
  [key: string]: unknown
}

export interface MoveSourceEvent {
  type?: RawMoveEventType
  label?: string
  moveType?: RawMoveCardEvent['MoveType']
  raw?: RawMoveCardEvent | Record<string, unknown>
  [key: string]: unknown
}

export interface MoveOptions {
  seatID?: SeatID
  subZone?: SubZone
  spellID?: SpellID | string | null
  combinationID?: number | string | null
  fromZone?: PublicZoneName | number | null
  fromSeatID?: SeatID
  fromSubZone?: SubZone
  fromSpellID?: SpellID | string | null
  cardCount?: number
  moveType?: RawMoveCardEvent['MoveType']
  position?: PublicPosition
  fromPosition?: PublicPosition
  resetKnownToUnknown?: boolean
  sourceCards?: Card[]
  sourceEvent?: MoveSourceEvent
  [key: string]: unknown
}

export interface NormalizedMoveEvent {
  type: RawMoveEventType
  cardIDs: CardID[]
  cardCount: number
  moveType?: RawMoveCardEvent['MoveType']
  toZone: PublicZoneName | 'player'
  options: MoveOptions
  raw?: RawMoveCardEvent | Record<string, unknown>
}

export interface MoveContext extends MoveOptions {
  cardIDs: CardID[]
  toZone: PublicZoneName | 'player'
  seatID: SeatID | null
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

export interface TrackerRuntime {
  isDuanXian?: boolean
  bindRoom?(room: Room | null): void
  syncRoomSeats?(room: Room): void
}

export interface TrackerControllerOptions {
  view?: Partial<TrackerView>
  gameState?: TrackerRuntime | null
  runtime?: TrackerRuntime | null
  roomFactory?(options?: { gameState?: TrackerRuntime | null }): Room
  getSeatUIs?(): unknown
  logger?: Partial<TrackerLogger>
  onError?(...args: unknown[]): void
  registerMoveEventHandlers?(room: Room): void
}

export interface SeatInfo {
  SeatID?: number
  seat_id?: number
  user_temp_id?: number
  ClientID?: number
  [key: string]: unknown
}
