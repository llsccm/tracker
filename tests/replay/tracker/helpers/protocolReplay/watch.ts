import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import type { Card } from '@/tracker/Card'
import type { ConstraintGroup } from '@/tracker/ConstraintGroup'
import type { Room } from '@/tracker/Room'
import { NOOP_REPLAY_METRICS, type ReplayMetricsSink } from './metrics'

/** 单次协议前后可观察到的 watched card 状态。 */
export interface ReplayWatchedCardState {
  cardID: number
  entityID: number
  location: string | null
  subZone: string | null
  seats: number[]
  candidates: string[]
  combinationID: string | number | null
  isKnown: boolean
  suspended: boolean
  description: string
  constraintGroupIDs: string[]
}

/** watched card 在某条协议上的紧凑变化事件。 */
export interface ReplayCardChange {
  seq: number
  className: string
  cardID: number
  previous: ReplayWatchedCardState | null
  next: ReplayWatchedCardState | null
  addedCandidates: string[]
  removedCandidates: string[]
  addedSeats: number[]
  removedSeats: number[]
  /** 来自 Room.dirtyCardEvents 的 `type:reason` 摘要，按发生顺序去重。 */
  reasons: string[]
  /** 变化前后涉及的约束组 ID 并集，用于查 provenance。 */
  constraintGroupIDs: string[]
}

/** 约束组来源与生命周期；旧组被清理后保留为 tombstone。 */
export interface ReplayConstraintProvenance {
  id: string
  createdAtSeq: number
  lastUpdatedAtSeq: number
  invalidatedAtSeq: number | null
  sourceEvent: Record<string, unknown> | string | null
  cardIDs: number[]
  candidateSeats: number[]
  expectedSlotsBySeat: Record<string, number>
  expectedSlotsBySubZone: Record<string, number>
  expectedSlotsByLocation: Record<string, number>
}

export interface ReplayWatchOptions {
  cardIDs?: number[]
  seatIDs?: number[]
  /** 变化事件日志上限；超出时丢弃最旧事件并计数，不静默截断。 */
  changeLimit?: number
  /** 约束 provenance（含 tombstone）保留上限。 */
  provenanceLimit?: number
  metrics?: ReplayMetricsSink
}

const DEFAULT_CHANGE_LIMIT = 4000
const DEFAULT_PROVENANCE_LIMIT = 512

/** sourceEvent 中保留到报告里的字段；`raw` 等大对象一律丢弃。 */
const SOURCE_EVENT_FIELDS = [
  'type',
  'label',
  'moveType',
  'className',
  'spellID',
  'seatID',
  'fromSeatID',
  'subZone',
  'fromSubZone',
  'fromZone',
  'toZone',
  'position',
  'fromPosition'
]

/**
 * 只读采集 watched card 的候选变化与约束来源。
 *
 * 采集完全发生在回放器一侧：不修改 Room、不推进任何生产游标，
 * 因此开启 watch 不会改变收敛时序。
 */
export class ReplayWatchTracker {
  private readonly explicitCardIDs: Set<number>
  private readonly watchSeatIDs: Set<number>
  private readonly changeLimit: number
  private readonly provenanceLimit: number
  private readonly metrics: ReplayMetricsSink

  /** 命中过 watch 条件的卡牌 ID；一旦命中就持续跟踪，避免离场后失去线索。 */
  private readonly stickyCardIDs = new Set<number>()
  private readonly previousStates = new Map<number, ReplayWatchedCardState>()
  private readonly provenance = new Map<string, ReplayConstraintProvenance>()
  private readonly provenanceSignatures = new Map<string, string>()
  private readonly changes: ReplayCardChange[] = []

  private dirtyCursor = 0
  private droppedChanges = 0
  private droppedProvenance = 0
  private truncatedReasonProtocols = 0

  constructor(options: ReplayWatchOptions = {}) {
    this.explicitCardIDs = new Set(options.cardIDs ?? [])
    this.watchSeatIDs = new Set(options.seatIDs ?? [])
    this.changeLimit = normalizePositive(options.changeLimit, DEFAULT_CHANGE_LIMIT)
    this.provenanceLimit = normalizePositive(options.provenanceLimit, DEFAULT_PROVENANCE_LIMIT)
    this.metrics = options.metrics ?? NOOP_REPLAY_METRICS
    this.explicitCardIDs.forEach((cardID) => this.stickyCardIDs.add(cardID))
  }

  get isEnabled(): boolean {
    return this.explicitCardIDs.size > 0 || this.watchSeatIDs.size > 0
  }

  /** 协议应用前调用：只记录 dirtyCardEvents 游标，不做扫描。 */
  beginProtocol(room: Room | null): void {
    this.dirtyCursor = room?.dirtyCardSeq ?? 0
  }

