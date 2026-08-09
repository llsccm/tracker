import { GameState } from '@/tracker/Game'
import type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
import { TrackerController } from '@/tracker/runtime/trackerController'
import { ReplayAssertionRunner, type ReplayAssertionViolation } from './assertions'
import { applyTrackerReplayProtocol } from './handlers'
import { ReplayMetrics } from './metrics'
import { normalizeNonNegative, normalizePositive } from './normalize'
import { parseTrackerProtocolJsonl } from './parser'
import { assertTrackerReplayConsistency, createTrackerReplaySnapshot } from './snapshot'
import type {
  TrackerProtocolReplayCausalClosure,
  TrackerProtocolReplayContext,
  TrackerProtocolReplayDiagnostics,
  TrackerProtocolReplayMode,
  TrackerProtocolReplayNonApplied,
  TrackerProtocolReplayOptions,
  TrackerProtocolReplayReport,
  TrackerProtocolReplayStatus,
  TrackerProtocolReplayStep,
  TrackerProtocolReplayStopOn,
  TrackerReplaySnapshot
} from './types'
import { ReplayWatchTracker } from './watch'

export { parseTrackerProtocolJsonl } from './parser'
export {
  expectCardIncludesSeatsAt,
  expectCardLocationCandidatesAt,
  expectCardSeatsAt
} from './assertions'
export type { ReplayAssertion, ReplayAssertionViolation } from './assertions'
export { formatTrackerProtocolReplayReport } from './reportFormat'
export type { FormatTrackerProtocolReplayOptions } from './reportFormat'
export type { ReplayCardChange, ReplayConstraintProvenance } from './watch'
export type { RecordedTrackerProtocol } from './types'
export type { TrackerProtocolReplayCausalClosure } from './types'
export type { TrackerProtocolReplayDiagnostics } from './types'
export type { TrackerProtocolReplayFailure } from './types'
export type { TrackerProtocolReplayMode } from './types'
export type { TrackerProtocolReplayNonApplied } from './types'
export type { TrackerProtocolReplayOptions } from './types'
export type { TrackerProtocolReplayReport } from './types'
export type { TrackerProtocolReplayStep } from './types'
export type { TrackerReplaySnapshot } from './types'

const DEFAULT_CONTEXT_BEFORE = 5
const DEFAULT_CONTEXT_AFTER = 2
const DEFAULT_INDEX_CHECK_INTERVAL = 16
/** 因果闭包里最多回带多少条协议，超出时在报告中显式说明。 */
const MAX_CLOSURE_PROTOCOLS = 64
const INDEX_REBUILD_PROTOCOLS = new Set(['MsgGamePlayCardNtf', 'PubGsCMoveCard'])
const ROOM_DESTROY_PROTOCOLS = new Set(['MsgGameOver', 'ClientLeavetableRep'])

export class TrackerProtocolReplayer {
  readonly gameState: GameState
  readonly controller: TrackerController
  readonly metrics = new ReplayMetrics()

  private readonly context: TrackerProtocolReplayContext
  private readonly mode: TrackerProtocolReplayMode
  private readonly stopOn: TrackerProtocolReplayStopOn
  private readonly contextBefore: number
  private readonly contextAfter: number
  private readonly indexCheckInterval: number
  private readonly captureFullSnapshots: boolean
  private readonly toSeq: number | null
  private readonly watch: ReplayWatchTracker
  private readonly assertions: ReplayAssertionRunner
  private replayed = false

  constructor(options: TrackerProtocolReplayOptions = {}) {
    this.gameState = new GameState()
    this.controller = new TrackerController({
      ...options.controllerOptions,
      gameState: this.gameState,
      runtime: this.gameState,
      onError: (message, ...details) => {
        throw new Error(formatControllerError(String(message), details))
      }
    })
    this.context = {
      controller: this.controller,
      gameState: this.gameState,
      currentUserID: options.currentUserID,
      sessionInitialized: false
    }

    this.mode = options.mode ?? 'deep'
    this.contextBefore = normalizePositive(
      options.contextBefore ?? options.contextSize,
      DEFAULT_CONTEXT_BEFORE
    )
    this.contextAfter = normalizeNonNegative(options.contextAfter, DEFAULT_CONTEXT_AFTER)
    this.indexCheckInterval = normalizePositive(
      options.indexCheckInterval,
      DEFAULT_INDEX_CHECK_INTERVAL
    )
    this.captureFullSnapshots =
      options.captureFullSnapshots === true || options.captureStepStates === true
    this.toSeq = Number.isInteger(options.toSeq) ? Number(options.toSeq) : null

    const assertions = options.assertions ?? []
    this.assertions = new ReplayAssertionRunner(assertions)
    this.stopOn =
      options.stopOn ??
      (assertions.length > 0 ? 'first-semantic-mismatch' : 'first-structural-error')
    this.watch = new ReplayWatchTracker({
      // 断言关注的卡牌自动进入 watch 集合，否则首错时拿不到因果闭包。
      cardIDs: [
        ...(options.watchCardIDs ?? []),
        ...assertions.flatMap((item) => item.cardIDs ?? [])
      ],
      seatIDs: options.watchSeatIDs,
      changeLimit: options.changeLimit,
      metrics: this.metrics
    })
  }

