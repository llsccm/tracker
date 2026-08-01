import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from './candidate/cardPositions'
import type { CardID, PublicPosition } from './types'

export type PileIdentityCohortKind = 'all-in-pile' | 'none-in-pile' | 'partial'

export interface PileIdentityCohort {
  generation: number
  candidateIdentityIDs: Set<CardID>
  remainingPileCount: number
}

export interface PileIdentityCohortProjectionGroup {
  generation: number
  kind: PileIdentityCohortKind
  cardIDs: CardID[]
  remainingPileCount: number
  label: string
}

export interface PileIdentityCohortSnapshot {
  generation: number
  groups: PileIdentityCohortProjectionGroup[]
  definitelyInPileIDs: CardID[]
  definitelyOutsidePileIDs: CardID[]
  flatCandidateWidth: number
}

export interface PileIdentityLedgerSnapshot {
  revision: number
  identityUniverseIDs: CardID[]
  locatedIdentityIDs: CardID[]
  knownPileIdentityIDs: CardID[]
  knownDiscardIdentityIDs: CardID[]
  hiddenPileSlotCount: number
  accountedPileCount: number
  cohort: PileIdentityCohortSnapshot
}

export interface PileIdentityLedgerMove {
  eventType: string
  fromZone: number | null
  toZone: number | null
  cardIDs: readonly CardID[]
  cardCount: number
  pileCountBefore?: number
  anonymousPileConsumptionCount?: number
  knownPileIdentityIDsConsumed?: readonly CardID[]
  visiblePileIdentityIDsAfter?: readonly CardID[]
  fromPosition?: PublicPosition
  toPosition?: PublicPosition
  moveType?: number | string | null
  spellID?: number | string | null
  pileCountAfter: number
  discardCountAfter: number
}

export interface PileIdentityLedgerReveal {
  cardIDs: readonly CardID[]
  location: 'pile' | 'outside'
  pileCountAfter: number
  discardCountAfter: number
}

export interface PileIdentityConsistencyIssue {
  context: string
  reason: string
  expected?: number
  actual?: number
  cardID?: CardID
}

export type PileIdentityLedgerWarningHandler = (
  message: string,
  detail: Record<string, unknown>
) => void

export interface PileIdentityLedgerOptions {
  enabled?: boolean
  onWarning?: PileIdentityLedgerWarningHandler
}

interface PileIdentityLedgerState {
  revision: number
  generation: number
  identityUniverse: Set<CardID>
  locatedIdentityIDs: Set<CardID>
  knownPileIdentityIDs: Set<CardID>
  knownDiscardIdentityIDs: Set<CardID>
  previousDiscardCount: number
  cohorts: PileIdentityCohort[]
}

function normalizeIDs(cardIDs: readonly CardID[]): CardID[] {
  return Array.from(new Set(cardIDs.map(Number).filter((cardID) => cardID > 0))).sort(
    (left, right) => left - right
  )
}

function normalizeCount(count: number): number {
  const normalized = Math.floor(Number(count))
  return Number.isFinite(normalized) ? Math.max(0, normalized) : 0
}

function createCohortLabel(kind: PileIdentityCohortKind, size: number, count: number): string {
  if (kind === 'all-in-pile') return `这 ${size} 张都在牌堆`
  if (kind === 'none-in-pile') return `这 ${size} 张都不在牌堆`
  return `这 ${size} 张里有 ${count} 张在牌堆`
}

function cloneCohort(cohort: PileIdentityCohort): PileIdentityCohort {
  return {
    generation: cohort.generation,
    candidateIdentityIDs: new Set(cohort.candidateIdentityIDs),
    remainingPileCount: cohort.remainingPileCount
  }
}

