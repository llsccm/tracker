import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '../candidate/cardPositions'
import type { CardID, PublicPosition } from '../types'

export type PileIdentityComparisonModel = 'baseline' | 'generation' | 'cohort'

export type CohortProjectionKind = 'all-in-pile' | 'none-in-pile' | 'partial'

export interface ShadowPileIdentityCohort {
  generation: number
  candidateIdentityIDs: Set<CardID>
  remainingPileCount: number
}

export interface ShadowCohortProjectionGroup {
  generation: number
  kind: CohortProjectionKind
  cardIDs: CardID[]
  remainingPileCount: number
  label: string
}

export interface PileIdentityComparisonMove {
  eventType: string
  fromZone: number | null
  toZone: number | null
  cardIDs: CardID[]
  cardCount: number
  fromPosition?: PublicPosition
  toPosition?: PublicPosition
  moveType?: number | string
  spellID?: number | string | null
  pileCountAfter: number
}

export interface PileIdentityComparisonReveal {
  cardIDs: CardID[]
  location: 'pile' | 'outside'
  pileCountAfter: number
}

export interface PileIdentityComparisonSnapshot {
  currentCandidateIDs: CardID[]
  generationCandidateIDs: CardID[]
  cohortCandidateIDs: CardID[]
  generationAddedCandidateIDs: CardID[]
  generationRemovedCandidateIDs: CardID[]
  cohortAddedCandidateIDs: CardID[]
  cohortRemovedCandidateIDs: CardID[]
  generation: {
    generation: number
    activeIdentityIDs: CardID[]
    suspendedIdentityIDs: CardID[]
    definitelyInPileIDs: CardID[]
  }
  cohort: {
    generation: number
    groups: ShadowCohortProjectionGroup[]
    definitelyInPileIDs: CardID[]
    definitelyOutsidePileIDs: CardID[]
    flatCandidateWidth: number
  }
}

export interface PileIdentityComparisonMetrics {
  maxCurrentCandidateCount: number
  maxGenerationCandidateCount: number
  maxCohortCandidateCount: number
  maxCohortFlatCandidateWidth: number
  maxCohortGroupCount: number
  batchBoundaryRiskEventCount: number
  batchBoundaryDegradationCount: number
  unsupportedEventCount: number
}

export interface PileIdentityDegradation {
  eventSeq: number
  reason: string
  eventType: string
  fromZone: number | null
  toZone: number | null
  cardIDs: CardID[]
  cardCount: number
  fromPosition: PublicPosition | null
  toPosition: PublicPosition | null
  moveType: number | string | null
  spellID: number | string | null
  pileCountAfter: number
  boundaryRisk: boolean
  boundaryDegraded: boolean
  cohortGroupCountBefore: number
  cohortGroupCountAfter: number
}

type PileIdentityDegradationContext = Omit<
  PileIdentityDegradation,
  | 'eventSeq'
  | 'reason'
  | 'boundaryRisk'
  | 'boundaryDegraded'
  | 'cohortGroupCountBefore'
  | 'cohortGroupCountAfter'
>

export interface PileIdentityComparisonReport {
  metrics: PileIdentityComparisonMetrics
  snapshot: PileIdentityComparisonSnapshot
  degradations: PileIdentityDegradation[]
}

function normalizeIDs(cardIDs: readonly CardID[]): CardID[] {
  return Array.from(new Set(cardIDs.filter((cardID) => cardID > 0))).sort(
    (left, right) => left - right
  )
}

function difference(left: Iterable<CardID>, right: Iterable<CardID>): CardID[] {
  const rightSet = new Set(right)
  return Array.from(left)
    .filter((cardID) => !rightSet.has(cardID))
    .sort((a, b) => a - b)
}

function createCohortLabel(kind: CohortProjectionKind, size: number, count: number): string {
  if (kind === 'all-in-pile') return `这 ${size} 张都在牌堆`
  if (kind === 'none-in-pile') return `这 ${size} 张都不在牌堆`
  return `这 ${size} 张里有 ${count} 张在牌堆`
}

/**
 * Phase 1 的 DEV 只读三模型账本。
 *
 * 账本只消费 Controller 已经完成的协议事件与只读投影，不持有 `Room` 引用，也不会把
 * 影子状态写回生产对象。遇到无法维护批次边界的事件时合并批次并显式记录降级原因。
 */
