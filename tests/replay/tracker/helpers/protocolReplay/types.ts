import type { GameState } from '@/tracker/Game'
import type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
import type { TrackerController } from '@/tracker/runtime/trackerController'
import type { TrackerControllerOptions } from '@/tracker/types'

export type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'

export type TrackerProtocolReplayStatus = 'applied' | 'ignored' | 'partial'

export interface TrackerProtocolReplayStep {
  seq: number
  className: string
  status: TrackerProtocolReplayStatus
  note?: string
  state?: TrackerReplaySnapshot
}

export interface TrackerReplayZoneSnapshot {
  count: number
  anonymousCount: number
  knownCardIDs: number[]
  cardIDsBottomToTop: number[]
}

export interface TrackerReplayPlayerSnapshot {
  seatID: number
  observedHandCount: number | null
  unknownHandCount: number
  knownHandCardIDs: number[]
  candidateHandCardIDs: number[]
  equipCardIDs: number[]
  judgeCardIDs: number[]
  markCardIDs: Record<string, number[]>
  generals: number[]
}

export interface TrackerReplayConstraintSnapshot {
  id: string
  cardIDs: number[]
  entityIDs: number[]
  candidateSeats: number[]
  expectedSlotsBySeat: Record<string, number>
  expectedSlotsBySubZone: Record<string, number>
  expectedSlotsByLocation: Record<string, number>
}

export interface TrackerReplayRoomSnapshot {
  active: true
  deckReady: boolean
  seatIDs: number[]
  mySeatID: number | null
  firstSeatID: number | null
  totalCards: number
  knownCards: number
  anonymousCards: number
  zones: Record<string, TrackerReplayZoneSnapshot>
  players: TrackerReplayPlayerSnapshot[]
  constraints: TrackerReplayConstraintSnapshot[]
  ambiguousKnownCards: {
    cardID: number
    entityID: number
    description: string
    suspended: boolean
  }[]
  unlocatedIdentityIDs: number[]
  suspendedIdentityIDs: number[]
  pileIdentityLedger: unknown
}

export interface TrackerReplaySnapshot {
  game: {
    isGameStart: boolean | null
    isPassed: boolean | null
    isRecord: boolean
    isDuanXian: boolean
    isGuoZhan: boolean
    isDouDiZhu: boolean
    isShanHeTu: boolean
    isRoguelike1v1: boolean
    turn: number
    round: number
    phase: number
    currentSeatID: number | null
    spellState: unknown
  }
  room: TrackerReplayRoomSnapshot | null
}

export interface TrackerProtocolReplayFailure {
  seq: number
  className: string
  payload: Record<string, unknown>
  message: string
  context: RecordedTrackerProtocol[]
  stateBefore: TrackerReplaySnapshot
  stateAfter: TrackerReplaySnapshot
}

export interface TrackerProtocolReplayReport {
  success: boolean
  applied: number
  ignored: number
  partial: number
  steps: TrackerProtocolReplayStep[]
  finalState: TrackerReplaySnapshot
  lastActiveState: TrackerReplaySnapshot | null
  failure?: TrackerProtocolReplayFailure
}

type ReplayControllerOptions = Pick<
  TrackerControllerOptions,
  'registerMoveEventHandlers' | 'roomFactory'
>

export interface TrackerProtocolReplayOptions {
  currentUserID?: number
  contextSize?: number
  captureStepStates?: boolean
  controllerOptions?: ReplayControllerOptions
}

export interface TrackerProtocolReplayContext {
  controller: TrackerController
  gameState: GameState
  currentUserID?: number
  sessionInitialized: boolean
}

export interface ApplyTrackerProtocolResult {
  status: TrackerProtocolReplayStatus
  note?: string
}
