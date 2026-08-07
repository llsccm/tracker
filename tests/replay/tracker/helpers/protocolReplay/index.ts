import { GameState } from '@/tracker/Game'
import type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
import { TrackerController } from '@/tracker/runtime/trackerController'
import { applyTrackerReplayProtocol } from './handlers'
import { parseTrackerProtocolJsonl } from './parser'
import { assertTrackerReplayConsistency, createTrackerReplaySnapshot } from './snapshot'
import type {
  TrackerProtocolReplayContext,
  TrackerProtocolReplayOptions,
  TrackerProtocolReplayReport,
  TrackerProtocolReplayStatus,
  TrackerReplaySnapshot
} from './types'

export { parseTrackerProtocolJsonl } from './parser'
export type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
export type { TrackerProtocolReplayFailure } from './types'
export type { TrackerProtocolReplayOptions } from './types'
export type { TrackerProtocolReplayReport } from './types'
export type { TrackerProtocolReplayStep } from './types'
export type { TrackerReplaySnapshot } from './types'

const DEFAULT_CONTEXT_SIZE = 5
const INDEX_REBUILD_PROTOCOLS = new Set([
  'MsgGamePlayCardNtf',
  'CGsRoleSpellOptRep',
  'GsCRoleOptTargetNtf',
  'GsCUpdateRoleDataExNtf',
  'PubGsCMoveCard'
])

export class TrackerProtocolReplayer {
  readonly gameState: GameState
  readonly controller: TrackerController

  private readonly context: TrackerProtocolReplayContext
  private readonly contextSize: number
  private readonly captureStepStates: boolean
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
    this.contextSize = normalizeContextSize(options.contextSize)
    this.captureStepStates = options.captureStepStates === true
  }

  replay(records: RecordedTrackerProtocol[]): TrackerProtocolReplayReport {
    if (this.replayed) throw new Error('同一个 TrackerProtocolReplayer 只能执行一次回放')
    this.replayed = true

    const steps: TrackerProtocolReplayReport['steps'] = []
    const counts: Record<TrackerProtocolReplayStatus, number> = {
      applied: 0,
      ignored: 0,
      partial: 0
    }
    let previousState = createTrackerReplaySnapshot(
      this.gameState,
      this.controller.getTrackerRoom()
    )
    let lastActiveState: TrackerReplaySnapshot | null = previousState.room ? previousState : null

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      const stateBefore = previousState

      try {
        const result = applyTrackerReplayProtocol(this.context, record)
        const roomAfter = this.controller.getTrackerRoom()
        if (roomAfter?.isDeckReady) {
          assertTrackerReplayConsistency(roomAfter, `${record.seq}:${record.className}`, {
            checkIndexes:
              result.status !== 'ignored' && INDEX_REBUILD_PROTOCOLS.has(record.className)
          })
        }

        const stateAfter = createTrackerReplaySnapshot(this.gameState, roomAfter)
        if (stateAfter.room) lastActiveState = stateAfter
        previousState = stateAfter
        counts[result.status] += 1
        steps.push({
          seq: record.seq,
          className: record.className,
          status: result.status,
          note: result.note,
          state: this.captureStepStates ? stateAfter : undefined
        })
      } catch (error) {
        const stateAfter = createTrackerReplaySnapshot(
          this.gameState,
          this.controller.getTrackerRoom()
        )
        if (stateAfter.room) lastActiveState = stateAfter
        return {
          success: false,
          applied: counts.applied,
          ignored: counts.ignored,
          partial: counts.partial,
          steps,
          finalState: stateAfter,
          lastActiveState,
          failure: {
            seq: record.seq,
            className: record.className,
            payload: record.payload,
            message: getErrorMessage(error),
            context: records.slice(Math.max(0, index - this.contextSize), index + 1),
            stateBefore,
            stateAfter
          }
        }
      }
    }

    return {
      success: true,
      applied: counts.applied,
      ignored: counts.ignored,
      partial: counts.partial,
      steps,
      finalState: previousState,
      lastActiveState
    }
  }
}

export function replayTrackerProtocolJsonl(
  source: string,
  options: TrackerProtocolReplayOptions = {}
): TrackerProtocolReplayReport {
  return new TrackerProtocolReplayer(options).replay(parseTrackerProtocolJsonl(source))
}

