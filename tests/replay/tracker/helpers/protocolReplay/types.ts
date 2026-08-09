import type { GameState } from '@/tracker/Game'
import type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
import type { TrackerController } from '@/tracker/runtime/trackerController'
import type { TrackerControllerOptions } from '@/tracker/types'
import type { ReplayAssertion, ReplayAssertionViolation } from './assertions'
import type { ReplayMetricsSnapshot } from './metrics'
import type { ReplayCardChange, ReplayConstraintProvenance } from './watch'

export type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'

export type TrackerProtocolReplayStatus = 'applied' | 'ignored' | 'partial'

/**
 * 回放档位。
 *
 * - `fast`：只做基础计数与生命周期检查，不做影子索引重建，适合长回放。
 * - `watch`：按间隔做影子索引检查，配合 watch/断言定位首个语义偏差。
 * - `deep`：每条相关协议都做完整一致性检查（历史默认行为，成本最高）。
 */
export type TrackerProtocolReplayMode = 'fast' | 'watch' | 'deep'

/**
 * 停机策略。
 *
 * 只作用于**语义违反**（断言）：`never` 表示收集全部违反、不提前停机。
 * **结构错误不受此选项影响**：协议无法应用或一致性检查抛出时，
 * 后续回放状态已不可信，任何取值都会立刻终止并给出 `failure`。
 */
export type TrackerProtocolReplayStopOn =
  | 'first-semantic-mismatch'
  | 'first-structural-error'
  | 'never'

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
  /** 仅在开启完整快照时捕获；默认不为失败点重复回放前缀。 */
  stateBefore: TrackerReplaySnapshot | null
  stateAfter: TrackerReplaySnapshot
}

/** 未完整应用的协议按 className + status + note 归并后的结构化记录。 */
export interface TrackerProtocolReplayNonApplied {
  status: Exclude<TrackerProtocolReplayStatus, 'applied'>
  className: string
  note: string
  count: number
  seqs: number[]
  affectedCardIDs: number[]
  affectedSeatIDs: number[]
}

/** 首个语义违反的因果闭包：相关卡牌变化 + 约束来源 + 相关协议。 */
export interface TrackerProtocolReplayCausalClosure {
  violation: ReplayAssertionViolation
  cardIDs: number[]
  changes: ReplayCardChange[]
  constraintGroups: ReplayConstraintProvenance[]
  protocols: RecordedTrackerProtocol[]
}

export interface TrackerProtocolReplayDiagnostics {
  mode: TrackerProtocolReplayMode
  metrics: ReplayMetricsSnapshot
  watchStats: Record<string, number>
  /** watch 到的候选/座位变化事件；未开启 watch 时为空数组。 */
  cardChanges: ReplayCardChange[]
  violations: ReplayAssertionViolation[]
  causalClosure: TrackerProtocolReplayCausalClosure | null
  /** 回放实际停止在哪条 seq（正常跑完为最后一条）。 */
  stoppedAtSeq: number | null
  /** 输入不完整或检查被降级时为 true；此时报告不得宣称“确定正确”。 */
  tainted: boolean
  taintReasons: string[]
}

export interface TrackerProtocolReplayReport {
  success: boolean
  applied: number
  ignored: number
  partial: number
  steps: TrackerProtocolReplayStep[]
  nonApplied: TrackerProtocolReplayNonApplied[]
  finalState: TrackerReplaySnapshot
  lastActiveState: TrackerReplaySnapshot | null
  diagnostics: TrackerProtocolReplayDiagnostics
  failure?: TrackerProtocolReplayFailure
}

type ReplayControllerOptions = Pick<
  TrackerControllerOptions,
  'registerMoveEventHandlers' | 'roomFactory'
>

export interface TrackerProtocolReplayOptions {
  currentUserID?: number
  /** 默认 `deep`，保持历史检查强度；日常定位请显式传 `watch` 或 `fast`。 */
  mode?: TrackerProtocolReplayMode
  /** 只回放到该 seq（含）为止；`fromSeq` 需要 checkpoint 支持，暂未提供。 */
  toSeq?: number
  watchCardIDs?: number[]
  watchSeatIDs?: number[]
  assertions?: ReplayAssertion[]
  /** 默认：存在断言时为 `first-semantic-mismatch`，否则 `first-structural-error`。 */
  stopOn?: TrackerProtocolReplayStopOn
  /** 失败/违反点之前保留的协议条数，兼容旧字段 `contextSize`。 */
  contextBefore?: number
  /** 失败/违反点之后保留的协议条数（来自输入，不代表已应用）。 */
  contextAfter?: number
  /** @deprecated 改用 `contextBefore`。 */
  contextSize?: number
  /** watch/fast 模式下每隔多少条“需要索引检查”的协议做一次影子索引重建。 */
  indexCheckInterval?: number
  /** watch 变化事件日志上限。 */
  changeLimit?: number
  captureFullSnapshots?: boolean
  /** @deprecated 改用 `captureFullSnapshots`。 */
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
  /** 该协议未能完整应用时受影响的卡牌/座位，用于结构化 partial 报告。 */
  affectedCardIDs?: number[]
  affectedSeatIDs?: number[]
}