  /** 协议应用后调用：产出本条协议引发的 watched card 变化。 */
  endProtocol(seq: number, className: string, room: Room | null): ReplayCardChange[] {
    if (!this.isEnabled) return []

    const startedAt = performance.now()
    try {
      if (!room) return []

      const watched = this.resolveWatchedCards(room)
      const reasonsByCard = this.collectReasons(room)
      const emitted: ReplayCardChange[] = []

      watched.forEach((card) => {
        const cardID = card.id
        const next = createWatchedCardState(card, room)
        const previous = this.previousStates.get(cardID) ?? null
        this.previousStates.set(cardID, next)
        this.metrics.count('watchedCardScans')

        const reasons = reasonsByCard.get(card.entityID) ?? []
        if (previous && isSameWatchedState(previous, next) && reasons.length === 0) return

        const change: ReplayCardChange = {
          seq,
          className,
          cardID,
          previous,
          next,
          addedCandidates: difference(next.candidates, previous?.candidates ?? []),
          removedCandidates: difference(previous?.candidates ?? [], next.candidates),
          addedSeats: numericDifference(next.seats, previous?.seats ?? []),
          removedSeats: numericDifference(previous?.seats ?? [], next.seats),
          reasons,
          constraintGroupIDs: union(previous?.constraintGroupIDs ?? [], next.constraintGroupIDs)
        }
        this.pushChange(change)
        emitted.push(change)
      })

      this.syncConstraintProvenance(seq, room)
      return emitted
    } finally {
      this.metrics.add('watch', performance.now() - startedAt)
    }
  }

  getChanges(): ReplayCardChange[] {
    return this.changes.slice()
  }

  /** 取目标卡牌的完整变化链，用于首错的因果闭包。 */
  getChangesForCards(cardIDs: Iterable<number>): ReplayCardChange[] {
    const wanted = new Set(cardIDs)
    if (wanted.size === 0) return []
    return this.changes.filter((change) => wanted.has(change.cardID))
  }

  getProvenance(ids: Iterable<string>): ReplayConstraintProvenance[] {
    const wanted = new Set(Array.from(ids, String))
    return Array.from(this.provenance.values())
      .filter((item) => wanted.has(item.id))
      .sort((left, right) => left.createdAtSeq - right.createdAtSeq)
  }

  getStats(): Record<string, number> {
    return {
      watchedCards: this.stickyCardIDs.size,
      changes: this.changes.length,
      droppedChanges: this.droppedChanges,
      trackedConstraintGroups: this.provenance.size,
      droppedConstraintGroups: this.droppedProvenance,
      truncatedReasonProtocols: this.truncatedReasonProtocols
    }
  }

  private pushChange(change: ReplayCardChange): void {
    this.changes.push(change)
    if (this.changes.length > this.changeLimit) {
      const overflow = this.changes.length - this.changeLimit
      this.changes.splice(0, overflow)
      this.droppedChanges += overflow
    }
  }

  private resolveWatchedCards(room: Room): Card[] {
    if (this.watchSeatIDs.size > 0) {
      room.cards.forEach((card) => {
        if (card.id <= 0) return
        if (this.stickyCardIDs.has(card.id)) return
        if (matchesWatchedSeats(card, this.watchSeatIDs)) this.stickyCardIDs.add(card.id)
      })
      this.metrics.count('watchSeatScans', room.cards.length)
    }

    const cards: Card[] = []
    this.stickyCardIDs.forEach((cardID) => {
      const card = room.cardIndex.get(cardID)
      if (card) cards.push(card)
    })
    return cards.sort((left, right) => left.id - right.id)
  }

  /** 按 entityID 聚合本条协议内产生的 `type:reason` 摘要。 */
  private collectReasons(room: Room): Map<number, string[]> {
    const grouped = new Map<number, string[]>()
    const events = room.dirtyCardEvents
    if (events.length === 0) return grouped

    if (events[0].seq > this.dirtyCursor + 1) this.truncatedReasonProtocols += 1

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event.seq <= this.dirtyCursor) break
      const cardID = event.card.id
      if (cardID > 0 && !this.stickyCardIDs.has(cardID)) continue

      const label = formatReason(event.detail)
      if (!label) continue
      const bucket = grouped.get(event.card.entityID) ?? []
      if (!bucket.includes(label)) bucket.unshift(label)
      grouped.set(event.card.entityID, bucket)
    }
    return grouped
  }

  private syncConstraintProvenance(seq: number, room: Room): void {
    const alive = new Set<string>()

    room.constraintGroups.forEach((group) => {
      const id = String(group.id)
      alive.add(id)
      const signature = createGroupSignature(group)
      const existing = this.provenance.get(id)
      if (!existing) {
        this.putProvenance(createProvenance(id, seq, group))
        this.provenanceSignatures.set(id, signature)
        return
      }

      existing.invalidatedAtSeq = null
      if (this.provenanceSignatures.get(id) === signature) return
      this.provenanceSignatures.set(id, signature)
      existing.lastUpdatedAtSeq = seq
      Object.assign(existing, createProvenance(id, existing.createdAtSeq, group), {
        lastUpdatedAtSeq: seq,
        invalidatedAtSeq: null
      })
    })

    this.provenance.forEach((item) => {
      if (alive.has(item.id) || item.invalidatedAtSeq !== null) return
      item.invalidatedAtSeq = seq
    })
  }

  private putProvenance(item: ReplayConstraintProvenance): void {
    this.provenance.set(item.id, item)
    if (this.provenance.size <= this.provenanceLimit) return

    // 优先淘汰已失效且与 watched card 无关的 tombstone。
    for (const [id, candidate] of this.provenance) {
      if (this.provenance.size <= this.provenanceLimit) break
      if (candidate.invalidatedAtSeq === null) continue
      if (candidate.cardIDs.some((cardID) => this.stickyCardIDs.has(cardID))) continue
      this.provenance.delete(id)
      this.provenanceSignatures.delete(id)
      this.droppedProvenance += 1
    }
  }
}