export class PileIdentityModelComparison {
  private eventSeq = 0
  private identityUniverse = new Set<CardID>()
  private locatedIdentityIDs = new Set<CardID>()
  private knownPileIDs = new Set<CardID>()
  private knownDiscardIDs = new Set<CardID>()
  private previousDiscardCount = 0

  private generation = 0
  private activeGenerationIDs = new Set<CardID>()
  private suspendedGenerationIDs = new Set<CardID>()
  private generationDefinitelyInPileIDs = new Set<CardID>()

  private cohortGeneration = 0
  private cohorts: ShadowPileIdentityCohort[] = []

  private currentCandidateIDs = new Set<CardID>()
  private maxCurrentCandidateCount = 0
  private maxGenerationCandidateCount = 0
  private maxCohortCandidateCount = 0
  private maxCohortFlatCandidateWidth = 0
  private maxCohortGroupCount = 0
  private batchBoundaryRiskEventCount = 0
  private batchBoundaryDegradationCount = 0
  private unsupportedEventCount = 0
  private readonly degradations: PileIdentityDegradation[] = []
  private degradationContext: PileIdentityDegradationContext | null = null

  initialize(cardIDs: readonly CardID[], currentCandidateIDs: readonly CardID[] = []): void {
    const identities = normalizeIDs(cardIDs)
    this.eventSeq = 0
    this.identityUniverse = new Set(identities)
    this.locatedIdentityIDs.clear()
    this.knownPileIDs.clear()
    this.knownDiscardIDs.clear()
    this.previousDiscardCount = 0

    this.generation = 0
    this.activeGenerationIDs = new Set(identities)
    this.suspendedGenerationIDs.clear()
    this.generationDefinitelyInPileIDs = new Set(identities)

    this.cohortGeneration = 0
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

    this.currentCandidateIDs = new Set(normalizeIDs(currentCandidateIDs))
    this.maxCurrentCandidateCount = this.currentCandidateIDs.size
    this.maxGenerationCandidateCount = 0
    this.maxCohortCandidateCount = 0
    this.maxCohortFlatCandidateWidth = 0
    this.maxCohortGroupCount = this.cohorts.length
    this.batchBoundaryRiskEventCount = 0
    this.batchBoundaryDegradationCount = 0
    this.unsupportedEventCount = 0
    this.degradations.length = 0
    this.degradationContext = null
  }

  applyMove(
    move: PileIdentityComparisonMove,
    currentCandidateIDs: readonly CardID[],
    discardCountAfter: number
  ): void {
    this.eventSeq += 1
    const cardIDs = normalizeIDs(move.cardIDs)
    this.degradationContext = {
      eventType: move.eventType,
      fromZone: move.fromZone,
      toZone: move.toZone,
      cardIDs,
      cardCount: move.cardCount,
      fromPosition: move.fromPosition ?? null,
      toPosition: move.toPosition ?? null,
      moveType: move.moveType ?? null,
      spellID: move.spellID ?? null,
      pileCountAfter: move.pileCountAfter
    }
    const knownCount = cardIDs.length
    const unknownCount = Math.max(0, move.cardCount - knownCount)

    if (move.eventType === 'noop') {
      this.observeProjection(currentCandidateIDs, discardCountAfter)
      return
    }

    if (move.eventType === 'shuffleDiscardIntoPile') {
      this.applyShuffle(move.pileCountAfter)
      this.observeProjection(currentCandidateIDs, discardCountAfter)
      return
    }

    const staysInPile = move.fromZone === 1 && move.toZone === 1
    if (staysInPile) {
      cardIDs.forEach((cardID) => this.revealIdentityInPile(cardID))
      this.reconcilePileCount(move.pileCountAfter, 'same-zone-pile-reveal')
      this.observeProjection(currentCandidateIDs, discardCountAfter)
      return
    }

    if (move.fromZone === 1) {
      cardIDs.forEach((cardID) => this.revealIdentityFromPile(cardID))
      if (unknownCount > 0) {
        const isTopRangeGain =
          Number(move.moveType) === 18 &&
          Number(move.spellID) === 7011 &&
          move.fromPosition !== POSITION_RANDOM
        if (isTopRangeGain) this.consumeUnknownPileTopRange(unknownCount)
        else if (Number(move.moveType) === 18) {
          this.consumeUnknownPileSlots(unknownCount, POSITION_RANDOM)
        } else this.consumeUnknownPileSlots(unknownCount, move.fromPosition)
        this.generationDefinitelyInPileIDs.clear()
      }
    } else if (move.toZone === 1) {
      if (cardIDs.length > 0) {
        const randomInsertion =
          move.toPosition === POSITION_RANDOM ||
          (move.fromZone === 0 && Number(move.spellID) === 3694) ||
          cardIDs.some((cardID) => cardID === 4400 || cardID === 4401)

        if (randomInsertion) this.insertKnownAtRandom(cardIDs)
        else cardIDs.forEach((cardID) => this.returnKnownIdentityToPile(cardID, move.toPosition))
      }

      if (unknownCount > 0) {
        this.degradeToSingleCohort(move.pileCountAfter, 'unknown-return-to-pile', true)
        this.generationDefinitelyInPileIDs.clear()
      }
    } else {
      cardIDs.forEach((cardID) => this.revealIdentityOutsidePile(cardID))
    }

    if (move.fromZone === 2) cardIDs.forEach((cardID) => this.knownDiscardIDs.delete(cardID))
    if (move.toZone === 2) cardIDs.forEach((cardID) => this.knownDiscardIDs.add(cardID))

    this.reconcilePileCount(move.pileCountAfter, 'protocol-move')
    this.observeProjection(currentCandidateIDs, discardCountAfter)
  }