  replay(records: RecordedTrackerProtocol[]): TrackerProtocolReplayReport {
    if (this.replayed) throw new Error('同一个 TrackerProtocolReplayer 只能执行一次回放')
    this.replayed = true

    const steps: TrackerProtocolReplayStep[] = []
    const counts: Record<TrackerProtocolReplayStatus, number> = {
      applied: 0,
      ignored: 0,
      partial: 0
    }
    const nonApplied = new Map<string, TrackerProtocolReplayNonApplied>()
    const violations: ReplayAssertionViolation[] = []
    const taintReasons: string[] = []
    let lastActiveState: TrackerReplaySnapshot | null = null
    let indexCandidates = 0
    let skippedIndexChecks = 0
    let lastSeq = 0
    let lastClassName = ''
    let truncatedBySeq = 0
    let closure: TrackerProtocolReplayCausalClosure | null = null

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (this.toSeq !== null && record.seq > this.toSeq) {
        truncatedBySeq = records.length - index
        break
      }

      lastSeq = record.seq
      lastClassName = record.className
      this.metrics.count('protocols')

      const stateBefore = this.captureSnapshotIf(
        this.captureFullSnapshots || ROOM_DESTROY_PROTOCOLS.has(record.className)
      )
      if (stateBefore?.room && ROOM_DESTROY_PROTOCOLS.has(record.className)) {
        lastActiveState = stateBefore
      }
      this.watch.beginProtocol(this.controller.getTrackerRoom())

      try {
        const result = this.metrics.time('apply', () =>
          applyTrackerReplayProtocol(this.context, record)
        )
        const roomAfter = this.controller.getTrackerRoom()

        const wantsIndexCheck =
          result.status !== 'ignored' && INDEX_REBUILD_PROTOCOLS.has(record.className)
        if (wantsIndexCheck) indexCandidates += 1
        const checkIndexes = wantsIndexCheck && this.shouldCheckIndexes(indexCandidates)
        if (wantsIndexCheck && !checkIndexes) skippedIndexChecks += 1

        if (roomAfter?.isDeckReady) {
          this.metrics.time('consistency', () =>
            assertTrackerReplayConsistency(roomAfter, `${record.seq}:${record.className}`, {
              checkIndexes,
              metrics: this.metrics
            })
          )
          this.metrics.observeMax('resolveRoundsMax', roomAfter.maxResolveRounds)
        }

        const stateAfter = this.captureSnapshotIf(this.captureFullSnapshots)
        if (stateAfter?.room) lastActiveState = stateAfter

        counts[result.status] += 1
        if (result.status !== 'applied') recordNonApplied(nonApplied, record, result)
        steps.push({
          seq: record.seq,
          className: record.className,
          status: result.status,
          note: result.note,
          state: stateAfter ?? undefined
        })

        this.watch.endProtocol(record.seq, record.className, roomAfter)

        const stepViolations = this.metrics.time('assert', () =>
          this.assertions.runAfterProtocol({
            seq: record.seq,
            className: record.className,
            room: roomAfter
          })
        )
        if (stepViolations.length > 0) {
          violations.push(...stepViolations)
          if (this.stopOn === 'first-semantic-mismatch') {
            closure = this.buildCausalClosure(stepViolations[0], records)
            break
          }
        }
      } catch (error) {
        this.watch.endProtocol(record.seq, record.className, this.controller.getTrackerRoom())
        const stateAfter = createTrackerReplaySnapshot(
          this.gameState,
          this.controller.getTrackerRoom()
        )
        if (stateAfter.room) lastActiveState = stateAfter
        if (!stateAfter.room && stateBefore?.room) lastActiveState = stateBefore

        return this.finalize({
          success: false,
          counts,
          steps,
          nonApplied,
          violations,
          closure,
          finalState: stateAfter,
          lastActiveState,
          taintReasons,
          skippedIndexChecks,
          truncatedBySeq,
          stoppedAtSeq: record.seq,
          failure: {
            seq: record.seq,
            className: record.className,
            payload: record.payload,
            message: getErrorMessage(error),
            context: records.slice(
              Math.max(0, index - this.contextBefore),
              index + 1 + this.contextAfter
            ),
            stateBefore: stateBefore ?? null,
            stateAfter
          }
        })
      }
    }