export function createWatchedCardState(card: Card, room: Room): ReplayWatchedCardState {
  const constraintGroupIDs: string[] = []
  room.constraintGroups.forEach((group) => {
    if (group.cards.has(card)) constraintGroupIDs.push(String(group.id))
  })

  return {
    cardID: card.id,
    entityID: card.entityID,
    location: card.location ?? null,
    subZone: card.subZone ?? null,
    seats: Array.from(card.seats).sort((left, right) => left - right),
    candidates: card
      .getLocationCandidates()
      .map((candidate) => createLocationCandidateKey(candidate))
      .filter(Boolean)
      .sort(),
    combinationID: card.combinationID ?? null,
    isKnown: card.isKnown,
    suspended: card.suspended,
    description: card.getLocationDescription(),
    constraintGroupIDs: constraintGroupIDs.sort()
  }
}

function matchesWatchedSeats(card: Card, seatIDs: Set<number>): boolean {
  for (const seatID of card.seats) {
    if (seatIDs.has(seatID)) return true
  }
  return false
}

function createProvenance(
  id: string,
  createdAtSeq: number,
  group: ConstraintGroup
): ReplayConstraintProvenance {
  return {
    id,
    createdAtSeq,
    lastUpdatedAtSeq: createdAtSeq,
    invalidatedAtSeq: null,
    sourceEvent: summarizeSourceEvent(group.sourceEvent),
    cardIDs: Array.from(group.cards, (card) => card.id).sort((left, right) => left - right),
    candidateSeats: Array.from(group.candidateSeats).sort((left, right) => left - right),
    expectedSlotsBySeat: mapNumberEntries(group.expectedSlotsBySeat),
    expectedSlotsBySubZone: mapNumberEntries(group.expectedSlotsBySubZone),
    expectedSlotsByLocation: mapNumberEntries(group.expectedSlotsByLocation)
  }
}

function createGroupSignature(group: ConstraintGroup): string {
  return JSON.stringify([
    Array.from(group.cards, (card) => card.entityID).sort((left, right) => left - right),
    Array.from(group.candidateSeats).sort((left, right) => left - right),
    mapNumberEntries(group.expectedSlotsBySeat),
    mapNumberEntries(group.expectedSlotsBySubZone),
    mapNumberEntries(group.expectedSlotsByLocation)
  ])
}

export function summarizeSourceEvent(
  sourceEvent: unknown
): Record<string, unknown> | string | null {
  if (typeof sourceEvent === 'string') return sourceEvent
  if (!sourceEvent || typeof sourceEvent !== 'object' || Array.isArray(sourceEvent)) return null

  const source = sourceEvent as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  SOURCE_EVENT_FIELDS.forEach((field) => {
    const value = source[field]
    if (value === undefined || value === null) return
    if (typeof value === 'object') return
    summary[field] = value
  })
  return Object.keys(summary).length > 0 ? summary : null
}

function formatReason(detail: Record<string, unknown>): string {
  const type = typeof detail.type === 'string' ? detail.type : ''
  const reason = typeof detail.reason === 'string' ? detail.reason : ''
  if (type && reason) return `${type}:${reason}`
  return type || reason
}

function isSameWatchedState(left: ReplayWatchedCardState, right: ReplayWatchedCardState): boolean {
  return (
    left.location === right.location &&
    left.subZone === right.subZone &&
    left.isKnown === right.isKnown &&
    left.suspended === right.suspended &&
    left.combinationID === right.combinationID &&
    sameStrings(left.candidates, right.candidates) &&
    sameNumbers(left.seats, right.seats) &&
    sameStrings(left.constraintGroupIDs, right.constraintGroupIDs)
  )
}

function mapNumberEntries(map: Map<unknown, number>): Record<string, number> {
  const entries: [string, number][] = Array.from(map.entries(), ([key, value]) => [
    String(key),
    value
  ])
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

function difference(left: string[], right: string[]): string[] {
  const excluded = new Set(right)
  return left.filter((item) => !excluded.has(item))
}

function numericDifference(left: number[], right: number[]): number[] {
  const excluded = new Set(right)
  return left.filter((item) => !excluded.has(item))
}

function union(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).sort()
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function normalizePositive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}