  applyReveal(
    reveal: PileIdentityComparisonReveal,
    currentCandidateIDs: readonly CardID[],
    discardCountAfter: number
  ): void {
    this.eventSeq += 1
    const cardIDs = normalizeIDs(reveal.cardIDs)
    this.degradationContext = {
      eventType: `explicit-reveal:${reveal.location}`,
      fromZone: null,
      toZone: null,
      cardIDs,
      cardCount: cardIDs.length,
      fromPosition: null,
      toPosition: null,
      moveType: null,
      spellID: null,
      pileCountAfter: reveal.pileCountAfter
    }
    if (reveal.location === 'pile') {
      cardIDs.forEach((cardID) => this.revealIdentityInPile(cardID))
    } else {
      cardIDs.forEach((cardID) => this.revealIdentityOutsidePile(cardID))
    }

    this.reconcilePileCount(reveal.pileCountAfter, 'explicit-reveal')
    this.observeProjection(currentCandidateIDs, discardCountAfter)
  }

  observeProjection(currentCandidateIDs: readonly CardID[], discardCount: number): void {
    this.currentCandidateIDs = new Set(normalizeIDs(currentCandidateIDs))
    this.previousDiscardCount = Math.max(0, discardCount)

    const projection = this.projectCohorts()
    this.maxCurrentCandidateCount = Math.max(
      this.maxCurrentCandidateCount,
      this.currentCandidateIDs.size
    )
    this.maxGenerationCandidateCount = Math.max(
      this.maxGenerationCandidateCount,
      this.suspendedGenerationIDs.size
    )
    this.maxCohortCandidateCount = Math.max(
      this.maxCohortCandidateCount,
      projection.candidateIDs.size
    )
    this.maxCohortFlatCandidateWidth = Math.max(
      this.maxCohortFlatCandidateWidth,
      projection.flatCandidateWidth
    )
    this.maxCohortGroupCount = Math.max(this.maxCohortGroupCount, projection.groups.length)
  }

  getGenerationDefinitelyInPileIDs(): Set<CardID> {
    return new Set([...this.knownPileIDs, ...this.generationDefinitelyInPileIDs])
  }

  getCohortDefinitelyInPileIDs(): Set<CardID> {
    return new Set(this.projectCohorts().definitelyInPileIDs)
  }

  getCohortSnapshot(): PileIdentityComparisonSnapshot['cohort'] {
    const projection = this.projectCohorts()
    return {
      generation: this.cohortGeneration,
      groups: projection.groups,
      definitelyInPileIDs: normalizeIDs(Array.from(projection.definitelyInPileIDs)),
      definitelyOutsidePileIDs: normalizeIDs(Array.from(projection.definitelyOutsidePileIDs)),
      flatCandidateWidth: projection.flatCandidateWidth
    }
  }

