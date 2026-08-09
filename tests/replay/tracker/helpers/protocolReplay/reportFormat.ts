import type { ReplayAssertionViolation } from './assertions'
import { normalizePositive } from './normalize'
import type {
  RecordedTrackerProtocol,
  TrackerProtocolReplayCausalClosure,
  TrackerProtocolReplayNonApplied,
  TrackerProtocolReplayReport,
  TrackerReplaySnapshot
} from './types'
import type { ReplayCardChange, ReplayConstraintProvenance } from './watch'

export interface FormatTrackerProtocolReplayOptions {
  /** 输出的 watch 变化条数上限；截断时会显式说明丢弃了多少条。 */
  maxCardChanges?: number
  /** 是否附加最终状态摘要；定位场景可关掉进一步压缩输出。 */
  includeFinalState?: boolean
}

const DEFAULT_MAX_CARD_CHANGES = 200

/**
 * 默认输出保持“事件摘要 + 最终摘要”，不展开逐条完整 Room 状态。
 * 只有显式开启 `captureFullSnapshots` 时才会出现逐条状态段落。
 */
export function formatTrackerProtocolReplayReport(
  report: TrackerProtocolReplayReport,
  options: FormatTrackerProtocolReplayOptions = {}
): string {
  const maxCardChanges = normalizePositive(options.maxCardChanges, DEFAULT_MAX_CARD_CHANGES)
  const diagnostics = report.diagnostics
  const lines = [
    `${report.success ? '记牌器协议回放完成' : '记牌器协议回放失败'} [mode=${diagnostics.mode}]`,
    `统计：applied=${report.applied} ignored=${report.ignored} partial=${report.partial}`,
    `耗时(ms)：${formatEntries(diagnostics.metrics.timings)}`,
    `计数：${formatEntries(diagnostics.metrics.counters)}`
  ]

  if (diagnostics.tainted) {
    lines.push('回放输入或检查不完整（tainted），不能据此断言“状态确定正确”：')
    lines.push(...diagnostics.taintReasons.map((reason) => `- ${reason}`))
  }

  if (report.nonApplied.length > 0) {
    lines.push('未完整应用的协议：')
    lines.push(...report.nonApplied.map(formatNonApplied))
  }

  if (diagnostics.cardChanges.length > 0) {
    lines.push(...formatCardChangeSection(diagnostics.cardChanges, maxCardChanges))
  }

  if (diagnostics.violations.length > 0) {
    lines.push('断言违反：')
    lines.push(...diagnostics.violations.map(formatViolation))
  }

  if (diagnostics.causalClosure) {
    lines.push(...formatCausalClosure(diagnostics.causalClosure, maxCardChanges))
  }

  const stateSteps = report.steps.filter((step) => step.state).slice(-maxCardChanges)
  if (stateSteps.length > 0) {
    lines.push('逐条状态：', stringify(stateSteps))
  }

  if (report.failure) {
    lines.push(
      `首个失败：seq=${report.failure.seq} className=${report.failure.className}`,
      `原因：${report.failure.message}`,
      '失败协议 payload：',
      stringify(report.failure.payload),
      '前置协议上下文：',
      stringify(report.failure.context),
      '失败后状态：',
      stringify(report.failure.stateAfter)
    )
    if (report.failure.stateBefore) {
      lines.push('失败前状态：', stringify(report.failure.stateBefore))
    }
    return lines.join('\n')
  }

  if (options.includeFinalState === false) return lines.join('\n')

  lines.push('最终状态摘要：', stringify(compactSnapshot(report.finalState)))
  if (!report.finalState.room && report.lastActiveState) {
    lines.push('销毁前最后一份 Room 状态摘要：', stringify(compactSnapshot(report.lastActiveState)))
  }
  return lines.join('\n')
}

function formatNonApplied(entry: TrackerProtocolReplayNonApplied): string {
  const seqSummary = summarizeSeqs(entry.seqs, entry.count)
  const affected = [
    entry.affectedCardIDs.length > 0 ? `cards=${entry.affectedCardIDs.join(',')}` : '',
    entry.affectedSeatIDs.length > 0 ? `seats=${entry.affectedSeatIDs.join(',')}` : ''
  ]
    .filter(Boolean)
    .join(' ')
  const label = `${entry.className} [${entry.status}]${entry.note ? ` ${entry.note}` : ''}`
  return `- ${label}：${entry.count} 条（seq ${seqSummary}）${affected ? ` ${affected}` : ''}`
}