export function arePileIdentityCohortSnapshotsEqual(
  left: PileIdentityCohortSnapshot,
  right: PileIdentityCohortSnapshot
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Production cohort ledger. It shadows the current authoritative card entities and never mutates them.
 */
export class PileIdentityLedger {
  private revision = 0
  private generation = 0
  private identityUniverse = new Set<CardID>()
  private locatedIdentityIDs = new Set<CardID>()
  private knownPileIdentityIDs = new Set<CardID>()
  private knownDiscardIdentityIDs = new Set<CardID>()
  private previousDiscardCount = 0
  private cohorts: PileIdentityCohort[] = []
  private enabled: boolean
  private readonly onWarning: PileIdentityLedgerWarningHandler

  constructor({ enabled = true, onWarning = () => undefined }: PileIdentityLedgerOptions = {}) {
    this.enabled = enabled
    this.onWarning = onWarning
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  initialize(cardIDs: readonly CardID[]): void {
    if (!this.enabled) return
    const identities = normalizeIDs(cardIDs)
    this.revision += 1
    this.generation = 0
    this.identityUniverse = new Set(identities)
    this.locatedIdentityIDs.clear()
    this.knownPileIdentityIDs.clear()
    this.knownDiscardIdentityIDs.clear()
    this.previousDiscardCount = 0
    this.cohorts =
      identities.length === 0
        ? []
        : [
            {
              generation: 0,
              candidateIdentityIDs: new Set(identities),
              remainingPileCount: identities.length
            }
          ]

    this.warnForIssues(this.collectConsistencyIssues(cardIDs.length, 'initialize'))
  }

  applyMove(move: PileIdentityLedgerMove): void {
    if (!this.enabled) return
    this.commit(`move:${move.eventType}`, () => {
      const cardIDs = normalizeIDs(move.cardIDs)
      const knownCount = cardIDs.length
      const protocolUnknownCount = Math.max(0, normalizeCount(move.cardCount) - knownCount)
      const knownPileIdentityIDsConsumed =
        move.fromZone === 1 && cardIDs.length === 0
          ? normalizeIDs(move.knownPileIdentityIDsConsumed ?? [])
          : []
      const maxAnonymousPileConsumptionCount = Math.max(
        0,
        protocolUnknownCount - knownPileIdentityIDsConsumed.length
      )
      const anonymousPileConsumptionCount =
        move.fromZone === 1 && cardIDs.length === 0
          ? Math.min(
              maxAnonymousPileConsumptionCount,
              normalizeCount(move.anonymousPileConsumptionCount ?? maxAnonymousPileConsumptionCount)
            )
          : protocolUnknownCount

      if (move.eventType === 'noop') {
        this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
        this.previousDiscardCount = normalizeCount(move.discardCountAfter)
        return
      }

      if (move.eventType === 'shuffleDiscardIntoPile') {
        this.applyShuffleInternal(move.pileCountAfter)
        this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
        this.reconcilePileCountInternal(move.pileCountAfter)
        this.previousDiscardCount = normalizeCount(move.discardCountAfter)
        return
      }

      const staysInPile = move.fromZone === 1 && move.toZone === 1
      if (staysInPile) {
        cardIDs.forEach((cardID) => this.revealIdentityInPileInternal(cardID))
        this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
        this.reconcilePileCountInternal(move.pileCountAfter)
        this.previousDiscardCount = normalizeCount(move.discardCountAfter)
        return
      }

      if (move.fromZone === 1) {
        cardIDs.forEach((cardID) => this.revealIdentityFromPileInternal(cardID))
        knownPileIdentityIDsConsumed.forEach((cardID) =>
          this.revealIdentityFromPileInternal(cardID)
        )
        if (anonymousPileConsumptionCount > 0) {
          const isTopRangeGain =
            Number(move.moveType) === 18 &&
            Number(move.spellID) === 7011 &&
            move.fromPosition !== POSITION_RANDOM
          const isAnonymousArbitraryPileGain =
            !isTopRangeGain &&
            (Number(move.moveType) === 18 || move.fromPosition === POSITION_RANDOM)
          if (isAnonymousArbitraryPileGain) {
            this.releaseKnownPileIdentitiesExceptInternal(move.visiblePileIdentityIDsAfter)
          }
          if (isTopRangeGain) {
            this.consumeAnonymousTopRangeInternal(anonymousPileConsumptionCount)
          } else if (Number(move.moveType) === 18) {
            this.consumeAnonymousInternal(anonymousPileConsumptionCount, POSITION_RANDOM)
          } else {
            this.consumeAnonymousInternal(anonymousPileConsumptionCount, move.fromPosition)
          }
        }
      } else if (move.toZone === 1) {
        if (cardIDs.length > 0) {
          const randomInsertion =
            move.toPosition === POSITION_RANDOM ||
            (move.fromZone === 0 && Number(move.spellID) === 3694) ||
            cardIDs.some((cardID) => cardID === 4400 || cardID === 4401)

          this.insertKnownInternal(
            cardIDs,
            cardIDs.length,
            randomInsertion ? POSITION_RANDOM : move.toPosition
          )
        }

        if (protocolUnknownCount > 0) {
          this.degradeToSingleCohortInternal(move.pileCountAfter)
        }
      } else {
        cardIDs.forEach((cardID) => this.revealIdentityOutsidePileInternal(cardID))
      }

      if (move.fromZone === 2) {
        cardIDs.forEach((cardID) => this.knownDiscardIdentityIDs.delete(cardID))
      }
      if (move.toZone === 2) {
        cardIDs.forEach((cardID) => this.knownDiscardIdentityIDs.add(cardID))
      }

      this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter)
      this.reconcilePileCountInternal(move.pileCountAfter)
      this.previousDiscardCount = normalizeCount(move.discardCountAfter)
    })

    this.warnForIssues(this.collectConsistencyIssues(move.pileCountAfter, `move:${move.eventType}`))
  }

  applyReveal(reveal: PileIdentityLedgerReveal): void {
    if (!this.enabled) return
    this.commit(`reveal:${reveal.location}`, () => {
      normalizeIDs(reveal.cardIDs).forEach((cardID) => {
        if (reveal.location === 'pile') this.revealIdentityInPileInternal(cardID)
        else this.revealIdentityOutsidePileInternal(cardID)
      })
      this.reconcilePileCountInternal(reveal.pileCountAfter)
      this.previousDiscardCount = normalizeCount(reveal.discardCountAfter)
    })

    this.warnForIssues(
      this.collectConsistencyIssues(reveal.pileCountAfter, `reveal:${reveal.location}`)
    )
  }

  consumeAnonymous(count: number, position: PublicPosition, reason: string): void {
    if (!this.enabled) return
    this.commit(reason, () => this.consumeAnonymousInternal(count, position))
  }

  revealIdentity(
    cardID: CardID,
    source: 'pile' | 'outside',
    reason: string,
    staysInPile = false
  ): void {
    if (!this.enabled) return
    this.commit(reason, () => {
      if (source === 'pile' && staysInPile) this.revealIdentityInPileInternal(cardID)
      else if (source === 'pile') this.revealIdentityFromPileInternal(cardID)
      else this.revealIdentityOutsidePileInternal(cardID)
    })
  }

  insertKnown(
    cardIDs: readonly CardID[],
    count: number,
    position: PublicPosition,
    reason: string
  ): void {
    if (!this.enabled) return
    this.commit(reason, () => this.insertKnownInternal(cardIDs, count, position))
  }

  insertAnonymous(count: number, position: PublicPosition, reason: string): void {
    if (!this.enabled) return
    this.commit(reason, () => this.insertAnonymousInternal(count, position))
  }

  mergeAll(reason: string): void {
    if (!this.enabled) return
    this.commit(reason, () => {
      this.mergeAllCohortsInternal()
    })
  }

  rotateFromDiscard(cardIDs: readonly CardID[], reason: string): void {
    if (!this.enabled) return
    this.commit(reason, () => this.rotateFromDiscardInternal(cardIDs))
  }

  assertConsistency(pileCount: number, context: string): PileIdentityConsistencyIssue[] {
    if (!this.enabled) return []
    const issues = this.collectConsistencyIssues(pileCount, context)
    this.warnForIssues(issues)
    return issues
  }

  getSnapshot(): PileIdentityLedgerSnapshot {
    const cohort = this.projectCohorts()
    return {
      revision: this.revision,
      identityUniverseIDs: normalizeIDs(Array.from(this.identityUniverse)),
      locatedIdentityIDs: normalizeIDs(Array.from(this.locatedIdentityIDs)),
      knownPileIdentityIDs: normalizeIDs(Array.from(this.knownPileIdentityIDs)),
      knownDiscardIdentityIDs: normalizeIDs(Array.from(this.knownDiscardIdentityIDs)),
      hiddenPileSlotCount: this.getHiddenPileSlotCount(),
      accountedPileCount: this.getAccountedPileCount(),
      cohort
    }
  }

  getUnresolvedIdentityIDs(): CardID[] {
    const identityIDs = new Set<CardID>()
    this.cohorts.forEach((cohort) => {
      cohort.candidateIdentityIDs.forEach((cardID) => identityIDs.add(cardID))
    })
    return normalizeIDs(Array.from(identityIDs))
  }

  private applyShuffleInternal(pileCountAfter: number): void {
    const recycledIdentityIDs = normalizeIDs(Array.from(this.knownDiscardIdentityIDs))
    const anonymousDiscardCount = Math.max(
      0,
      this.previousDiscardCount - recycledIdentityIDs.length
    )

    if (this.previousDiscardCount === 0 && recycledIdentityIDs.length === 0) {
      this.reconcilePileCountInternal(pileCountAfter)
      return
    }

    this.rotateFromDiscardInternal(recycledIdentityIDs)
    this.knownDiscardIdentityIDs.clear()

    if (anonymousDiscardCount > 0) {
      this.degradeToSingleCohortInternal(pileCountAfter)
      this.warn('anonymous-discard-shuffle', {
        anonymousDiscardCount,
        pileCountAfter
      })
      return
    }

    this.reconcilePileCountInternal(pileCountAfter)
  }

  private consumeAnonymousInternal(count: number, position?: PublicPosition): void {
    const normalizedCount = normalizeCount(count)
    if (normalizedCount === 0) return

    if (position === POSITION_RANDOM) {
      this.degradeToSingleCohortInternal(
        Math.max(0, this.getAccountedPileCount() - normalizedCount)
      )
      return
    }

    let remaining = normalizedCount
    const indexes =
      position === POSITION_BOTTOM
        ? Array.from({ length: this.cohorts.length }, (_, index) => index)
        : Array.from({ length: this.cohorts.length }, (_, index) => this.cohorts.length - 1 - index)

    for (const index of indexes) {
      if (remaining === 0) break
      const cohort = this.cohorts[index]
      const consumed = Math.min(cohort.remainingPileCount, remaining)
      cohort.remainingPileCount -= consumed
      remaining -= consumed
    }

    if (remaining > 0) {
      this.degradeToSingleCohortInternal(Math.max(0, this.getAccountedPileCount() - remaining))
      this.warn('unexplained-pile-consumption', {
        requestedCount: normalizedCount,
        unaccountedCount: remaining
      })
    }
  }

  private consumeAnonymousTopRangeInternal(count: number): void {
    const activeCohortCount = this.cohorts.filter((cohort) => cohort.remainingPileCount > 0).length
    if (activeCohortCount > 1) {
      this.degradeToSingleCohortInternal(this.getAccountedPileCount())
    }
    this.consumeAnonymousInternal(count, POSITION_TOP)
  }

  private revealIdentityFromPileInternal(cardID: CardID): void {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return

    this.identityUniverse.add(normalizedCardID)
    this.locatedIdentityIDs.add(normalizedCardID)

    if (this.knownPileIdentityIDs.delete(normalizedCardID)) return
    const cohort = this.findIdentityCohort(normalizedCardID)
    if (!cohort) {
      this.warn('revealed-pile-identity-without-cohort', { cardID: normalizedCardID })
      return
    }

    if (cohort.remainingPileCount <= 0) {
      this.warn('revealed-pile-identity-from-empty-cohort', { cardID: normalizedCardID })
    } else {
      cohort.remainingPileCount -= 1
    }
    cohort.candidateIdentityIDs.delete(normalizedCardID)
    this.removeEmptyCohorts()
  }

  private revealIdentityOutsidePileInternal(cardID: CardID): void {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return

    this.identityUniverse.add(normalizedCardID)
    this.locatedIdentityIDs.add(normalizedCardID)

    if (this.knownPileIdentityIDs.delete(normalizedCardID)) return
    const cohort = this.findIdentityCohort(normalizedCardID)
    if (!cohort) return

    if (cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
      cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1)
      this.warn('outside-reveal-from-all-in-cohort', { cardID: normalizedCardID })
    }
    cohort.candidateIdentityIDs.delete(normalizedCardID)
    this.removeEmptyCohorts()
  }

  private revealIdentityInPileInternal(cardID: CardID): void {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0) || this.knownPileIdentityIDs.has(normalizedCardID)) return

    this.identityUniverse.add(normalizedCardID)
    this.locatedIdentityIDs.add(normalizedCardID)

    const cohort = this.findIdentityCohort(normalizedCardID)
    if (cohort) {
      if (cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1
      else this.warn('pile-reveal-from-empty-cohort', { cardID: normalizedCardID })
      cohort.candidateIdentityIDs.delete(normalizedCardID)
      this.removeEmptyCohorts()
    }
    this.knownPileIdentityIDs.add(normalizedCardID)
  }

  private confirmVisiblePileIdentitiesInternal(cardIDs: readonly CardID[] | undefined): void {
    normalizeIDs(cardIDs ?? []).forEach((cardID) => this.revealIdentityInPileInternal(cardID))
  }

  private insertKnownInternal(
    cardIDs: readonly CardID[],
    count: number,
    position?: PublicPosition
  ): void {
    const identities = normalizeIDs(cardIDs)
    if (identities.length === 0) {
      this.insertAnonymousInternal(count, position)
      return
    }

    if (position === POSITION_RANDOM) {
      identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
      const merged = this.mergeAllCohortsInternal()
      identities.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
      merged.remainingPileCount += identities.length
    } else {
      identities.forEach((cardID) => {
        this.prepareIdentityForPile(cardID)
        const cohort: PileIdentityCohort = {
          generation: this.generation,
          candidateIdentityIDs: new Set([cardID]),
          remainingPileCount: 1
        }
        if (position === POSITION_BOTTOM) this.cohorts.unshift(cohort)
        else this.cohorts.push(cohort)
      })
    }

    const anonymousCount = Math.max(0, normalizeCount(count) - identities.length)
    if (anonymousCount > 0) this.insertAnonymousInternal(anonymousCount, position)
  }

  private insertAnonymousInternal(count: number, _position?: PublicPosition): void {
    const normalizedCount = normalizeCount(count)
    if (normalizedCount === 0) return

    const merged = this.mergeAllCohortsInternal()
    this.addUnresolvedUniverseToCohort(merged)
    const targetCount = merged.remainingPileCount + normalizedCount
    merged.remainingPileCount = Math.min(targetCount, merged.candidateIdentityIDs.size)
    if (targetCount > merged.candidateIdentityIDs.size) {
      this.warn('anonymous-pile-insertion-capacity-shortage', {
        targetCount,
        candidateCount: merged.candidateIdentityIDs.size
      })
    }
  }

  private prepareIdentityForPile(cardID: CardID): void {
    this.identityUniverse.add(cardID)
    this.locatedIdentityIDs.delete(cardID)
    this.knownDiscardIdentityIDs.delete(cardID)
    this.knownPileIdentityIDs.delete(cardID)
    this.removeIdentityFromCohorts(cardID, false)
  }

  private releaseKnownPileIdentitiesExceptInternal(
    preservedCardIDs: readonly CardID[] | undefined
  ): void {
    const preserved = new Set(normalizeIDs(preservedCardIDs ?? []))
    const released: CardID[] = []
    this.knownPileIdentityIDs.forEach((cardID) => {
      if (preserved.has(cardID)) return
      this.knownPileIdentityIDs.delete(cardID)
      this.locatedIdentityIDs.delete(cardID)
      released.push(cardID)
    })
    if (released.length === 0) return

    const merged = this.mergeAllCohortsInternal()
    released.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
    merged.remainingPileCount += released.length
  }

  private rotateFromDiscardInternal(cardIDs: readonly CardID[]): void {
    const identities = normalizeIDs(cardIDs)
    identities.forEach((cardID) => this.prepareIdentityForPile(cardID))
    this.generation += 1
    if (identities.length > 0) {
      this.cohorts.unshift({
        generation: this.generation,
        candidateIdentityIDs: new Set(identities),
        remainingPileCount: identities.length
      })
    }
  }

  private reconcilePileCountInternal(pileCountAfter: number): void {
    const targetPileCount = normalizeCount(pileCountAfter)
    const targetHiddenCount = Math.max(0, targetPileCount - this.knownPileIdentityIDs.size)
    if (targetHiddenCount === this.getHiddenPileSlotCount()) return
    this.degradeToSingleCohortInternal(targetPileCount)
  }

  private degradeToSingleCohortInternal(pileCountAfter: number): void {
    const merged = this.mergeAllCohortsInternal()
    this.addUnresolvedUniverseToCohort(merged)

    const targetHiddenCount = Math.max(
      0,
      normalizeCount(pileCountAfter) - this.knownPileIdentityIDs.size
    )
    merged.remainingPileCount = Math.min(targetHiddenCount, merged.candidateIdentityIDs.size)
    if (targetHiddenCount > merged.candidateIdentityIDs.size) {
      this.warn('pile-identity-capacity-shortage', {
        targetHiddenCount,
        candidateCount: merged.candidateIdentityIDs.size
      })
    }
  }

  private addUnresolvedUniverseToCohort(cohort: PileIdentityCohort): void {
    this.identityUniverse.forEach((cardID) => {
      if (this.locatedIdentityIDs.has(cardID) || this.knownPileIdentityIDs.has(cardID)) return
      cohort.candidateIdentityIDs.add(cardID)
    })
  }

  private mergeAllCohortsInternal(): PileIdentityCohort {
    const merged: PileIdentityCohort = {
      generation: this.generation,
      candidateIdentityIDs: new Set(),
      remainingPileCount: 0
    }
    this.cohorts.forEach((cohort) => {
      cohort.candidateIdentityIDs.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
      merged.remainingPileCount += cohort.remainingPileCount
    })
    this.cohorts = [merged]
    return merged
  }

  private removeIdentityFromCohorts(cardID: CardID, wasInPile: boolean): void {
    const cohort = this.findIdentityCohort(cardID)
    if (!cohort) return
    if (wasInPile && cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1
    if (!wasInPile && cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
      cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1)
    }
    cohort.candidateIdentityIDs.delete(cardID)
    this.removeEmptyCohorts()
  }

  private findIdentityCohort(cardID: CardID): PileIdentityCohort | undefined {
    return this.cohorts.find((cohort) => cohort.candidateIdentityIDs.has(cardID))
  }

  private removeEmptyCohorts(): void {
    this.cohorts = this.cohorts.filter((cohort) => cohort.candidateIdentityIDs.size > 0)
  }

  private getHiddenPileSlotCount(): number {
    return this.cohorts.reduce((sum, cohort) => sum + cohort.remainingPileCount, 0)
  }

  private getAccountedPileCount(): number {
    return this.knownPileIdentityIDs.size + this.getHiddenPileSlotCount()
  }

  private projectCohorts(): PileIdentityCohortSnapshot {
    const groups: PileIdentityCohortProjectionGroup[] = []
    const definitelyInPileIDs = new Set<CardID>(this.knownPileIdentityIDs)
    const definitelyOutsidePileIDs = new Set<CardID>()
    let flatCandidateWidth = 0

    this.cohorts.forEach((cohort) => {
      const cardIDs = normalizeIDs(Array.from(cohort.candidateIdentityIDs))
      if (cardIDs.length === 0) return

      const kind: PileIdentityCohortKind =
        cohort.remainingPileCount === 0
          ? 'none-in-pile'
          : cohort.remainingPileCount === cardIDs.length
            ? 'all-in-pile'
            : 'partial'
      groups.push({
        generation: cohort.generation,
        kind,
        cardIDs,
        remainingPileCount: cohort.remainingPileCount,
        label: createCohortLabel(kind, cardIDs.length, cohort.remainingPileCount)
      })

      if (kind === 'all-in-pile') {
        cardIDs.forEach((cardID) => definitelyInPileIDs.add(cardID))
        return
      }
      if (kind === 'none-in-pile') {
        cardIDs.forEach((cardID) => definitelyOutsidePileIDs.add(cardID))
        return
      }

      flatCandidateWidth += cardIDs.length
    })

    return {
      generation: this.generation,
      groups,
      definitelyInPileIDs: normalizeIDs(Array.from(definitelyInPileIDs)),
      definitelyOutsidePileIDs: normalizeIDs(Array.from(definitelyOutsidePileIDs)),
      flatCandidateWidth
    }
  }

  private collectConsistencyIssues(
    pileCount: number,
    context: string
  ): PileIdentityConsistencyIssue[] {
    const issues: PileIdentityConsistencyIssue[] = []
    const seen = new Set<CardID>()

    this.cohorts.forEach((cohort) => {
      if (
        cohort.remainingPileCount < 0 ||
        cohort.remainingPileCount > cohort.candidateIdentityIDs.size
      ) {
        issues.push({
          context,
          reason: 'cohort-cardinality-out-of-range',
          expected: cohort.candidateIdentityIDs.size,
          actual: cohort.remainingPileCount
        })
      }

      cohort.candidateIdentityIDs.forEach((cardID) => {
        if (seen.has(cardID)) issues.push({ context, reason: 'duplicate-cohort-identity', cardID })
        if (this.locatedIdentityIDs.has(cardID)) {
          issues.push({ context, reason: 'located-identity-in-cohort', cardID })
        }
        if (this.knownPileIdentityIDs.has(cardID)) {
          issues.push({ context, reason: 'known-pile-identity-in-cohort', cardID })
        }
        seen.add(cardID)
      })
    })

    const expectedPileCount = normalizeCount(pileCount)
    const actualPileCount = this.getAccountedPileCount()
    if (expectedPileCount !== actualPileCount) {
      issues.push({
        context,
        reason: 'pile-count-mismatch',
        expected: expectedPileCount,
        actual: actualPileCount
      })
    }

    return issues
  }

  private commit(reason: string, update: () => void): void {
    const previous = this.captureState()
    try {
      update()
      this.assertInternalState(reason)
      this.revision += 1
    } catch (error) {
      this.restoreState(previous)
      this.warn('transaction-rollback', { reason, error })
    }
  }

  private assertInternalState(context: string): void {
    const issues = this.collectConsistencyIssues(this.getAccountedPileCount(), context).filter(
      (issue) => issue.reason !== 'pile-count-mismatch'
    )
    if (issues.length > 0) throw new Error(JSON.stringify(issues))
  }

  private captureState(): PileIdentityLedgerState {
    return {
      revision: this.revision,
      generation: this.generation,
      identityUniverse: new Set(this.identityUniverse),
      locatedIdentityIDs: new Set(this.locatedIdentityIDs),
      knownPileIdentityIDs: new Set(this.knownPileIdentityIDs),
      knownDiscardIdentityIDs: new Set(this.knownDiscardIdentityIDs),
      previousDiscardCount: this.previousDiscardCount,
      cohorts: this.cohorts.map(cloneCohort)
    }
  }

  private restoreState(state: PileIdentityLedgerState): void {
    this.revision = state.revision
    this.generation = state.generation
    this.identityUniverse = state.identityUniverse
    this.locatedIdentityIDs = state.locatedIdentityIDs
    this.knownPileIdentityIDs = state.knownPileIdentityIDs
    this.knownDiscardIdentityIDs = state.knownDiscardIdentityIDs
    this.previousDiscardCount = state.previousDiscardCount
    this.cohorts = state.cohorts
  }

  private warnForIssues(issues: readonly PileIdentityConsistencyIssue[]): void {
    issues.forEach((issue) => this.warn(issue.reason, { ...issue }))
  }

  private warn(reason: string, detail: Record<string, unknown>): void {
    this.onWarning('牌堆身份账本异常', { reason, ...detail })
  }
}