  getReport(): PileIdentityComparisonReport {
    const projection = this.projectCohorts()
    const currentCandidateIDs = normalizeIDs(Array.from(this.currentCandidateIDs))
    const generationCandidateIDs = normalizeIDs(Array.from(this.suspendedGenerationIDs))
    const cohortCandidateIDs = normalizeIDs(Array.from(projection.candidateIDs))

    return {
      metrics: {
        maxCurrentCandidateCount: this.maxCurrentCandidateCount,
        maxGenerationCandidateCount: this.maxGenerationCandidateCount,
        maxCohortCandidateCount: this.maxCohortCandidateCount,
        maxCohortFlatCandidateWidth: this.maxCohortFlatCandidateWidth,
        maxCohortGroupCount: this.maxCohortGroupCount,
        batchBoundaryRiskEventCount: this.batchBoundaryRiskEventCount,
        batchBoundaryDegradationCount: this.batchBoundaryDegradationCount,
        unsupportedEventCount: this.unsupportedEventCount
      },
      snapshot: {
        currentCandidateIDs,
        generationCandidateIDs,
        cohortCandidateIDs,
        generationAddedCandidateIDs: difference(generationCandidateIDs, currentCandidateIDs),
        generationRemovedCandidateIDs: difference(currentCandidateIDs, generationCandidateIDs),
        cohortAddedCandidateIDs: difference(cohortCandidateIDs, currentCandidateIDs),
        cohortRemovedCandidateIDs: difference(currentCandidateIDs, cohortCandidateIDs),
        generation: {
          generation: this.generation,
          activeIdentityIDs: normalizeIDs(Array.from(this.activeGenerationIDs)),
          suspendedIdentityIDs: generationCandidateIDs,
          definitelyInPileIDs: normalizeIDs(Array.from(this.getGenerationDefinitelyInPileIDs()))
        },
        cohort: this.getCohortSnapshot()
      },
      degradations: this.degradations.map((item) => ({
        ...item,
        cardIDs: [...item.cardIDs]
      }))
    }
  }

  private applyShuffle(pileCountAfter: number): void {
    const recycledIdentityIDs = normalizeIDs(Array.from(this.knownDiscardIDs))
    const anonymousDiscardCount = Math.max(
      0,
      this.previousDiscardCount - recycledIdentityIDs.length
    )
    if (this.previousDiscardCount === 0 && recycledIdentityIDs.length === 0) {
      this.reconcilePileCount(pileCountAfter, 'empty-discard-shuffle')
      return
    }

    this.activeGenerationIDs.forEach((cardID) => this.suspendedGenerationIDs.add(cardID))
    this.activeGenerationIDs = new Set(recycledIdentityIDs)
    this.generationDefinitelyInPileIDs = new Set(recycledIdentityIDs)
    this.generation += 1

    recycledIdentityIDs.forEach((cardID) => {
      this.identityUniverse.add(cardID)
      this.locatedIdentityIDs.delete(cardID)
      this.removeIdentityFromCohorts(cardID, false)
      this.knownPileIDs.delete(cardID)
    })

    this.cohortGeneration += 1
    if (recycledIdentityIDs.length > 0) {
      this.cohorts.unshift({
        generation: this.cohortGeneration,
        candidateIdentityIDs: new Set(recycledIdentityIDs),
        remainingPileCount: recycledIdentityIDs.length
      })
    }

    this.knownDiscardIDs.clear()
    if (anonymousDiscardCount > 0) {
      this.degradeToSingleCohort(pileCountAfter, 'anonymous-discard-shuffle', true)
      this.unsupportedEventCount += 1
      return
    }

    this.reconcilePileCount(pileCountAfter, 'pile-shuffle')
  }