function formatCardChangeSection(changes: ReplayCardChange[], limit: number): string[] {
  const shown = changes.slice(-limit)
  const omitted = changes.length - shown.length
  const header =
    omitted > 0
      ? `watch 变化：${changes.length} 条，仅显示最后 ${shown.length} 条（省略 ${omitted} 条）`
      : `watch 变化：${changes.length} 条`
  return [header, ...shown.flatMap(formatCardChange)]
}

function formatCardChange(change: ReplayCardChange): string[] {
  const lines = [
    `seq=${change.seq} class=${change.className} card=${change.cardID} ` +
      `seats=[${(change.previous?.seats ?? []).join(',')}]->[${(change.next?.seats ?? []).join(',')}]`
  ]
  change.removedCandidates.forEach((candidate) => lines.push(`  -candidate ${candidate}`))
  change.addedCandidates.forEach((candidate) => lines.push(`  +candidate ${candidate}`))
  if (change.previous?.location !== change.next?.location) {
    lines.push(
      `  location ${change.previous?.location ?? 'none'} -> ${change.next?.location ?? 'none'}`
    )
  }
  change.reasons.forEach((reason) => lines.push(`  reason=${reason}`))
  if (change.constraintGroupIDs.length > 0) {
    lines.push(`  groups=${change.constraintGroupIDs.join(',')}`)
  }
  return lines
}

function formatViolation(violation: ReplayAssertionViolation): string {
  return `- seq=${violation.seq} class=${violation.className} ${violation.label}：${violation.message}`
}

function formatCausalClosure(closure: TrackerProtocolReplayCausalClosure, limit: number): string[] {
  const lines = [
    `因果闭包（首个语义违反 seq=${closure.violation.seq}，关注卡牌 ${closure.cardIDs.join(', ') || '未指定'}）：`
  ]
  if (closure.changes.length > 0) {
    lines.push(...formatCardChangeSection(closure.changes, limit))
  }
  if (closure.constraintGroups.length > 0) {
    lines.push('相关约束组：')
    lines.push(...closure.constraintGroups.map(formatProvenance))
  }
  if (closure.protocols.length > 0) {
    lines.push('相关协议：')
    lines.push(...closure.protocols.map(formatProtocolLine))
  }
  return lines
}

function formatProvenance(item: ReplayConstraintProvenance): string {
  const lifecycle = [
    `created@${item.createdAtSeq}`,
    `updated@${item.lastUpdatedAtSeq}`,
    item.invalidatedAtSeq === null ? 'alive' : `invalidated@${item.invalidatedAtSeq}`
  ].join(' ')
  const slots = formatEntries(item.expectedSlotsByLocation)
  return (
    `- group=${item.id} ${lifecycle} seats=[${item.candidateSeats.join(',')}] ` +
    `cards=${item.cardIDs.length} slotsByLocation={${slots}} source=${stringifyInline(item.sourceEvent)}`
  )
}

const MAX_INLINE_PAYLOAD = 400

function formatProtocolLine(record: RecordedTrackerProtocol): string {
  const payload = stringifyInline(record.payload)
  const compact =
    payload.length > MAX_INLINE_PAYLOAD
      ? `${payload.slice(0, MAX_INLINE_PAYLOAD)}…（截断 ${payload.length - MAX_INLINE_PAYLOAD} 字符）`
      : payload
  return `- seq=${record.seq} ${record.className} ${compact}`
}

function summarizeSeqs(seqs: number[], count: number): string {
  const omitted = count - seqs.length
  return `${seqs.join(', ')}${omitted > 0 ? ` 等，另 ${omitted} 条` : ''}`
}

export function compactSnapshot(snapshot: TrackerReplaySnapshot): unknown {
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

function formatEntries(values: Record<string, number>): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return '(空)'
  return entries.map(([key, value]) => `${key}=${value}`).join(' ')
}

function stringifyInline(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return String(value)
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null'
  } catch (error) {
    return `（无法序列化：${error instanceof Error ? error.message : String(error)}）`
  }
}