export function formatTrackerProtocolReplayReport(report: TrackerProtocolReplayReport): string {
  const lines = [
    report.success ? '记牌器协议回放完成' : '记牌器协议回放失败',
    `统计：applied=${report.applied} ignored=${report.ignored} partial=${report.partial}`
  ]

  const nonAppliedSteps = report.steps.filter((step) => step.status !== 'applied')
  if (nonAppliedSteps.length > 0) {
    lines.push('未完整应用的协议：')
    lines.push(...summarizeNonAppliedSteps(nonAppliedSteps))
  }

  if (report.steps.some((step) => step.state)) {
    lines.push('逐条状态：', stringify(report.steps))
  }

  if (report.failure) {
    lines.push(
      `首个失败：seq=${report.failure.seq} className=${report.failure.className}`,
      `原因：${report.failure.message}`,
      '失败协议 payload：',
      stringify(report.failure.payload),
      '前置协议上下文：',
      stringify(report.failure.context),
      '失败前状态：',
      stringify(report.failure.stateBefore),
      '失败后状态：',
      stringify(report.failure.stateAfter)
    )
    return lines.join('\n')
  }

  lines.push('最终状态摘要：', stringify(compactSnapshot(report.finalState)))
  if (!report.finalState.room && report.lastActiveState) {
    lines.push('销毁前最后一份 Room 状态摘要：', stringify(compactSnapshot(report.lastActiveState)))
  }
  return lines.join('\n')
}

function summarizeNonAppliedSteps(steps: TrackerProtocolReplayReport['steps']): string[] {
  const groups = new Map<string, { count: number; seqs: number[]; label: string }>()
  steps.forEach((step) => {
    const label = `${step.className} [${step.status}]${step.note ? ` ${step.note}` : ''}`
    const key = `${step.status}\u0000${step.className}\u0000${step.note ?? ''}`
    const group = groups.get(key) ?? { count: 0, seqs: [], label }
    group.count += 1
    if (group.seqs.length < 8) group.seqs.push(step.seq)
    groups.set(key, group)
  })

  return Array.from(groups.values()).map((group) => {
    const omitted = group.count - group.seqs.length
    const seqSummary = `${group.seqs.join(', ')}${omitted > 0 ? ` 等，另 ${omitted} 条` : ''}`
    return `- ${group.label}：${group.count} 条（seq ${seqSummary}）`
  })
}

function compactSnapshot(snapshot: TrackerReplaySnapshot): unknown {
  if (!snapshot.room) return snapshot

  return {
    game: snapshot.game,
    room: {
      deckReady: snapshot.room.deckReady,
      seatIDs: snapshot.room.seatIDs,
      mySeatID: snapshot.room.mySeatID,
      firstSeatID: snapshot.room.firstSeatID,
      totalCards: snapshot.room.totalCards,
      knownCards: snapshot.room.knownCards,
      anonymousCards: snapshot.room.anonymousCards,
      zoneCounts: Object.fromEntries(
        Object.entries(snapshot.room.zones).map(([zoneName, zone]) => [zoneName, zone.count])
      ),
      players: snapshot.room.players.map((player) => ({
        seatID: player.seatID,
        observedHandCount: player.observedHandCount,
        unknownHandCount: player.unknownHandCount,
        knownHandCardIDs: player.knownHandCardIDs,
        candidateHandCardIDs: player.candidateHandCardIDs,
        equipCardIDs: player.equipCardIDs,
        judgeCardIDs: player.judgeCardIDs,
        markCardIDs: player.markCardIDs,
        generals: player.generals
      })),
      constraintCount: snapshot.room.constraints.length,
      ambiguousKnownCards: snapshot.room.ambiguousKnownCards,
      unlocatedIdentityCount: snapshot.room.unlocatedIdentityIDs.length,
      suspendedIdentityIDs: snapshot.room.suspendedIdentityIDs,
      pileIdentityLedger: compactPileIdentityLedger(snapshot.room.pileIdentityLedger)
    }
  }
}

function compactPileIdentityLedger(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const snapshot = value as Record<string, unknown>
  const cohort =
    snapshot.cohort && typeof snapshot.cohort === 'object' && !Array.isArray(snapshot.cohort)
      ? (snapshot.cohort as Record<string, unknown>)
      : null
  const groups = Array.isArray(cohort?.groups)
    ? cohort.groups.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item
        const group = item as Record<string, unknown>
        return {
          generation: group.generation,
          kind: group.kind,
          candidateCount: Array.isArray(group.cardIDs) ? group.cardIDs.length : 0,
          remainingPileCount: group.remainingPileCount
        }
      })
    : cohort?.groups

  return {
    revision: snapshot.revision,
    hiddenPileSlotCount: snapshot.hiddenPileSlotCount,
    accountedPileCount: snapshot.accountedPileCount,
    generation: cohort?.generation,
    groups
  }
}

function normalizeContextSize(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0) return DEFAULT_CONTEXT_SIZE
  return Number(value)
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

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