  private consumeUnknownPileSlots(count: number, position?: PublicPosition): void {
    if (position === POSITION_RANDOM) {
      // 匿名任意位置取牌与普通暗摸一样，只能确认暗槽数量减少，不能筛出具体身份。
      // 合并为全局未决集合等待后续展示，但不把这种正常失效计为批次风险或模型降级。
      this.degradeToSingleCohort(
        Math.max(0, this.getAccountedPileCount() - count),
        'anonymous-pile-draw',
        false
      )
      return
    }

    let remaining = count
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
      this.degradeToSingleCohort(
        Math.max(0, this.getAccountedPileCount() - remaining),
        'unexplained-pile-consumption',
        true
      )
      this.unsupportedEventCount += 1
    }
  }

  private consumeUnknownPileTopRange(count: number): void {
    const activeCohortCount = this.cohorts.filter((cohort) => cohort.remainingPileCount > 0).length
    if (activeCohortCount > 1) {
      this.degradeToSingleCohort(this.getAccountedPileCount(), 'anonymous-top-range-gain', true)
    }
    this.consumeUnknownPileSlots(count, POSITION_TOP)
  }

  private revealIdentityFromPile(cardID: CardID): void {
    this.identityUniverse.add(cardID)
    this.activeGenerationIDs.delete(cardID)
    this.suspendedGenerationIDs.delete(cardID)
    this.generationDefinitelyInPileIDs.delete(cardID)
    this.locatedIdentityIDs.add(cardID)

    if (this.knownPileIDs.delete(cardID)) return
    const cohort = this.findIdentityCohort(cardID)
    if (!cohort) {
      this.recordDegradation('revealed-pile-identity-without-cohort')
      this.unsupportedEventCount += 1
      return
    }

    if (cohort.remainingPileCount <= 0) {
      this.recordDegradation('revealed-pile-identity-from-empty-cohort')
      this.unsupportedEventCount += 1
    } else {
      cohort.remainingPileCount -= 1
    }
    cohort.candidateIdentityIDs.delete(cardID)
    this.removeEmptyCohorts()
  }

  private revealIdentityOutsidePile(cardID: CardID): void {
    this.identityUniverse.add(cardID)
    this.activeGenerationIDs.delete(cardID)
    this.suspendedGenerationIDs.delete(cardID)
    this.generationDefinitelyInPileIDs.delete(cardID)
    this.locatedIdentityIDs.add(cardID)

    if (this.knownPileIDs.delete(cardID)) return
    const cohort = this.findIdentityCohort(cardID)
    if (!cohort) return

    if (cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
      cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1)
      this.recordDegradation('outside-reveal-from-all-in-cohort')
    }
    cohort.candidateIdentityIDs.delete(cardID)
    this.removeEmptyCohorts()
  }

  private revealIdentityInPile(cardID: CardID): void {
    if (this.knownPileIDs.has(cardID)) return

    this.identityUniverse.add(cardID)
    this.activeGenerationIDs.delete(cardID)
    this.suspendedGenerationIDs.delete(cardID)
    this.generationDefinitelyInPileIDs.delete(cardID)
    this.locatedIdentityIDs.add(cardID)

    const cohort = this.findIdentityCohort(cardID)
    if (cohort) {
      if (cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1
      else this.recordDegradation('pile-reveal-from-empty-cohort')
      cohort.candidateIdentityIDs.delete(cardID)
      this.removeEmptyCohorts()
    }
    this.knownPileIDs.add(cardID)
  }

  private returnKnownIdentityToPile(cardID: CardID, position?: PublicPosition): void {
    this.identityUniverse.add(cardID)
    this.locatedIdentityIDs.delete(cardID)
    this.knownDiscardIDs.delete(cardID)
    this.knownPileIDs.delete(cardID)
    this.removeIdentityFromCohorts(cardID, false)

    this.activeGenerationIDs.add(cardID)
    this.suspendedGenerationIDs.delete(cardID)
    this.generationDefinitelyInPileIDs.add(cardID)

    const cohort: ShadowPileIdentityCohort = {
      generation: this.cohortGeneration,
      candidateIdentityIDs: new Set([cardID]),
      remainingPileCount: 1
    }
    if (position === POSITION_BOTTOM) this.cohorts.unshift(cohort)
    else this.cohorts.push(cohort)
  }

  private insertKnownAtRandom(cardIDs: readonly CardID[]): void {
    const cohortGroupCountBefore = this.cohorts.length
    cardIDs.forEach((cardID) => {
      this.identityUniverse.add(cardID)
      this.locatedIdentityIDs.delete(cardID)
      this.knownDiscardIDs.delete(cardID)
      this.knownPileIDs.delete(cardID)
      this.removeIdentityFromCohorts(cardID, false)
      this.activeGenerationIDs.add(cardID)
      this.suspendedGenerationIDs.delete(cardID)
    })
    this.generationDefinitelyInPileIDs.clear()

    const merged = this.mergeAllCohorts()
    cardIDs.forEach((cardID) => merged.candidateIdentityIDs.add(cardID))
    merged.remainingPileCount += cardIDs.length
    this.recordDegradation('random-pile-insertion', true, cohortGroupCountBefore)
  }

  private reconcilePileCount(pileCountAfter: number, reason: string): void {
    const targetUnknownCount = Math.max(0, pileCountAfter - this.knownPileIDs.size)
    const currentUnknownCount = this.cohorts.reduce(
      (sum, cohort) => sum + cohort.remainingPileCount,
      0
    )
    if (targetUnknownCount === currentUnknownCount) return

    this.degradeToSingleCohort(pileCountAfter, `pile-count-reconcile:${reason}`, false)
  }

  private degradeToSingleCohort(
    pileCountAfter: number,
    reason: string,
    countAsBoundaryDegradation: boolean
  ): void {
    const cohortGroupCountBefore = this.cohorts.length
    const merged = this.mergeAllCohorts()
    this.identityUniverse.forEach((cardID) => {
      if (this.locatedIdentityIDs.has(cardID) || this.knownPileIDs.has(cardID)) return
      merged.candidateIdentityIDs.add(cardID)
    })

    const targetUnknownCount = Math.max(0, pileCountAfter - this.knownPileIDs.size)
    merged.remainingPileCount = Math.min(targetUnknownCount, merged.candidateIdentityIDs.size)
    if (targetUnknownCount > merged.candidateIdentityIDs.size) {
      this.unsupportedEventCount += 1
    }
    this.recordDegradation(reason, countAsBoundaryDegradation, cohortGroupCountBefore)
  }

  private mergeAllCohorts(): ShadowPileIdentityCohort {
    const merged: ShadowPileIdentityCohort = {
      generation: this.cohortGeneration,
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

  private findIdentityCohort(cardID: CardID): ShadowPileIdentityCohort | undefined {
    return this.cohorts.find((cohort) => cohort.candidateIdentityIDs.has(cardID))
  }

  private removeEmptyCohorts(): void {
    this.cohorts = this.cohorts.filter((cohort) => cohort.candidateIdentityIDs.size > 0)
  }

  private getAccountedPileCount(): number {
    return (
      this.knownPileIDs.size +
      this.cohorts.reduce((sum, cohort) => sum + cohort.remainingPileCount, 0)
    )
  }

  private projectCohorts(): {
    groups: ShadowCohortProjectionGroup[]
    candidateIDs: Set<CardID>
    definitelyInPileIDs: Set<CardID>
    definitelyOutsidePileIDs: Set<CardID>
    flatCandidateWidth: number
  } {
    const groups: ShadowCohortProjectionGroup[] = []
    const candidateIDs = new Set<CardID>()
    const definitelyInPileIDs = new Set<CardID>(this.knownPileIDs)
    const definitelyOutsidePileIDs = new Set<CardID>()
    let flatCandidateWidth = 0

    this.cohorts.forEach((cohort) => {
      const cardIDs = normalizeIDs(Array.from(cohort.candidateIdentityIDs))
      if (cardIDs.length === 0) return

      const kind: CohortProjectionKind =
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
        cardIDs.forEach((cardID) => {
          candidateIDs.add(cardID)
          definitelyOutsidePileIDs.add(cardID)
        })
        return
      }

      flatCandidateWidth += cardIDs.length
      cardIDs.forEach((cardID) => candidateIDs.add(cardID))
    })

    return {
      groups,
      candidateIDs,
      definitelyInPileIDs,
      definitelyOutsidePileIDs,
      flatCandidateWidth
    }
  }

  private recordDegradation(
    reason: string,
    boundaryRisk = false,
    cohortGroupCountBefore = this.cohorts.length
  ): void {
    const previous = this.degradations[this.degradations.length - 1]
    if (previous?.eventSeq === this.eventSeq && previous.reason === reason) return
    const context = this.degradationContext ?? {
      eventType: 'observer-internal',
      fromZone: null,
      toZone: null,
      cardIDs: [],
      cardCount: 0,
      fromPosition: null,
      toPosition: null,
      moveType: null,
      spellID: null,
      pileCountAfter: this.getAccountedPileCount()
    }
    const cohortGroupCountAfter = this.cohorts.length
    const boundaryDegraded = boundaryRisk && cohortGroupCountAfter < cohortGroupCountBefore
    this.degradations.push({
      eventSeq: this.eventSeq,
      reason,
      ...context,
      cardIDs: [...context.cardIDs],
      boundaryRisk,
      boundaryDegraded,
      cohortGroupCountBefore,
      cohortGroupCountAfter
    })
    if (boundaryRisk) this.batchBoundaryRiskEventCount += 1
    if (boundaryDegraded) this.batchBoundaryDegradationCount += 1
  }
}