    const finalRoom = this.controller.getTrackerRoom()
    // 只有在首个语义违反上主动停机时才跳过 final 断言；stopOn=never 必须跑完全部断言。
    if (closure === null) {
      const finalViolations = this.metrics.time('assert', () =>
        this.assertions.runFinal({ seq: lastSeq, className: lastClassName, room: finalRoom })
      )
      violations.push(...finalViolations)
      if (finalViolations.length > 0 && this.stopOn === 'first-semantic-mismatch') {
        closure = this.buildCausalClosure(finalViolations[0], records)
      }
    }
    violations.push(...this.assertions.collectUnevaluated(lastSeq, lastClassName))

    // fast/watch 降级了逐条索引检查，收尾时至少补一次全量核对。
    if (finalRoom?.isDeckReady && skippedIndexChecks > 0 && violations.length === 0) {
      try {
        this.metrics.time('consistency', () =>
          assertTrackerReplayConsistency(finalRoom, `final:${lastSeq}`, {
            checkIndexes: true,
            metrics: this.metrics
          })
        )
      } catch (error) {
        taintReasons.push(`收尾索引核对失败：${getErrorMessage(error)}`)
      }
    }

    const finalState = this.metrics.time('snapshot', () =>
      createTrackerReplaySnapshot(this.gameState, finalRoom)
    )
    if (finalState.room) lastActiveState = finalState

    return this.finalize({
      success: violations.length === 0,
      counts,
      steps,
      nonApplied,
      violations,
      closure,
      finalState,
      lastActiveState,
      taintReasons,
      skippedIndexChecks,
      truncatedBySeq,
      stoppedAtSeq: lastSeq || null
    })
  }

  private shouldCheckIndexes(indexCandidates: number): boolean {
    if (this.mode === 'deep') return true
    if (this.mode === 'fast') return false
    return indexCandidates % this.indexCheckInterval === 0
  }

  private captureSnapshotIf(condition: boolean): TrackerReplaySnapshot | null {
    if (!condition) return null
    return this.metrics.time('snapshot', () => {
      this.metrics.count('fullSnapshots')
      return createTrackerReplaySnapshot(this.gameState, this.controller.getTrackerRoom())
    })
  }

  /**
   * 用首个语义违反反查因果闭包：目标卡牌的全部变化、相关约束组来源、以及
   * 这些事件对应的协议。上下文按相关性收敛，而不是固定回带最近 N 条协议。
   */
  private buildCausalClosure(
    violation: ReplayAssertionViolation,
    records: RecordedTrackerProtocol[]
  ): TrackerProtocolReplayCausalClosure {
    const cardIDs = violation.cardIDs.slice()
    const changes = this.watch.getChangesForCards(cardIDs)
    const groupIDs = new Set<string>()
    changes.forEach((change) => change.constraintGroupIDs.forEach((id) => groupIDs.add(id)))
    const constraintGroups = this.watch.getProvenance(groupIDs)

    const seqs = new Set<number>()
    changes.forEach((change) => seqs.add(change.seq))
    constraintGroups.forEach((group) => {
      seqs.add(group.createdAtSeq)
      seqs.add(group.lastUpdatedAtSeq)
      if (group.invalidatedAtSeq !== null) seqs.add(group.invalidatedAtSeq)
    })
    for (let offset = -this.contextBefore; offset <= this.contextAfter; offset += 1) {
      seqs.add(violation.seq + offset)
    }

    const bySeq = new Map(records.map((record) => [record.seq, record]))
    const protocols = Array.from(seqs)
      .sort((left, right) => left - right)
      .map((seq) => bySeq.get(seq))
      .filter((record): record is RecordedTrackerProtocol => record !== undefined)
      .slice(0, MAX_CLOSURE_PROTOCOLS)

    return { violation, cardIDs, changes, constraintGroups, protocols }
  }

  private finalize(input: {
    success: boolean
    counts: Record<TrackerProtocolReplayStatus, number>
    steps: TrackerProtocolReplayStep[]
    nonApplied: Map<string, TrackerProtocolReplayNonApplied>
    violations: ReplayAssertionViolation[]
    closure: TrackerProtocolReplayCausalClosure | null
    finalState: TrackerReplaySnapshot
    lastActiveState: TrackerReplaySnapshot | null
    taintReasons: string[]
    skippedIndexChecks: number
    truncatedBySeq: number
    stoppedAtSeq: number | null
    failure?: TrackerProtocolReplayReport['failure']
  }): TrackerProtocolReplayReport {
    const watchStats = this.watch.getStats()
    const taintReasons = input.taintReasons.slice()

    if (input.counts.partial > 0) {
      taintReasons.push(`存在 ${input.counts.partial} 条只能部分重建的协议，输入信息不完整`)
    }
    if (input.skippedIndexChecks > 0) {
      taintReasons.push(
        `mode=${this.mode} 跳过了 ${input.skippedIndexChecks} 次逐条影子索引检查（已在收尾补一次全量核对）`
      )
    }
    if (input.truncatedBySeq > 0) {
      taintReasons.push(`按 toSeq=${this.toSeq} 截断，剩余 ${input.truncatedBySeq} 条协议未回放`)
    }
    if (watchStats.droppedChanges > 0) {
      taintReasons.push(`watch 变化日志超限，丢弃了 ${watchStats.droppedChanges} 条最早事件`)
    }
    if (watchStats.droppedConstraintGroups > 0) {
      taintReasons.push(`约束 provenance 超限，丢弃了 ${watchStats.droppedConstraintGroups} 条记录`)
    }
    if (watchStats.truncatedReasonProtocols > 0) {
      taintReasons.push(
        `${watchStats.truncatedReasonProtocols} 条协议的变更原因日志被 Room 事件上限截断`
      )
    }

    const diagnostics: TrackerProtocolReplayDiagnostics = {
      mode: this.mode,
      metrics: this.metrics.getSnapshot(),
      watchStats,
      cardChanges: this.watch.getChanges(),
      violations: input.violations,
      causalClosure: input.closure,
      stoppedAtSeq: input.stoppedAtSeq,
      tainted: taintReasons.length > 0,
      taintReasons
    }

    return {
      success: input.success,
      applied: input.counts.applied,
      ignored: input.counts.ignored,
      partial: input.counts.partial,
      steps: input.steps,
      nonApplied: Array.from(input.nonApplied.values()),
      finalState: input.finalState,
      lastActiveState: input.lastActiveState,
      diagnostics,
      ...(input.failure ? { failure: input.failure } : {})
    }
  }
}

export function replayTrackerProtocolJsonl(
  source: string,
  options: TrackerProtocolReplayOptions = {}
): TrackerProtocolReplayReport {
  const replayer = new TrackerProtocolReplayer(options)
  const records = replayer.metrics.time('parse', () => parseTrackerProtocolJsonl(source))
  return replayer.replay(records)
}

function recordNonApplied(
  target: Map<string, TrackerProtocolReplayNonApplied>,
  record: RecordedTrackerProtocol,
  result: {
    status: TrackerProtocolReplayStatus
    note?: string
    affectedCardIDs?: number[]
    affectedSeatIDs?: number[]
  }
): void {
  const note = result.note ?? ''
  const key = `${result.status}|${record.className}|${note}`
  const entry = target.get(key) ?? {
    status: result.status as Exclude<TrackerProtocolReplayStatus, 'applied'>,
    className: record.className,
    note,
    count: 0,
    seqs: [],
    affectedCardIDs: [],
    affectedSeatIDs: []
  }
  entry.count += 1
  if (entry.seqs.length < 8) entry.seqs.push(record.seq)
  mergeSorted(entry.affectedCardIDs, result.affectedCardIDs)
  mergeSorted(entry.affectedSeatIDs, result.affectedSeatIDs)
  target.set(key, entry)
}

function mergeSorted(target: number[], values: number[] | undefined): void {
  if (!values || values.length === 0) return
  values.forEach((value) => {
    if (!target.includes(value)) target.push(value)
  })
  target.sort((left, right) => left - right)
}

function formatControllerError(message: string, details: unknown[]): string {
  const detailText = details
    .map((detail) => getErrorMessage(detail))
    .filter(Boolean)
    .join(' | ')
  return detailText ? `${message} ${detailText}` : message
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
